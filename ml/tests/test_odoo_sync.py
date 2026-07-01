"""Unit tests for the Odoo → Supabase product-volume sync mapping
(ml/odoo_sync_oa_v2.py: index_odoo_products_by_sku + compute_product_patch).

Hermetic — no live Odoo. Fixtures reproduce the real Odoo XML-RPC quirks the
sync code defends against:
  * empty fields come back as ``False`` (not ``None``/``''``/``0``);
  * custom ``x_studio_*`` fields may be absent from the record entirely;
  * the Supabase (PostgREST) side may return numerics as strings or ``None``.

(Attempted a read-only fixture capture from the live Odoo dev instance; it was
hibernated — 404 on /xmlrpc/2/common. These fixtures are grounded in the sync
code's own defensive field handling and standard Odoo conventions instead.)
"""
from odoo_sync_oa_v2 import compute_product_patch, index_odoo_products_by_sku


def _odoo(**over):
    """A realistic Odoo product.product record; override fields per test.
    Empty Odoo fields are False by convention."""
    base = {
        'id': 101,
        'default_code': 'SKU-1',
        'name': 'Producto',
        'volume': 0.0025,
        'weight': 1.5,
        'x_studio_alto': 0.10,
        'x_studio_ancho': 0.20,
        'x_studio_largo': 0.30,
    }
    base.update(over)
    return base


# ── index_odoo_products_by_sku ────────────────────────────────────────────────

def test_index_keeps_product_with_volume():
    idx = index_odoo_products_by_sku([_odoo(weight=False, x_studio_alto=False)])
    assert set(idx) == {'SKU-1'}


def test_index_keeps_product_with_only_weight():
    idx = index_odoo_products_by_sku([_odoo(volume=False, x_studio_alto=False)])
    assert 'SKU-1' in idx


def test_index_keeps_product_with_only_dimension():
    idx = index_odoo_products_by_sku([_odoo(volume=False, weight=False)])
    assert 'SKU-1' in idx


def test_index_skips_empty_sku_false():
    # Odoo returns False for a missing default_code
    idx = index_odoo_products_by_sku([_odoo(default_code=False)])
    assert idx == {}


def test_index_skips_product_with_no_usable_data():
    idx = index_odoo_products_by_sku([
        _odoo(volume=False, weight=False, x_studio_alto=False),
    ])
    assert idx == {}


def test_index_handles_absent_custom_fields():
    rec = {'id': 5, 'default_code': 'SKU-9', 'name': 'x', 'volume': 0.004}
    # x_studio_* keys entirely absent — must not raise
    idx = index_odoo_products_by_sku([rec])
    assert 'SKU-9' in idx


def test_index_zero_values_are_not_data():
    idx = index_odoo_products_by_sku([
        _odoo(volume=0, weight=0, x_studio_alto=0),
    ])
    assert idx == {}


def test_index_duplicate_sku_last_wins():
    a = _odoo(volume=0.001)
    b = _odoo(volume=0.009)
    idx = index_odoo_products_by_sku([a, b])
    assert idx['SKU-1']['volume'] == 0.009


# ── compute_product_patch ─────────────────────────────────────────────────────

def test_patch_sets_volume_when_it_differs():
    patch = compute_product_patch(_odoo(volume=0.0025), {'volume_m3': '0.0020'})
    assert patch['volume_m3'] == 0.0025


def test_patch_omits_volume_within_tolerance():
    patch = compute_product_patch(_odoo(volume=0.0025), {'volume_m3': '0.0025'})
    assert 'volume_m3' not in patch


def test_patch_maps_all_three_dimensions():
    odoo = _odoo(x_studio_alto=0.11, x_studio_ancho=0.22, x_studio_largo=0.33)
    patch = compute_product_patch(odoo, {})
    assert patch['height_m'] == 0.11
    assert patch['width_m'] == 0.22
    assert patch['length_m'] == 0.33


def test_patch_parses_supabase_string_numeric():
    # PostgREST can return numerics as strings; a sub-tolerance diff → no change
    patch = compute_product_patch(_odoo(volume=0.0025), {'volume_m3': '0.00250000005'})
    assert 'volume_m3' not in patch


def test_patch_treats_none_supabase_value_as_zero():
    patch = compute_product_patch(_odoo(x_studio_alto=0.15), {'height_m': None})
    assert patch['height_m'] == 0.15


def test_patch_ignores_false_or_missing_odoo_fields():
    odoo = _odoo(volume=False, x_studio_alto=False)  # ancho/largo still present
    del odoo['x_studio_largo']
    patch = compute_product_patch(odoo, {})
    assert 'volume_m3' not in patch
    assert 'height_m' not in patch
    assert 'length_m' not in patch
    assert patch['width_m'] == 0.20


def test_patch_empty_when_everything_current():
    odoo = _odoo(volume=0.0025, x_studio_alto=0.10, x_studio_ancho=0.20, x_studio_largo=0.30)
    supa = {'volume_m3': '0.0025', 'height_m': '0.10', 'width_m': '0.20', 'length_m': '0.30'}
    assert compute_product_patch(odoo, supa) == {}


def test_patch_dimension_tolerance_is_one_ten_thousandth():
    # diff 0.00005 (< 1e-4) → skip; diff 0.0002 (> 1e-4) → include
    assert 'height_m' not in compute_product_patch(
        _odoo(x_studio_alto=0.10005), {'height_m': '0.10'})
    assert compute_product_patch(
        _odoo(x_studio_alto=0.1002), {'height_m': '0.10'})['height_m'] == 0.1002
