"""Unit tests for the Prophet config selector (ml/forecast_revenue.get_prophet_config).

Pins the training-window-dependent config that feeds the sales forecast — the
same config the golden-backtest harness relies on. Guards the yearly-seasonality
threshold and the fixed hyperparameters against drift.
"""
from forecast_revenue import get_prophet_config


def test_yearly_seasonality_off_below_a_full_year():
    assert get_prophet_config(200)['yearly_seasonality'] is False
    assert get_prophet_config(364)['yearly_seasonality'] is False


def test_yearly_seasonality_on_at_or_above_a_full_year():
    assert get_prophet_config(365)['yearly_seasonality'] is True
    assert get_prophet_config(400)['yearly_seasonality'] is True


def test_fixed_hyperparameters_are_stable():
    cfg = get_prophet_config(400)
    assert cfg['weekly_seasonality'] is True
    assert cfg['daily_seasonality'] is False
    assert cfg['changepoint_prior_scale'] == 0.1
    assert cfg['seasonality_prior_scale'] == 5.0
    assert cfg['uncertainty_samples'] == 1000
