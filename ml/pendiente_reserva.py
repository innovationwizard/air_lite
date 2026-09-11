"""
«Pendiente de tomar reserva» — la parte PURA (sin Odoo) del cálculo en vivo.

Qué es (Wilmer, 2026-09-11, pantalla «Análisis de movimientos», favorito
«Wilmer - Reservas.» = `ir.filters` 1166 sobre `stock.move`):

    dominio : state not in (cancel, done)  ∧  picking_type_id in (OUT, INT de la bodega)
    medidas : product_uom_qty (Demanda)  y  quantity (Cantidad = ya reservada)
    valor   : Demanda − Cantidad

Es decir: demanda ya en un albarán abierto —entregas a clientes Y traslados a
tiendas— que todavía no tiene existencias reservadas, y que se va a comer el
próximo ingreso. Cuenta TODOS los estados no finales, incluidos `draft` y el
remanente de `partially_available`; es su definición, no una nuestra.

Un refinamiento nuestro, medido el mismo día, que su favorito no necesita en
Bodega Central pero sí en las otras dos: el movimiento tiene que SALIR de las
existencias de la bodega (`location_id` = `stock.warehouse.lot_stock_id`).
En 4ZAC y 3PET el tipo «Traslados internos» es también la segunda pata de
las RECEPCIONES (`4ZAC/Entrada → 4ZAC/Existencias`, origen `PO-PZ-…`):
mercadería que ENTRA, no demanda que espera stock. Sin el refinamiento,
Zacapa daba 82,000 y Petén 91,000 unidades «pendientes»; con él, 691 y 780.
En 1CET el mismo filtro quita además la segunda pata de los traslados a
tiendas (`1CET a T8 → T8`), que su favorito cuenta dos veces (~830 unidades
ese día, ~8%): todos los renglones de su captura de pantalla (77205001)
salen de `1CET/Existencias` y quedan intactos.

Por qué vive aparte de `api.py`: el endpoint hace las llamadas a Odoo y esto
es lo único que se puede probar sin Odoo. La sonda `ml/probe_pending_reserve.py`
reproduce la pantalla renglón por renglón; esto es la versión agregada que
consume la página (un `read_group` por carga, nunca una llamada por producto).

⚠️ Este número NO se sincroniza ni se guarda: Odoo reserva la demanda
confirmada casi al instante, así que el sliver sin reservar cambia minuto a
minuto (2026-09-03: 40 vs 275 movimientos para el mismo SKU×bodega con 20
minutos de diferencia; 2026-09-11: 77205001 pasó de 2,340 a 1,312 en una
hora). Se consulta en vivo por request, o no se muestra.
"""

# Los tipos de albarán que entran, por `sequence_code` y no por id: en 1CET
# resuelven EXACTAMENTE a los [2, 5] del favorito de Wilmer (verificado
# 2026-09-11) y en 4ZAC/3PET a sus equivalentes. Quedan fuera a propósito
# `RES` (Subcontratista de reabastecimiento), `INTER` (traslado
# internacional) y `POS` — el favorito tampoco los incluye.
SEQUENCE_CODES = ('OUT', 'INT')

# Odoo guarda `quantity` con decimales de UoM (1661.976 para 1662 reservadas);
# por debajo de esto un pendiente es ruido de redondeo, no demanda.
EPSILON = 0.001


def picking_types_por_bodega(tipos, bodegas):
    """{código de bodega: [picking_type_id, ...]} para los códigos pedidos.

    `tipos` son filas de `stock.picking.type` con `id`, `sequence_code` y
    `warehouse_id` ([id, nombre]); `bodegas` es {warehouse_id: código}.
    Una bodega sin tipos OUT/INT aparece igual, con lista vacía: que el
    llamador vea «no hay tipos» y no «no hay pendiente».
    """
    por_bodega = {codigo: [] for codigo in bodegas.values()}
    for t in tipos:
        if t.get('sequence_code') not in SEQUENCE_CODES or not t.get('warehouse_id'):
            continue
        codigo = bodegas.get(t['warehouse_id'][0])
        if codigo is not None:
            por_bodega[codigo].append(t['id'])
    for lista in por_bodega.values():
        lista.sort()
    return por_bodega


def agrupar(grupos, bodega_por_ubicacion, sku_por_producto=None):
    """Colapsa el `read_group` por (product_id, location_id) a
    {código de bodega: {llave de producto: {demanda, cantidad, pendiente}}}.

    `grupos` son filas de `stock.move.read_group(lazy=False)` con
    `product_id` ([id, nombre]), `location_id` ([id, nombre]),
    `product_uom_qty` y `quantity`; `bodega_por_ubicacion` es
    {lot_stock_id: código} — la bodega se atribuye por DE DÓNDE SALE el
    movimiento, no por el tipo de albarán (un albarán de 4ZAC que saca de
    `1CET/Existencias` es demanda de 1CET). Un grupo de una ubicación que
    no mapea se ignora (no debería llegar: el dominio ya filtró por ellas).

    La llave de producto es el SKU cuando se pasa `sku_por_producto`
    ({odoo_product_id: default_code}) — la única llave estable entre builds
    de Odoo —, y un producto sin SKU se descarta: tampoco llega a `products`
    (ver `odoo_sync_reabastecimiento.classify_products`). Sin el mapa, la
    llave es el id de Odoo (las pruebas y la sonda).

    Un producto SIN filas queda fuera del dict: para la página eso es
    pendiente = 0 CONOCIDO (Odoo respondió y no hay movimientos abiertos),
    distinto de «Odoo no respondió», que es el 502 del endpoint.
    """
    salida = {codigo: {} for codigo in set(bodega_por_ubicacion.values())}
    for g in grupos:
        ubicacion = g.get('location_id')
        producto = g.get('product_id')
        if not ubicacion or not producto:
            continue
        codigo = bodega_por_ubicacion.get(ubicacion[0])
        if codigo is None:
            continue
        llave = producto[0] if sku_por_producto is None else sku_por_producto.get(producto[0])
        if llave is None:
            continue
        acc = salida[codigo].setdefault(llave, {'demanda': 0.0, 'cantidad': 0.0, 'pendiente': 0.0})
        acc['demanda'] += float(g.get('product_uom_qty') or 0.0)
        acc['cantidad'] += float(g.get('quantity') or 0.0)
    for por_producto in salida.values():
        for acc in por_producto.values():
            pendiente = acc['demanda'] - acc['cantidad']
            # Nunca negativo: una `quantity` mayor que la demanda es un
            # sobre-reservado de Odoo, no un pendiente que reste.
            acc['pendiente'] = round(pendiente, 3) if pendiente > EPSILON else 0.0
            acc['demanda'] = round(acc['demanda'], 3)
            acc['cantidad'] = round(acc['cantidad'], 3)
    return salida
