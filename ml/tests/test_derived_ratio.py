"""Unit tests for the derived purchase-forecast ratio with Tukey-fence outlier
exclusion (ml/forecast_purchases_derived._compute_ratio_with_outlier_exclusion).

Pins the robust-ratio rules that make the derived method beat Prophet on
purchases: only months with BOTH sides strictly positive contribute; <4 points
uses a raw median; >=4 points applies Tukey's fence (IQR x 1.5); degenerate
distributions fall back to the full median.
"""
import pandas as pd

from forecast_purchases_derived import _compute_ratio_with_outlier_exclusion

NUM = 'purchases_ordered'
DEN = 'sales'


def _monthly(pairs):
    """pairs: list of (sales, purchases_ordered) → one row per month."""
    rows = [
        {'month': f'2025-{i + 1:02d}', DEN: sales, NUM: purch}
        for i, (sales, purch) in enumerate(pairs)
    ]
    return pd.DataFrame(rows)


def test_none_when_no_month_has_both_sides_positive():
    r = _compute_ratio_with_outlier_exclusion(_monthly([(0, 5), (10, 0)]), NUM, DEN)
    assert r['ratio_median'] is None
    assert r['ratio_count'] == 0


def test_only_both_positive_months_contribute():
    # rows 0 and 3 valid (ratio 1.5 each); rows 1,2 excluded (a zero side)
    r = _compute_ratio_with_outlier_exclusion(
        _monthly([(100, 150), (0, 50), (100, 0), (200, 300)]), NUM, DEN)
    assert r['ratio_count'] == 2
    assert r['ratio_median'] == 1.5


def test_raw_median_when_fewer_than_four_points():
    # ratios 1, 2, 3 → median 2, no Tukey exclusion below 4 points
    r = _compute_ratio_with_outlier_exclusion(
        _monthly([(100, 100), (100, 200), (100, 300)]), NUM, DEN)
    assert r['ratio_median'] == 2.0
    assert r['ratio_count'] == 3
    assert r['ratio_excluded'] == 0


def test_tukey_fence_excludes_high_outlier():
    # ratios 1,1,1,10 → 10 is outside the upper fence
    r = _compute_ratio_with_outlier_exclusion(
        _monthly([(100, 100), (100, 100), (100, 100), (100, 1000)]), NUM, DEN)
    assert r['ratio_excluded'] == 1
    assert r['ratio_median'] == 1.0
    assert ('2025-04', 10.0) in r['ratios_excluded']


def test_identical_ratios_zero_iqr_keeps_all():
    # all ratios == 1 → IQR 0, fences collapse to [1,1], everything is an inlier
    r = _compute_ratio_with_outlier_exclusion(
        _monthly([(100, 100), (100, 100), (100, 100), (100, 100)]), NUM, DEN)
    assert r['ratio_median'] == 1.0
    assert r['ratio_count'] == 4
    assert r['ratio_excluded'] == 0
