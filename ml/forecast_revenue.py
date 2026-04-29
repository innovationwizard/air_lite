"""
Forecast engine — reads from revenue_daily_for_ml (ML-training clone of revenue_daily).

Distinct from backtest_engine.py, which trains on demand_daily (the old
operational SSOT: sale.order.line + effective_date + delivered_qty).

This module powers /forecast/revenue-daily on the ML service. It reads
revenue_daily_for_ml — identical schema to revenue_daily, but with the October
2024 purchase anomaly smoothed out (onboarding artifact, 5–12 POs/SKU/day).
Sales rows are copied verbatim; October 2024 purchase rows are replaced with
one synthetic row per SKU whose quantity equals the median of the other 15
training-window months. See ML_PURCHASE_HYPOTHESIS_REVALIDATION_2026-04-28.md.

revenue_daily (the source of truth) is NEVER read or written by this module.
Acid Test 1 data lives there and must remain intact.

Populated by: docs/reconciliation/smooth_oct2024_purchase_anomaly.py
Re-run that script before re-training whenever revenue_daily changes.

Formulas (SSOT labels):
  - sales:              aml_income_posted_invoice_refund_neg_invoice_date_c40
  - purchases_ordered:  pol_confirmed_date_planned_product_qty_c40
  - purchases_received: pol_purchase_done_date_planned_qty_received_c40

Reference:
  docs/reconciliation/SSOT_WINNING_FORMULAS.md
  ML_PURCHASE_HYPOTHESIS_REVALIDATION_2026-04-28.md
"""
import logging
from datetime import date, timedelta
from typing import Optional

import pandas as pd
from prophet import Prophet
from supabase import Client

logger = logging.getLogger(__name__)


def get_prophet_config(training_days: int) -> dict:
    """
    Prophet configuration tuned for revenue_daily time series.

    revenue_daily tends to have longer tails of zero-days than demand_daily
    (because invoices cluster on billing days; not every calendar day has an
    invoice). Prophet handles this fine, but:

    - yearly_seasonality only if >= 365 days of training (full year)
    - weekly_seasonality always on (clear weekday/weekend invoice patterns)
    - conservative changepoint_prior to avoid overreacting to batching noise
    """
    return {
        'yearly_seasonality': training_days >= 365,
        'weekly_seasonality': True,
        'daily_seasonality': False,
        'changepoint_prior_scale': 0.1,
        'seasonality_prior_scale': 5.0,
        'uncertainty_samples': 1000,
    }


def load_revenue_for_product(
    supabase: Client,
    product_id: int,
    ssot_label: str,
    metric: str,
    start_date: date,
    end_date: date,
) -> pd.DataFrame:
    """Load revenue_daily for a single (product_id, ssot_label, metric) in
    a date range. Returns DataFrame ready for Prophet: columns [ds, y]."""
    result = supabase.table('revenue_daily_for_ml').select(
        'observation_date, quantity'
    ).eq(
        'product_id', product_id
    ).eq(
        'ssot_label', ssot_label
    ).eq(
        'metric', metric
    ).gte(
        'observation_date', start_date.isoformat()
    ).lte(
        'observation_date', end_date.isoformat()
    ).order('observation_date').execute()

    if not result.data:
        return pd.DataFrame(columns=['ds', 'y'])

    df = pd.DataFrame(result.data)
    df.rename(columns={'observation_date': 'ds', 'quantity': 'y'}, inplace=True)
    df['ds'] = pd.to_datetime(df['ds'])
    df['y'] = df['y'].astype(float)

    # Reindex to a complete date range so Prophet sees zero-days as zeros
    # (revenue_daily_for_ml only INSERTs rows where there was activity; missing
    # days are implicit zeros for the SSOT formulas we use).
    full_range = pd.date_range(start=start_date, end=end_date, freq='D')
    df = df.set_index('ds').reindex(full_range, fill_value=0).rename_axis('ds').reset_index()

    return df


def train_and_predict_revenue(
    history_df: pd.DataFrame,
    prediction_start: date,
    prediction_end: date,
    prophet_config: dict,
) -> Optional[pd.DataFrame]:
    """Train Prophet on history, predict a custom range.

    history_df columns: [ds, y] (ds dtype datetime64, y float).
    Returns predictions DataFrame [ds, yhat, yhat_lower, yhat_upper] or
    None if training fails or data is too sparse.
    """
    if len(history_df) < 30:
        logger.warning('Insufficient history: %d rows', len(history_df))
        return None

    try:
        model = Prophet(**prophet_config)
        model.fit(history_df[['ds', 'y']])

        # Build future dataframe that spans from day after history ends
        # through prediction_end.
        history_end = history_df['ds'].max().date()
        periods = (prediction_end - history_end).days
        if periods <= 0:
            logger.warning('prediction_end %s not after history_end %s',
                            prediction_end, history_end)
            return None

        future = model.make_future_dataframe(periods=periods, freq='D')
        forecast = model.predict(future)

        # Filter to the requested prediction window
        mask = (forecast['ds'].dt.date >= prediction_start) & \
               (forecast['ds'].dt.date <= prediction_end)
        prediction = forecast.loc[mask, ['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()

        # Quantity cannot be negative
        for col in ('yhat', 'yhat_lower', 'yhat_upper'):
            prediction[col] = prediction[col].clip(lower=0)

        return prediction
    except Exception as e:
        logger.error('Prophet training failed: %s', e)
        return None


def forecast_product(
    supabase: Client,
    product_id: int,
    ssot_label: str,
    metric: str,
    training_start: date,
    training_end: date,
    prediction_end: date,
) -> dict:
    """Full pipeline for one (product, ssot_label, metric). Returns dict
    suitable for JSON serialization with:

      - status:       'ok' | 'insufficient_history' | 'training_failed'
      - daily:        list of {date, yhat, yhat_lower, yhat_upper}
      - monthly:      list of {month, yhat_sum, yhat_lower_sum, yhat_upper_sum}
      - training_points: int (rows used to train)
      - training_end_date, prediction_start, prediction_end (echoed for audit)
    """
    prediction_start = training_end + timedelta(days=1)
    history = load_revenue_for_product(
        supabase, product_id, ssot_label, metric,
        training_start, training_end,
    )
    training_days = (training_end - training_start).days + 1
    config = get_prophet_config(training_days)

    # Prophet wants at least a few dozen points; revenue_daily reindexed to
    # daily may have mostly zeros, but Prophet still handles this OK as long
    # as SOME non-zero days exist.
    nonzero = int((history['y'] > 0).sum())
    if nonzero < 10:
        return {
            'status': 'insufficient_history',
            'training_points': len(history),
            'nonzero_points': nonzero,
            'daily': [],
            'monthly': [],
            'training_end_date': training_end.isoformat(),
            'prediction_start': prediction_start.isoformat(),
            'prediction_end': prediction_end.isoformat(),
        }

    prediction = train_and_predict_revenue(history, prediction_start, prediction_end, config)
    if prediction is None:
        return {
            'status': 'training_failed',
            'training_points': len(history),
            'nonzero_points': nonzero,
            'daily': [],
            'monthly': [],
            'training_end_date': training_end.isoformat(),
            'prediction_start': prediction_start.isoformat(),
            'prediction_end': prediction_end.isoformat(),
        }

    # Monthly aggregation for reporting
    prediction['month'] = prediction['ds'].dt.strftime('%Y-%m')
    monthly = prediction.groupby('month').agg(
        yhat_sum=('yhat', 'sum'),
        yhat_lower_sum=('yhat_lower', 'sum'),
        yhat_upper_sum=('yhat_upper', 'sum'),
    ).reset_index()

    return {
        'status': 'ok',
        'training_points': len(history),
        'nonzero_points': nonzero,
        'daily': [
            {
                'date': row['ds'].strftime('%Y-%m-%d'),
                'yhat': round(float(row['yhat']), 4),
                'yhat_lower': round(float(row['yhat_lower']), 4),
                'yhat_upper': round(float(row['yhat_upper']), 4),
            }
            for _, row in prediction.iterrows()
        ],
        'monthly': [
            {
                'month': row['month'],
                'yhat_sum': round(float(row['yhat_sum']), 4),
                'yhat_lower_sum': round(float(row['yhat_lower_sum']), 4),
                'yhat_upper_sum': round(float(row['yhat_upper_sum']), 4),
            }
            for _, row in monthly.iterrows()
        ],
        'training_end_date': training_end.isoformat(),
        'prediction_start': prediction_start.isoformat(),
        'prediction_end': prediction_end.isoformat(),
    }
