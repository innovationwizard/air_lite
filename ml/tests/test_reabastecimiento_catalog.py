"""Unit tests for the catalog planner of ml/odoo_sync_reabastecimiento.py
(plan_catalog_rows) — the step that decides which Odoo products become new
Supabase rows.

Regression anchor (2026-08-20, measured in production): products without a
``default_code`` were falling into the "genuinely new" branch on EVERY hourly
run, because SKU-only matching (the 2026-08-06 identity fix) can never match a
row that has no SKU. Result: 50 inserts/hour, ``products`` at 13,806 rows for
1,614 real Odoo products, and two code-less rows ('Descuento', '88001005')
reaching the reabastecimiento table with sales velocity.

Odoo XML-RPC convention: empty fields come back as ``False``, not '' or None.
"""
from odoo_sync_reabastecimiento import plan_catalog_rows


def _odoo(**over):
    base = {
        'id': 9001,
        'default_code': 'SKU-1',
        'name': 'Bandeja 2P',
        'standard_price': 1.5,
        'list_price': 2.5,
        'uom_id': [1, 'Unidades'],
        'categ_id': [7, 'Bandejas'],
    }
    base.update(over)
    return base


# ── SKU matching ──────────────────────────────────────────────────────────────

def test_existing_sku_maps_and_is_not_reinserted():
    by_odoo_id, repairs, new_rows, no_sku = plan_catalog_rows(
        [_odoo()], {'SKU-1': 42}, {42: '9001'})
    assert by_odoo_id == {'9001': 42}
    assert (repairs, new_rows, no_sku) == ([], [], [])


def test_stale_stored_odoo_id_is_repaired_not_duplicated():
    by_odoo_id, repairs, new_rows, _ = plan_catalog_rows(
        [_odoo()], {'SKU-1': 42}, {42: '1234'})
    assert by_odoo_id == {'9001': 42}
    assert repairs == [(42, '9001')]
    assert new_rows == []


def test_unknown_sku_becomes_a_new_row():
    _, _, new_rows, no_sku = plan_catalog_rows([_odoo()], {}, {})
    assert no_sku == []
    assert len(new_rows) == 1
    assert new_rows[0]['sku'] == 'SKU-1'
    assert new_rows[0]['odoo_id'] == '9001'
    assert new_rows[0]['name'] == 'Bandeja 2P'


# ── The bug: code-less products ───────────────────────────────────────────────

def test_product_without_default_code_is_never_inserted():
    """Odoo returns False for an empty default_code."""
    _, _, new_rows, no_sku = plan_catalog_rows([_odoo(default_code=False)], {}, {})
    assert new_rows == []
    assert [p['id'] for p in no_sku] == [9001]


def test_empty_string_and_missing_default_code_are_also_skipped():
    records = [_odoo(id=1, default_code=''), _odoo(id=2)]
    del records[1]['default_code']
    _, _, new_rows, no_sku = plan_catalog_rows(records, {}, {})
    assert new_rows == []
    assert [p['id'] for p in no_sku] == [1, 2]


def test_second_run_over_the_same_catalog_inserts_nothing():
    """The regression itself: run 1 inserts the coded product, run 2 must be a
    no-op — including the code-less one, which is skipped both times."""
    catalog = [_odoo(id=9001, default_code='SKU-1'),
               _odoo(id=2364, default_code=False, name='Descuento ')]

    _, _, first_run, skipped = plan_catalog_rows(catalog, {}, {})
    assert [r['sku'] for r in first_run] == ['SKU-1']
    assert [p['id'] for p in skipped] == [2364]

    # after run 1, the inserted row exists with its SKU and current odoo_id
    by_sku, stored = {'SKU-1': 77}, {77: '9001'}
    by_odoo_id, repairs, second_run, skipped_again = plan_catalog_rows(catalog, by_sku, stored)
    assert second_run == []
    assert repairs == []
    assert by_odoo_id == {'9001': 77}
    assert [p['id'] for p in skipped_again] == [2364]


def test_code_less_product_never_enters_the_product_map():
    """Nothing downstream (inputs, supplier links) can reference it — that is
    what keeps 'Descuento' off Wilmer's table."""
    by_odoo_id, _, _, _ = plan_catalog_rows([_odoo(id=2364, default_code=False)], {}, {})
    assert by_odoo_id == {}


def test_mixed_catalog_partitions_every_record():
    """Nothing is dropped: every input record lands in exactly one bucket."""
    catalog = [_odoo(id=1, default_code='A'), _odoo(id=2, default_code='B'),
               _odoo(id=3, default_code=False), _odoo(id=4, default_code='C')]
    by_odoo_id, _, new_rows, no_sku = plan_catalog_rows(catalog, {'A': 10}, {10: '1'})
    accounted = len(by_odoo_id) + len(new_rows) + len(no_sku)
    assert accounted == len(catalog)
    assert sorted(r['sku'] for r in new_rows) == ['B', 'C']
