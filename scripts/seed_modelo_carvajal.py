#!/usr/bin/env python3
"""
Siembra el ALCANCE del modelo Carvajal en `reyma_products` — A4.26.

DE DÓNDE SALEN LOS CÓDIGOS, y por qué eso importa. No se inventa ninguno: se
leen los productos que en Odoo están ligados a un proveedor Carvajal, vía
`product_suppliers`. Medido el 2026-09-01 hay CUATRO entidades Carvajal
distintas en Odoo (Centroamérica, S.A. de C.V., Cali Colombia y Distribuidora),
con 168 vínculos entre las cuatro — de ahí que el alcance se derive y no se
teclee.

⚠️ EL ALCANCE ES PROVISIONAL Y LA APLICACIÓN LO DICE EN PANTALLA.
Alexis nunca entregó una lista de códigos de Carvajal como sí entregó las 55 de
Reyma. Derivarla del proveedor es la mejor aproximación disponible y NO es lo
mismo que su lista: puede traer productos que él no maneja y omitir alguno que
compra por otra vía. Se marca `provisional` en `modelo_proveedor` y la página lo
declara, en vez de presentar una cifra que parece confirmada.

Es deliberadamente el mismo patrón que la columna «destino final» del silo de
compras: entregar la respuesta incompleta, rotulada como incompleta, porque la
forma más rápida de aprender el alcance real es que él lo vea y lo corrija.

Uso:
    python scripts/seed_modelo_carvajal.py              # dry-run
    python scripts/seed_modelo_carvajal.py --commit
"""

import argparse
import os
import sys

MODELO = 'carvajal'


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--commit', action='store_true', help='escribe (sin esto, dry-run)')
    args = ap.parse_args()

    url = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SECRET_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('Faltan SUPABASE_URL y SUPABASE_SECRET_KEY.')
        return 1

    from supabase import create_client
    sb = create_client(url, key)

    proveedores = [s for s in sb.table('suppliers').select('id, name').execute().data
                   if 'carvajal' in (s['name'] or '').lower()]
    if not proveedores:
        print('No hay ningun proveedor Carvajal en `suppliers`. Nada que sembrar.')
        return 1
    print(f'Proveedores Carvajal en Odoo: {len(proveedores)}')
    for p in proveedores:
        print(f'  {p["id"]:>4}  {p["name"]}')

    ids = [p['id'] for p in proveedores]
    links = sb.table('product_suppliers').select('product_id').in_('supplier_id', ids).execute().data
    product_ids = sorted({l['product_id'] for l in links})
    print(f'\nProductos ligados: {len(links)} vinculos, {len(product_ids)} productos distintos')

    productos = []
    for i in range(0, len(product_ids), 200):
        productos += sb.table('products').select(
            'id, sku, name, category, volume_m3, stock_uom, is_active'
        ).in_('id', product_ids[i:i + 200]).execute().data

    activos = [p for p in productos if p.get('is_active')]
    sin_sku = [p for p in activos if not (p.get('sku') or '').strip()]
    print(f'  activos: {len(activos)}  (descartados por inactivos: {len(productos) - len(activos)})')
    if sin_sku:
        # Un codigo sin SKU no se puede casar con nada del resto del modelo.
        print(f'  ⚠️  sin SKU, se omiten: {len(sin_sku)}')
    sin_cub = sum(1 for p in activos if not p.get('volume_m3'))
    print(f'  ⚠️  sin cubicaje en Odoo: {sin_cub} de {len(activos)} '
          f'({sin_cub/max(1,len(activos)):.0%}) — entran al alcance con cubicaje 0, '
          f'que este modelo ya interpreta como «fuera del calculo de furgones». '
          f'El pedido de esos codigos es correcto; su m3 no.')

    # Los que YA pertenecen a otro modelo no se tocan: un codigo vive en un solo
    # alcance, y si Reyma ya lo reclamo, reclamarlo tambien aca lo duplicaria en
    # dos pantallas con dos pedidos distintos.
    existentes = {r['codigo']: r for r in sb.table('reyma_products')
                  .select('codigo, modelo').execute().data}
    filas, ya_en_otro = [], []
    for p in activos:
        cod = (p.get('sku') or '').strip()
        if not cod:
            continue
        prev = existentes.get(cod)
        if prev and prev['modelo'] != MODELO:
            ya_en_otro.append(cod)
            continue
        filas.append({
            'codigo': cod,
            'odoo_product_id': p['id'],
            'nombre_odoo': p.get('name'),
            'descripcion': p.get('name'),
            'categoria': p.get('category'),
            'categoria_fuente': 'odoo',
            # `cubicaje` es NOT NULL, y 21 de estos productos no tienen volumen
            # en Odoo. Se siembra 0, que NO es un relleno arbitrario: es la
            # convención que este modelo ya usa — `odoo_sync_reyma.py` trata
            # volume=0 como «sin cubicaje no entra al cálculo de furgones» y
            # levanta un aviso. Poner un número inventado sí sería mentir; el 0
            # deja el producto en el alcance (hay que comprarlo igual) y fuera
            # de la aritmética de furgones, que es exactamente lo correcto.
            'cubicaje': p.get('volume_m3') or 0,
            'uom': p.get('stock_uom'),
            'activo': True,
            'en_alcance': True,
            'modelo': MODELO,
        })

    print(f'\nA sembrar en el modelo «{MODELO}»: {len(filas)} codigos')
    if ya_en_otro:
        print(f'  omitidos por pertenecer ya a otro modelo: {len(ya_en_otro)} -> '
              f'{", ".join(ya_en_otro[:6])}{"…" if len(ya_en_otro) > 6 else ""}')
    for f in filas[:5]:
        print(f'    {f["codigo"]}  {(f["nombre_odoo"] or "")[:52]}')

    if not args.commit:
        print('\nDRY-RUN. Correr con --commit para escribir.')
        return 0

    for i in range(0, len(filas), 100):
        sb.table('reyma_products').upsert(filas[i:i + 100], on_conflict='codigo').execute()
    print(f'\nListo. {len(filas)} codigos en el alcance de «{MODELO}».')
    print('El alcance queda marcado PROVISIONAL hasta que Alexis lo confirme.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
