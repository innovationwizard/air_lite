"""
Product Selector for Backtest
Selects the top products by revenue that have sufficient observations
for reliable Prophet modeling. Surfaces clearly which products are
included and why, and which are excluded and why.
"""

import logging
from datetime import date

import pandas as pd
from supabase import Client

logger = logging.getLogger(__name__)


def select_backtest_products(
    supabase: Client,
    training_start: date,
    training_end: date,
    min_observations: int = 30,
    max_products: int = 100,
) -> dict:
    """
    Select top products for backtest modeling.

    Strategy:
        1. Rank all products by total revenue in the training window
        2. For each product (top revenue first), check if it has
           >= min_observations non-censored daily observations
        3. Select the first max_products that qualify
        4. Report coverage metrics

    Args:
        supabase: Supabase client
        training_start: First day of training data
        training_end: Last day of training data
        min_observations: Minimum non-censored days required
        max_products: Maximum products to model individually

    Returns:
        dict with:
            - selected: list of {product_id, name, sku, category, revenue, observations}
            - excluded: list of {product_id, name, sku, category, revenue, reason}
            - coverage: {products_selected, products_total, revenue_coverage_pct}
    """
    # Get all products with their revenue in the training window
    result = supabase.rpc('get_product_revenue_ranking', {
        'p_start_date': training_start.isoformat(),
        'p_end_date': training_end.isoformat(),
        'p_min_observations': min_observations,
    }).execute()

    if not result.data:
        logger.warning('No product revenue data found for the training window')
        return {'selected': [], 'excluded': [], 'coverage': {
            'products_selected': 0, 'products_total': 0, 'revenue_coverage_pct': 0,
        }}

    products = result.data
    total_revenue = sum(p['total_revenue'] for p in products)

    selected = []
    excluded = []

    for product in products:
        if len(selected) >= max_products:
            excluded.append({
                **product,
                'reason': f'Límite de {max_products} productos alcanzado',
            })
        elif product['non_censored_days'] < min_observations:
            excluded.append({
                **product,
                'reason': (
                    f'Observaciones insuficientes: {product["non_censored_days"]} días '
                    f'(mínimo requerido: {min_observations})'
                ),
            })
        else:
            selected.append(product)

    selected_revenue = sum(p['total_revenue'] for p in selected)
    coverage_pct = (selected_revenue / total_revenue * 100) if total_revenue > 0 else 0

    coverage = {
        'products_selected': len(selected),
        'products_total': len(products),
        'revenue_coverage_pct': round(coverage_pct, 1),
    }

    logger.info(
        'Product selection: %d of %d products (%.1f%% of revenue)',
        coverage['products_selected'],
        coverage['products_total'],
        coverage['revenue_coverage_pct'],
    )

    return {
        'selected': selected,
        'excluded': excluded,
        'coverage': coverage,
    }
