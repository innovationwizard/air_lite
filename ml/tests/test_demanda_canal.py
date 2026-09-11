"""Per-channel demand history for the forecast comercial (Level 2)
(odoo_sync_reabastecimiento.py: sync_demanda_canal and its pure helpers).

Plan: docs/compras/FORECAST_COMERCIAL_L2_BUILD_PLAN_2026-09-10.md, Phase 1.3.

What these pin down:
  * the Odoo domain built from a rule (team-only, team+sucursal, team+exclusion)
    — the decided mapping (Q1/Q2) lives in data, and a wrong domain shows every
    leader someone else's numbers;
  * prior-year month arithmetic across the year boundary, and that months
    before Odoo went live are omitted, never zero-filled;
  * the partition self-check fires on an overlap and stays quiet on a match;
  * explicit zeros in the series and the customer-concentration rule;
  * the end-to-end step against a fake Odoo: union of rules, both quantities,
    the unassigned bucket, and the UoM fold.
"""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import odoo_sync_reabastecimiento as sync  # noqa: E402
from odoo_sync_reabastecimiento import (  # noqa: E402
    Issues, assemble_demanda_canal, check_particion, concentracion, domain_not_any,
    meses_anio_anterior, month_bounds, regla_domain, sync_demanda_canal,
)


# ── regla_domain ─────────────────────────────────────────────────────────────

def test_domain_team_only():
    assert regla_domain({'odoo_team_id': 6}) == [['order_id.team_id', '=', 6]]


def test_domain_team_with_sucursal():
    d = regla_domain({'odoo_team_id': 8, 'sucursal_ids': [3], 'excluir_sucursal_ids': None})
    assert d == [['order_id.team_id', '=', 8], ['order_id.location_id', 'in', [3]]]


def test_domain_team_with_exclusion():
    d = regla_domain({'odoo_team_id': 8, 'sucursal_ids': None, 'excluir_sucursal_ids': [1, 3]})
    assert d == [['order_id.team_id', '=', 8], ['order_id.location_id', 'not in', [1, 3]]]


def test_domain_empty_arrays_mean_no_filter():
    assert regla_domain({'odoo_team_id': 5, 'sucursal_ids': [], 'excluir_sucursal_ids': []}) \
        == [['order_id.team_id', '=', 5]]


def test_domain_team_with_salesperson():
    """Institucional per seller (2026-09-11): team AND the order's salesperson."""
    d = regla_domain({'odoo_team_id': 6, 'odoo_user_ids': [52]})
    assert d == [['order_id.team_id', '=', 6], ['order_id.user_id', 'in', [52]]]
    d = regla_domain({'odoo_team_id': 6, 'excluir_user_ids': [56]})
    assert d == [['order_id.team_id', '=', 6], ['order_id.user_id', 'not in', [56]]]


# ── domain_not_any ───────────────────────────────────────────────────────────

def test_not_any_of_one_rule():
    assert domain_not_any([[['a', '=', 1], ['b', '=', 2]]]) == ['!', '&', ['a', '=', 1], ['b', '=', 2]]


def test_not_any_of_three_rules_is_prefix_or_of_ands():
    d = domain_not_any([[['t', '=', 9]], [['t', '=', 8], ['s', 'not in', [1, 3]]], [['t', '=', 6], ['u', 'in', [52]]]])
    assert d == ['!',
                 '|', '|', ['t', '=', 9],
                 '&', ['t', '=', 8], ['s', 'not in', [1, 3]],
                 '&', ['t', '=', 6], ['u', 'in', [52]]]


def test_not_any_of_nothing_matches_everything():
    assert domain_not_any([]) == []


# ── meses_anio_anterior ──────────────────────────────────────────────────────

def test_prior_years_for_the_october_cycle():
    out = meses_anio_anterior(date(2026, 9, 10))
    assert list(out) == ['2026-09', '2026-10', '2026-11', '2026-12']
    # Sep 2024 is before Odoo's first month -> omitted, not zero
    assert out['2026-09'] == ['2025-09']
    assert out['2026-10'] == ['2025-10', '2024-10']
    assert out['2026-12'] == ['2025-12', '2024-12']


def test_prior_years_cross_the_year_boundary():
    out = meses_anio_anterior(date(2026, 11, 15))
    assert list(out) == ['2026-11', '2026-12', '2027-01', '2027-02']
    assert out['2027-01'] == ['2026-01', '2025-01']


def test_month_bounds_december_rolls_the_year():
    assert month_bounds('2026-12') == ('2026-12-01', '2027-01-01')
    assert month_bounds('2026-02') == ('2026-02-01', '2026-03-01')


# ── concentracion ────────────────────────────────────────────────────────────

def test_concentracion_empty():
    assert concentracion({}) == (0, None, None)


def test_concentracion_top_share():
    n, top, share = concentracion({'Walmart': 830.0, 'La Torre': 120.0, 'Otro': 50.0})
    assert (n, top) == (3, 'Walmart')
    assert share == 0.83


def test_concentracion_ignores_returns():
    """A customer whose folded quantity is negative (net returns) is not a buyer."""
    assert concentracion({'A': 100.0, 'B': -20.0}) == (1, 'A', 1.0)


# ── check_particion ──────────────────────────────────────────────────────────

def test_partition_matches_quietly():
    issues = Issues()
    por_area = {'mayoreo': {'2026-07': 100.0}, 'tiendas': {'2026-07': 50.0},
                '_sin_asignar': {'2026-07': 5.0}}
    assert check_particion(por_area, {'2026-07': 155.0}, issues) is True
    assert issues.rows == []


def test_partition_warns_on_overlap():
    """Two rules claiming the same orders make the channels sum ABOVE General."""
    issues = Issues()
    por_area = {'mayoreo': {'2026-07': 100.0}, 'zacapa': {'2026-07': 40.0}}
    assert check_particion(por_area, {'2026-07': 120.0}, issues) is False
    assert issues.rows[0]['severity'] == 'warning'
    assert '2026-07' in issues.rows[0]['message']


# ── assemble_demanda_canal ───────────────────────────────────────────────────

def _por_area():
    return {'mayoreo': {
        '2026-07': {'pedido': {501: 100.0}, 'entregado': {501: 90.0}},
        '2026-08': {'pedido': {501: 120.0, 777: 3.0}, 'entregado': {501: 120.0, 777: 3.0}},
        '2025-10': {'pedido': {501: 80.0}, 'entregado': {501: 75.0}},
    }}


def test_rows_have_explicit_zeros_and_prior_years_only_where_present():
    issues = Issues()
    rows = assemble_demanda_canal(
        _por_area(), ['2026-06', '2026-07', '2026-08'],
        {'2026-10': ['2025-10', '2024-10']}, {}, {'501': 9001, '777': 9002}, 'sync-1', issues)
    r = next(x for x in rows if x['product_id'] == 9001)
    assert r['pedido_mensual'] == {'2026-06': 0.0, '2026-07': 100.0, '2026-08': 120.0}
    assert r['entregado_mensual'] == {'2026-06': 0.0, '2026-07': 90.0, '2026-08': 120.0}
    # 2024-10 was queried but has no entry for this area -> absent, not zero
    assert r['mismo_mes_anios_anteriores'] == {'2025-10': {'pedido': 80.0, 'entregado': 75.0}}
    assert r['clientes_3m'] == 0 and r['cliente_principal'] is None
    assert r['source_sync_id'] == 'sync-1'
    assert issues.rows == []


def test_unmapped_products_are_skipped_and_reported():
    issues = Issues()
    rows = assemble_demanda_canal(_por_area(), ['2026-08'], {}, {}, {'501': 9001}, None, issues)
    assert [r['product_id'] for r in rows] == [9001]
    assert issues.rows[0]['severity'] == 'warning' and '777' in issues.rows[0]['message']


def test_customer_fields_are_filled():
    rows = assemble_demanda_canal(
        _por_area(), ['2026-08'], {},
        {'mayoreo': {501: {'Walmart': 90.0, 'Otro': 10.0}}}, {'501': 9001, '777': 9002}, None, Issues())
    r = next(x for x in rows if x['product_id'] == 9001)
    assert (r['clientes_3m'], r['cliente_principal'], r['cliente_principal_share']) == (2, 'Walmart', 0.9)


# ── sync_demanda_canal against a fake Odoo ───────────────────────────────────

FARDO50, UNIDAD = 11, 12
FACTORS = {FARDO50: 0.02, UNIDAD: 1.0}
STOCK_UOM = {501: FARDO50}


def _fake_execute(calls):
    """Answers read_group by the team in the domain. Product 501 is stocked in
    FARDO50; team 5 (tiendas) orders it loose."""
    def execute(model, method, *args, **kwargs):
        calls.append((model, method, args, kwargs))
        domain = args[0]
        if model == 'sale.order':
            return [{'team_id': [1, 'Sales'], '__count': 2}]
        negado = '!' in domain
        team = None if negado else next((d[2] for d in domain if isinstance(d, list) and d[0] == 'order_id.team_id'), None)
        fields = args[1]
        groupby = args[2]
        qty = 'qty_delivered' if 'qty_delivered' in fields else 'product_uom_qty'
        if 'order_partner_id' in groupby:
            return [{'product_id': [501, 'x'], 'product_uom': [FARDO50, 'F'],
                     'order_partner_id': [7, 'Cliente Uno'], qty: 6.0},
                    {'product_id': [501, 'x'], 'product_uom': [FARDO50, 'F'],
                     'order_partner_id': [8, 'Cliente Dos'], qty: 4.0}]
        if team == 9:      # Mayoreo Capital: 10 fardos ordered, 9 delivered
            return [{'product_id': [501, 'x'], 'product_uom': [FARDO50, 'F'],
                     qty: 10.0 if qty == 'product_uom_qty' else 9.0}]
        if team == 5:      # Tienda: 100 loose units = 2 fardos
            return [{'product_id': [501, 'x'], 'product_uom': [UNIDAD, 'U'], qty: 100.0}]
        if negado:  # the complement of every rule -> unassigned: 1 fardo
            return [{'product_id': [501, 'x'], 'product_uom': [FARDO50, 'F'], qty: 1.0}]
        return []
    return execute


def test_sync_unions_rules_folds_uom_and_reports_unassigned(monkeypatch):
    reglas = [{'area': 'mayoreo', 'odoo_team_id': 9, 'sucursal_ids': None, 'excluir_sucursal_ids': None},
              {'area': 'tiendas', 'odoo_team_id': 5, 'sucursal_ids': None, 'excluir_sucursal_ids': None}]

    def fake_sb_get_all(path):
        if path.startswith('comercial_areas'):
            return [{'slug': 'mayoreo', 'activa': True, 'padre': None}, {'slug': 'tiendas', 'activa': True, 'padre': None}]
        return reglas
    monkeypatch.setattr(sync, 'sb_get_all', fake_sb_get_all)

    calls, issues = [], Issues()
    today = date.today()
    buckets = sync.month_buckets(today)
    last = buckets[-1][0]
    # General: per month 10 (mayoreo) + 2 (tiendas) + 1 (unassigned) = 13 fardos
    velocity = {'General': {501: {'demanda_mensual': {b[0]: 13.0 for b in buckets}}}}

    rows = sync_demanda_canal(_fake_execute(calls), issues, (FACTORS, STOCK_UOM),
                              {'501': 9001}, 'sync-1', velocity)

    by_area = {r['area']: r for r in rows}
    assert set(by_area) == {'mayoreo', 'tiendas', '_sin_asignar'}
    assert by_area['mayoreo']['pedido_mensual'][last] == 10.0
    assert by_area['mayoreo']['entregado_mensual'][last] == 9.0
    assert by_area['tiendas']['pedido_mensual'][last] == 2.0          # 100 units -> 2 fardos
    assert by_area['_sin_asignar']['pedido_mensual'][last] == 1.0
    assert by_area['mayoreo']['clientes_3m'] == 2
    assert by_area['mayoreo']['cliente_principal'] == 'Cliente Uno'
    assert by_area['mayoreo']['cliente_principal_share'] == 0.6
    # the partition check passed: no warning issued
    assert not any(r['severity'] == 'warning' for r in issues.rows)
    # the unassigned teams were reported by name
    assert any('Sales=2' in r['message'] for r in issues.rows)


def test_sync_partition_warning_when_rules_overlap(monkeypatch):
    """Two rules on the same team double-count; General does not."""
    reglas = [{'area': 'mayoreo', 'odoo_team_id': 9, 'sucursal_ids': None, 'excluir_sucursal_ids': None},
              {'area': 'zacapa', 'odoo_team_id': 9, 'sucursal_ids': None, 'excluir_sucursal_ids': None}]
    monkeypatch.setattr(sync, 'sb_get_all', lambda path: (
        [{'slug': 'mayoreo', 'activa': True, 'padre': None}, {'slug': 'zacapa', 'activa': True, 'padre': None}]
        if path.startswith('comercial_areas') else reglas))
    issues = Issues()
    buckets = sync.month_buckets(date.today())
    velocity = {'General': {501: {'demanda_mensual': {b[0]: 11.0 for b in buckets}}}}
    sync_demanda_canal(_fake_execute([]), issues, (FACTORS, STOCK_UOM), {'501': 9001}, None, velocity)
    assert any(r['severity'] == 'warning' and 'overlap' in r['message'] for r in issues.rows)


def test_sync_without_rules_is_an_error_and_returns_nothing(monkeypatch):
    monkeypatch.setattr(sync, 'sb_get_all', lambda path: [])
    issues = Issues()
    assert sync_demanda_canal(_fake_execute([]), issues, (FACTORS, STOCK_UOM), {}, None, {}) == []
    assert issues.has_errors()


def test_parent_area_has_no_rules_and_raises_no_warning(monkeypatch):
    """A parent (institucional) is active but captures nothing: its children
    carry the rules. It must not be reported as an area without a rule."""
    reglas = [{'area': 'institucional_ortiz', 'odoo_team_id': 6, 'odoo_user_ids': [52]},
              {'area': 'institucional_cerezo', 'odoo_team_id': 6, 'odoo_user_ids': [54]}]
    monkeypatch.setattr(sync, 'sb_get_all', lambda path: (
        [{'slug': 'institucional', 'activa': True, 'padre': None},
         {'slug': 'institucional_ortiz', 'activa': True, 'padre': 'institucional'},
         {'slug': 'institucional_cerezo', 'activa': True, 'padre': 'institucional'}]
        if path.startswith('comercial_areas') else reglas))
    issues = Issues()
    out = sync.load_area_reglas(issues)
    assert [r['area'] for r in out] == ['institucional_ortiz', 'institucional_cerezo']
    assert not any('without an Odoo rule' in r['message'] for r in issues.rows)
