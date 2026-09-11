"""Seasonal index builder for the forecast comercial (Level 2)
(comercial_estacionalidad_carga.py).

Spec: docs/compras/FORECAST_COMERCIAL_L2_SPEC_RESEARCH_2026-09-10.md §3.3.

Pins: the two-year minimum, the exclusion of partial years (SAI's 2025 has
Jan-Mar only), the clamp, the '*' group fallback, Spanish month parsing, and a
CHARACTERIZATION test on a frozen slice of real SAI data (Supermercados,
2022-2024): the group's Nov/Dec/Mar indices are the measured numbers the spec
was validated with. If they move, the formula moved.
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from comercial_estacionalidad_carga import (  # noqa: E402
    GRUPO_FALLBACK, acumular_sai, anios_odoo_completos, build_indices, index_from_years,
)
from datetime import date  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), 'fixtures', 'sai_super_2022_2024.json')


def _flat_year(level):
    return [level] * 12


def test_index_needs_two_usable_years():
    idx, anios = index_from_years({2024: _flat_year(10.0)})
    assert idx is None and anios == []


def test_partial_year_is_not_a_year():
    """Jan-Mar only (SAI 2025) would read as nine zero-demand months."""
    partial = [10.0, 10.0, 10.0] + [0.0] * 9
    idx, anios = index_from_years({2023: _flat_year(10.0), 2024: _flat_year(10.0), 2025: partial})
    assert anios == [2023, 2024]
    assert idx == [1.0] * 12


def test_index_is_the_mean_shape_over_years():
    y1 = [10.0] * 11 + [20.0]     # Dec = 2x the other months
    y2 = [10.0] * 11 + [30.0]
    idx, anios = index_from_years({2023: y1, 2024: y2})
    assert anios == [2023, 2024]
    # year means: 10.833 and 11.667 -> Dec indices 1.846 and 2.571 -> mean 2.21, clamped to 1.8
    assert idx[11] == 1.8
    assert abs(idx[0] - (10 / (130 / 12) + 10 / (140 / 12)) / 2) < 1e-9


def test_clamp_floor():
    y = [1.0] + [100.0] * 11
    idx, _ = index_from_years({2023: y, 2024: y})
    assert idx[0] == 0.6


def test_build_indices_falls_back_to_group_and_skips_thin_categories():
    cat = {'VASOS': {2023: _flat_year(5.0), 2024: _flat_year(5.0)},
           'NUEVA': {2024: _flat_year(1.0)},          # one year -> no index
           '': {2023: _flat_year(1.0), 2024: _flat_year(1.0)}}  # unknown category -> never a row
    grupo = {2023: _flat_year(7.0), 2024: _flat_year(7.0)}
    rows = build_indices(cat, grupo)
    cats = {r['categoria'] for r in rows}
    assert cats == {'VASOS', GRUPO_FALLBACK}
    assert len(rows) == 24
    assert all(r['anios'] == [2023, 2024] for r in rows)


def test_acumular_sai_parses_spanish_months_and_filters_channel():
    rows = [
        {'code': 'A', 'category': 'VASOS', 'month': 'Diciembre', 'channel': 'SUPER', 'quantity_23': 5.0, 'quantity_24': 7.0},
        {'code': 'B', 'category': 'PLATOS', 'month': 'enero', 'channel': 'INSTI', 'quantity_23': 9.0},
        {'code': 'C', 'category': 'PLATOS', 'month': '??', 'channel': 'SUPER', 'quantity_23': 9.0},
    ]
    cat, grupo, code_cat, saltadas = acumular_sai(rows, ['SUPER'], [2023, 2024])
    assert cat['VASOS'][2023][11] == 5.0 and cat['VASOS'][2024][11] == 7.0
    assert 'PLATOS' not in cat                       # other channel, not accumulated
    assert grupo[2023][11] == 5.0
    assert code_cat == {'A': 'VASOS', 'B': 'PLATOS'}  # the map is channel-agnostic
    assert saltadas == 1


def test_odoo_complete_years():
    assert anios_odoo_completos(date(2026, 9, 10)) == [2025]
    assert anios_odoo_completos(date(2027, 1, 5)) == [2025, 2026]
    assert anios_odoo_completos(date(2025, 6, 1)) == []


def test_frozen_supermercados_slice_reproduces_the_measured_indices():
    """Characterization: Supermercados' Nov-Dec doubling and the March bump,
    from the real SAI rows (channel SUPER, 2022-2024). Reference values were
    computed once on 2026-09-10; a change here is a change in the formula."""
    rows = json.load(open(FIXTURE))
    cat, grupo, _code_cat, _s = acumular_sai(rows, ['SUPER'], [2022, 2023, 2024])
    idx = build_indices(cat, grupo)
    fb = {r['mes']: r['indice'] for r in idx if r['categoria'] == GRUPO_FALLBACK}
    assert fb[11] == 1.4108
    assert fb[12] == 1.6736
    assert fb[3] == 1.2142
    assert fb[1] == 0.6326
    assert [r['anios'] for r in idx if r['categoria'] == GRUPO_FALLBACK][0] == [2022, 2023, 2024]
    assert len({r['categoria'] for r in idx}) == 14   # 13 categories + '*'
