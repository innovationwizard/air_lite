"""
Extractor de las facturas CFDI de REYMA (PLASTICOS ADHERIBLES DEL BAJIO) a
filas de `reyma_facturas_pdf`.

Procedimiento puente de carga, docs/docs-alexis/MANIFEST.md §1d: mientras no
exista la ingesta por correo (L4), los PDFs que Alexis/David dejan en WhatsApp
o en la carpeta del drop se cargan a mano. Este script es el paso 3 de ese
procedimiento — extraer y VALIDAR contra el total impreso.

Reglas (§ETL del proyecto):
  * Nada se lee por posición: cada campo se busca por su etiqueta o por su
    forma, nunca por índice de línea o de columna.
  * Nada se descarta. Cada línea de detalle sale al CSV con su texto verbatim.
  * No falla en silencio: si la suma de importes no cuadra con el `Total:`
    impreso, o si una línea no cuadra cantidad×precio, se emite un flag y el
    proceso termina distinto de cero.
  * Lo que el documento no dice, no se inventa: `eta` y `destino` no se
    adivinan aquí — vienen del nombre de carpeta/archivo y se pasan aparte.

Uso:
    python scripts/extract_reyma_facturas_pdf.py <pdf>... --out lineas.csv
"""

import argparse
import csv
import hashlib
import re
import subprocess
import sys
from pathlib import Path

# Una línea de detalle: cantidad, unidad, clave SAT (8 dígitos), identificador
# REYMA, descripción, precio unitario, importe. Se ancla en los dos importes
# con '$' del final y en la clave SAT — no en columnas.
DETALLE = re.compile(
    r'^\s*(?P<cantidad>[\d,]+\.\d{2})\s+'
    r'(?P<unidad>[A-Z0-9]{2,4})\s+'
    r'(?P<clave_sat>\d{8})\s+'
    r'(?P<identificador>\S+)\s+'
    r'(?P<descripcion>.+?)\s+'
    r'\$(?P<precio>[\d,]+\.\d{2})\s+'
    r'\$(?P<importe>[\d,]+\.\d{2})\s*$'
)
# Continuación de la descripción: sangrada, sin importes, antes del pie 'DAP'.
CONTINUACION = re.compile(r'^\s{40,}(?P<texto>\S.*?)\s*$')
FIN_DETALLE = re.compile(r'^\s*DAP\b')

# Conteo de BULTOS al final de la descripción. REYMA factura la bolsa poliseda
# POR PESO (unidad KGM) y el número de bultos viaja SÓLO acá — Alexis, verbatim
# (2026-08-20): «él lo pone en la descripción, no está como que en la cantidad».
# Es el insumo de la conversión a la unidad de compra de Odoo (MILLAR/ML):
# bultos × rollos_por_bulto. Se captura siempre que aparezca, sea cual sea la
# unidad — content-based, no atado a KGM.
BULTOS = re.compile(r'\b(?P<bultos>\d+(?:\.\d+)?)\s+BLTS\b')


def num(s: str) -> float:
    return float(s.replace(',', ''))


def campo(texto: str, etiqueta: str, patron: str) -> str | None:
    """Busca `patron` en la misma línea que `etiqueta`. Content-based."""
    for linea in texto.splitlines():
        if etiqueta in linea:
            m = re.search(patron, linea)
            if m:
                return m.group(1)
    return None


def extraer(pdf: Path) -> dict:
    texto = subprocess.run(
        ['pdftotext', '-layout', str(pdf), '-'],
        capture_output=True, text=True, check=True,
    ).stdout

    cab = {
        'archivo': pdf.name,
        'sha256': hashlib.sha256(pdf.read_bytes()).hexdigest(),
        'factura': campo(texto, 'FACTURA:', r'(F\d{6,})'),
        'pv': campo(texto, 'PLASTICOS ADHERIBLES DEL BAJIO\n', r'(PV\d+)') or
              (re.search(r'\b(PV\d{7})\b', texto).group(1)
               if re.search(r'\b(PV\d{7})\b', texto) else None),
        'folio_fiscal': campo(texto, 'Folio Fiscal:', r'([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})'),
        'fecha': campo(texto, 'Fecha:', r'(\d{2}/\d{2}/\d{4})'),
        'hora': campo(texto, 'Fecha:', r'\d{2}/\d{2}/\d{4}\s+(\d{2}:\d{2}:\d{2})'),
        't_cambio': campo(texto, 'T. Cambio:', r'T\. Cambio:\s+([\d.]+)'),
        'total': campo(texto, 'Total:', r'Total:\s+\$([\d,]+\.\d{2})'),
        # Metadata in-band (MANIFEST §3): la OC de Odoo viaja en la línea OP.
        'op': campo(texto, 'OP. ', r'OP\.\s+(.+?)\s+CONF\.'),
        'oc': campo(texto, 'OP. ', r'#(PO-[A-Z0-9-]+)'),
        'conf': campo(texto, 'CONF. S/', r'CONF\.\s+(S/[\d-]+)'),
        # Observaciones: desde el segundo drop nombran el destino físico
        # (BODEGA ZACAPA / BODEGA SAN JOSE / CLIENTE DIRECTO) — hallazgo N10.
        'observ_destino': campo(texto, 'TRAILER 53 PIES', r'TRAILER 53 PIES\s+(BODEGA [A-ZÁÉÍÓÚÑ ]+?|CLIENTE DIRECTO)\s+ESTA MERCANCIA'),
        'paginas': str(texto.count('\f') or 1),
    }

    lineas, flags = [], []
    for cruda in texto.splitlines():
        if FIN_DETALLE.match(cruda):
            break
        m = DETALLE.match(cruda)
        if m:
            g = m.groupdict()
            lineas.append({
                'linea': len(lineas) + 1,
                'cantidad': num(g['cantidad']),
                'unidad': g['unidad'],
                'clave_sat': g['clave_sat'],
                'identificador': g['identificador'],
                'descripcion': g['descripcion'].strip(),
                'precio_unitario': num(g['precio']),
                'importe': num(g['importe']),
                'bultos': '',  # se completa si la descripción lo trae (ver BULTOS)
                'linea_verbatim': cruda.rstrip(),
            })
            continue
        c = CONTINUACION.match(cruda)
        if c and lineas:
            lineas[-1]['descripcion'] += ' ' + c.group('texto')
            lineas[-1]['linea_verbatim'] += '\n' + cruda.rstrip()
            b = BULTOS.search(lineas[-1]['descripcion'])
            if b:
                lineas[-1]['bultos'] = num(b.group('bultos'))

    # Validación 1 — cantidad × precio = importe, línea a línea.
    for ln in lineas:
        esperado = round(ln['cantidad'] * ln['precio_unitario'], 2)
        if abs(esperado - ln['importe']) > 0.01:
            flags.append(f"{cab['factura']} L{ln['linea']} {ln['identificador']}: "
                         f"{ln['cantidad']}×{ln['precio_unitario']}={esperado} ≠ importe {ln['importe']}")
    # Validación 2 — suma de importes = Total impreso.
    suma = round(sum(ln['importe'] for ln in lineas), 2)
    total = num(cab['total']) if cab['total'] else None
    if total is None or abs(suma - total) > 0.01:
        flags.append(f"{cab['factura']}: suma de importes {suma} ≠ Total impreso {total}")
    # Validación 3 — campos de cabecera obligatorios presentes.
    for k in ('factura', 'folio_fiscal', 'fecha', 't_cambio', 'total'):
        if not cab[k]:
            flags.append(f"{pdf.name}: falta el campo de cabecera '{k}'")

    cab['lineas'] = lineas
    cab['suma_importes'] = suma
    cab['flags'] = flags
    return cab


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('pdfs', nargs='+', type=Path)
    ap.add_argument('--out', type=Path, help='CSV de líneas con provenance')
    args = ap.parse_args()

    facturas = [extraer(p) for p in args.pdfs]
    todos_flags = [f for fa in facturas for f in fa['flags']]

    for fa in facturas:
        print(f"{fa['archivo']}")
        print(f"  factura={fa['factura']} pv={fa['pv']} fecha={fa['fecha']} {fa['hora']} "
              f"folio={fa['folio_fiscal']}")
        print(f"  tc={fa['t_cambio']} total={fa['total']} suma={fa['suma_importes']} "
              f"lineas={len(fa['lineas'])} paginas={fa['paginas']}")
        print(f"  op={fa['op']} oc={fa['oc']} conf={fa['conf']} destino_observ={fa['observ_destino']}")
        print(f"  sha256={fa['sha256']}")
        unidades = sorted({ln['unidad'] for ln in fa['lineas']})
        print(f"  unidades={unidades}")
        for ln in fa['lineas']:
            blt = f"  ({ln['bultos']:,.0f} BLTS)" if ln['bultos'] != '' else ''
            print(f"    {ln['linea']:>2} {ln['cantidad']:>10,.2f} {ln['unidad']:<4} "
                  f"{ln['identificador']:<14} ${ln['precio_unitario']:>8,.2f} "
                  f"${ln['importe']:>11,.2f}{blt}")
        print()

    if args.out:
        campos = ['archivo', 'factura', 'pv', 'folio_fiscal', 'fecha', 'hora', 't_cambio',
                  'oc_in_band', 'op', 'conf', 'observ_destino', 'sha256',
                  'linea', 'cantidad', 'unidad', 'clave_sat', 'identificador',
                  'descripcion', 'precio_unitario', 'importe', 'bultos', 'linea_verbatim']
        with args.out.open('w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, fieldnames=campos)
            w.writeheader()
            for fa in facturas:
                for ln in fa['lineas']:
                    w.writerow({
                        'archivo': fa['archivo'], 'factura': fa['factura'], 'pv': fa['pv'],
                        'folio_fiscal': fa['folio_fiscal'], 'fecha': fa['fecha'],
                        'hora': fa['hora'], 't_cambio': fa['t_cambio'],
                        'oc_in_band': fa['oc'] or '', 'op': fa['op'] or '',
                        'conf': fa['conf'] or '', 'observ_destino': fa['observ_destino'] or '',
                        'sha256': fa['sha256'], **ln,
                    })
        print(f"→ {args.out} ({sum(len(f['lineas']) for f in facturas)} líneas)")

    if todos_flags:
        print(f"\n⚠️  {len(todos_flags)} FLAGS:")
        for f in todos_flags:
            print(f"  - {f}")
        return 1
    print("✅ 0 flags — suma de importes = total impreso en todas las facturas.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
