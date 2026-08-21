"""Unit tests for the G4 invoiced-demand lens
(odoo_sync_reabastecimiento.py: classify_invoice_journal + aggregate_invoiced).

G4: Wilmer plans on ORDERED, Raquel validates on INVOICED, and their meetings
turn into number disputes. Measured in production for July 2026: the two bases
differ by 113% company-wide, and essentially all of that is retail store
billing (501,014 units on tienda journals, ~0% linked to a sale order) that
Wilmer's perimeter excludes by design. Like-for-like on the distribution
centres the gap is 4.1%.

The rules these tests lock:
  * tienda journals are their own perimeter and never land in a bodega;
  * an unrecognised journal is reported, never silently bucketed;
  * both windows are monthly averages over the same spans as p6/p3;
  * credit notes arrive already negated and must reduce the average.
"""
from odoo_sync_reabastecimiento import aggregate_invoiced, classify_invoice_journal

# Mapeo vigente desde 2026-08-21 (W11, migración 20260821000002): Zacapa y
# Petén dejaron de estar fusionadas. Wilmer: "Zacapa me debe de dar la venta de
# ambos, pero separada y sumada".
BODEGAS = {'San Jose VN': ['1CET'], 'Petén': ['3PET'], 'Zacapa': ['4ZAC']}

# El plegado de VARIOS códigos en una bodega sigue siendo una capacidad real de
# aggregate_invoiced (es como se arma cualquier agregado), así que se prueba
# aparte con un mapeo propio en vez de darla por muerta con la fusión.
BODEGAS_AGRUPADAS = {'Z&P': ['3PET', '4ZAC']}


# ── classify_invoice_journal ──────────────────────────────────────────────────

def test_cd_journals_map_to_their_warehouse():
    assert classify_invoice_journal('Facturas CD SJVN') == ('bodega', '1CET')
    assert classify_invoice_journal('Facturas CD Zacapa') == ('bodega', '4ZAC')
    assert classify_invoice_journal('Facturas CD Petén') == ('bodega', '3PET')


def test_journal_matching_ignores_accents_and_case():
    assert classify_invoice_journal('FACTURAS CD PETEN') == ('bodega', '3PET')
    assert classify_invoice_journal('  facturas cd petén  ') == ('bodega', '3PET')


def test_every_tienda_journal_is_its_own_perimeter():
    for name in ('Factura Tienda Terminal', 'Facturas Tienda Zona 11',
                 'Factura Tienda Zona 17', 'Factura Tienda La Torre',
                 'Facturas Tienda Mixco'):
        assert classify_invoice_journal(name) == ('tienda', name)


def test_unknown_journal_is_otros_not_guessed():
    assert classify_invoice_journal('Nota de debito Che Rechazado BI13') == (
        'otros', 'Nota de debito Che Rechazado BI13')


# ── aggregate_invoiced ────────────────────────────────────────────────────────

def test_monthly_average_uses_six_and_three():
    by_bodega, _, _ = aggregate_invoiced(
        [(1, 'Facturas CD SJVN', 600.0)], [(1, 'Facturas CD SJVN', 300.0)], BODEGAS)
    assert by_bodega['San Jose VN'][1] == {'f6': 100.0, 'f3': 100.0}


def test_zacapa_and_peten_are_separate_bodegas():
    """Desde W11 cada CD responde por su cuenta: Zacapa guarda stock que va de
    paso a Petén, y la cifra fusionada era justo la que Zacapa le discutía."""
    by_bodega, _, _ = aggregate_invoiced(
        [(1, 'Facturas CD Zacapa', 600.0), (1, 'Facturas CD Petén', 1200.0)], [], BODEGAS)
    assert by_bodega['Zacapa'][1]['f6'] == 100.0
    assert by_bodega['Petén'][1]['f6'] == 200.0


def test_several_warehouse_codes_can_still_fold_into_one_bodega():
    """La capacidad de plegar varios códigos en un agregado no desapareció con
    la separación — es como se construye cualquier bodega compuesta."""
    by_bodega, _, _ = aggregate_invoiced(
        [(1, 'Facturas CD Zacapa', 600.0), (1, 'Facturas CD Petén', 1200.0)],
        [], BODEGAS_AGRUPADAS)
    assert by_bodega['Z&P'][1]['f6'] == 300.0


def test_credit_notes_reduce_the_average():
    """Refunds arrive already negated, as account.invoice.report shows them."""
    by_bodega, _, _ = aggregate_invoiced(
        [(1, 'Facturas CD SJVN', 600.0), (1, 'Facturas CD SJVN', -60.0)], [], BODEGAS)
    assert by_bodega['San Jose VN'][1]['f6'] == 90.0


def test_tienda_units_never_reach_a_purchasing_bodega():
    by_bodega, tiendas, _ = aggregate_invoiced(
        [(1, 'Factura Tienda Terminal', 600.0)], [], BODEGAS)
    assert 'San Jose VN' not in by_bodega or 1 not in by_bodega.get('San Jose VN', {})
    assert tiendas[(1, 'Factura Tienda Terminal')]['f6'] == 100.0


def test_general_mirrors_the_ordered_side_and_includes_everything():
    """Ordered General is every warehouse, so invoiced General is every journal."""
    by_bodega, _, _ = aggregate_invoiced(
        [(1, 'Facturas CD SJVN', 600.0), (1, 'Factura Tienda Terminal', 1200.0),
         (1, 'Nota de debito Che Rechazado BI13', 6.0)], [], BODEGAS)
    assert by_bodega['General'][1]['f6'] == (600.0 + 1200.0 + 6.0) / 6


def test_unmapped_journal_is_reported_with_its_quantity():
    _, _, unmapped = aggregate_invoiced(
        [(1, 'Nota de debito Che Rechazado BI13', 40.0)], [], BODEGAS)
    assert unmapped == {'Nota de debito Che Rechazado BI13': 40.0}


def test_cd_journal_for_an_unmapped_warehouse_is_reported_not_dropped():
    """If bodega_map loses 3PET, Petén's units surface as unmapped instead of
    vanishing into General alone."""
    _, _, unmapped = aggregate_invoiced(
        [(1, 'Facturas CD Petén', 500.0)], [], {'San Jose VN': ['1CET']})
    assert unmapped == {'Facturas CD Petén': 500.0}


def test_windows_are_independent_per_product():
    by_bodega, _, _ = aggregate_invoiced(
        [(1, 'Facturas CD SJVN', 600.0), (2, 'Facturas CD SJVN', 60.0)],
        [(1, 'Facturas CD SJVN', 300.0)], BODEGAS)
    sj = by_bodega['San Jose VN']
    assert sj[1] == {'f6': 100.0, 'f3': 100.0}
    assert sj[2] == {'f6': 10.0, 'f3': 0.0}
