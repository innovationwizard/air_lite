import pandas as pd
from prophet import Prophet
from typing import Dict, Any
import numpy as np
from datetime import datetime, timedelta

# Based on SSOT, using standard formulas adapted for Prophet forecasts):
# ROP = (Avg Daily Demand over Lead Time) * Lead Time + SS.
# SS = Z * Std(Demand) * sqrt(Lead Time), where Z=1.65 (95% service level), Std(Demand) approximated from Prophet's prediction interval (yhat_upper - yhat_lower)/ (2*1.96) for 95% CI.
# Lead Time: Queried per SKU from DB (assumed constant; no separate LT model in current code).
# Forecasts: Generate Prophet predictions for next 30 days per SKU to estimate avg demand and std.
# Input: Dict of SKU data {product_id: {'lead_time_days': float, 'current_inventory': float, 'unit_cost': float}}.
# Output: Dict {product_id: {'reorder_point': float, 'safety_stock': float}}.

def forecast_metric(model: Prophet, historical_df: pd.DataFrame, horizon_days: int = 30) -> tuple[float, float]:
    """Forecast avg and std over next horizon_days."""
    if len(historical_df) < 2:
        raise ValueError("Insufficient data")
    future = model.make_future_dataframe(periods=horizon_days)
    forecast = model.predict(future)
    future_forecast = forecast[forecast['ds'] > datetime.now()]
    if len(future_forecast) < 1:
        raise ValueError("No forecast available")
    avg = future_forecast['yhat'].mean()
    std = (future_forecast['yhat_upper'].mean() - future_forecast['yhat_lower'].mean()) / (2 * 1.96)
    return avg, std

def calculate_reorder_point_and_safety_stock(
    demand_model: Prophet,
    lt_model: Prophet,
    demand_hist: pd.DataFrame,
    lt_hist: pd.DataFrame,
    sku_data: Dict[str, Any],
    forecast_horizon_days: int = 30,
    service_level: float = 0.95
) -> Dict[str, float]:
    """Calc ROP/SS using dynamic LT forecast."""
    avg_demand, std_demand = forecast_metric(demand_model, demand_hist, forecast_horizon_days)
    avg_lt, std_lt = forecast_metric(lt_model, lt_hist, 90)  # LT horizon longer (e.g., quarterly)

    lead_time = avg_lt  # Use forecasted avg LT

    z = 1.65 if service_level == 0.95 else 1.96
    safety_stock = z * std_demand * np.sqrt(lead_time + std_lt**2)  # Adjust for LT variability

    reorder_point = (avg_demand * lead_time) + safety_stock

    return {
        'reorder_point': max(0, reorder_point),
        'safety_stock': max(0, safety_stock),
        'forecasted_lead_time': lead_time
    }

def batch_calculate_params(
    demand_model: Prophet,
    lt_model: Prophet,
    skus_data: pd.DataFrame,
    demand_hists: Dict[int, pd.DataFrame],
    lt_hists: Dict[int, pd.DataFrame]
) -> Dict[int, Dict[str, float]]:
    results = {}
    for _, row in skus_data.iterrows():
        pid = row['product_id']
        d_hist = demand_hists.get(pid, pd.DataFrame())
        lt_hist = lt_hists.get(pid, pd.DataFrame())
        if d_hist.empty or lt_hist.empty:
            results[pid] = {'reorder_point': 0, 'safety_stock': 0}
            continue
        try:
            params = calculate_reorder_point_and_safety_stock(
                demand_model, lt_model, d_hist, lt_hist, row.to_dict()
            )
            results[pid] = params
        except ValueError as e:
            print(f"Skipping SKU {pid}: {e}")
            results[pid] = {'reorder_point': 0, 'safety_stock': 0}
    return results