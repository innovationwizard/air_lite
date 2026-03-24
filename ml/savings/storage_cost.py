"""
Savings Calculation: Reduced Storage Costs (Contractual Goal 1)

Compares actual holding costs vs what they would have been with
AI Refill's optimized inventory levels.

Holding cost = average_inventory_value × monthly_holding_rate
Optimized inventory = (daily_demand × lead_time / 2) + safety_stock
"""

import logging
import math
from datetime import date

from supabase import Client

logger = logging.getLogger(__name__)


def calculate_storage_savings(
    supabase: Client,
    run_id: int,
    prediction_start: date,
    prediction_end: date,
    holding_cost_rate_annual: float = 0.25,
) -> dict:
    """
    Calculate storage cost savings for a backtest run.

    Args:
        supabase: Supabase client
        run_id: Backtest run ID
        prediction_start: First day of prediction month
        prediction_end: Last day of prediction month
        holding_cost_rate_annual: Annual holding cost rate (0.25 = 25%)

    Returns:
        dict with storage savings metrics and reasoning
    """
    monthly_rate = holding_cost_rate_annual / 12

    # Get products in this backtest run with their predictions
    results = supabase.table('backtest_results').select(
        'product_id, predicted_demand'
    ).eq('run_id', run_id).execute()

    if not results.data:
        return _empty_result(holding_cost_rate_annual)

    product_ids = [r['product_id'] for r in results.data]
    predictions_map = {r['product_id']: r['predicted_demand'] for r in results.data}

    # Get actual average inventory value for these products in the prediction month
    actual_result = supabase.rpc('get_avg_inventory_value', {
        'p_product_ids': product_ids,
        'p_start_date': prediction_start.isoformat(),
        'p_end_date': prediction_end.isoformat(),
    }).execute()

    actual_total_value = 0
    optimized_total_value = 0
    actual_total_units = 0
    optimized_total_units = 0

    days_in_month = (prediction_end - prediction_start).days + 1

    for row in (actual_result.data or []):
        product_id = row['product_id']
        avg_qty = row['avg_quantity'] or 0
        unit_cost = row['unit_cost'] or 0
        predicted_demand = predictions_map.get(product_id, 0) or 0
        lead_time = row.get('lead_time_days', 30) or 30

        actual_value = avg_qty * unit_cost
        actual_total_value += actual_value
        actual_total_units += avg_qty

        # Optimized inventory level
        daily_demand = predicted_demand / days_in_month if days_in_month > 0 else 0
        demand_std = row.get('demand_std', daily_demand * 0.3) or (daily_demand * 0.3)

        # Safety stock at 95% service level (Z = 1.65)
        safety_stock = 1.65 * demand_std * math.sqrt(lead_time) if demand_std > 0 else 0

        # Average cycle stock = order_qty / 2 ≈ (daily_demand × lead_time) / 2
        cycle_stock = (daily_demand * lead_time) / 2

        optimal_avg_qty = cycle_stock + safety_stock
        optimal_value = optimal_avg_qty * unit_cost

        optimized_total_value += optimal_value
        optimized_total_units += optimal_avg_qty

    actual_holding_cost = actual_total_value * monthly_rate
    optimized_holding_cost = optimized_total_value * monthly_rate
    savings = max(0, actual_holding_cost - optimized_holding_cost)
    savings_pct = (savings / actual_holding_cost * 100) if actual_holding_cost > 0 else 0

    if savings > 0:
        reasoning = (
            f'El costo actual de almacenamiento fue de GTQ {actual_holding_cost:,.0f} '
            f'(tasa aplicada: {holding_cost_rate_annual*100:.0f}% anual). '
            f'Con AI Refill, los niveles de inventario optimizados habrían reducido '
            f'el inventario promedio de {actual_total_units:,.0f} a {optimized_total_units:,.0f} '
            f'unidades, resultando en un costo de almacenamiento de GTQ {optimized_holding_cost:,.0f}. '
            f'Ahorro: GTQ {savings:,.0f} ({savings_pct:.1f}%).'
        )
    else:
        reasoning = (
            f'El costo actual de almacenamiento fue de GTQ {actual_holding_cost:,.0f} '
            f'(tasa aplicada: {holding_cost_rate_annual*100:.0f}% anual). '
            f'El inventario actual promedio ({actual_total_units:,.0f} unidades) ya es menor '
            f'o igual al nivel óptimo calculado ({optimized_total_units:,.0f} unidades), '
            f'por lo que no se identifican ahorros adicionales en almacenamiento.'
        )

    return {
        'actual_storage_cost': round(actual_holding_cost, 4),
        'optimized_storage_cost': round(optimized_holding_cost, 4),
        'storage_savings_gtq': round(savings, 4),
        'storage_savings_pct': round(savings_pct, 4),
        'storage_reasoning': reasoning,
        'holding_cost_rate_used': holding_cost_rate_annual,
    }


def _empty_result(rate: float) -> dict:
    return {
        'actual_storage_cost': 0,
        'optimized_storage_cost': 0,
        'storage_savings_gtq': 0,
        'storage_savings_pct': 0,
        'storage_reasoning': 'No hay datos suficientes para calcular ahorro en almacenamiento.',
        'holding_cost_rate_used': rate,
    }
