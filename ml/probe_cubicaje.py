#!/usr/bin/env python3
"""
SONDA P0.3 — ¿alcanza el cubicaje para W21/W22? (plan 2026-08-27)

POR QUÉ ESTA SONDA EXISTE: Wilmer pidió ver los metros cúbicos del Sugerido, y
lo pidió porque tiene un tope físico duro — «tengo un límite de 3 furgones
locales, entonces yo tengo que cubicar no más de eso». Un cubicaje incompleto o
en la unidad equivocada es PEOR que no tenerlo: lo usaría para reservar camiones.

TRES PREGUNTAS, y ninguna se puede contestar de memoria:

  1. COBERTURA dentro del alcance de compras. `products.volume_m3` se midió en
     74.6% en 2026-03, sobre el catálogo entero y ANTES de la limpieza que dejó
     1,670 productos. El número que importa es el de hoy y sólo sobre los
     productos que Wilmer ve.
  2. UNIDAD. Todo el sync normaliza cantidades a la UoM de stock del producto
     (`fold_uom_groups`). Si `product.volume` de Odoo está en otra unidad, el
     m³ del Sugerido queda mal en silencio. El bug de UoM del 2026-08-20 (441
     productos) es el precedente de por qué esto se mide y no se asume.
  3. LAS BOLSAS. O7 — Mario reportó que TODOS los códigos de bolsa están mal
     medidos en Odoo («un pedido pequeño de bolsas sugiere casi un furgón
     completo») y su remedición está vencida. Hay que ver el daño antes de
     construir encima.

SÓLO LECTURA. No escribe en Odoo ni en Supabase.

Uso:
    ODOO_URL=… ODOO_DB=… ODOO_USERNAME=… ODOO_API_KEY=… python ml/probe_cubicaje.py
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


print(f'Sonda de cubicaje · uid {uid} · {datetime.now(timezone.utc).isoformat()}')

prods = read_all('product.product', [['default_code', '!=', False]],
                 ['id', 'default_code', 'name', 'volume', 'weight', 'uom_id', 'active'])
print(f'  productos con código en Odoo: {len(prods)}')

seccion('P0.3.1 · Cobertura de volumen')
con_vol = [p for p in prods if (p.get('volume') or 0) > 0]
sin_vol = [p for p in prods if not (p.get('volume') or 0) > 0]
pct = len(con_vol) / len(prods) * 100 if prods else 0
print(f'  con volume > 0 : {len(con_vol):>6}  ({pct:.1f}%)')
print(f'  sin volume     : {len(sin_vol):>6}')
print('\n  ⚠️ El porcentaje que decide W21 es el del ALCANCE DE COMPRAS (~1,670 productos')
print('     en `products` tras la limpieza del 2026-08-20), no el del catálogo entero.')
print('     Cruzar esta lista con `products.sku` en Supabase antes de concluir.')

print('\n  muestra de productos SIN volumen (los primeros 15):')
for p in sin_vol[:15]:
    print(f'    {p["default_code"]:>12}  {p["name"][:52]}')

seccion('P0.3.2 · Unidad de medida — ¿m³ por unidad de stock?')
por_uom = defaultdict(lambda: {'n': 0, 'con_vol': 0})
for p in prods:
    u = p['uom_id'][1] if p.get('uom_id') else '(sin uom)'
    por_uom[u]['n'] += 1
    if (p.get('volume') or 0) > 0:
        por_uom[u]['con_vol'] += 1
print(f'  {"UoM de stock":>26} {"productos":>10} {"con volumen":>12}')
for u, v in sorted(por_uom.items(), key=lambda kv: -kv[1]['n']):
    print(f'  {u[:26]:>26} {v["n"]:>10} {v["con_vol"]:>12}')
print('\n  👉 Si conviven varias UoM, `volume` NO se puede multiplicar por el Sugerido')
print('     sin convertir antes. Ese es exactamente el bug del 2026-08-20 repetido.')

seccion('P0.3.3 · Cordura: los volúmenes más grandes y más chicos')
ordenados = sorted(con_vol, key=lambda p: p['volume'])
print('  los 10 MENORES (un m³ absurdamente chico infla el furgón):')
for p in ordenados[:10]:
    print(f'    {p["default_code"]:>12}  {p["volume"]:>12.6f} m³  {p["name"][:44]}')
print('\n  los 10 MAYORES (un m³ absurdamente grande deja camiones a medio llenar):')
for p in ordenados[-10:]:
    print(f'    {p["default_code"]:>12}  {p["volume"]:>12.6f} m³  {p["name"][:44]}')

seccion('P0.3.4 · O7 — las bolsas, que Mario reportó mal medidas')
bolsas = [p for p in prods if 'bolsa' in (p.get('name') or '').lower()]
bolsas_con = [p for p in bolsas if (p.get('volume') or 0) > 0]
print(f'  productos «bolsa»: {len(bolsas)} · con volumen: {len(bolsas_con)}')
if bolsas_con:
    vols = sorted(p['volume'] for p in bolsas_con)
    mediana = vols[len(vols) // 2]
    print(f'  volumen mediano de bolsa: {mediana:.6f} m³')
    otros = sorted(p['volume'] for p in con_vol if 'bolsa' not in (p.get('name') or '').lower())
    if otros:
        med_otros = otros[len(otros) // 2]
        print(f'  volumen mediano del resto: {med_otros:.6f} m³')
        if mediana > med_otros:
            print(f'  ⚠️ La bolsa mediana ocupa {mediana / med_otros:.1f}× el producto mediano.')
            print('     Consistente con lo que reportó Mario. NO construir el cálculo de')
            print('     furgones sobre estos números hasta que su remedición (O7) llegue.')
    print('\n  las 10 bolsas de mayor volumen:')
    for p in sorted(bolsas_con, key=lambda x: -x['volume'])[:10]:
        print(f'    {p["default_code"]:>12}  {p["volume"]:>12.6f} m³  {p["name"][:44]}')

seccion('FIN — pegar esta salida en docs/compras/OPEN_QUESTIONS.md con su fecha')
