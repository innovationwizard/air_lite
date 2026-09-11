#!/usr/bin/env python3
"""SONDA — «pendiente de tomar reserva» tal como Wilmer lo ve en Odoo (2026-09-11).

SÓLO LECTURA (search_read / read_group / fields_get). Reproduce la pantalla
«Análisis de movimientos» con el favorito «Wilmer - Reservas.» (ir.filters 1166)
para el producto 77205001: dominio state not in (cancel, done) y
picking_type_id in [5, 2] (1 Bodega Central: Delivery Orders + Internal
Transfers); medidas product_uom_qty (Demanda) y quantity (Cantidad);
pendiente = Demanda − Cantidad.

Uso:
    set -a; source .env.prod; set +a; python3 ml/probe_pending_reserve.py
"""
import json
import os
import xmlrpc.client
from collections import defaultdict

URL, DB, USER, KEY = (os.environ[k] for k in ('ODOO_URL','ODOO_DB','ODOO_USERNAME','ODOO_API_KEY'))
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(DB, USER, KEY, {})
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object', allow_none=True)
def ex(model, method, *a, **kw):
    return models.execute_kw(DB, uid, KEY, model, method, list(a), kw)

print(f'connected uid={uid} db={DB}')

# 1) The saved filter itself
filters = ex('ir.filters', 'search_read', [['name', 'ilike', 'Wilmer']],
             fields=['name', 'model_id', 'domain', 'context', 'user_id', 'action_id'])
print('\n== ir.filters matching "Wilmer" ==')
for f in filters:
    print(json.dumps(f, ensure_ascii=False, indent=1))

wf = [f for f in filters if f['model_id'] == 'stock.move' and 'reserva' in f['name'].lower()]
if not wf:
    print('no stock.move filter found; using fallback domain')
    dom = []
else:
    dom = eval(wf[0]['domain'], {'__builtins__': {}}, {})  # Odoo stores a python-literal domain
    print('\nfilter domain:', dom)

# 2) Product
prod = ex('product.product', 'search_read', [['default_code', '=', '77205001']], fields=['id','display_name'])
print('\nproduct:', prod)
pid = prod[0]['id']

# 3) Moves under that domain + product — the same population the pivot shows
fields = ['reference','picking_id','picking_type_id','state','product_uom_qty','quantity',
          'location_id','location_dest_id','date','origin']
moves = ex('stock.move', 'search_read', list(dom) + [['product_id','=',pid]], fields=fields, limit=2000)
print(f'\nmoves under filter for {pid}: {len(moves)}')
by_type = defaultdict(lambda: [0.0, 0.0])
rows = defaultdict(lambda: [0.0, 0.0, set()])
for m in moves:
    t = m['picking_type_id'][1] if m['picking_type_id'] else '(sin tipo)'
    r = m['reference'] or '(sin ref)'
    by_type[t][0] += m['product_uom_qty']
    by_type[t][1] += m['quantity']
    rows[r][0] += m['product_uom_qty']
    rows[r][1] += m['quantity']
    rows[r][2].add(m['state'])
print('\n== por tipo de operación (Demanda, Cantidad, pendiente=Dem-Cant) ==')
for t, (d, q) in sorted(by_type.items()):
    print(f'  {t:50s} {d:10.0f} {q:10.0f}  pend={d-q:8.0f}')
td = sum(v[0] for v in by_type.values())
tq = sum(v[1] for v in by_type.values())
print(f'  {"TOTAL":50s} {td:10.0f} {tq:10.0f}  pend={td-tq:8.0f}')
print('\n== por picking ==')
for r, (d, q, st) in sorted(rows.items()):
    print(f'  {r:22s} {d:8.0f} {q:8.0f}  pend={d-q:6.0f}  states={sorted(st)}')

# 4) Location usage of the moves — to see if INT (traslados) count alongside OUT
print('\n== distinct (location_id -> location_dest_id, state) ==')
combos = defaultdict(int)
for m in moves:
    combos[(m['location_id'][1], m['location_dest_id'][1], m['state'])] += 1
for k, n in sorted(combos.items()):
    print(f'  {n:4d}  {k}')
