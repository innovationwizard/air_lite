"""
Savings Calculation: Reduced Unnecessary Purchases (Contractual Goal 2)

Compares actual purchase orders vs what would have been needed with
AI Refill's demand predictions + inventory awareness.

Needed = predicted_demand - inventory_at_start + safety_stock
Excess = actual_purchased - needed (when actual > needed)
"""

import logging
import math
from datetime import date

from supabase import Client

logger = logging.getLogger(__name__)


def calculate_purchase_savings(
    supabase: Client,
    run_id: int,
    prediction_start: date,
    prediction_end: date,
) -> dict:
    """
    Calculate unnecessary purchase savings for a backtest run.

    Compares actual PO values vs what AI Refill would have recommended
    given predicted demand and existing inventory levels.
    """
    results = supabase.table('backtest_results').select(
        'product_id, predicted_demand'
    ).eq('run_id', run_id).execute()

    if not results.data:
        return _empty_result()

    product_ids = [r['product_id'] for r in results.data]
    predictions_map = {r['product_id']: r['predicted_demand'] for r in results.data}

    # Get actual purchases for these products in the prediction month
    purchase_result = supabase.rpc('get_purchase_analysis', {
        'p_product_ids': product_ids,
        'p_start_date': prediction_start.isoformat(),
        'p_end_date': prediction_end.isoformat(),
    }).execute()

    actual_total = 0
    optimized_total = 0
    excess_products = []

    for row in (purchase_result.data or []):
        product_id = row['product_id']
        actual_qty = row['actual_purchased_qty'] or 0
        actual_value = row['actual_purchased_value'] or 0
        avg_unit_cost = row['avg_unit_cost'] or 0
        inventory_at_start = row['inventory_at_start'] or 0
        lead_time = row.get('lead_time_days', 30) or 30
        demand_std = row.get('demand_std', 0) or 0
        product_name = row.get('product_name', '')

        predicted_demand = predictions_map.get(product_id, 0) or 0

        # Safety stock at 95% service level
        safety_stock = 1.65 * demand_std * math.sqrt(lead_time) if demand_std > 0 else 0

        # How much did we actually need to buy?
        needed_qty = max(0, predicted_demand - inventory_at_start + safety_stock)

        # Apply MOQ if available
        moq = row.get('min_order_qty', 1) or 1
        if needed_qty > 0 and moq > 1:
            needed_qty = math.ceil(needed_qty / moq) * moq

        optimized_value = needed_qty * avg_unit_cost if avg_unit_cost > 0 else 0

        actual_total += actual_value
        optimized_total += optimized_value

        if actual_value > optimized_value and actual_value > 0:
            excess_products.append({
                'name': product_name,
                'excess_gtq': actual_value - optimized_value,
            })

    savings = max(0, actual_total - optimized_total)
    savings_pct = (savings / actual_total * 100) if actual_total > 0 else 0

    # Top 3 excess products for reasoning
    excess_products.sort(key=lambda x: x['excess_gtq'], reverse=True)
    top_3 = excess_products[:3]
    top_3_text = ', '.join(
        f'{p["name"]} (GTQ {p["excess_gtq"]:,.0f} en exceso)' for p in top_3
    ) if top_3 else 'ninguno identificado'

    n_excess = len(excess_products)

    reasoning = (
        f'Se realizaron compras por GTQ {actual_total:,.0f}. '
        f'Basado en la demanda predicha y los niveles de inventario existentes, '
        f'las compras optimizadas habrían sido GTQ {optimized_total:,.0f}. '
        f'Se identificaron {n_excess} productos con compras excesivas, '
        f'siendo los principales: {top_3_text}. '
        f'Ahorro estimado: GTQ {savings:,.0f} ({savings_pct:.1f}%).'
    )

    return {
        'actual_purchase_value': round(actual_total, 4),
        'optimized_purchase_value': round(optimized_total, 4),
        'purchase_savings_gtq': round(savings, 4),
        'purchase_savings_pct': round(savings_pct, 4),
        'purchase_reasoning': reasoning,
    }


def _empty_result() -> dict:
    return {
        'actual_purchase_value': 0,
        'optimized_purchase_value': 0,
        'purchase_savings_gtq': 0,
        'purchase_savings_pct': 0,
        'purchase_reasoning': 'No se encontraron compras en el período de predicción.',
    }
