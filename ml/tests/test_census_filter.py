"""Unit tests for the Census Filter — core IP (ml/census_filter.py).

Pins the censoring rule: a zero-sales day is censored ONLY when inventory was
<= 0 that same day. Positive-sales days are never censored. These tests guard
the moat against regressions during the AWS migration + pandas 3.0 (H2).
"""
import pandas as pd

from census_filter import apply_census_filter, filter_for_training


def _demand(rows):
    return pd.DataFrame(rows, columns=['product_id', 'demand_date', 'quantity_sold'])


def _inv(rows):
    return pd.DataFrame(rows, columns=['product_id', 'snapshot_date', 'quantity_on_hand'])


def test_zero_sales_on_stockout_day_is_censored():
    out = apply_census_filter(_demand([(1, '2026-01-01', 0)]), _inv([(1, '2026-01-01', 0)]))
    assert out.loc[0, 'is_censored']


def test_zero_sales_with_stock_is_not_censored():
    out = apply_census_filter(_demand([(1, '2026-01-01', 0)]), _inv([(1, '2026-01-01', 5)]))
    assert not out.loc[0, 'is_censored']


def test_positive_sales_never_censored_even_on_stockout_record():
    out = apply_census_filter(_demand([(1, '2026-01-01', 3)]), _inv([(1, '2026-01-01', 0)]))
    assert not out.loc[0, 'is_censored']


def test_negative_inventory_counts_as_stockout():
    out = apply_census_filter(_demand([(1, '2026-01-01', 0)]), _inv([(1, '2026-01-01', -2)]))
    assert out.loc[0, 'is_censored']


def test_stockout_on_a_different_day_does_not_censor():
    out = apply_census_filter(_demand([(1, '2026-01-02', 0)]), _inv([(1, '2026-01-01', 0)]))
    assert not out.loc[0, 'is_censored']


def test_stockout_for_a_different_product_does_not_censor():
    out = apply_census_filter(_demand([(1, '2026-01-01', 0)]), _inv([(2, '2026-01-01', 0)]))
    assert not out.loc[0, 'is_censored']


def test_empty_demand_still_gets_column():
    out = apply_census_filter(_demand([]), _inv([]))
    assert 'is_censored' in out.columns
    assert len(out) == 0


def test_empty_inventory_censors_nothing():
    out = apply_census_filter(_demand([(1, '2026-01-01', 0), (1, '2026-01-02', 5)]), _inv([]))
    assert out['is_censored'].tolist() == [False, False]


def test_filter_for_training_removes_censored_rows():
    marked = apply_census_filter(
        _demand([(1, '2026-01-01', 0), (1, '2026-01-02', 5)]),
        _inv([(1, '2026-01-01', 0)]),
    )
    out = filter_for_training(marked)
    assert len(out) == 1
    assert out.iloc[0]['demand_date'] == '2026-01-02'


def test_filter_for_training_is_noop_without_column():
    out = filter_for_training(_demand([(1, '2026-01-01', 0)]))
    assert len(out) == 1
