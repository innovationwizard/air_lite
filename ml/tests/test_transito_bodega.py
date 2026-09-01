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
from odoo_sync_reabastecimiento import GENERAL_BODEGA, attribute_transit

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


def test_sin_picking_type_no_se_adivina():
    """Ninguna cantidad se «asigna por defecto» a San José."""
    transit, fuera, _, *_ = attribute_transit([linea(1, 100, 700)], {1: None}, BODEGAS)
    assert not transit['San Jose VN']
    assert fuera == {'(sin picking_type)': 700}


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
