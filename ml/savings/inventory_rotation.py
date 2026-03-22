"""
Savings Calculation: Increased Inventory Rotation (Contractual Goal 4)

Compares actual inventory turnover rate vs what it would have been
with AI Refill's optimized inventory levels.

Turnover = COGS / Average Inventory Value (annualized)
"""

import logging
from datetime import date

from supabase import Client

logger = logging.getLogger(__name__)


def calculate_rotation_improvement(
    supabase: Client,
    run_id: int,
    prediction_start: date,
    prediction_end: date,
) -> dict:
    """
    Calculate inventory rotation improvement for a backtest run.

    Turnover is calculated as:
        (COGS for the month / avg inventory value) × 12

    The optimized turnover uses the same COGS (same sales) but
    lower average inventory (because AI Refill optimizes stock levels).
    """
    # Get COGS and inventory values
    rotation_result = supabase.rpc('get_rotation_metrics', {
        'p_run_id': run_id,
        'p_start_date': prediction_start.isoformat(),
        'p_end_date': prediction_end.isoformat(),
    }).execute()

    if not rotation_result.data or not rotation_result.data[0]:
        return _empty_result()

    metrics = rotation_result.data[0]
    cogs = metrics.get('total_cogs', 0) or 0
    actual_avg_inv = metrics.get('actual_avg_inventory_value', 0) or 0
    optimized_avg_inv = metrics.get('optimized_avg_inventory_value', 0) or 0

    if actual_avg_inv <= 0:
        return _empty_result()

    # Annualize
    actual_turnover = (cogs / actual_avg_inv) * 12
    optimized_turnover = (cogs / optimized_avg_inv) * 12 if optimized_avg_inv > 0 else actual_turnover

    improvement_pct = (
        (optimized_turnover - actual_turnover) / actual_turnover * 100
    ) if actual_turnover > 0 else 0

    reasoning = (
        f'La rotación de inventario actual fue de {actual_turnover:.1f}x anualizada '
        f'(inventario promedio: GTQ {actual_avg_inv:,.0f}). '
        f'Con niveles optimizados, la rotación habría sido {optimized_turnover:.1f}x '
        f'(inventario promedio: GTQ {optimized_avg_inv:,.0f}). '
        f'Mejora: {improvement_pct:.1f}%.'
    )

    return {
        'actual_turnover_rate': round(actual_turnover, 4),
        'optimized_turnover_rate': round(optimized_turnover, 4),
        'rotation_improvement_pct': round(improvement_pct, 4),
        'rotation_reasoning': reasoning,
    }


def _empty_result() -> dict:
    return {
        'actual_turnover_rate': 0,
        'optimized_turnover_rate': 0,
        'rotation_improvement_pct': 0,
        'rotation_reasoning': 'No hay datos suficientes para calcular la rotación de inventario.',
    }
