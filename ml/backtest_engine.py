"""
AI Refill Lite — Backtest Engine
Core ML pipeline: iterative train-predict-compare with savings calculations.

For each backtest cycle:
  1. Select top qualifying products
  2. Train Prophet on historical demand (censored days excluded)
  3. Predict next month's demand
  4. Compare predictions vs actuals
  5. Calculate the 4 contractual savings
  6. Generate Spanish summary with transparent reasoning
"""

import logging
import time
from datetime import date, timedelta
from calendar import monthrange
from typing import Optional

import numpy as np
import pandas as pd
from prophet import Prophet
from supabase import Client

from census_filter import filter_for_training
from product_selector import select_backtest_products
from savings.storage_cost import calculate_storage_savings
from savings.unnecessary_purchases import calculate_purchase_savings
from savings.lost_sales import calculate_stockout_savings
from savings.inventory_rotation import calculate_rotation_improvement
from savings.summary_generator import generate_spanish_summary

logger = logging.getLogger(__name__)


def get_prophet_config(training_months: int) -> dict:
    """
    Prophet configuration adapted to data availability.

    Rationale:
    - yearly_seasonality: Only enable with >= 12 months (need full year)
    - weekly_seasonality: Always on (clear weekday/weekend patterns)
    - changepoint_prior_scale: Conservative (0.1) to avoid overfitting on short history
    - seasonality_prior_scale: Moderate (5.0) to allow seasonality detection
    """
    return {
        'yearly_seasonality': training_months >= 12,
        'weekly_seasonality': True,
        'daily_seasonality': False,
        'changepoint_prior_scale': 0.1,
        'seasonality_prior_scale': 5.0,
        'uncertainty_samples': 1000,
    }


def load_demand_for_product(
    supabase: Client,
    product_id: int,
    start_date: date,
    end_date: date,
) -> pd.DataFrame:
    """Load demand_daily for a single product in a date range."""
    result = supabase.table('demand_daily').select(
        'demand_date, quantity_sold, is_censored'
    ).eq(
        'product_id', product_id
    ).gte(
        'demand_date', start_date.isoformat()
    ).lte(
        'demand_date', end_date.isoformat()
    ).execute()

    if not result.data:
        return pd.DataFrame(columns=['ds', 'y', 'is_censored'])

    df = pd.DataFrame(result.data)
    df.rename(columns={'demand_date': 'ds', 'quantity_sold': 'y'}, inplace=True)
    df['ds'] = pd.to_datetime(df['ds'])
    return df


def train_and_predict_product(
    demand_df: pd.DataFrame,
    prediction_start: date,
    prediction_end: date,
    prophet_config: dict,
) -> Optional[pd.DataFrame]:
    """
    Train Prophet on historical demand and predict for the target month.

    Args:
        demand_df: Historical demand with columns [ds, y, is_censored]
        prediction_start: First day of prediction month
        prediction_end: Last day of prediction month
        prophet_config: Prophet hyperparameters

    Returns:
        DataFrame with predictions [ds, yhat, yhat_lower, yhat_upper]
        or None if training fails
    """
    # Filter out censored observations
    training_df = filter_for_training(demand_df)

    if len(training_df) < 10:
        return None

    try:
        model = Prophet(**prophet_config)
        model.fit(training_df[['ds', 'y']])

        # Create future dataframe covering the prediction month
        days_to_predict = (prediction_end - prediction_start).days + 1
        future = model.make_future_dataframe(periods=days_to_predict)

        # Filter to only prediction month
        forecast = model.predict(future)
        mask = (forecast['ds'].dt.date >= prediction_start) & (forecast['ds'].dt.date <= prediction_end)
        prediction = forecast.loc[mask, ['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()

        # Clamp negative predictions to zero (demand cannot be negative)
        prediction['yhat'] = prediction['yhat'].clip(lower=0)
        prediction['yhat_lower'] = prediction['yhat_lower'].clip(lower=0)
        prediction['yhat_upper'] = prediction['yhat_upper'].clip(lower=0)

        return prediction

    except Exception as e:
        logger.error(f'Prophet training failed: {e}')
        return None


def run_backtest_cycle(
    supabase: Client,
    training_months: int,
    max_products: int = 100,
    holding_cost_rate: float = 0.25,
) -> dict:
    """
    Execute a single backtest cycle.

    Args:
        supabase: Supabase client (service role)
        training_months: Number of months to use for training
        max_products: Max products to model individually
        holding_cost_rate: Annual holding cost rate (default 25%)

    Returns:
        dict with run_id, savings, coverage, and per-product results
    """
    start_time = time.time()

    # Determine date boundaries
    data_start = date(2024, 10, 1)  # First available data
    training_end_month = data_start.month + training_months - 1
    training_end_year = data_start.year + (training_end_month - 1) // 12
    training_end_month = ((training_end_month - 1) % 12) + 1
    last_day = monthrange(training_end_year, training_end_month)[1]
    training_end = date(training_end_year, training_end_month, last_day)

    # Prediction month = month after training ends
    prediction_start = training_end + timedelta(days=1)
    pred_last_day = monthrange(prediction_start.year, prediction_start.month)[1]
    prediction_end = date(prediction_start.year, prediction_start.month, pred_last_day)

    logger.info(
        'Backtest cycle: training %s to %s, predicting %s',
        data_start, training_end, prediction_start.strftime('%Y-%m'),
    )

    # Create backtest run record
    run_result = supabase.table('backtest_runs').insert({
        'training_start_date': data_start.isoformat(),
        'training_end_date': training_end.isoformat(),
        'prediction_month': prediction_start.isoformat(),
        'model_params': get_prophet_config(training_months),
        'status': 'running',
    }).execute()

    run_id = run_result.data[0]['id']
    logger.info('Created backtest run %d', run_id)

    try:
        # Select top qualifying products
        selection = select_backtest_products(
            supabase, data_start, training_end,
            min_observations=30, max_products=max_products,
        )

        prophet_config = get_prophet_config(training_months)
        results = []
        products_modeled = 0

        # Train and predict for each selected product
        for product in selection['selected']:
            product_id = product['product_id']

            # Load historical demand
            demand_df = load_demand_for_product(
                supabase, product_id, data_start, training_end,
            )

            # Train and predict
            prediction = train_and_predict_product(
                demand_df, prediction_start, prediction_end, prophet_config,
            )

            if prediction is None:
                continue

            # Load actuals for comparison
            actuals_df = load_demand_for_product(
                supabase, product_id, prediction_start, prediction_end,
            )

            predicted_demand = float(prediction['yhat'].sum())
            actual_demand = float(actuals_df['y'].sum()) if not actuals_df.empty else 0
            error_abs = abs(predicted_demand - actual_demand)
            error_pct = (error_abs / actual_demand * 100) if actual_demand > 0 else None

            result = {
                'run_id': run_id,
                'product_id': product_id,
                'model_type': 'individual',
                'predicted_demand': round(predicted_demand, 4),
                'actual_demand': round(actual_demand, 4),
                'predicted_demand_lower': round(float(prediction['yhat_lower'].sum()), 4),
                'predicted_demand_upper': round(float(prediction['yhat_upper'].sum()), 4),
                'error_absolute': round(error_abs, 4),
                'error_percentage': round(error_pct, 4) if error_pct is not None else None,
            }
            results.append(result)
            products_modeled += 1

            if products_modeled % 10 == 0:
                logger.info('  Modeled %d/%d products...', products_modeled, len(selection['selected']))

        # Batch insert results
        if results:
            for i in range(0, len(results), 100):
                batch = results[i:i+100]
                supabase.table('backtest_results').insert(batch).execute()

        # Calculate savings (Phase 4)
        savings = calculate_all_savings(
            supabase, run_id, prediction_start, prediction_end,
            holding_cost_rate, training_months,
        )

        # Store savings
        supabase.table('backtest_savings').insert(savings).execute()

        # Update run status
        duration_ms = int((time.time() - start_time) * 1000)
        supabase.table('backtest_runs').update({
            'status': 'completed',
            'training_duration_ms': duration_ms,
            'products_modeled': products_modeled,
            'products_total_eligible': len(selection['selected']) + len(selection['excluded']),
        }).eq('id', run_id).execute()

        logger.info(
            'Backtest run %d completed: %d products in %dms',
            run_id, products_modeled, duration_ms,
        )

        return {
            'run_id': run_id,
            'status': 'completed',
            'savings': savings,
            'coverage': selection['coverage'],
            'products_modeled': products_modeled,
            'duration_ms': duration_ms,
        }

    except Exception as e:
        logger.error('Backtest run %d failed: %s', run_id, e)
        supabase.table('backtest_runs').update({
            'status': 'failed',
            'error_message': str(e),
        }).eq('id', run_id).execute()
        raise


def calculate_all_savings(
    supabase: Client,
    run_id: int,
    prediction_start: date,
    prediction_end: date,
    holding_cost_rate: float,
    training_months: int,
) -> dict:
    """Calculate all 4 contractual savings for a backtest run."""
    storage = calculate_storage_savings(
        supabase, run_id, prediction_start, prediction_end, holding_cost_rate,
    )
    purchases = calculate_purchase_savings(
        supabase, run_id, prediction_start, prediction_end,
    )
    stockouts = calculate_stockout_savings(
        supabase, run_id, prediction_start, prediction_end,
    )
    rotation = calculate_rotation_improvement(
        supabase, run_id, prediction_start, prediction_end,
    )

    total_savings = (
        (storage.get('storage_savings_gtq') or 0)
        + (purchases.get('purchase_savings_gtq') or 0)
        + (stockouts.get('stockout_savings_gtq') or 0)
    )

    month_name = prediction_start.strftime('%B %Y')
    # Spanish month names
    spanish_months = {
        'January': 'enero', 'February': 'febrero', 'March': 'marzo',
        'April': 'abril', 'May': 'mayo', 'June': 'junio',
        'July': 'julio', 'August': 'agosto', 'September': 'septiembre',
        'October': 'octubre', 'November': 'noviembre', 'December': 'diciembre',
    }
    eng_month = prediction_start.strftime('%B')
    month_name_es = f'{spanish_months.get(eng_month, eng_month)} {prediction_start.year}'

    summary = generate_spanish_summary(
        month_name=month_name_es,
        total_savings=total_savings,
        storage=storage,
        purchases=purchases,
        stockouts=stockouts,
        rotation=rotation,
    )

    return {
        'run_id': run_id,
        **storage,
        **purchases,
        **stockouts,
        **rotation,
        'total_savings_gtq': round(total_savings, 4),
        'summary_text': summary,
    }
