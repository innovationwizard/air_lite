"""Monthly demand buckets that feed the rising-trend alert
(odoo_sync_reabastecimiento.py: month_buckets).

The alert Wilmer asked for on 2026-08-20 reads the last three COMPLETE months.
These tests pin the two properties the rule depends on: the current (partial)
month is never a bucket, and the buckets partition exactly the p6 window so the
series and the average beside it come from the same data.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from odoo_sync_reabastecimiento import (  # noqa: E402
    DEMANDA_MESES, month_buckets, month_windows,
)


def test_excludes_the_current_partial_month():
    buckets = month_buckets(date(2026, 8, 21))
    labels = [b[0] for b in buckets]
    assert '2026-08' not in labels
    assert labels[-1] == '2026-07'


def test_returns_six_months_oldest_first():
    labels = [b[0] for b in month_buckets(date(2026, 8, 21))]
    assert labels == ['2026-02', '2026-03', '2026-04',
                      '2026-05', '2026-06', '2026-07']
    assert len(labels) == DEMANDA_MESES


def test_buckets_are_contiguous_and_half_open():
    buckets = month_buckets(date(2026, 8, 21))
    for i in range(1, len(buckets)):
        # each bucket ends exactly where the next begins: no gap, no overlap
        assert buckets[i - 1][2] == buckets[i][1]
    assert buckets[0][1] == date(2026, 2, 1)
    assert buckets[-1][2] == date(2026, 8, 1)


def test_buckets_partition_exactly_the_p6_window():
    """The self-check in sync_velocity compares sum(buckets) to the p6 window.
    That comparison is only meaningful if the spans are identical."""
    today = date(2026, 8, 21)
    _start3, start6, end = month_windows(today)
    buckets = month_buckets(today)
    assert buckets[0][1] == start6
    assert buckets[-1][2] == end


def test_crosses_the_year_boundary():
    labels = [b[0] for b in month_buckets(date(2026, 1, 15))]
    assert labels == ['2025-07', '2025-08', '2025-09',
                      '2025-10', '2025-11', '2025-12']


def test_first_day_of_month_still_excludes_that_month():
    # Running the sync at 00:05 on the 1st must not create an empty bucket for
    # a month that has barely started.
    labels = [b[0] for b in month_buckets(date(2026, 3, 1))]
    assert labels[-1] == '2026-02'
    assert '2026-03' not in labels
