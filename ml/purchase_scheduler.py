"""
Purchase Schedule Optimizer — AI Refill Lite POC

Given a supplier (Carvajal / Reyma), a training window, and a target week:
1. Train Prophet on each qualifying product's demand history
2. Forecast daily demand for the target week
3. Calculate optimal purchase quantities respecting the 2-week max inventory policy
4. Return per-product, per-day recommendations

Policy constraint: inventory must never exceed 14 days of forecasted demand.
"""

import logging
import math
from datetime import date, timedelta, datetime
from typing import Optional

import pandas as pd
from prophet import Prophet

from census_filter import filter_for_training

logger = logging.getLogger(__name__)


def get_supplier_products(supabase, supplier_filter: str, training_start: date, training_end: date):
    """
    Get products for the given supplier(s) that have sufficient demand data.

    Carvajal products: linked via product_suppliers table.
    Reyma products: identified by product name containing 'REYMA' (no PO data).
    """
    # Get Carvajal products via product_suppliers
    carvajal_result = supabase.rpc('get_supplier_products_for_schedule', {
        'p_supplier_pattern': '%carvajal%',
        'p_start_date': str(training_start),
        'p_end_date': str(training_end),
        'p_min_observations': 14,
    }).execute()

    # Get Reyma products by name pattern
    reyma_result = supabase.rpc('get_reyma_products_for_schedule', {
        'p_start_date': str(training_start),
        'p_end_date': str(training_end),
        'p_min_observations': 14,
    }).execute()

    products = []
    seen_ids = set()

    for row in (carvajal_result.data or []):
        if row['product_id'] not in seen_ids:
            row['supplier_name'] = 'Carvajal'
            products.append(row)
            seen_ids.add(row['product_id'])

    for row in (reyma_result.data or []):
        if row['product_id'] not in seen_ids:
            row['supplier_name'] = 'Reyma'
            products.append(row)
            seen_ids.add(row['product_id'])

    return products


def forecast_product_week(supabase, product_id: int, training_start: date,
                          training_end: date, forecast_start: date, forecast_end: date):
    """
    Train Prophet on a product's demand history, forecast daily demand for the target week.
    Returns list of (date, forecasted_demand) tuples.
    """
    result = supabase.table('demand_daily').select(
        'demand_date, quantity_sold, is_censored'
    ).eq('product_id', product_id).gte(
        'demand_date', str(training_start)
    ).lte('demand_date', str(training_end)).execute()

    if not result.data:
        return None

    df = pd.DataFrame(result.data)
    df['demand_date'] = pd.to_datetime(df['demand_date'])

    # Apply census filter — exclude stockout-suppressed zeros
    training_df = filter_for_training(df)
    if len(training_df) < 14:
        return None

    training_df = training_df.rename(columns={'demand_date': 'ds', 'quantity_sold': 'y'})

    try:
        model = Prophet(
            weekly_seasonality=True,
            yearly_seasonality=False,
            daily_seasonality=False,
            changepoint_prior_scale=0.1,
            seasonality_prior_scale=5.0,
        )
        model.fit(training_df[['ds', 'y']])

        days_to_forecast = (forecast_end - training_end).days
        future = model.make_future_dataframe(periods=days_to_forecast)
        forecast = model.predict(future)

        # Extract the target week
        mask = (forecast['ds'].dt.date >= forecast_start) & (forecast['ds'].dt.date <= forecast_end)
        week_forecast = forecast[mask][['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()
        week_forecast['yhat'] = week_forecast['yhat'].clip(lower=0)

        return [
            {
                'date': row['ds'].date(),
                'demand': round(float(row['yhat']), 2),
                'demand_lower': round(max(0, float(row['yhat_lower'])), 2),
                'demand_upper': round(float(row['yhat_upper']), 2),
            }
            for _, row in week_forecast.iterrows()
        ]
    except Exception as e:
        logger.error('Prophet forecast failed for product %d: %s', product_id, e)
        return None


def get_inventory_at_date(supabase, product_id: int, target_date: date) -> float:
    """Get the inventory on hand for a product at a specific date."""
    result = supabase.table('inventory_daily').select(
        'quantity_on_hand'
    ).eq('product_id', product_id).eq(
        'snapshot_date', str(target_date)
    ).execute()

    if result.data:
        return sum(float(r['quantity_on_hand'] or 0) for r in result.data)
    return 0.0


def calculate_purchase_schedule(
    product: dict,
    weekly_forecast: list,
    inventory_on_hand: float,
    max_inventory_days: int = 14,
) -> list:
    """
    Calculate daily purchase recommendations for one product for one week.

    Policy: inventory must never exceed max_inventory_days of forecasted daily demand.

    Logic:
    - Compute average daily demand from the week's forecast
    - Max inventory ceiling = avg_daily_demand × max_inventory_days
    - For each day of the week:
        - Projected inventory = previous day inventory - today's forecasted demand + any purchase
        - If projected inventory < 7 days of demand (reorder point): recommend a purchase
        - Purchase quantity = ceiling - projected inventory (but never exceed ceiling)
    """
    if not weekly_forecast:
        return []

    avg_daily_demand = sum(d['demand'] for d in weekly_forecast) / len(weekly_forecast)
    if avg_daily_demand <= 0:
        return []

    max_inventory_ceiling = avg_daily_demand * max_inventory_days
    reorder_point = avg_daily_demand * 7  # Reorder when below 1 week of supply
    current_inventory = inventory_on_hand

    recommendations = []

    for day_forecast in weekly_forecast:
        day_date = day_forecast['date']
        daily_demand = day_forecast['demand']

        # Project inventory after today's demand
        projected = current_inventory - daily_demand

        if projected < reorder_point and projected < max_inventory_ceiling:
            # Calculate how much to order: fill up to ceiling
            order_qty = max_inventory_ceiling - projected
            # Round up to whole units
            order_qty = math.ceil(order_qty)

            if order_qty > 0:
                days_of_supply_before = (projected / avg_daily_demand) if avg_daily_demand > 0 else 0
                days_of_supply_after = ((projected + order_qty) / avg_daily_demand) if avg_daily_demand > 0 else 0

                recommendations.append({
                    'date': day_date,
                    'qty': order_qty,
                    'forecasted_daily_demand': round(daily_demand, 2),
                    'current_inventory_before': round(projected, 2),
                    'days_of_supply_before': round(days_of_supply_before, 1),
                    'days_of_supply_after': round(days_of_supply_after, 1),
                    'max_inventory_qty': round(max_inventory_ceiling, 2),
                    'reasoning': (
                        f"Inventario proyectado: {projected:.0f} unidades "
                        f"({days_of_supply_before:.1f} días de abasto). "
                        f"Se recomienda comprar {order_qty} unidades para alcanzar "
                        f"{days_of_supply_after:.1f} días de abasto "
                        f"(máximo permitido: {max_inventory_days} días)."
                    ),
                })

                # Update inventory with the purchase
                current_inventory = projected + order_qty
            else:
                current_inventory = projected
        else:
            current_inventory = projected

    return recommendations


def run_purchase_schedule_cycle(
    supabase,
    training_months: int,
    week_offset: int,
    max_inventory_days: int = 14,
) -> dict:
    """
    Run one purchase schedule cycle:
    - Train on training_months months from data start
    - Add week_offset weeks
    - Forecast the next week
    - Generate purchase recommendations for Carvajal + Reyma products

    Returns dict with run_id, products_scheduled, etc.
    """
    import time
    start_time = time.time()

    data_start = date(2024, 10, 1)

    # Training end = data_start + training_months months + week_offset weeks
    training_end_month = data_start.month + training_months
    training_end_year = data_start.year + (training_end_month - 1) // 12
    training_end_month = ((training_end_month - 1) % 12) + 1
    training_end = date(training_end_year, training_end_month, 1) - timedelta(days=1)

    # Add week offset
    training_end = training_end + timedelta(weeks=week_offset)

    # Target week = next 7 days after training_end
    schedule_week_start = training_end + timedelta(days=1)
    schedule_week_end = schedule_week_start + timedelta(days=6)

    # Don't forecast beyond data range
    data_end = date(2026, 3, 3)
    if schedule_week_start >= data_end:
        return None

    if schedule_week_end > data_end:
        schedule_week_end = data_end

    logger.info(
        'Purchase schedule: training %s to %s, scheduling week %s to %s',
        data_start, training_end, schedule_week_start, schedule_week_end,
    )

    # Create run record
    run_result = supabase.table('purchase_schedule_runs').insert({
        'supplier_filter': 'carvajal,reyma',
        'training_start_date': str(data_start),
        'training_end_date': str(training_end),
        'schedule_week_start': str(schedule_week_start),
        'schedule_week_end': str(schedule_week_end),
        'max_inventory_days': max_inventory_days,
        'status': 'running',
    }).execute()

    run_id = run_result.data[0]['id']

    try:
        # Get qualifying products
        products = get_supplier_products(supabase, 'carvajal,reyma', data_start, training_end)
        logger.info('Found %d qualifying products for Carvajal + Reyma', len(products))

        all_lines = []
        products_with_recommendations = 0

        for product in products:
            product_id = product['product_id']
            product_name = product.get('product_name', '')
            product_sku = product.get('product_sku', '')
            product_uom = product.get('product_uom', '')
            product_cost = float(product.get('product_cost', 0) or 0)
            supplier_name = product.get('supplier_name', '')

            # Forecast demand for the target week
            weekly_forecast = forecast_product_week(
                supabase, product_id, data_start, training_end,
                schedule_week_start, schedule_week_end,
            )

            if not weekly_forecast:
                continue

            # Get inventory at the start of the target week
            inventory = get_inventory_at_date(supabase, product_id, schedule_week_start)

            # Calculate purchase recommendations
            recommendations = calculate_purchase_schedule(
                product, weekly_forecast, inventory, max_inventory_days,
            )

            if recommendations:
                products_with_recommendations += 1

            for rec in recommendations:
                all_lines.append({
                    'run_id': run_id,
                    'product_id': product_id,
                    'supplier_name': supplier_name,
                    'recommended_date': str(rec['date']),
                    'recommended_qty': rec['qty'],
                    'recommended_value': round(rec['qty'] * product_cost, 4),
                    'uom': product_uom,
                    'forecasted_weekly_demand': round(
                        sum(d['demand'] for d in weekly_forecast), 2
                    ),
                    'current_inventory': rec['current_inventory_before'],
                    'days_of_supply_before': rec['days_of_supply_before'],
                    'days_of_supply_after': rec['days_of_supply_after'],
                    'max_inventory_qty': rec['max_inventory_qty'],
                    'reasoning': rec['reasoning'],
                })

        # Bulk insert recommendation lines
        if all_lines:
            # Insert in batches of 200
            for i in range(0, len(all_lines), 200):
                batch = all_lines[i:i+200]
                supabase.table('purchase_schedule_lines').insert(batch).execute()

        total_units = sum(l['recommended_qty'] for l in all_lines)
        total_value = sum(l['recommended_value'] for l in all_lines)
        duration_ms = int((time.time() - start_time) * 1000)

        # Update run record
        supabase.table('purchase_schedule_runs').update({
            'status': 'completed',
            'products_scheduled': products_with_recommendations,
            'total_units_recommended': round(total_units, 4),
            'total_value_recommended': round(total_value, 4),
            'training_duration_ms': duration_ms,
        }).eq('id', run_id).execute()

        logger.info(
            'Purchase schedule run %d completed: %d products, %.0f units, GTQ %.0f, %dms',
            run_id, products_with_recommendations, total_units, total_value, duration_ms,
        )

        return {
            'run_id': run_id,
            'products_scheduled': products_with_recommendations,
            'total_units': total_units,
            'total_value': total_value,
            'duration_ms': duration_ms,
            'schedule_week_start': str(schedule_week_start),
            'schedule_week_end': str(schedule_week_end),
        }

    except Exception as e:
        logger.error('Purchase schedule run %d failed: %s', run_id, e)
        supabase.table('purchase_schedule_runs').update({
            'status': 'failed',
            'error_message': str(e),
            'training_duration_ms': int((time.time() - start_time) * 1000),
        }).eq('id', run_id).execute()
        raise
