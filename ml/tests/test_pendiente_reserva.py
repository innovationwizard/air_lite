"""Pendiente de tomar reserva — la agregación pura (sin Odoo)."""
from pendiente_reserva import agrupar, en_uom_de_stock, picking_types_por_bodega

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


# Factores medidos en `units_of_measure`: la referencia vale 1, CAJA20 vale
# 0.05 (20 unidades), FARDO100 vale 0.01 (100 unidades).
CAJA20, UNIDAD_CJ, FARDO100, UNIDAD_FD = 59, 167, 87, 165
FACTORES = {CAJA20: 0.05, UNIDAD_CJ: 1.0, FARDO100: 0.01, UNIDAD_FD: 1.0}


def test_unidades_sueltas_no_se_restan_como_cajas():
    """77201326, Wilmer 2026-09-29: 2 CAJA20 ya reservadas + 1,096 unidades
    sueltas abiertas. En crudo eso es pendiente 1,096 y exist. neta −1,059
    contra 43.5 cajas a la mano. En UoM de stock son 54.8 cajas pendientes."""
    grupos = [
        {'product_id': [1265, 'tapa'], 'location_id': [8, '1CET/Existencias'],
         'product_uom': [CAJA20, 'CAJA20'], 'product_uom_qty': 2.0, 'quantity': 2.0},
        {'product_id': [1265, 'tapa'], 'location_id': [8, '1CET/Existencias'],
         'product_uom': [UNIDAD_CJ, 'Unidad CJ'], 'product_uom_qty': 1096.0, 'quantity': 0.0},
    ]
    convertidos, sin = en_uom_de_stock(grupos, FACTORES, {1265: CAJA20})
    assert sin == 0
    # El grupo de entrada no se muta: el crudo sigue siendo el de la pantalla.
    assert grupos[1]['product_uom_qty'] == 1096.0
    out = agrupar(convertidos, {8: '1CET'})
    assert out['1CET'][1265]['demanda'] == 56.8
    assert out['1CET'][1265]['cantidad'] == 2.0
    assert out['1CET'][1265]['pendiente'] == 54.8


def test_fardo_suelto_se_pliega_y_lo_ya_en_fardo_pasa_igual():
    """88111011: 93 FARDO100 reservados (cuadran con el quant) + 2,007 unidades."""
    grupos = [
        {'product_id': [1397, 'tenedor'], 'location_id': [8, '1CET/Existencias'],
         'product_uom': [FARDO100, 'FARDO100'], 'product_uom_qty': 93.0, 'quantity': 93.0},
        {'product_id': [1397, 'tenedor'], 'location_id': [8, '1CET/Existencias'],
         'product_uom': [UNIDAD_FD, 'Unidad FD'], 'product_uom_qty': 2007.0, 'quantity': 0.0},
    ]
    convertidos, sin = en_uom_de_stock(grupos, FACTORES, {1397: FARDO100})
    assert sin == 0
    out = agrupar(convertidos, {8: '1CET'})
    assert out['1CET'][1397]['cantidad'] == 93.0
    assert out['1CET'][1397]['pendiente'] == 20.07


def test_uom_desconocida_se_suma_tal_cual_y_se_cuenta():
    grupos = [
        {'product_id': [1, 'a'], 'location_id': [8, '1CET/Existencias'],
         'product_uom': [999, '?'], 'product_uom_qty': 5.0, 'quantity': 1.0},
    ]
    convertidos, sin = en_uom_de_stock(grupos, FACTORES, {1: CAJA20})
    assert sin == 1
    assert convertidos[0]['product_uom_qty'] == 5.0


def test_agrupar_atribuye_por_ubicacion_de_origen_no_por_albaran():
    # Un albarán de 4ZAC que saca de 1CET/Existencias es demanda de 1CET
    # (visto en producción 2026-09-11: 80 unidades en borrador).
    grupos = [{'product_id': [1, 'a'], 'location_id': [8, '1CET/Existencias'],
               'product_uom_qty': 80.0, 'quantity': 0.0}]
    out = agrupar(grupos, {8: '1CET', 36: '4ZAC'})
    assert out == {'1CET': {1: {'demanda': 80.0, 'cantidad': 0.0, 'pendiente': 80.0}}, '4ZAC': {}}
