#!/usr/bin/env python3
"""SONDA P0.1 (segunda vuelta) — ¿la SUCURSAL de la orden es el destino real?

POR QUÉ EXISTE, teniendo ya `probe_transito_destino.py`:
  Esa sonda midió `picking_type_id -> stock.picking.type.warehouse_id` y el
  resultado quedó en el docstring de `sync_transit()` (2026-08-27, 56,847 uds):

      1CET 39,861 (70.1%) · SUB 9,305 · 2Z11 6,361 · SUBPA 1,300 · T7Z11 20
      **4ZAC 0 · 3PET 0**

  Zacapa y Petén sin UNA orden entrante es justo lo que se ve si `picking_type`
  dice DÓNDE DESCARGA EL CAMIÓN (el CD Central) y no DE QUIÉN ES la orden. Jorge
  lo confirmó el 2026-09-03: la orden lleva su sucursal, y el correlativo del
  nombre la codifica — `PO-PE-` Petén, `PO-PZ-` Zacapa, `PO-P-` Central,
  `PO-PT*-` tiendas, `PO-PZ11-` CD Zona 11.

LO QUE CONTESTA, antes de tocar una línea del sync que ya está en producción:

  1. ¿Existe el campo? Nombre técnico, etiqueta y comodel de la «Sucursal» en
     `purchase.order` — leído de `fields_get`, no supuesto.
  2. ¿Con qué cobertura viene lleno sobre las MISMAS órdenes que cuenta
     `sync_transit()` (encabezado de hoy en adelante, estados purchase+done)?
  3. ¿El prefijo del nombre concuerda con el campo? Dónde discrepan y cuánto.
  4. **La tabla que decide todo:** el cruce sucursal × almacén-de-picking_type.
     Si los 39,861 de 1CET se reparten entre Petén/Zacapa/Central al mirarlos
     por sucursal, la regla nueva es la correcta y la vigente está atribuyendo
     al primer tramo. Si no se mueven, la regla nueva no cambia nada y hay que
     volver a preguntar antes de escribir código.
  5. Cuánto pendiente cae en `PZ11` (CD Zona 11), la única fila que Jorge dejó
     abierta.

SÓLO LECTURA. No escribe en Odoo ni en Supabase (Odoo es read-only, regla dura).

Uso:
    set -a; source .env; set +a; python3 ml/probe_sucursal_po.py
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
    out, offset = [], 0
    while True:
        batch = call(model, 'search_read', domain, fields=fields, offset=offset, limit=chunk)
        out.extend(batch)
        if len(batch) < chunk:
            return out
        offset += chunk


def seccion(t):
    print(f'\n{"=" * 78}\n{t}\n{"=" * 78}')


print(f'Sonda sucursal · uid {uid} · {datetime.now(timezone.utc).isoformat()}')

# ── 1. ¿Existe el campo, y cómo se llama de verdad? ─────────────────────────
seccion('1. El campo «Sucursal» en purchase.order, leído de fields_get')
campos = call('purchase.order', 'fields_get', [], attributes=['string', 'type', 'relation'])

sospechosos = {n: f for n, f in campos.items()
               if 'sucursal' in (f.get('string') or '').lower()
               or n in ('location_id', 'branch_id', 'x_sucursal', 'x_studio_sucursal')}
if not sospechosos:
    print('  ⚠️ NINGÚN campo con etiqueta «Sucursal» ni location_id/branch_id.')
    print('     Candidatos que contienen «loc» o «branch»:')
    for n, f in sorted(campos.items()):
        if 'loc' in n.lower() or 'branch' in n.lower() or 'sucursal' in n.lower():
            print(f'       {n:<34} {f.get("type"):<12} {f.get("relation") or "":<26} {f.get("string")}')
else:
    for n, f in sorted(sospechosos.items()):
        print(f'  {n:<34} tipo={f.get("type"):<12} comodel={f.get("relation") or "—":<26} '
              f'etiqueta="{f.get("string")}"')

campo_suc = next((n for n in ('location_id', 'branch_id', 'x_sucursal') if n in campos), None)
comodel = (campos.get(campo_suc) or {}).get('relation') if campo_suc else None
print(f'\n  👉 campo usado por esta sonda: {campo_suc or "(ninguno)"} · comodel: {comodel or "—"}')

# ── 2. La tabla de sucursales con sus prefijos ──────────────────────────────
seccion('2. El catálogo de sucursales (nombre ↔ prefijo PO)')
sucursales = {}
if comodel:
    cf = call(comodel, 'fields_get', [], attributes=['string', 'type'])
    pref_fields = [n for n, f in cf.items()
                   if 'prefijo' in (f.get('string') or '').lower()
                   or 'prefix' in (f.get('string') or '').lower()]
    leer = ['display_name'] + pref_fields
    print(f'  modelo {comodel} · campos de prefijo detectados: {pref_fields or "(ninguno)"}')
    try:
        filas = read_all(comodel, [], leer)
        for r in sorted(filas, key=lambda x: x.get('display_name') or ''):
            prefijos = ' · '.join(f'{p}={r.get(p)}' for p in pref_fields if r.get(p))
            sucursales[r['id']] = r.get('display_name')
            print(f'  id={r["id"]:<5} {(r.get("display_name") or ""):<36} {prefijos}')
    except Exception as e:                                    # noqa: BLE001
        print(f'  ⚠️ no se pudo leer {comodel}: {e}')
else:
    print('  (sin comodel — se omite)')

# ── 3. Cobertura sobre EL MISMO universo que cuenta sync_transit() ──────────
seccion('3. Cobertura del campo sobre las órdenes que hoy cuenta sync_transit()')
today0 = datetime.now(timezone.utc).strftime('%Y-%m-%d 00:00:00')
campos_orden = ['name', 'date_planned', 'picking_type_id'] + ([campo_suc] if campo_suc else [])
orders = read_all('purchase.order', [['state', 'in', ['purchase', 'done']]], campos_orden)
future = [o for o in orders if (o.get('date_planned') or '') >= today0]
print(f'  órdenes purchase+done: {len(orders)} · con encabezado de hoy en adelante: {len(future)}')

con_campo = sum(1 for o in future if o.get(campo_suc)) if campo_suc else 0
print(f'  con {campo_suc or "(campo)"} lleno: {con_campo}/{len(future)} '
      f'({(con_campo / len(future) * 100) if future else 0:.1f}%)')

# ── 4. El prefijo del nombre, y si concuerda con el campo ──────────────────
seccion('4. Prefijo del nombre (correlativo) vs. el campo')


def prefijo_de(nombre):
    """Prefijo estilo `PO-PZ11-` — todo hasta el último guion antes del número."""
    if not nombre:
        return None
    partes = nombre.split('-')
    for i in range(len(partes) - 1, 0, -1):
        if partes[i] and partes[i][0].isdigit():
            return '-'.join(partes[:i]) + '-'
    return nombre


por_prefijo = defaultdict(int)
for o in future:
    por_prefijo[prefijo_de(o.get('name'))] += 1
print('  prefijos hallados en las órdenes futuras:')
for p, n in sorted(por_prefijo.items(), key=lambda kv: -kv[1]):
    print(f'    {n:>5}  {p}')

if campo_suc:
    concuerda = defaultdict(int)
    for o in future:
        suc = o[campo_suc][1] if o.get(campo_suc) else '(vacío)'
        concuerda[(prefijo_de(o.get('name')), suc)] += 1
    print('\n  cruce prefijo × sucursal (si el prefijo es fiel, cada fila es 1:1):')
    for (p, s), n in sorted(concuerda.items(), key=lambda kv: -kv[1]):
        print(f'    {n:>5}  {(p or "—"):<14} → {s}')

# ── 5. LA TABLA QUE DECIDE: pendiente por sucursal vs. por picking_type ────
seccion('5. Pendiente por SUCURSAL vs. por almacén de picking_type (el cruce)')
picking_types = call('stock.picking.type', 'search_read', [], fields=['id', 'warehouse_id'])
warehouses = call('stock.warehouse', 'search_read', [], fields=['id', 'code'])
code_by_wh = {w['id']: w.get('code') for w in warehouses}
pt_wh = {pt['id']: (code_by_wh.get(pt['warehouse_id'][0]) if pt.get('warehouse_id') else None)
         for pt in picking_types}

info_orden = {}
for o in future:
    pt = o['picking_type_id'][0] if o.get('picking_type_id') else None
    info_orden[o['id']] = {
        'wh': pt_wh.get(pt) if pt else None,
        'suc': (o[campo_suc][1] if (campo_suc and o.get(campo_suc)) else None),
        'pref': prefijo_de(o.get('name')),
    }

lines = read_all('purchase.order.line', [['order_id', 'in', list(info_orden)]],
                 ['order_id', 'product_id', 'product_qty', 'qty_received']) if info_orden else []

cruce = defaultdict(float)
por_suc = defaultdict(float)
por_wh = defaultdict(float)
por_pref = defaultdict(float)
total = 0.0
for ln in lines:
    if not ln.get('product_id'):
        continue
    pend = (ln.get('product_qty') or 0.0) - (ln.get('qty_received') or 0.0)
    if pend <= 0:
        continue
    inf = info_orden.get(ln['order_id'][0], {})
    suc = inf.get('suc') or '(sin sucursal)'
    wh = inf.get('wh') or '(sin picking_type)'
    cruce[(suc, wh)] += pend
    por_suc[suc] += pend
    por_wh[wh] += pend
    por_pref[inf.get('pref') or '(sin prefijo)'] += pend
    total += pend

print(f'  pendiente total: {total:,.1f}\n')
print(f'  {"POR ALMACÉN (regla VIGENTE, picking_type)":<46}{"POR SUCURSAL (regla NUEVA)":<40}')
print(f'  {"-" * 44}  {"-" * 38}')
izq = sorted(por_wh.items(), key=lambda kv: -kv[1])
der = sorted(por_suc.items(), key=lambda kv: -kv[1])
for i in range(max(len(izq), len(der))):
    a = f'{izq[i][0]:<14} {izq[i][1]:>12,.0f} {izq[i][1] / total * 100 if total else 0:>5.1f}%' if i < len(izq) else ''
    b = f'{der[i][0]:<28} {der[i][1]:>10,.0f}' if i < len(der) else ''
    print(f'  {a:<46}{b}')

print('\n  cruce completo sucursal × almacén (dónde se movería cada cantidad):')
print(f'  {"sucursal":<34} {"almacén":<14} {"pendiente":>12}')
for (suc, wh), q in sorted(cruce.items(), key=lambda kv: -kv[1]):
    print(f'  {suc:<34} {wh:<14} {q:>12,.1f}')

print('\n  por prefijo del nombre (el fallback, si el campo viniera vacío):')
for p, q in sorted(por_pref.items(), key=lambda kv: -kv[1]):
    print(f'    {p:<16} {q:>12,.1f}')

seccion('FIN — pegar la salida en docs/compras/OPEN_QUESTIONS.md con su fecha')
print('Lectura: si el bloque de la IZQUIERDA concentra todo en 1CET y el de la')
print('DERECHA lo reparte entre Petén/Zacapa/Central, la regla nueva corrige una')
print('atribución al primer tramo. Si ambos bloques coinciden, no cambia nada y')
print('hay que volver a preguntar ANTES de tocar el sync.')
