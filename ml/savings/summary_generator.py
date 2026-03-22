"""
Summary Generator — Headline text in Latin American Spanish
Generates the "Had you had AI Refill..." paragraph for each backtest cycle.
"""


def generate_spanish_summary(
    month_name: str,
    total_savings: float,
    storage: dict,
    purchases: dict,
    stockouts: dict,
    rotation: dict,
) -> str:
    """
    Generate the headline summary in Latin American Spanish.

    Args:
        month_name: Month name in Spanish (e.g., "enero 2025")
        total_savings: Total GTQ savings across all categories
        storage: Storage savings dict
        purchases: Purchase savings dict
        stockouts: Stockout savings dict
        rotation: Rotation improvement dict

    Returns:
        Multi-line summary string in Spanish
    """
    storage_gtq = storage.get('storage_savings_gtq', 0) or 0
    storage_pct = storage.get('storage_savings_pct', 0) or 0
    purchase_gtq = purchases.get('purchase_savings_gtq', 0) or 0
    purchase_pct = purchases.get('purchase_savings_pct', 0) or 0
    stockout_gtq = stockouts.get('stockout_savings_gtq', 0) or 0
    stockout_pct = stockouts.get('stockout_savings_pct', 0) or 0
    rotation_pct = rotation.get('rotation_improvement_pct', 0) or 0

    return (
        f'Si hubiera contado con AI Refill durante {month_name}, '
        f'habría ahorrado aproximadamente GTQ {total_savings:,.0f}:\n'
        f'• GTQ {storage_gtq:,.0f} en costos de almacenamiento '
        f'({storage_pct:.0f}% de reducción)\n'
        f'• GTQ {purchase_gtq:,.0f} en compras innecesarias '
        f'({purchase_pct:.0f}% de reducción)\n'
        f'• GTQ {stockout_gtq:,.0f} en ventas perdidas evitadas '
        f'({stockout_pct:.0f}% de reducción)\n'
        f'• Rotación de inventario mejorada en {rotation_pct:.0f}%'
    )
