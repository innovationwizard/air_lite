"""Pendiente de tomar reserva — la agregación pura (sin Odoo)."""
from pendiente_reserva import agrupar, picking_types_por_bodega

BODEGAS = {1: '1CET', 3: '3PET', 4: '4ZAC'}

# Recorte real de stock.picking.type en producción (2026-09-11).
TIPOS = [
    {'id': 5, 'sequence_code': 'INT', 'warehouse_id': [1, '1 Bodega Central']},
    {'id': 2, 'sequence_code': 'OUT', 'warehouse_id': [1, '1 Bodega Central']},
    {'id': 270, 'sequence_code': 'INTER', 'warehouse_id': [1, '1 Bodega Central']},
    {'id': 107, 'sequence_code': 'RES', 'warehouse_id': [1, '1 Bodega Central']},
    {'id': 47, 'sequence_code': 'POS', 'warehouse_id': [1, '1 Bodega Central']},
    {'id': 22, 'sequence_code': 'INT', 'warehouse_id': [3, '3 Peten']},
    {'id': 19, 'sequence_code': 'OUT', 'warehouse_id': [3, '3 Peten']},
    {'id': 30, 'sequence_code': 'INT', 'warehouse_id': [4, '4 Bodega Zacapa']},
    {'id': 27, 'sequence_code': 'OUT', 'warehouse_id': [4, '4 Bodega Zacapa']},
    {'id': 14, 'sequence_code': 'INT', 'warehouse_id': [2, '2 Bodega Zona 11']},
    {'id': 99, 'sequence_code': 'OUT', 'warehouse_id': False},
]


def test_1cet_resuelve_exactamente_al_favorito_de_wilmer():
    por = picking_types_por_bodega(TIPOS, BODEGAS)
    assert por['1CET'] == [2, 5]          # ir.filters 1166: picking_type_id in [5, 2]
    assert por['3PET'] == [19, 22]
    assert por['4ZAC'] == [27, 30]
    assert 'ZONA11' not in por             # no pedida → no aparece


def test_bodega_sin_tipos_aparece_vacia():
    por = picking_types_por_bodega([], BODEGAS)
    assert por == {'1CET': [], '3PET': [], '4ZAC': []}


def test_agrupar_replica_la_pantalla_de_77205001():
    # Los totales del 2026-09-11: OUT 3452/1661.976, INT 550/0 — ambos salen de 1CET/Existencias.
    grupos = [
        {'product_id': [7116, 'x'], 'location_id': [8, '1CET/Existencias'],
         'product_uom_qty': 3452.0, 'quantity': 1661.976},
        {'product_id': [7116, 'x'], 'location_id': [8, '1CET/Existencias'],
         'product_uom_qty': 550.0, 'quantity': 0.0},
        {'product_id': [8000, 'y'], 'location_id': [36, '4ZAC/Existencias'],
         'product_uom_qty': 10.0, 'quantity': 10.0},
    ]
    ubicacion_a_bodega = {8: '1CET', 36: '4ZAC', 28: '3PET'}
    out = agrupar(grupos, ubicacion_a_bodega)
    assert out['1CET'][7116] == {'demanda': 4002.0, 'cantidad': 1661.976, 'pendiente': 2340.024}
    # Reservado completo → pendiente 0 conocido.
    assert out['4ZAC'][8000]['pendiente'] == 0.0
    # Bodega pedida sin movimientos abiertos: dict vacío, no ausente.
    assert out['3PET'] == {}


def test_agrupar_nunca_devuelve_negativo_y_tolera_ruido():
    grupos = [
        {'product_id': [1, 'a'], 'location_id': [8, '1CET/Existencias'], 'product_uom_qty': 5.0, 'quantity': 5.0004},
        {'product_id': [2, 'b'], 'location_id': [8, '1CET/Existencias'], 'product_uom_qty': 5.0, 'quantity': 9.0},
        {'product_id': [3, 'c'], 'location_id': [777, '?'], 'product_uom_qty': 5.0, 'quantity': 0.0},
        {'product_id': False, 'location_id': [8, '1CET/Existencias'], 'product_uom_qty': 5.0, 'quantity': 0.0},
    ]
    out = agrupar(grupos, {8: '1CET'})
    assert out['1CET'][1]['pendiente'] == 0.0
    assert out['1CET'][2]['pendiente'] == 0.0
    assert 3 not in out['1CET']
    assert len(out['1CET']) == 2


def test_agrupar_por_sku_descarta_productos_sin_codigo():
    grupos = [
        {'product_id': [7116, 'x'], 'location_id': [8, '1CET/Existencias'], 'product_uom_qty': 10.0, 'quantity': 4.0},
        {'product_id': [7116, 'x'], 'location_id': [8, '1CET/Existencias'], 'product_uom_qty': 5.0, 'quantity': 0.0},
        {'product_id': [9999, 'servicio'], 'location_id': [8, '1CET/Existencias'], 'product_uom_qty': 3.0, 'quantity': 0.0},
    ]
    out = agrupar(grupos, {8: '1CET'}, {7116: '77205001'})
    assert out == {'1CET': {'77205001': {'demanda': 15.0, 'cantidad': 4.0, 'pendiente': 11.0}}}


def test_agrupar_atribuye_por_ubicacion_de_origen_no_por_albaran():
    # Un albarán de 4ZAC que saca de 1CET/Existencias es demanda de 1CET
    # (visto en producción 2026-09-11: 80 unidades en borrador).
    grupos = [{'product_id': [1, 'a'], 'location_id': [8, '1CET/Existencias'],
               'product_uom_qty': 80.0, 'quantity': 0.0}]
    out = agrupar(grupos, {8: '1CET', 36: '4ZAC'})
    assert out == {'1CET': {1: {'demanda': 80.0, 'cantidad': 0.0, 'pendiente': 80.0}}, '4ZAC': {}}
