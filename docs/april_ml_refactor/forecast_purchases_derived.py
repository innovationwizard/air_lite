"""
Derived purchase forecast — purchases as a function of sales forecast.

Architecture decision (documented in ML_TRAINING_DATA_FINDINGS_2026-04-28.md):
    Sales       → Prophet (time series; 75–97% daily nonzero density is ideal)
    PO Ordered  → sales_forecast × median(historical PO/Sales ratio per SKU)
    PO Received → sales_forecast × median(historical Received/Sales ratio per SKU)

Why not Prophet for purchases:
    Purchase orders are business decisions, not stochastic processes.  Daily
    purchase density is 4.7–16.8% across the 23 demo SKUs — structurally
    incompatible with any additive time-series decomposition model.  Prophet's
    own confidence intervals collapsing to [0, 300,000+] confirm it extracts
    zero reliable signal from this data.

Why the ratio method works:
    Wholesale distributors buy to replenish what they sell.  Monthly purchases
    track monthly sales with a stable per-SKU multiplier (typically 1.0–1.6×).
    The median ratio is robust to monthly variance by definition.  Tukey's
    fence (IQR × 1.5) automatically excludes anomaly months — Oct 2024
    onboarding artifact, Jan 2026 bulk pre-buy — without hardcoding dates.

Data source:
    revenue_daily_for_ml  — complete with locked POs, Oct 2024 smoothed.

Dependency:
    Sales forecast must be persisted in forecast_results BEFORE calling this
    module.  The orchestrator (route.ts) enforces this by running Prophet for
    sales in Pass 1 and derived purchases in Pass 2.

Reference:
    ML_TRAINING_DATA_FINDINGS_2026-04-28.md   — root cause analysis
    ML_PURCHASE_HYPOTHESIS_REVALIDATION_2026-04-28.md — purchase frequency
    ML_SYSTEM_OVERVIEW.md § 5                 — model architecture
"""

import logging
from datetime import date
from typing import Optional

import numpy as np
import pandas as pd
from supabase import Client

logger = logging.getLogger(__name__)

VALID_PURCHASE_METRICS = frozenset({'purchases_ordered', 'purchases_received'})


# ── Internal helpers ──────────────────────────────────────────────────────────


def _compute_monthly_totals(
    supabase: Client,
    product_id: int,
    training_start: date,
    training_end: date,
) -> pd.DataFrame:
    """Aggregate revenue_daily_for_ml to monthly totals per metric.

    Returns a DataFrame with columns [month, sales, purchases_ordered,
    purchases_received].  One row per calendar month.  Metrics absent from the
    source table are filled with 0.
    """
    result = supabase.table('revenue_daily_for_ml').select(
        'observation_date, metric, quantity'
    ).eq(
        'product_id', product_id,
    ).gte(
        'observation_date', training_start.isoformat(),
    ).lte(
        'observation_date', training_end.isoformat(),
    ).execute()

    if not result.data:
        return pd.DataFrame(columns=['month', 'sales', 'purchases_ordered', 'purchases_received'])

    df = pd.DataFrame(result.data)
    df['month'] = df['observation_date'].str[:7]
    df['quantity'] = df['quantity'].astype(float)

    monthly = (
        df.groupby(['month', 'metric'])['quantity']
        .sum()
        .reset_index()
    )
    pivoted = (
        monthly.pivot(index='month', columns='metric', values='quantity')
        .fillna(0)
        .reset_index()
    )

    for col in ('sales', 'purchases_ordered', 'purchases_received'):
        if col not in pivoted.columns:
            pivoted[col] = 0.0

    return pivoted[['month', 'sales', 'purchases_ordered', 'purchases_received']]


def _compute_ratio_with_outlier_exclusion(
    monthly_df: pd.DataFrame,
    numerator_col: str,
    denominator_col: str,
) -> dict:
    """Compute median ratio with Tukey's fence (IQR × 1.5) outlier exclusion.

    Only months where both numerator and denominator are strictly positive
    contribute a ratio data point.  Months with zero sales or zero purchases
    are structurally different events (stockout, no-order month) and must not
    dilute the ratio of months where both activities occurred.

    Returns an audit-friendly dict:
        ratio_median      – the robust central estimate (or None)
        ratio_count       – months used to compute the median
        ratio_excluded    – months dropped by Tukey's fence
        ratios_used       – [(month, ratio), ...] for transparency
        ratios_excluded   – [(month, ratio), ...] for transparency
    """
    valid = monthly_df[
        (monthly_df[denominator_col] > 0) & (monthly_df[numerator_col] > 0)
    ].copy()

    if valid.empty:
        return {
            'ratio_median': None,
            'ratio_count': 0,
            'ratio_excluded': 0,
            'ratios_used': [],
            'ratios_excluded': [],
        }

    valid = valid.copy()
    valid['ratio'] = valid[numerator_col] / valid[denominator_col]

    # Fewer than 4 data points: Tukey's fence is unreliable, use raw median.
    if len(valid) < 4:
        return {
            'ratio_median': float(np.median(valid['ratio'])),
            'ratio_count': len(valid),
            'ratio_excluded': 0,
            'ratios_used': list(zip(valid['month'].tolist(), valid['ratio'].round(4).tolist())),
            'ratios_excluded': [],
        }

    q1 = float(np.percentile(valid['ratio'], 25))
    q3 = float(np.percentile(valid['ratio'], 75))
    iqr = q3 - q1
    lower_fence = q1 - 1.5 * iqr
    upper_fence = q3 + 1.5 * iqr

    inlier_mask = (valid['ratio'] >= lower_fence) & (valid['ratio'] <= upper_fence)
    inliers = valid[inlier_mask]
    outliers = valid[~inlier_mask]

    # Edge case: IQR is zero (all ratios identical) or all points outside
    # fence (degenerate distribution).  Fall back to full median.
    if inliers.empty:
        logger.warning(
            'Tukey fence excluded all %d data points (IQR=%.4f). '
            'Falling back to unfiltered median.',
            len(valid), iqr,
        )
        inliers = valid
        outliers = valid.iloc[0:0]

    return {
        'ratio_median': float(np.median(inliers['ratio'])),
        'ratio_count': len(inliers),
        'ratio_excluded': len(outliers),
        'ratios_used': list(zip(
            inliers['month'].tolist(),
            inliers['ratio'].round(4).tolist(),
        )),
        'ratios_excluded': list(zip(
            outliers['month'].tolist(),
            outliers['ratio'].round(4).tolist(),
        )),
    }


def _load_sales_forecasts(
    supabase: Client,
    product_id: int,
    training_end: date,
    forecast_months: list[str],
) -> dict[str, dict[str, float]]:
    """Load persisted Prophet sales forecasts from forecast_results.

    Returns: { '2026-02': {yhat_sum, yhat_lower_sum, yhat_upper_sum}, ... }
    """
    month_dates = [f'{m}-01' for m in forecast_months]

    result = supabase.table('forecast_results').select(
        'forecast_month, yhat_sum, yhat_lower_sum, yhat_upper_sum',
    ).eq(
        'product_id', product_id,
    ).eq(
        'metric', 'sales',
    ).eq(
        'training_end_date', training_end.isoformat(),
    ).eq(
        'model_status', 'ok',
    ).in_(
        'forecast_month', month_dates,
    ).execute()

    forecasts: dict[str, dict[str, float]] = {}
    for row in (result.data or []):
        month_key = str(row['forecast_month'])[:7]
        forecasts[month_key] = {
            'yhat_sum': float(row['yhat_sum']),
            'yhat_lower_sum': float(row['yhat_lower_sum'] or 0),
            'yhat_upper_sum': float(row['yhat_upper_sum'] or 0),
        }
    return forecasts


# ── Public API ────────────────────────────────────────────────────────────────


def forecast_purchases_derived(
    supabase: Client,
    product_id: int,
    metric: str,
    ssot_label: str,
    training_start: date,
    training_end: date,
    forecast_months: list[str],
) -> dict:
    """Derive a monthly purchase forecast from the persisted sales forecast.

    Pipeline:
        1. Aggregate revenue_daily_for_ml → monthly sales + purchase totals
        2. Compute per-SKU ratio (purchase/sales) with Tukey outlier exclusion
        3. Read Prophet sales forecast from forecast_results
        4. Multiply: forecast_purchases = forecast_sales × R

    Args:
        supabase:        Service-role client.
        product_id:      products.id
        metric:          'purchases_ordered' | 'purchases_received'
        ssot_label:      SSOT label (echoed into output for persistence).
        training_start:  First day of training window.
        training_end:    Last day of training window.
        forecast_months: ['2026-02', '2026-03'] — months to predict.

    Returns dict shaped for persistence into forecast_results:
        status          'ok_derived' | 'insufficient_ratio_data' | 'no_sales_forecast'
        monthly         [{month, yhat_sum, yhat_lower_sum, yhat_upper_sum}, ...]
        ratio_detail    Full audit trail of the ratio computation.
        training_points Number of monthly observations in the training window.
        nonzero_points  Months where the purchase metric had activity.
    """
    if metric not in VALID_PURCHASE_METRICS:
        return {
            'status': 'invalid_metric',
            'monthly': [],
            'ratio_detail': {'error': f'Expected one of {VALID_PURCHASE_METRICS}, got {metric!r}'},
            'training_points': 0,
            'nonzero_points': 0,
        }

    # ── Step 1: monthly totals from training data ─────────────────────────

    monthly_df = _compute_monthly_totals(supabase, product_id, training_start, training_end)

    if monthly_df.empty:
        logger.warning('product_id=%d: no training data in revenue_daily_for_ml', product_id)
        return {
            'status': 'insufficient_ratio_data',
            'monthly': [],
            'ratio_detail': {'error': 'No training data found in revenue_daily_for_ml'},
            'training_points': 0,
            'nonzero_points': 0,
        }

    # ── Step 2: ratio with outlier exclusion ──────────────────────────────

    ratio_result = _compute_ratio_with_outlier_exclusion(
        monthly_df,
        numerator_col=metric,
        denominator_col='sales',
    )

    if ratio_result['ratio_median'] is None:
        logger.warning(
            'product_id=%d metric=%s: insufficient data for ratio (need months '
            'with both sales > 0 and %s > 0)',
            product_id, metric, metric,
        )
        return {
            'status': 'insufficient_ratio_data',
            'monthly': [],
            'ratio_detail': ratio_result,
            'training_points': len(monthly_df),
            'nonzero_points': int((monthly_df[metric] > 0).sum()),
        }

    R = ratio_result['ratio_median']
    logger.info(
        'product_id=%d metric=%s: R=%.4f (%d months used, %d excluded)',
        product_id, metric, R,
        ratio_result['ratio_count'], ratio_result['ratio_excluded'],
    )

    # ── Step 3: load sales forecasts ──────────────────────────────────────

    sales_forecasts = _load_sales_forecasts(
        supabase, product_id, training_end, forecast_months,
    )

    if not sales_forecasts:
        logger.error(
            'product_id=%d: no sales forecast in forecast_results for '
            'training_end=%s months=%s. Was Prophet run first?',
            product_id, training_end, forecast_months,
        )
        return {
            'status': 'no_sales_forecast',
            'monthly': [],
            'ratio_detail': ratio_result,
            'training_points': len(monthly_df),
            'nonzero_points': int((monthly_df[metric] > 0).sum()),
        }

    # ── Step 4: derive purchase forecast ──────────────────────────────────

    monthly_predictions = []
    for month in forecast_months:
        sf = sales_forecasts.get(month)
        if sf is None:
            logger.warning(
                'product_id=%d: sales forecast missing for %s, skipping',
                product_id, month,
            )
            continue

        monthly_predictions.append({
            'month': month,
            'yhat_sum': round(sf['yhat_sum'] * R, 4),
            'yhat_lower_sum': round(sf['yhat_lower_sum'] * R, 4),
            'yhat_upper_sum': round(sf['yhat_upper_sum'] * R, 4),
        })

    return {
        'status': 'ok_derived',
        'monthly': monthly_predictions,
        'ratio_detail': {
            'R': round(R, 4),
            'months_used': ratio_result['ratio_count'],
            'months_excluded': ratio_result['ratio_excluded'],
            'ratios_used': ratio_result['ratios_used'],
            'ratios_excluded': ratio_result['ratios_excluded'],
        },
        'training_points': len(monthly_df),
        'nonzero_points': int((monthly_df[metric] > 0).sum()),
    }
