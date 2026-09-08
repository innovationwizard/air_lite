"""W15-B — el tránsito se atribuye a la bodega que lo RECIBE
(odoo_sync_reabastecimiento.py: attribute_transit).

EL DEFECTO QUE ESTO CIERRA, medido en el código el 2026-08-27: `sync_transit()`
devolvía `{product_id: qty}` sin dimensión de bodega y `assemble_inputs()`
escribía ESE MISMO número en las tres. El tránsito no estaba «revuelto» como lo
describió Wilmer: estaba REPLICADO. Y como el motor acredita `exist + trans`
contra el forecast, el tránsito ajeno le TAPABA el Sugerido —
«no me da un sugerido porque está tomando los 3 saques».

MEDIDO EN PRODUCCIÓN EL 2026-08-27, antes del arreglo (56,847 unidades):
    1CET 39,861 (70.1%) · SUB 9,305 (16.4%) · 2Z11 6,361 (11.2%)
    SUBPA 1,300 (2.3%) · T7Z11 20 · **4ZAC 0 · 3PET 0**
Es decir: Zacapa y Petén no tenían NINGUNA orden de compra entrante, así que el
100% de lo que mostraban era ajeno; y ~30% del total va a almacenes fuera del
alcance de compras (subcontratación, Zona 11, tiendas) e inflaba a las tres.

LA REGLA (Jorge, Q26/Q2, 2026-08-27): sólo destino final — una cantidad
pendiente pertenece a EXACTAMENTE UNA bodega, la que la recibe.
"""
from odoo_sync_reabastecimiento import (
    GENERAL_BODEGA, attribute_transit, map_detalle_rows, prefijo_de_orden,
    resolve_sucursal_warehouses)

# Mapeo vigente (W11, migración 20260821000002).
BODEGAS = {'San Jose VN': ['1CET'], 'Petén': ['3PET'], 'Zacapa': ['4ZAC']}


def linea(order_id, pid, qty, recibido=0.0):
    return {'order_id': [order_id, f'PO-{order_id}'],
            'product_id': [pid, f'prod-{pid}'],
            'product_qty': qty, 'qty_received': recibido}


def test_cada_cantidad_cae_en_una_sola_bodega():
    """La invariante: sumar las bodegas de compra da el total UNA vez, no tres."""
    lineas = [linea(1, 100, 50), linea(2, 100, 30)]
    wh = {1: '1CET', 2: '4ZAC'}
    transit, fuera, counted, *_ = attribute_transit(lineas, wh, BODEGAS)

    assert transit['San Jose VN'][100] == 50
    assert transit['Zacapa'][100] == 30
    assert 100 not in transit['Petén']
    assert counted == 2
    assert not fuera

    suma_compras = sum(sum(v.values()) for b, v in transit.items() if b != GENERAL_BODEGA)
    assert suma_compras == 80  # antes habría dado 240


def test_el_caso_de_wilmer_zacapa_no_ve_transito_de_san_jose():
    """«estos 50 en tránsito no son de la bodega de Zacapa»."""
    transit, _, _, *_ = attribute_transit([linea(1, 77202156, 50)], {1: '1CET'}, BODEGAS)
    assert transit['Zacapa'].get(77202156, 0.0) == 0.0
    assert transit['San Jose VN'][77202156] == 50


def test_almacen_fuera_de_alcance_se_reporta_y_no_se_reparte():
    """SUB / 2Z11 / tiendas: ~30% del tránsito real. No son de nadie."""
    lineas = [linea(1, 100, 9305), linea(2, 101, 6361), linea(3, 102, 20)]
    wh = {1: 'SUB', 2: '2Z11', 3: 'T7Z11'}
    transit, fuera, _, *_ = attribute_transit(lineas, wh, BODEGAS)

    for bodega in BODEGAS:
        assert not transit[bodega], f'{bodega} no debería recibir nada'
    assert fuera == {'SUB': 9305, '2Z11': 6361, 'T7Z11': 20}


def test_sin_sucursal_no_se_adivina():
    """Ninguna cantidad se «asigna por defecto» a San José."""
    transit, fuera, _, *_ = attribute_transit([linea(1, 100, 700)], {1: None}, BODEGAS)
    assert not transit['San Jose VN']
    assert fuera == {'(sin sucursal)': 700}


def test_general_es_roll_up_del_mismo_perimetro_que_su_stock():
    """General suma todo menos GENERAL_EXCLUDED_WH — incluye lo que no es
    bodega de compra, igual que hace su propio stock."""
    lineas = [linea(1, 100, 50), linea(2, 100, 30), linea(3, 100, 20)]
    wh = {1: '1CET', 2: 'SUB', 3: '5DEP'}
    transit, _, _, *_ = attribute_transit(lineas, wh, BODEGAS)
    assert transit[GENERAL_BODEGA][100] == 80  # 5DEP excluido


def test_lineas_ya_recibidas_no_son_transito():
    lineas = [linea(1, 100, 50, recibido=50), linea(1, 101, 50, recibido=20)]
    transit, _, counted, *_ = attribute_transit(lineas, {1: '1CET'}, BODEGAS)
    assert 100 not in transit['San Jose VN']
    assert transit['San Jose VN'][101] == 30
    assert counted == 1


def test_varias_lineas_del_mismo_producto_se_acumulan_por_bodega():
    lineas = [linea(1, 100, 10), linea(2, 100, 15), linea(3, 100, 7)]
    wh = {1: '4ZAC', 2: '4ZAC', 3: '1CET'}
    transit, _, _, *_ = attribute_transit(lineas, wh, BODEGAS)
    assert transit['Zacapa'][100] == 25
    assert transit['San Jose VN'][100] == 7


def test_linea_sin_producto_se_ignora():
    transit, fuera, counted, *_ = attribute_transit(
        [{'order_id': [1, 'PO-1'], 'product_id': False, 'product_qty': 9, 'qty_received': 0}],
        {1: '1CET'}, BODEGAS)
    assert counted == 0 and not fuera and not transit


def test_bodega_con_varios_almacenes_sigue_funcionando():
    """La fusión Zacapa-Petén ya no rige, pero plegar varios códigos en una
    bodega es una capacidad real de bodega_map y no debe romperse."""
    agrupado = {'San Jose VN': ['1CET'], 'Z&P': ['3PET', '4ZAC']}
    lineas = [linea(1, 100, 10), linea(2, 100, 5)]
    transit, _, _, *_ = attribute_transit(lineas, {1: '3PET', 2: '4ZAC'}, agrupado)
    assert transit['Z&P'][100] == 15


# ─── A6.15 — el desglose por fecha que explica el total ──────────────────────
#
# «1,200 en tránsito: ¿500 entran el 24?» (Mario vía Wilmer, 20-ago). El detalle
# sale del MISMO recorrido que el total a propósito: si se calculara aparte, el
# día que cambie la regla de atribución los dos dirían cosas distintas.

def linea_con_fecha(order_id, pid, qty, fecha, recibido=0.0):
    ln = linea(order_id, pid, qty, recibido)
    ln['date_planned'] = fecha
    return ln


def test_el_detalle_suma_exactamente_el_total_de_la_columna():
    # El invariante que hace confiable el drill-down: si no cuadra, el usuario
    # descubre que la app se contradice consigo misma.
    lineas = [linea_con_fecha(1, 100, 500, '2026-09-24 08:00:00'),
              linea_con_fecha(2, 100, 700, '2026-10-01 08:00:00')]
    wh = {1: '1CET', 2: '1CET'}
    transit, _, _, detalle = attribute_transit(lineas, wh, BODEGAS)
    de_sj = [d for d in detalle if d['bodega'] == 'San Jose VN' and d['opid'] == 100]
    assert sum(d['qty'] for d in de_sj) == transit['San Jose VN'][100] == 1200


def test_cada_entrada_lleva_su_fecha_y_su_correlativo():
    lineas = [linea_con_fecha(7, 100, 500, '2026-09-24 08:00:00')]
    _, _, _, detalle = attribute_transit(lineas, {7: '1CET'}, BODEGAS,
                                         nombre_por_orden={7: 'PO00123'})
    assert detalle[0]['fecha'].startswith('2026-09-24')
    assert detalle[0]['orden'] == 'PO00123'


def test_sin_fecha_en_la_linea_cae_a_la_del_encabezado():
    ln = linea(3, 100, 250)          # sin date_planned propio
    _, _, _, detalle = attribute_transit([ln], {3: '1CET'}, BODEGAS,
                                         fecha_por_orden={3: '2026-11-05 00:00:00'})
    assert detalle[0]['fecha'].startswith('2026-11-05')


def test_sin_fecha_en_ningun_lado_queda_en_none_y_no_se_inventa():
    # Una fecha inventada haría que alguien decidiera NO comprar por una
    # entrada que quizá nunca llega.
    ln = linea(4, 100, 80)
    _, _, _, detalle = attribute_transit([ln], {4: '1CET'}, BODEGAS)
    assert detalle[0]['fecha'] is None


def test_lo_fuera_de_alcance_no_entra_al_detalle():
    # Mismo criterio que el total: lo que no se reparte, no se desglosa.
    lineas = [linea_con_fecha(5, 100, 900, '2026-09-24 08:00:00')]
    _, fuera, _, detalle = attribute_transit(lineas, {5: 'SUB'}, BODEGAS)
    assert fuera['SUB'] == 900
    assert detalle == []


def test_el_detalle_no_duplica_por_el_roll_up_general():
    # General suma las bodegas físicas; si el detalle también lo incluyera, el
    # desglose contaría dos veces cada línea.
    lineas = [linea_con_fecha(6, 100, 300, '2026-09-24 08:00:00')]
    _, _, _, detalle = attribute_transit(lineas, {6: '1CET'}, BODEGAS)
    assert [d['bodega'] for d in detalle] == ['San Jose VN']
    assert GENERAL_BODEGA not in {d['bodega'] for d in detalle}


# ─── La traducción de ids, que es donde estuvo el error ──────────────────────

def test_el_mapa_de_productos_se_indexa_por_STRING_no_por_int():
    # El bug del 2026-09-01: buscar product_map[opid] con un int devolvía None
    # para TODAS las líneas y escribía la tabla vacía sin un solo error. Las
    # pruebas de attribute_transit pasaban, porque el fallo estaba acá.
    detalle = [{'bodega': 'San Jose VN', 'opid': 100, 'fecha': '2026-09-24 08:00:00',
                'qty': 500.0, 'orden': 'PO1'}]
    filas = map_detalle_rows(detalle, {'100': 77}, 'sync-1')
    assert len(filas) == 1
    assert filas[0]['product_id'] == 77


def test_la_fecha_se_recorta_a_dia_y_el_vacio_queda_en_none():
    detalle = [{'bodega': 'Zacapa', 'opid': 1, 'fecha': '2026-09-24 08:00:00', 'qty': 5, 'orden': None},
               {'bodega': 'Zacapa', 'opid': 1, 'fecha': None, 'qty': 3, 'orden': None}]
    filas = map_detalle_rows(detalle, {'1': 9}, 's')
    assert filas[0]['fecha'] == '2026-09-24'
    assert filas[1]['fecha'] is None


def test_un_producto_fuera_del_catalogo_se_descarta_sin_romper():
    detalle = [{'bodega': 'Petén', 'opid': 999, 'fecha': None, 'qty': 1, 'orden': None}]
    assert map_detalle_rows(detalle, {'100': 77}, 's') == []


# ─── P0.1 — la sucursal de la orden es el destino, no su primer tramo ────────
#
# EL DEFECTO QUE ESTO CIERRA, medido en producción el 2026-09-08: la atribución
# usaba `picking_type_id`, que dice dónde DESCARGA el camión. Por eso el
# 2026-08-27 se midió **4ZAC 0 · 3PET 0** con el 88% en 1CET. Leyendo la
# sucursal dueña (`purchase.order.location_id`, comodel `branch.location`),
# Petén pasa de 0 a 2,575 y Zacapa de 550 a 3,387 sobre 175,154 pendientes.
#
# Los 9 prefijos salen de Odoo (`branch.location.po_prefix`), no de una
# transcripción: `PO-PE-` Petén · `PO-PZ-` Zacapa · `PO-P-` Central · `PO-PT*-`
# tiendas (San José, no tienen bodega) · `PO-PZ11-` CD Zona 11 (sin decidir).

# Los prefijos reales, leídos de producción el 2026-09-08.
PREFIJOS = {2: 'PO-P-', 1: 'PO-PE-', 3: 'PO-PZ-', 9: 'PO-PZ11-',
            4: 'PO-PT11-', 5: 'PO-PT9-', 6: 'PO-PT17-', 7: 'PO-PTTorre-',
            10: 'PO-PT6-'}


def orden(oid, name, branch=None):
    o = {'id': oid, 'name': name}
    if branch is not None:
        o['location_id'] = [branch, f'sucursal-{branch}']
    return o


def test_la_sucursal_manda_sobre_el_almacen_que_recibe():
    """El caso que lo motiva: una OC de Petén que descarga en el CD Central
    sigue siendo tránsito de Petén."""
    wh, stats = resolve_sucursal_warehouses([orden(1, 'PO-PE-0001', 1)], PREFIJOS)
    assert wh[1] == '3PET'
    assert stats['por_campo'] == 1 and stats['por_nombre'] == 0


def test_el_correlativo_del_nombre_es_el_respaldo():
    """Sin `location_id`, el nombre lleva el mismo dato — medido 1:1 en las 52
    órdenes vivas del 2026-09-08."""
    wh, stats = resolve_sucursal_warehouses([orden(1, 'PO-PZ-0007')], PREFIJOS)
    assert wh[1] == '4ZAC'
    assert stats['por_nombre'] == 1 and stats['por_campo'] == 0


def test_pz11_no_se_confunde_con_pz_ni_con_p():
    """Un `startswith` mandaría `PO-PZ11-0007` a Zacapa (o a Central). El
    prefijo se corta completo y la búsqueda es exacta."""
    assert prefijo_de_orden('PO-PZ11-0007') == 'PO-PZ11-'
    assert prefijo_de_orden('PO-PZ-0007') == 'PO-PZ-'
    assert prefijo_de_orden('PO-P-2960') == 'PO-P-'
    assert prefijo_de_orden('PO-PTTorre-12') == 'PO-PTTorre-'


def test_sin_numero_no_inventa_prefijo():
    assert prefijo_de_orden('PO-P-') is None
    assert prefijo_de_orden('') is None
    assert prefijo_de_orden(None) is None


def test_las_tiendas_son_san_jose():
    """Jorge 2026-09-03: «they all source from San José as they do not have
    warehouse space». Las cinco, incluida Mixco, cuyo prefijo de OC es PO-PT6-
    aunque su prefijo de venta sea SO-T6Mix-."""
    ordenes = [orden(1, 'PO-PT11-1', 4), orden(2, 'PO-PT9-1', 5),
               orden(3, 'PO-PT17-1', 6), orden(4, 'PO-PTTorre-1', 7),
               orden(5, 'PO-PT6-1', 10)]
    wh, _ = resolve_sucursal_warehouses(ordenes, PREFIJOS)
    assert set(wh.values()) == {'1CET'}


def test_el_cd_zona_11_queda_reportado_y_no_se_reparte():
    """No es tienda: la regla de las tiendas no le aplica y Jorge no lo ha
    decidido. Sale con nombre para que caiga en la cubeta que se reporta —
    2,947 unidades medidas el 2026-09-08."""
    wh, stats = resolve_sucursal_warehouses(
        [{'id': 1, 'name': 'PO-PZ11-0007',
          'location_id': [9, 'Centro de Distribución Zona 11']}], PREFIJOS)
    assert wh[1] == 'sucursal:Centro de Distribución Zona 11'
    assert stats['fuera_de_mapa']['sucursal:Centro de Distribución Zona 11'] == 1

    # Y el reparto lo deja fuera de las bodegas de compra, con su nombre.
    transit, fuera, _, _ = attribute_transit([linea(1, 100, 2947)], wh, BODEGAS)
    for bodega in BODEGAS:
        assert not transit[bodega]
    assert fuera == {'sucursal:Centro de Distribución Zona 11': 2947}


def test_una_orden_sin_sucursal_ni_correlativo_no_se_adivina():
    wh, stats = resolve_sucursal_warehouses([{'id': 1, 'name': 'RANDOM'}], PREFIJOS)
    assert wh[1] is None
    assert stats['sin_sucursal'] == 1


def test_el_campo_gana_al_nombre_y_la_discrepancia_se_cuenta():
    """El campo manda (Jorge: leerlo primero), pero un desacuerdo es señal de
    captura y no puede pasar callado. Medido 2026-09-08: 0 de 52."""
    wh, stats = resolve_sucursal_warehouses([orden(1, 'PO-P-0001', 3)], PREFIJOS)
    assert wh[1] == '4ZAC'                    # la sucursal 3 es Zacapa
    assert stats['discrepancia_nombre'] == 1


def test_sin_catalogo_de_sucursales_el_nombre_sostiene_la_atribucion():
    """Si `branch.location` no se pudiera leer, el sync no se cae: el
    correlativo sigue resolviendo, que es por qué el respaldo existe."""
    ordenes = [orden(1, 'PO-PE-1', 1), orden(2, 'PO-PZ-2', 3), orden(3, 'PO-P-3', 2)]
    wh, stats = resolve_sucursal_warehouses(ordenes, {})
    assert [wh[1], wh[2], wh[3]] == ['3PET', '4ZAC', '1CET']
    assert stats['por_nombre'] == 3
