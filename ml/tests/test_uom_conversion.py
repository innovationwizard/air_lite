"""Unit tests for stock-UoM folding
(odoo_sync_reabastecimiento.py: fold_uom_groups).

Root cause of Wilmer's report, 2026-08-20: "stock, tránsito me hace sentido
pero el sugerido está muy arriba" on 77202156 (DOMO GP-10X15, stocked in
FARDO50 = a bundle of 50).

Odoo expresses a sale/invoice line quantity in the LINE's unit, not the
product's stock unit. The CDs order that product in FARDO50; the tiendas sell
it loose in "Unidad FD". Summing both raw counted 960 individual domos as 960
fardos, so General p3 read 479/month against a true 165 — and the page
suggested buying 257 fardos when the honest answer was 0. 441 products were
inflated this way, some by 100×.

Odoo UoM algebra: qty_reference = qty ÷ factor; qty_stock = qty_reference ×
stock_factor. FARDO50 has factor 0.02 (50 reference units to a bundle); the
reference unit has factor 1.0.
"""
from odoo_sync_reabastecimiento import fold_uom_groups

FARDO50, UNIDAD_FD, CAJA200 = 11, 12, 13
FACTORS = {FARDO50: 0.02, UNIDAD_FD: 1.0, CAJA200: 0.005}
STOCK_UOM = {8361: FARDO50, 9000: CAJA200}


def _g(pid, qty, uom, journal=None):
    g = {'product_id': [pid, 'DOMO GP-10X15'], 'product_uom_qty': qty, 'quantity': qty,
         'product_uom': [uom, 'uom'] if uom else False}
    if journal:
        g['journal_id'] = [1, journal]
    return g


def fold(groups, **kw):
    return fold_uom_groups(groups, FACTORS, STOCK_UOM, 'product_uom_qty', 'product_uom', **kw)


# ── the reported bug ──────────────────────────────────────────────────────────

def test_loose_units_are_converted_into_bundles():
    """960 individual domos are 19.2 fardos, not 960."""
    totals, unconverted = fold([_g(8361, 960.0, UNIDAD_FD)])
    assert totals[8361] == 19.2
    assert unconverted == 0


def test_quantities_already_in_the_stock_uom_pass_through():
    totals, _ = fold([_g(8361, 477.0, FARDO50)])
    assert totals[8361] == 477.0


def test_the_real_case_sums_to_the_measured_figure():
    """CD orders in fardos + tienda sales in loose units, may–jul 2026."""
    totals, _ = fold([
        _g(8361, 318.0, FARDO50),      # 1 Bodega Central
        _g(8361, 101.0, FARDO50),      # 3 Peten
        _g(8361, 58.0, FARDO50),       # 4 Bodega Zacapa
        _g(8361, 824.0, UNIDAD_FD),    # 8 Tienda Terminal
        _g(8361, 86.0, UNIDAD_FD),     # 7 Tienda Zona 11
        _g(8361, 50.0, UNIDAD_FD),     # 6 Tienda Mixco
    ])
    assert round(totals[8361], 1) == 496.2          # vs 1,437 read raw
    assert round(totals[8361] / 3, 1) == 165.4      # p3, vs the 479 that was stored


def test_a_different_bundle_size_uses_its_own_factor():
    totals, _ = fold([_g(9000, 400.0, UNIDAD_FD)])
    assert totals[9000] == 2.0                       # 400 units ÷ 200 per caja


# ── never drop data ───────────────────────────────────────────────────────────

def test_unknown_line_uom_is_counted_at_face_value_and_reported():
    totals, unconverted = fold([_g(8361, 5.0, 999)])
    assert totals[8361] == 5.0
    assert unconverted == 1


def test_product_without_a_stock_uom_is_reported_not_dropped():
    totals, unconverted = fold([_g(7777, 5.0, UNIDAD_FD)])
    assert totals[7777] == 5.0
    assert unconverted == 1


def test_rows_without_a_product_are_skipped():
    totals, unconverted = fold([{'product_uom_qty': 9.0, 'product_uom': [UNIDAD_FD, 'u']}])
    assert totals == {}
    assert unconverted == 0


# ── the invoiced lens keys by (product, journal) ──────────────────────────────

def test_extra_key_splits_by_journal_and_still_converts():
    totals, _ = fold_uom_groups(
        [_g(8361, 824.0, UNIDAD_FD, journal='Factura Tienda Terminal'),
         _g(8361, 318.0, FARDO50, journal='Facturas CD SJVN')],
        FACTORS, STOCK_UOM, 'quantity', 'product_uom', extra_key='journal_id')
    assert totals[(8361, 'Factura Tienda Terminal')] == 16.48
    assert totals[(8361, 'Facturas CD SJVN')] == 318.0
