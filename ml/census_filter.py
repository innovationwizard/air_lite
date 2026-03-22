"""
Census Filter — Core IP
Marks demand observations as censored when inventory was at zero.

When a product is out of stock and records zero sales, this is NOT true
zero demand — it's a censored observation. The demand was suppressed by
the stockout. Training a forecasting model on these zeros biases
predictions downward.

Prophet handles this naturally: censored days are excluded from training.
Prophet interpolates through the gaps and widens confidence intervals,
correctly reflecting increased uncertainty during stockout periods.

This logic is applied at the SQL level during demand aggregation
(see 002_reconstruction_functions.sql). This Python module provides
the same logic for in-memory filtering during backtest cycles.
"""

import pandas as pd


def apply_census_filter(
    demand_df: pd.DataFrame,
    inventory_df: pd.DataFrame,
) -> pd.DataFrame:
    """
    Apply Census Filter to demand data.

    Args:
        demand_df: DataFrame with columns [product_id, demand_date, quantity_sold]
        inventory_df: DataFrame with columns [product_id, snapshot_date, quantity_on_hand]

    Returns:
        demand_df with 'is_censored' column added.
        Censored rows have quantity_sold = 0 AND inventory was <= 0 on that day.
    """
    if demand_df.empty:
        demand_df['is_censored'] = False
        return demand_df

    # Build a set of (product_id, date) where inventory was zero or negative
    stockout_days = set()
    if not inventory_df.empty:
        zero_inventory = inventory_df[inventory_df['quantity_on_hand'] <= 0]
        for _, row in zero_inventory.iterrows():
            stockout_days.add((row['product_id'], row['snapshot_date']))

    # Mark censored: zero sales on a stockout day
    demand_df = demand_df.copy()
    demand_df['is_censored'] = demand_df.apply(
        lambda row: (
            row['quantity_sold'] == 0
            and (row['product_id'], row['demand_date']) in stockout_days
        ),
        axis=1,
    )

    return demand_df


def filter_for_training(demand_df: pd.DataFrame) -> pd.DataFrame:
    """
    Remove censored observations from demand data for Prophet training.
    Prophet will interpolate through the resulting gaps.

    Args:
        demand_df: DataFrame with 'is_censored' column

    Returns:
        DataFrame with censored rows removed
    """
    if 'is_censored' not in demand_df.columns:
        return demand_df
    return demand_df[~demand_df['is_censored']].copy()
