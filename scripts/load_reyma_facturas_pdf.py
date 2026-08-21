"""
Carga a `reyma_facturas_pdf` las líneas extraídas por
`extract_reyma_facturas_pdf.py` (paso 3 del procedimiento puente,
docs/docs-alexis/MANIFEST.md §1d).

Reglas que hace cumplir el script (no son opcionales):

  * `destino` NO se infiere del CFDI. Se declara por archivo en el mapa
    `--destinos`; el script verifica que coincida con el destino in-band de
    las Observaciones (`TRAILER 53 PIES BODEGA ZACAPA` / `... BODEGA SAN JOSE`
    / `... CLIENTE DIRECTO`, hallazgo N10) cuando el documento lo trae, y se
    niega a cargar si se contradicen.
  * `eta` NO se inventa. Sólo entra si viene declarada (nombre de carpeta con
    ETA); si no, queda NULL — precedente G-226.
  * Unidades: X4G ≡ caja/bulto y XPK ≡ Fardo van 1:1 contra la UoM de compra de
    Odoo. `KGM` (bolsa poliseda, que REYMA factura POR PESO) se convierte con la
    tablita de Alexis que vive en la BD (`reyma_conversion_bulto`):
        cantidad = BLTS de la descripción × rollos_por_bulto
    NO se deriva del peso: Alexis, verbatim, «no podemos poner como que un peso
    estándar porque… por centavos no va a cuadrar la factura en cuanto a
    montos». Si falta la tablita para un código, o el documento no trae los
    BLTS, la línea se RETIENE — nunca se estima.
  * Siempre se guarda lo verbatim del papel además de lo convertido:
    `cantidad_cfdi` + `unidad` + `bultos`.
  * `codigo` sale de `reyma_products.clave`. Una clave sin mapa detiene la
    carga: no se descarta la línea ni se le inventa código.
  * Idempotente: upsert sobre UNIQUE (folio_fiscal, codigo).

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
import re
import sys
import urllib.request
from collections import defaultdict

# Unidades del CFDI con equivalencia 1:1 probada contra la UoM de compra de
# Odoo (verificado línea a línea contra PO-PZ11-0489, PO-PZ-0132 y las 95
# líneas ya cargadas): X4G = caja/bulto, XPK = Fardo.
UNIDADES_1A1 = {'X4G', 'XPK'}
# Unidades que requieren conversión con `reyma_conversion_bulto`.
UNIDADES_CONVERTIBLES = {'KGM'}

DESTINOS_VALIDOS = {'bodega-san-jose', 'bodega-zacapa', 'bodega-peten', 'entrega-directa'}

# Destino declarado en Observaciones (hallazgo N10) → valor de la columna.
OBSERV_A_DESTINO = {
    'BODEGA ZACAPA': 'bodega-zacapa',
    'BODEGA SAN JOSE': 'bodega-san-jose',
    'BODEGA PETEN': 'bodega-peten',
    'CLIENTE DIRECTO': 'entrega-directa',
}


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


def guia_de(archivo: str) -> str:
    m = re.match(r'(G-\d+-\d{4})', archivo)
    if not m:
        raise SystemExit(f'No se pudo leer el correlativo de furgón de: {archivo}')
    return m.group(1)


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

    # Mapa clave REYMA → código Suplicentro. Una clave ambigua o ausente
    # detiene la carga.
    prods = rest('reyma_products?select=clave,codigo')
    por_clave = defaultdict(set)
    for p in prods:
        if p['clave']:
            por_clave[p['clave']].add(p['codigo'])

    # Tablita de Alexis: rollos por bulto. Append-only, la última fila por
    # código manda (viene ordenada por created_at DESC).
    rollos_por_bulto = {}
    for c in rest('reyma_conversion_bulto?select=codigo,rollos_por_bulto'
                  '&order=created_at.desc'):
        rollos_por_bulto.setdefault(c['codigo'], float(c['rollos_por_bulto']))

    filas, retenidas, errores = [], [], []
    for ln in lineas:
        guia = guia_de(ln['archivo'])
        prefijo = guia.rsplit('-', 1)[0]  # 'G-227-2026' → 'G-227'
        destino = destinos.get(prefijo)
        if not destino:
            errores.append(f'{guia}: sin destino declarado en --destinos')
            continue
        # El documento manda cuando lo dice (N10): contradicción = alto.
        observ = ln.get('observ_destino') or ''
        if observ and OBSERV_A_DESTINO.get(observ) not in (None, destino):
            errores.append(f'{guia}: destino declarado "{destino}" contradice '
                           f'Observaciones "{observ}" → {OBSERV_A_DESTINO[observ]}')
            continue
        if ln['unidad'] not in UNIDADES_1A1 | UNIDADES_CONVERTIBLES:
            retenidas.append((ln, 'unidad sin equivalencia ni tabla de conversión'))
            continue
        codigos = por_clave.get(ln['identificador'])
        if not codigos:
            errores.append(f"{guia} {ln['identificador']}: sin mapa en reyma_products.clave")
            continue
        if len(codigos) > 1:
            errores.append(f"{guia} {ln['identificador']}: clave ambigua → {sorted(codigos)}")
            continue
        codigo = next(iter(codigos))
        cantidad_cfdi = float(ln['cantidad'])
        bultos = float(ln['bultos']) if ln.get('bultos') not in (None, '') else None

        # Conversión a la unidad de compra de Odoo. Sólo por BULTOS, nunca por
        # peso (regla de Alexis). Si falta un insumo, se retiene la línea.
        if ln['unidad'] in UNIDADES_CONVERTIBLES:
            factor = rollos_por_bulto.get(codigo)
            if bultos is None:
                retenidas.append((ln, f"unidad {ln['unidad']} y la descripción no declara BLTS"))
                continue
            if factor is None:
                retenidas.append((ln, f'{codigo} sin fila en reyma_conversion_bulto '
                                      '(pedirle la tablita a Alexis para este código)'))
                continue
            cantidad = bultos * factor
            nota_conv = f' [{ln["unidad"]} → {bultos:,.0f} BLTS × {factor:g} rollos/bulto = {cantidad:,.0f}]'
        else:
            cantidad = cantidad_cfdi
            nota_conv = ''

        d, mth, y = ln['fecha'].split('/')
        filas.append({
            'folio_fiscal': ln['folio_fiscal'],
            'factura': ln['factura'],
            'guia': guia,
            'destino': destino,
            'fecha': f'{y}-{mth}-{d}',
            'codigo': codigo,
            'clave': ln['identificador'],
            'cantidad': cantidad,
            'cantidad_cfdi': cantidad_cfdi,
            'unidad': ln['unidad'],
            'bultos': bultos,
            'precio_unit': float(ln['precio_unitario']),
            'eta': etas.get(prefijo) or None,
            'autor': (args.autor + nota_conv)[:500],
        })

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
        for r, motivo in retenidas:
            print(f"      {guia_de(r['archivo'])} {r['identificador']:<14} "
                  f"{float(r['cantidad']):>10,.2f} {r['unidad']}  — {motivo}")

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
