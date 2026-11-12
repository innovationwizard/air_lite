"""One-SKU, read-only explanation of the reabastecimiento rules.

Used by the admin preview and by the grid's "why this number?" drawer.
It reads Odoo and applies the same selectors the sync uses
(`location_ids_for`, `general_exist_location_ids`, `patio_ids_for`,
`resolve_sucursal_warehouses`, `attribute_transit`, the pendiente origin
filter). It does not write `reabastecimiento_inputs` or anything else.

The numbers are a live read. They follow the saved rule when that rule is
the seed, and they are not a second copy of the hourly snapshot: the grid
keeps showing the snapshot. Callers that pass `propuesto` get a second pass
over the same read, so current vs proposed differ only where the rule differs.
"""

from datetime import datetime, timezone

from config_rules import (
    ORIGIN_WAREHOUSE_LOT_STOCK,
    TRANSIT_CUTOFF_TODAY_UTC,
    accept_excluded_wh,
    accept_existencias,
    accept_patio,
    accept_pendiente,
    accept_prefix_map,
    accept_transit_rules,
    read_config,
)
from odoo_sync_reabastecimiento import (
    GENERAL_BODEGA,
    GENERAL_EXCLUDED_WH,
    PATIO_BODEGAS,
    PATIO_LOCATION,
    SUCURSAL_PREFIX_TO_WH,
    TRANSIT_STATES,
    attribute_transit,
    general_exist_location_ids,
    location_ids_for,
    resolve_sucursal_warehouses,
)
from pendiente_reserva import EPSILON, EXCLUDED_MOVE_STATES, SEQUENCE_CODES

BODEGA_ORDEN = ('San Jose VN', 'Zacapa', 'Petén', GENERAL_BODEGA)
TOPE_DETALLE = 80

_ACEPTAR = {
    'stock.existencias.locations': accept_existencias,
    'stock.patio': accept_patio,
    'transit.rules': accept_transit_rules,
    'transit.prefix_map': accept_prefix_map,
    'pendiente.rules': accept_pendiente,
    'bodega.general_excluded_wh': accept_excluded_wh,
}


class SkuDesconocido(LookupError):
    pass


class ReglaInvalida(ValueError):
    pass


class _Callado:
    def add(self, *args, **kwargs):
        return None


def reglas_guardadas():
    """The six rules the sync would use on its next run, fallbacks included."""
    loaded = read_config({
        'stock.existencias.locations': ({'kind': 'Existencias'}, accept_existencias),
        'stock.patio': (
            {'location': PATIO_LOCATION, 'bodegas': PATIO_BODEGAS},
            accept_patio,
        ),
        'transit.rules': (
            {'states': TRANSIT_STATES, 'date_cutoff': TRANSIT_CUTOFF_TODAY_UTC},
            accept_transit_rules,
        ),
        'transit.prefix_map': (dict(SUCURSAL_PREFIX_TO_WH), accept_prefix_map),
        'pendiente.rules': (
            {
                'sequence_codes': SEQUENCE_CODES,
                'excluded_states': EXCLUDED_MOVE_STATES,
                'origin': ORIGIN_WAREHOUSE_LOT_STOCK,
            },
            accept_pendiente,
        ),
        'bodega.general_excluded_wh': (GENERAL_EXCLUDED_WH, accept_excluded_wh),
    })
    return _normalizar(loaded)


def aplicar_propuesto(actual, propuesto):
    """Overlay editor JSON on the saved rules. An unknown shape is an error.

    The sync would ignore that shape and keep the constant. The preview says
    so instead, so a draft that would not change the calculation is not shown
    as if it had.
    """
    if propuesto is None:
        return None
    if not isinstance(propuesto, dict):
        raise ReglaInvalida('propuesto tiene que ser un objeto de reglas')
    loaded = _desnormalizar(actual)
    for key, value in propuesto.items():
        accept = _ACEPTAR.get(key)
        if accept is None:
            raise ReglaInvalida(f'regla desconocida: {key}')
        accepted = accept(value)
        if accepted is None:
            raise ReglaInvalida(
                f'{key} no tiene la forma que el cálculo sabe aplicar')
        loaded[key] = accepted
    return _normalizar(loaded)


def explicar(execute, sku, bodega_codes, actual, propuesto=None):
    """`bodega_codes` is {bodega name: [warehouse code, ...]} from bodega_map."""
    if not bodega_codes:
        raise RuntimeError('bodega_map no tiene bodegas en alcance')
    snap = _leer(execute, sku.strip(), bodega_codes, _estados_comunes(actual, propuesto))
    snap['execute'] = execute
    bodegas = []
    for nombre in _orden(bodega_codes):
        bodegas.append({
            'bodega': nombre,
            'actual': _aplicar(snap, actual, nombre),
            'propuesto': None if propuesto is None else _aplicar(snap, propuesto, nombre),
        })
    return {
        'sku': snap['sku'],
        'producto': snap['nombre'],
        'bodegas': bodegas,
        'escribe': False,
    }


def _normalizar(loaded):
    patio = loaded['stock.patio']
    transit = loaded['transit.rules']
    pend = loaded['pendiente.rules']
    return {
        'kind': loaded['stock.existencias.locations']['kind'],
        'patio_location': patio['location'],
        'patio_bodegas': patio['bodegas'],
        'states': list(transit['states']),
        'date_cutoff': transit['date_cutoff'],
        'prefix_map': dict(loaded['transit.prefix_map']),
        'sequence_codes': tuple(pend['sequence_codes']),
        'excluded_states': tuple(pend['excluded_states']),
        'origin': pend['origin'],
        'excluded_wh': tuple(loaded['bodega.general_excluded_wh']),
    }


def _desnormalizar(rules):
    return {
        'stock.existencias.locations': {'kind': rules['kind']},
        'stock.patio': {
            'location': rules['patio_location'],
            'bodegas': sorted(rules['patio_bodegas']),
        },
        'transit.rules': {
            'states': list(rules['states']),
            'date_cutoff': rules['date_cutoff'],
        },
        'transit.prefix_map': dict(rules['prefix_map']),
        'pendiente.rules': {
            'sequence_codes': list(rules['sequence_codes']),
            'excluded_states': list(rules['excluded_states']),
            'origin': rules['origin'],
        },
        'bodega.general_excluded_wh': list(rules['excluded_wh']),
    }


def _orden(bodega_codes):
    nombres = list(bodega_codes)
    cabeza = [b for b in BODEGA_ORDEN if b in nombres or b == GENERAL_BODEGA]
    resto = [b for b in nombres if b not in BODEGA_ORDEN]
    orden = []
    for b in cabeza:
        if b == GENERAL_BODEGA:
            continue
        if b not in orden:
            orden.append(b)
    orden.extend(resto)
    orden.append(GENERAL_BODEGA)
    return orden


def _estados_comunes(actual, propuesto):
    """States both rule sets exclude. Those moves cannot affect either total."""
    comunes = set(actual['excluded_states'])
    if propuesto is not None:
        comunes &= set(propuesto['excluded_states'])
    return sorted(comunes)


def _leer(execute, sku, bodega_codes, estados_excluidos):
    productos = execute(
        'product.product', 'search_read',
        [['default_code', '=', sku]],
        fields=['id', 'name', 'uom_id', 'default_code'],
        limit=1, order='id asc', context={'active_test': False},
    )
    if not productos:
        raise SkuDesconocido(f'Odoo no tiene un producto con SKU {sku}')
    producto = productos[0]
    pid = producto['id']
    stock_uom = producto['uom_id'][0] if producto.get('uom_id') else None

    locs = _paginar(execute, 'stock.location', [['usage', '=', 'internal']],
                    ['id', 'complete_name'])
    by_name = {loc['complete_name']: loc['id'] for loc in locs}
    nombres = {loc['id']: loc['complete_name'] for loc in locs}

    codigos = sorted({c for cs in bodega_codes.values() for c in cs})
    almacenes = _paginar(execute, 'stock.warehouse', [['code', 'in', codigos]],
                         ['code', 'lot_stock_id']) if codigos else []
    lot_a_codigo = {
        w['lot_stock_id'][0]: w['code']
        for w in almacenes if w.get('lot_stock_id')
    }
    wh_ids = [w['id'] for w in almacenes]
    tipos = _paginar(
        execute, 'stock.picking.type',
        [['warehouse_id', 'in', wh_ids]],
        ['sequence_code', 'warehouse_id'],
    ) if wh_ids else []

    lineas = _paginar(
        execute, 'purchase.order.line',
        [['product_id', '=', pid]],
        ['order_id', 'product_id', 'product_qty', 'qty_received', 'date_planned'],
    )
    orden_ids = sorted({ln['order_id'][0] for ln in lineas if ln.get('order_id')})
    ordenes = _por_ids(
        execute, 'purchase.order', orden_ids,
        ['name', 'state', 'date_planned', 'location_id'],
    )
    # The sync keeps going when this custom model cannot be read: the order
    # name's correlativo is the backup inside resolve_sucursal_warehouses.
    try:
        prefijos = {
            r['id']: (r.get('po_prefix') or None)
            for r in _paginar(execute, 'branch.location', [], ['po_prefix'])
        }
    except Exception:
        prefijos = {}

    lot_ids = list(lot_a_codigo)
    movimientos = []
    if lot_ids:
        dominio = [['product_id', '=', pid], ['location_id', 'in', lot_ids]]
        if estados_excluidos:
            dominio.append(['state', 'not in', estados_excluidos])
        movimientos = _paginar(
            execute, 'stock.move', dominio,
            ['reference', 'product_uom_qty', 'quantity', 'location_id',
             'state', 'product_uom', 'picking_type_id', 'product_id'],
        )
    uom_ids = {stock_uom} if stock_uom else set()
    for m in movimientos:
        uom = m.get('product_uom')
        if uom:
            uom_ids.add(uom[0])
    factores = {}
    if uom_ids:
        factores = {
            u['id']: u['factor']
            for u in _por_ids(execute, 'uom.uom', sorted(uom_ids), ['factor'])
        }
    moves = []
    sin_convertir = 0
    for m in movimientos:
        uom = m.get('product_uom')
        dem, ok_d = _a_stock(m.get('product_uom_qty'), uom[0] if uom else None,
                             stock_uom, factores)
        cant, ok_c = _a_stock(m.get('quantity'), uom[0] if uom else None,
                              stock_uom, factores)
        if uom and not (ok_d and ok_c):
            sin_convertir += 1
        loc = m.get('location_id')
        pt = m.get('picking_type_id')
        moves.append({
            'referencia': m.get('reference') or '',
            'demanda': dem,
            'cantidad': cant,
            'origen': loc[1] if loc and len(loc) > 1 else '',
            'location_id': loc[0] if loc else None,
            'estado': m.get('state') or '',
            'picking_type_id': pt[0] if pt else None,
        })

    return {
        'sku': producto.get('default_code') or sku,
        'nombre': producto.get('name') or '',
        'pid': pid,
        'by_name': by_name,
        'nombres': nombres,
        'bodega_codes': bodega_codes,
        'lot_a_codigo': lot_a_codigo,
        'tipos': tipos,
        'lineas': lineas,
        'ordenes': ordenes,
        'prefijos': prefijos,
        'moves': moves,
        'sin_convertir': sin_convertir,
        'hoy': datetime.now(timezone.utc).strftime('%Y-%m-%d 00:00:00'),
        'quants_de': {},
    }


def _aplicar(snap, rules, bodega):
    """One bodega, one rule set. Quants are fetched lazily per location set."""
    exist_ids, patio_ids = _ubicaciones(snap, rules, bodega)
    _asegurar_quants(snap, exist_ids + patio_ids)
    exist, reserved, ubicaciones = _sumar(snap, exist_ids, patio=False)
    patio_qty, _, patio_ubicaciones = _sumar(snap, patio_ids, patio=True)
    if bodega not in rules['patio_bodegas']:
        patio_qty = 0.0
        patio_ubicaciones = []

    transito, ordenes = _transito(snap, rules, bodega)
    pendiente, movimientos, recortados = _pendiente(snap, rules, bodega)
    pend = round(pendiente, 3)
    if pend <= EPSILON:
        pend = 0.0
    return {
        'existencias': round(exist, 4),
        'reservado': round(reserved, 4),
        'pendiente': pend,
        'existNeta': _round1(exist - reserved - pend),
        'patio': _round1(patio_qty),
        'transito': round(transito, 4),
        'ubicaciones': ubicaciones,
        'patioUbicaciones': patio_ubicaciones,
        'ordenes': ordenes,
        'movimientos': movimientos,
        'movimientosRecortados': recortados,
        'uomSinConvertir': snap['sin_convertir'],
    }


def _ubicaciones(snap, rules, bodega):
    by_name = snap['by_name']
    kind = rules['kind']
    if bodega == GENERAL_BODEGA:
        exist_ids = general_exist_location_ids(by_name, rules['excluded_wh'], kind)
    else:
        exist_ids = location_ids_for(
            by_name, snap['bodega_codes'].get(bodega, []), [kind], _Callado())
    patio_id = by_name.get(rules['patio_location'])
    patio_ids = [patio_id] if patio_id and bodega in rules['patio_bodegas'] else []
    return list(exist_ids), patio_ids


def _asegurar_quants(snap, location_ids):
    faltan = [i for i in dict.fromkeys(location_ids) if i not in snap['quants_de']]
    if not faltan:
        return
    filas = _paginar(
        snap['execute'], 'stock.quant',
        [['product_id', '=', snap['pid']], ['location_id', 'in', faltan]],
        ['location_id', 'quantity', 'reserved_quantity'],
    )
    for loc in faltan:
        snap['quants_de'][loc] = []
    for q in filas:
        loc = q.get('location_id')
        if loc:
            snap['quants_de'].setdefault(loc[0], []).append(q)


def _sumar(snap, location_ids, patio):
    total = reservado = 0.0
    por_nombre = {}
    for loc in location_ids:
        for q in snap['quants_de'].get(loc, []):
            cant = float(q.get('quantity') or 0.0)
            res = 0.0 if patio else float(q.get('reserved_quantity') or 0.0)
            total += cant
            reservado += res
            nombre = snap['nombres'].get(loc, str(loc))
            acc = por_nombre.setdefault(nombre, {'ubicacion': nombre, 'cantidad': 0.0, 'reservado': 0.0})
            acc['cantidad'] += cant
            acc['reservado'] += res
    items = [
        {'ubicacion': v['ubicacion'], 'cantidad': round(v['cantidad'], 4),
         'reservado': round(v['reservado'], 4)}
        for v in por_nombre.values()
        if v['cantidad'] or v['reservado']
    ]
    items.sort(key=lambda r: r['ubicacion'])
    if patio:
        items = [{'ubicacion': r['ubicacion'], 'cantidad': r['cantidad']} for r in items]
    return total, reservado, items


def _transito(snap, rules, bodega):
    if rules['date_cutoff'] != TRANSIT_CUTOFF_TODAY_UTC:
        raise ReglaInvalida('date_cutoff')
    estados = set(rules['states'])
    ordenes = [
        o for o in snap['ordenes']
        if o.get('state') in estados and (o.get('date_planned') or '') >= snap['hoy']
    ]
    wh_by_order, _stats = resolve_sucursal_warehouses(
        ordenes, snap['prefijos'], rules['prefix_map'])
    vivas = {o['id'] for o in ordenes}
    lineas = [
        ln for ln in snap['lineas']
        if ln.get('order_id') and ln['order_id'][0] in vivas
    ]
    fecha = {o['id']: o.get('date_planned') for o in ordenes}
    nombre = {o['id']: o.get('name') for o in ordenes}
    transit, _fuera, _counted, detalle = attribute_transit(
        lineas, wh_by_order, snap['bodega_codes'], fecha, nombre, rules['excluded_wh'])
    pid = snap['pid']
    total = float(transit.get(bodega, {}).get(pid, 0.0))
    # Purchasing bodegas use the same `detalle` the sync writes. General has
    # no stored detail: its column is the roll-up, so the lines are every
    # pending line whose warehouse is not excluded.
    if bodega == GENERAL_BODEGA:
        crudas = _lineas_visibles(
            lineas, wh_by_order, fecha, nombre,
            lambda code: code not in rules['excluded_wh'])
    else:
        crudas = [
            {'orden': d.get('orden'), 'cantidad': round(float(d['qty']), 4),
             'fecha': (d.get('fecha') or '')[:10] or None}
            for d in detalle if d.get('bodega') == bodega and d.get('opid') == pid
        ]
    crudas.sort(key=lambda r: (r['fecha'] or '9999', r['orden'] or ''))
    recortadas = crudas[:TOPE_DETALLE]
    return total, recortadas


def _lineas_visibles(lineas, wh_by_order, fecha, nombre, pred):
    out = []
    for ln in lineas:
        if not ln.get('product_id') or not ln.get('order_id'):
            continue
        pending = float(ln.get('product_qty') or 0.0) - float(ln.get('qty_received') or 0.0)
        if pending <= 0:
            continue
        oid = ln['order_id'][0]
        if not pred(wh_by_order.get(oid)):
            continue
        cuando = ln.get('date_planned') or fecha.get(oid)
        out.append({
            'orden': nombre.get(oid) or (ln['order_id'][1] if len(ln['order_id']) > 1 else None),
            'cantidad': round(pending, 4),
            'fecha': (cuando or '')[:10] or None,
        })
    return out


def _pendiente(snap, rules, bodega):
    if rules['origin'] != ORIGIN_WAREHOUSE_LOT_STOCK:
        raise ReglaInvalida('origin')
    tipos = {
        t['id'] for t in snap['tipos']
        if t.get('sequence_code') in rules['sequence_codes'] and t.get('warehouse_id')
    }
    fuera = set(rules['excluded_states'])
    if bodega == GENERAL_BODEGA:
        codigos = {c for cs in snap['bodega_codes'].values() for c in cs}
    else:
        codigos = set(snap['bodega_codes'].get(bodega, []))
    dem = cant = 0.0
    items = []
    for m in snap['moves']:
        if m['estado'] in fuera or m['picking_type_id'] not in tipos:
            continue
        code = snap['lot_a_codigo'].get(m['location_id'])
        if code not in codigos:
            continue
        dem += m['demanda']
        cant += m['cantidad']
        diff = m['demanda'] - m['cantidad']
        items.append({
            'referencia': m['referencia'],
            'demanda': round(m['demanda'], 3),
            'cantidad': round(m['cantidad'], 3),
            'pendiente': round(diff, 3) if diff > EPSILON else 0.0,
            'origen': m['origen'],
            'estado': m['estado'],
        })
    diff = dem - cant
    total = round(diff, 3) if diff > EPSILON else 0.0
    items.sort(key=lambda r: (-r['pendiente'], r['referencia']))
    return total, items[:TOPE_DETALLE], len(items) > TOPE_DETALLE


def _a_stock(qty, uom_id, stock_uom, factores):
    cantidad = float(qty or 0.0)
    if not uom_id or not stock_uom:
        return cantidad, not uom_id and not stock_uom
    factor_linea = factores.get(uom_id)
    factor_stock = factores.get(stock_uom)
    if factor_linea and factor_stock:
        return cantidad * (factor_stock / factor_linea), True
    return cantidad, False


def _round1(n):
    return round(float(n) + 1e-9, 1)


def _paginar(execute, model, domain, fields, page=200):
    out, offset = [], 0
    while True:
        batch = execute(model, 'search_read', domain, fields=fields,
                        limit=page, offset=offset)
        out.extend(batch or [])
        if len(batch or []) < page:
            return out
        offset += page


def _por_ids(execute, model, ids, fields):
    out = []
    ids = list(ids)
    for i in range(0, len(ids), 200):
        chunk = ids[i:i + 200]
        if chunk:
            out.extend(_paginar(execute, model, [['id', 'in', chunk]], fields))
    return out
