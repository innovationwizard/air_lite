#!/usr/bin/env python3
"""
SONDA P0.1 + P0.2 — ¿de qué bodega es cada tránsito? (W15-B, plan 2026-08-27)

CONTEXTO MEDIDO EL 2026-08-27, no supuesto:
  `sync_transit()` en odoo_sync_reabastecimiento.py devuelve `{product_id: qty}`
  SIN dimensión de bodega, y `assemble_inputs()` escribe ese mismo número en las
  TRES bodegas. El tránsito no está «revuelto» como lo describió Wilmer: está
  REPLICADO. Consecuencias: cada bodega ve tránsito ajeno, ese tránsito ajeno le
  TAPA el Sugerido («no me da un sugerido porque está tomando los 3 saques»), y
  sumar las tres bodegas triplica la cifra.

LO QUE ESTA SONDA CONTESTA, antes de escribir una línea de la corrección:

  P0.1 — ¿Se puede atribuir cada orden de compra a la bodega que la recibe?
         Vía `purchase.order.picking_type_id` → `stock.picking.type.warehouse_id`.
         Reporta cuántas resuelven, a qué almacenes, cuántas quedan sin resolver,
         y CÓMO SE REPARTE la cantidad pendiente entre bodegas. Ese reparto es la
         primera medición real de cuánto se distorsiona hoy cada vista.

  P0.2 — ¿Existen los traslados internos de «la cadenita» (San José → Zacapa →
         Petén) como stock.picking en vuelo? ¿Cuántos, con cuántos productos, y
         distinguen sus estados «salió de San José» de «llegó a Zacapa»?
         De eso depende que las paradas intermedias sean representables sin que
         Wilmer las teclee a mano.

SÓLO LECTURA. No escribe en Odoo ni en Supabase. Se corre a mano; su salida se
pega en docs/compras/OPEN_QUESTIONS.md con la fecha de medición.

Uso:
    ODOO_URL=… ODOO_DB=… ODOO_USERNAME=… ODOO_API_KEY=… python ml/probe_transito_destino.py
"""

import os
import sys
import xmlrpc.client
from collections import defaultdict
from datetime import datetime, timezone

ODOO_URL = os.environ.get('ODOO_URL', '')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')

if not all([ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY]):
    sys.exit('Faltan ODOO_URL / ODOO_DB / ODOO_USERNAME / ODOO_API_KEY en el entorno.')

common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
if not uid:
    sys.exit('No autenticó contra Odoo.')
models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)


def call(model, method, *args, **kwargs):
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, list(args), kwargs)


def read_all(model, domain, fields, chunk=2000):
    """Paginado — mismo patrón que odoo_read_all() del sync."""
    out, offset = [], 0
    while True:
        batch = call(model, 'search_read', domain, fields=fields, offset=offset, limit=chunk)
        out.extend(batch)
        if len(batch) < chunk:
            return out
        offset += chunk


def seccion(t):
    print(f'\n{"=" * 78}\n{t}\n{"=" * 78}')


print(f'Sonda de tránsito · uid {uid} · {datetime.now(timezone.utc).isoformat()}')

# ── Mapa almacén → bodega, la misma fuente que usa el sync ──────────────────
seccion('0. Almacenes de Odoo y el mapa que ya usa el sync (bodega_map)')
warehouses = call('stock.warehouse', 'search_read', [], fields=['id', 'name', 'code'])
wh_by_id = {w['id']: w for w in warehouses}
for w in sorted(warehouses, key=lambda x: x.get('code') or ''):
    print(f'  {w["code"]:>8}  id={w["id"]:<5} {w["name"]}')
print('\n  ⚠️ bodega_map (Supabase) mapea hoy: 1CET→San Jose VN, 3PET→Petén, 4ZAC→Zacapa.')
print('     Cualquier almacén de arriba que NO esté ahí es tránsito sin bodega asignable.')

picking_types = call('stock.picking.type', 'search_read', [],
                     fields=['id', 'name', 'code', 'warehouse_id'])
pt_wh = {pt['id']: (pt['warehouse_id'][0] if pt.get('warehouse_id') else None)
         for pt in picking_types}

# ── P0.1 — atribución de las órdenes de compra ──────────────────────────────
seccion('P0.1 · ¿A qué bodega llega cada orden de compra en tránsito?')

# MISMA regla que sync_transit(): pendiente > 0 sobre órdenes con fecha de
# cabecera de hoy en adelante, estados purchase+done. Si esta sonda usara otra
# regla, mediría un universo distinto al que la app muestra.
today0 = datetime.now(timezone.utc).strftime('%Y-%m-%d 00:00:00')
orders = read_all('purchase.order', [['state', 'in', ['purchase', 'done']]],
                  ['name', 'date_planned', 'picking_type_id'])
future = [o for o in orders if (o.get('date_planned') or '') >= today0]
print(f'  órdenes purchase+done: {len(orders)} · con fecha de hoy en adelante: {len(future)}')

order_wh = {}
sin_picking_type = 0
for o in future:
    pt = o['picking_type_id'][0] if o.get('picking_type_id') else None
    wh = pt_wh.get(pt) if pt else None
    if wh is None:
        sin_picking_type += 1
    order_wh[o['id']] = wh

lines = read_all('purchase.order.line', [['order_id', 'in', list(order_wh)]],
                 ['order_id', 'product_id', 'product_qty', 'qty_received']) if order_wh else []

por_bodega = defaultdict(lambda: {'lineas': 0, 'qty': 0.0, 'productos': set()})
sin_asignar = {'lineas': 0, 'qty': 0.0, 'productos': set()}
for ln in lines:
    if not ln.get('product_id'):
        continue
    pend = (ln.get('product_qty') or 0.0) - (ln.get('qty_received') or 0.0)
    if pend <= 0:
        continue
    wh = order_wh.get(ln['order_id'][0])
    destino = por_bodega[wh_by_id[wh]['code']] if wh in wh_by_id else sin_asignar
    destino['lineas'] += 1
    destino['qty'] += pend
    destino['productos'].add(ln['product_id'][0])

total_qty = sum(v['qty'] for v in por_bodega.values()) + sin_asignar['qty']
print(f'  órdenes sin picking_type resoluble: {sin_picking_type}')
print(f'\n  {"almacén":>10} {"líneas":>8} {"pendiente":>14} {"productos":>10}   % del total')
for code, v in sorted(por_bodega.items(), key=lambda kv: -kv[1]['qty']):
    pct = (v['qty'] / total_qty * 100) if total_qty else 0
    print(f'  {code:>10} {v["lineas"]:>8} {v["qty"]:>14,.1f} {len(v["productos"]):>10}   {pct:5.1f}%')
if sin_asignar['lineas']:
    pct = (sin_asignar['qty'] / total_qty * 100) if total_qty else 0
    print(f'  {"SIN MAPA":>10} {sin_asignar["lineas"]:>8} {sin_asignar["qty"]:>14,.1f} '
          f'{len(sin_asignar["productos"]):>10}   {pct:5.1f}%   ← se reporta, NO se reparte')

print(f'\n  TOTAL pendiente en tránsito: {total_qty:,.1f}')
print('  👉 Hoy la app muestra ESTE MISMO total en CADA bodega. Las filas de arriba')
print('     son lo que a cada una le toca de verdad. La diferencia es la distorsión.')

# ── P0.2 — traslados internos, «la cadenita» ────────────────────────────────
seccion('P0.2 · Traslados internos en vuelo (San José → Zacapa → Petén)')
internos = read_all(
    'stock.picking',
    [['picking_type_code', '=', 'internal'], ['state', 'not in', ['done', 'cancel', 'draft']]],
    ['name', 'state', 'scheduled_date', 'location_id', 'location_dest_id', 'picking_type_id'])
print(f'  traslados internos abiertos (ni done, ni cancel, ni draft): {len(internos)}')

por_estado = defaultdict(int)
por_ruta = defaultdict(int)
for p in internos:
    por_estado[p.get('state')] += 1
    ori = (p['location_id'][1] if p.get('location_id') else '?')
    dst = (p['location_dest_id'][1] if p.get('location_dest_id') else '?')
    por_ruta[f'{ori} → {dst}'] += 1

print('\n  por estado (¿distinguen «salió» de «llegó»?):')
for st, n in sorted(por_estado.items(), key=lambda kv: -kv[1]):
    print(f'    {st:>12}: {n}')

print('\n  rutas más frecuentes:')
for ruta, n in sorted(por_ruta.items(), key=lambda kv: -kv[1])[:15]:
    print(f'    {n:>5}  {ruta}')

if internos:
    move_ids = read_all('stock.move',
                        [['picking_id', 'in', [p['id'] for p in internos]]],
                        ['product_id', 'product_uom_qty', 'picking_id'])
    prods = {m['product_id'][0] for m in move_ids if m.get('product_id')}
    print(f'\n  líneas de movimiento: {len(move_ids)} · productos distintos: {len(prods)}')
    print('  👉 Si este número es sustancial, las paradas intermedias son representables')
    print('     SIN que Wilmer las teclee. Si es ~0, su captura manual es la única fuente.')
else:
    print('\n  ⚠️ Ninguno. Los traslados de la cadena no existen como picking en vuelo:')
    print('     el destino final sólo puede venir de él (W15-A) o de otra señal.')

seccion('FIN — pegar esta salida en docs/compras/OPEN_QUESTIONS.md con su fecha')
