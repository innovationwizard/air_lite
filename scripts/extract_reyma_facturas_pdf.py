"""
Extractor de las facturas CFDI de REYMA (PLASTICOS ADHERIBLES DEL BAJIO) a
filas de `reyma_facturas_pdf` — interfaz de línea de comandos.

Procedimiento puente de carga, docs/docs-alexis/MANIFEST.md §1d: mientras no
exista la ingesta por correo (L4), los PDFs que Alexis/David dejan en WhatsApp
o en la carpeta del drop se cargan a mano. Este script es el paso 3 de ese
procedimiento — extraer y VALIDAR contra el total impreso.

⚠️ El PARSEO no vive acá: vive en `ml/reyma_factura_extract.py`, porque la
página de carga de Alexis (A12) lo usa a través del servicio ML y no puede
haber dos implementaciones que se separen el día que REYMA cambie la plantilla.
Este archivo es la CLI: argumentos, impresión y CSV. Su comportamiento y su
salida no cambiaron.

Uso:
    python scripts/extract_reyma_facturas_pdf.py <pdf>... --out lineas.csv
"""

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ml'))

from reyma_factura_extract import extraer  # noqa: E402


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
