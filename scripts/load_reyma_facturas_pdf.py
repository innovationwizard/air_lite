"""
Carga a `reyma_facturas_pdf` las líneas extraídas por
`extract_reyma_facturas_pdf.py` (paso 3 del procedimiento puente,
docs/docs-alexis/MANIFEST.md §1d).

⚠️ Las REGLAS no viven acá: viven en `ml/reyma_factura_carga.py`, porque la
página de carga de Alexis (A12) las usa a través del servicio ML y no puede
haber dos implementaciones que se separen el día que REYMA cambie algo. Este
archivo es la CLI: argumentos, lectura del CSV, los dos catálogos de la BD, la
impresión y el upsert. Su interfaz y su salida no cambiaron.

Este script sigue siendo el camino de BACKFILL y la red de seguridad: carga a
granel desde una carpeta, sin pasar por el navegador.

Uso:
    python scripts/load_reyma_facturas_pdf.py lineas.csv \
        --destinos "G-227:bodega-zacapa,G-228:bodega-san-jose,..." \
        --autor "..." [--commit]

Sin `--commit` es dry-run: imprime exactamente lo que escribiría.
"""

import argparse
import csv
import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ml'))

from reyma_factura_carga import (  # noqa: E402
    DESTINOS_VALIDOS,
    DatoInvalido,
    Mapas,
    evaluar,
)


def rest(path: str, method: str = 'GET', body=None, prefer: str | None = None):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/' + path
    key = os.environ['SUPABASE_SECRET_KEY']
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('apikey', key)
    req.add_header('Authorization', f'Bearer {key}')
    req.add_header('Content-Type', 'application/json')
    if prefer:
        req.add_header('Prefer', prefer)
    with urllib.request.urlopen(req) as r:
        raw = r.read()
        return json.loads(raw) if raw else []


def cargar_mapas() -> Mapas:
    """Los dos catálogos que las reglas necesitan. Único I/O de lectura."""
    por_clave = defaultdict(set)
    for p in rest('reyma_products?select=clave,codigo'):
        if p['clave']:
            por_clave[p['clave']].add(p['codigo'])

    # Tablita de Alexis: rollos por bulto. Append-only, la última fila por
    # código manda (viene ordenada por created_at DESC).
    rollos = {}
    for c in rest('reyma_conversion_bulto?select=codigo,rollos_por_bulto'
                  '&order=created_at.desc'):
        rollos.setdefault(c['codigo'], float(c['rollos_por_bulto']))

    return Mapas(por_clave=dict(por_clave), rollos_por_bulto=rollos)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('csv', help='salida de extract_reyma_facturas_pdf.py')
    ap.add_argument('--destinos', required=True,
                    help='G-227:bodega-zacapa,G-228:bodega-san-jose,... (prefijo del correlativo)')
    ap.add_argument('--etas', default='', help='G-227:2026-08-19,... (sólo ETAs DECLARADAS)')
    ap.add_argument('--autor', required=True, help='procedencia completa de la carga')
    ap.add_argument('--commit', action='store_true', help='escribe; sin esto es dry-run')
    args = ap.parse_args()

    destinos = {}
    for par in args.destinos.split(','):
        g, d = par.split(':')
        if d not in DESTINOS_VALIDOS:
            raise SystemExit(f'destino inválido: {d} (válidos: {sorted(DESTINOS_VALIDOS)})')
        destinos[g.strip()] = d
    etas = dict(p.split(':') for p in args.etas.split(',')) if args.etas else {}

    lineas = list(csv.DictReader(open(args.csv, encoding='utf-8')))

    try:
        resultado = evaluar(lineas, destinos, etas, args.autor, cargar_mapas())
    except DatoInvalido as e:
        raise SystemExit(str(e)) from e

    filas, retenidas, errores = resultado.filas, resultado.retenidas, resultado.errores

    por_factura = defaultdict(list)
    for f in filas:
        por_factura[(f['guia'], f['factura'], f['destino'], f['fecha'], f['eta'])].append(f)
    print(f'=== {len(filas)} filas a cargar, {len(por_factura)} facturas ===')
    for k, v in sorted(por_factura.items()):
        print(f'  {k[0]}  {k[1]}  {k[3]}  {k[2]:<16} eta={k[4]}  {len(v)} líneas')
        for f in v:
            conv = ('' if f['cantidad'] == f['cantidad_cfdi']
                    else f"   ⟵ {f['cantidad_cfdi']:,.2f} {f['unidad']} · {f['bultos']:,.0f} BLTS")
            print(f"      {f['clave']:<14} → {f['codigo']}  {f['cantidad']:>10,.2f}  "
                  f"${f['precio_unit']:.2f}{conv}")

    if retenidas:
        print(f'\n⏸  {len(retenidas)} líneas RETENIDAS:')
        for r in retenidas:
            print(f"      {r['guia']} {r['identificador']:<14} "
                  f"{r['cantidad']:>10,.2f} {r['unidad']}  — {r['motivo']}")

    if errores:
        print(f'\n❌ {len(errores)} ERRORES — no se carga nada:')
        for e in errores:
            print(f'  - {e}')
        return 1

    if not args.commit:
        print('\n(dry-run: no se escribió nada. Agregá --commit para cargar.)')
        return 0

    rest('reyma_facturas_pdf?on_conflict=folio_fiscal,codigo', 'POST', filas,
         prefer='resolution=merge-duplicates,return=minimal')
    print(f'\n✅ {len(filas)} filas cargadas en reyma_facturas_pdf.')
    meses = sorted({f['fecha'][:7] for f in filas})
    print('\nSiguiente paso — conciliación (N14): el fill rate ya sale bien solo (el '
          'motor corre en la página con las decisiones persistidas como entrada), pero '
          'para dejar el RASTRO auditable de los enlaces nuevos hay que correr la '
          'conciliación desde /inventarios/reyma-vivo → pestaña Cumplimiento → '
          f'«Ejecutar conciliación». Mes(es) afectado(s): {", ".join(meses)}.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
