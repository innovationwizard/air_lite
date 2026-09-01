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
    transit, fuera, counted = attribute_transit(lineas, wh, BODEGAS)

    assert transit['San Jose VN'][100] == 50
    assert transit['Zacapa'][100] == 30
    assert 100 not in transit['Petén']
    assert counted == 2
    assert not fuera

    suma_compras = sum(sum(v.values()) for b, v in transit.items() if b != GENERAL_BODEGA)
    assert suma_compras == 80  # antes habría dado 240


def test_el_caso_de_wilmer_zacapa_no_ve_transito_de_san_jose():
    """«estos 50 en tránsito no son de la bodega de Zacapa»."""
    transit, _, _ = attribute_transit([linea(1, 77202156, 50)], {1: '1CET'}, BODEGAS)
    assert transit['Zacapa'].get(77202156, 0.0) == 0.0
    assert transit['San Jose VN'][77202156] == 50


def test_almacen_fuera_de_alcance_se_reporta_y_no_se_reparte():
    """SUB / 2Z11 / tiendas: ~30% del tránsito real. No son de nadie."""
    lineas = [linea(1, 100, 9305), linea(2, 101, 6361), linea(3, 102, 20)]
    wh = {1: 'SUB', 2: '2Z11', 3: 'T7Z11'}
    transit, fuera, _ = attribute_transit(lineas, wh, BODEGAS)

    for bodega in BODEGAS:
        assert not transit[bodega], f'{bodega} no debería recibir nada'
    assert fuera == {'SUB': 9305, '2Z11': 6361, 'T7Z11': 20}


def test_sin_picking_type_no_se_adivina():
    """Ninguna cantidad se «asigna por defecto» a San José."""
    transit, fuera, _ = attribute_transit([linea(1, 100, 700)], {1: None}, BODEGAS)
    assert not transit['San Jose VN']
    assert fuera == {'(sin picking_type)': 700}


def test_general_es_roll_up_del_mismo_perimetro_que_su_stock():
    """General suma todo menos GENERAL_EXCLUDED_WH — incluye lo que no es
    bodega de compra, igual que hace su propio stock."""
    lineas = [linea(1, 100, 50), linea(2, 100, 30), linea(3, 100, 20)]
    wh = {1: '1CET', 2: 'SUB', 3: '5DEP'}
    transit, _, _ = attribute_transit(lineas, wh, BODEGAS)
    assert transit[GENERAL_BODEGA][100] == 80  # 5DEP excluido


def test_lineas_ya_recibidas_no_son_transito():
    lineas = [linea(1, 100, 50, recibido=50), linea(1, 101, 50, recibido=20)]
    transit, _, counted = attribute_transit(lineas, {1: '1CET'}, BODEGAS)
    assert 100 not in transit['San Jose VN']
    assert transit['San Jose VN'][101] == 30
    assert counted == 1


def test_varias_lineas_del_mismo_producto_se_acumulan_por_bodega():
    lineas = [linea(1, 100, 10), linea(2, 100, 15), linea(3, 100, 7)]
    wh = {1: '4ZAC', 2: '4ZAC', 3: '1CET'}
    transit, _, _ = attribute_transit(lineas, wh, BODEGAS)
    assert transit['Zacapa'][100] == 25
    assert transit['San Jose VN'][100] == 7


def test_linea_sin_producto_se_ignora():
    transit, fuera, counted = attribute_transit(
        [{'order_id': [1, 'PO-1'], 'product_id': False, 'product_qty': 9, 'qty_received': 0}],
        {1: '1CET'}, BODEGAS)
    assert counted == 0 and not fuera and not transit


def test_bodega_con_varios_almacenes_sigue_funcionando():
    """La fusión Zacapa-Petén ya no rige, pero plegar varios códigos en una
    bodega es una capacidad real de bodega_map y no debe romperse."""
    agrupado = {'San Jose VN': ['1CET'], 'Z&P': ['3PET', '4ZAC']}
    lineas = [linea(1, 100, 10), linea(2, 100, 5)]
    transit, _, _ = attribute_transit(lineas, {1: '3PET', 2: '4ZAC'}, agrupado)
    assert transit['Z&P'][100] == 15
