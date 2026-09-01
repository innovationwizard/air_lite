#!/usr/bin/env python3
"""
SONDA — ¿por qué `transito_detalle` sale vacía? (2026-09-01)

SÓLO LECTURA. No escribe en Odoo ni en Supabase. Reproduce paso a paso el mismo
camino que corre el sincronizador y cuenta cuántas líneas sobreviven a cada
etapa, para que la pérdida tenga un lugar exacto en vez de un síntoma.

El primer error ya se encontró y se corrigió (`product_map` se indexa por
STRING del id de Odoo y se buscaba con int). Esta sonda existe para comprobar
que NO HAY UN SEGUNDO, sin esperar a la corrida horaria y sin escribir nada.

Uso:
    ODOO_URL=… ODOO_DB=… ODOO_USERNAME=… ODOO_API_KEY=… \
    SUPABASE_URL=… SUPABASE_SECRET_KEY=… python ml/probe_transito_detalle.py
"""

import sys
from collections import Counter

from odoo_sync_reabastecimiento import (
    GENERAL_BODEGA, Issues, _connect_once, attribute_transit, load_bodega_map,
    map_detalle_rows, odoo_read_all, sb_get_all,
)


def main():
    issues = Issues()
    execute = _connect_once(1)

    bodega_codes = load_bodega_map(issues)
    print(f'bodega_map: {bodega_codes}')

    # `product_map` tal como lo deja `sync_catalog`: {str(odoo_id): id_nuestro}.
    # Se arma leyendo `products` en vez de correr el sync, que escribe.
    productos = sb_get_all('products?select=id,odoo_id')
    product_map = {str(p['odoo_id']): p['id'] for p in productos if p.get('odoo_id')}
    print(f'products: {len(productos)} filas, {len(product_map)} con odoo_id')
    muestra = list(product_map.items())[:3]
    print(f'  muestra de claves (deben ser STRINGS): {muestra}')

    # ── mismo recorrido que sync_transit ────────────────────────────────────
    import datetime as dt
    today0 = dt.date.today().isoformat() + ' 00:00:00'
    orders = odoo_read_all(execute, 'purchase.order',
                           [['state', 'in', ['purchase', 'done']]],
                           ['name', 'date_planned', 'picking_type_id'])
    future = [o for o in orders if (o.get('date_planned') or '') >= today0]
    print(f'\npurchase.order confirmadas: {len(orders)}; con fecha de hoy en adelante: {len(future)}')
    if not future:
        print('  ⚠️  NINGUNA orden futura -> el desglose seria vacio LEGITIMAMENTE')
        return 0

    types = odoo_read_all(execute, 'stock.picking.type', [], ['warehouse_id'])
    whs = odoo_read_all(execute, 'stock.warehouse', [], ['code'])
    code_by_wh = {w['id']: w.get('code') for w in whs}
    wh_by_type = {t['id']: (code_by_wh.get(t['warehouse_id'][0]) if t.get('warehouse_id') else None)
                  for t in types}
    wh_by_order, fecha_por_orden, nombre_por_orden = {}, {}, {}
    for o in future:
        pt = o.get('picking_type_id')
        wh_by_order[o['id']] = wh_by_type.get(pt[0]) if pt else None
        fecha_por_orden[o['id']] = o.get('date_planned') or None
        nombre_por_orden[o['id']] = o.get('name')

    lines = odoo_read_all(execute, 'purchase.order.line',
                          [['order_id', 'in', [o['id'] for o in future]]],
                          ['order_id', 'product_id', 'product_qty', 'qty_received', 'date_planned'])
    print(f'purchase.order.line de esas ordenes: {len(lines)}')

    transit, fuera, counted, detalle = attribute_transit(
        lines, wh_by_order, bodega_codes, fecha_por_orden, nombre_por_orden)
    total = sum(v for b, vs in transit.items() if b != GENERAL_BODEGA for v in vs.values())
    print(f'\nattribute_transit: {counted} lineas contadas, {total:,.0f} unidades a bodegas de compra')
    print(f'  detalle producido: {len(detalle)} entradas')
    print(f'  fuera de alcance : {dict(fuera)}')
    if not detalle:
        print('  ⚠️  LA PERDIDA ESTA EN attribute_transit, no en la traduccion')
        return 1

    # ── la etapa donde estaba el error ──────────────────────────────────────
    filas = map_detalle_rows(detalle, product_map, 'sonda')
    print(f'\nmap_detalle_rows: {len(filas)} de {len(detalle)} entradas sobreviven')
    if len(filas) < len(detalle):
        perdidos = Counter(d['opid'] for d in detalle if not product_map.get(str(d['opid'])))
        print(f'  productos de Odoo SIN fila en `products`: {len(perdidos)} distintos')
        print(f'  ejemplos: {list(perdidos.items())[:5]}')

    if filas:
        print('\n  muestra de lo que se escribiria:')
        for f in filas[:4]:
            print(f'    {f["bodega"]:<12} prod {f["product_id"]:<6} {f["fecha"]}  '
                  f'{f["qty"]:>9,.0f}  {f["orden"]}')
        # El invariante que hace confiable el drill-down.
        por_bodega = Counter()
        for f in filas:
            por_bodega[f['bodega']] += f['qty']
        print('\n  suma del detalle por bodega vs total atribuido:')
        for b in sorted(por_bodega):
            t = sum(transit.get(b, {}).values())
            ok = 'OK' if abs(por_bodega[b] - t) < 0.01 else '*** NO CUADRA ***'
            print(f'    {b:<12} detalle {por_bodega[b]:>10,.0f}   total {t:>10,.0f}   {ok}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
