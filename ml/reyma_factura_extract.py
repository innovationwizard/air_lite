"""
Extractor de las facturas CFDI de REYMA (PLASTICOS ADHERIBLES DEL BAJIO) —
núcleo compartido.

Este módulo vive en `ml/` (y no en `scripts/`) porque tiene DOS consumidores y
sólo puede haber una implementación:

  * `scripts/extract_reyma_facturas_pdf.py` — la CLI de siempre, que sigue
    siendo el camino de backfill y la red de seguridad.
  * `ml/api.py` → `POST /reyma/factura/preview` — lo que usa la página de carga
    de Alexis (A12).

El contenedor de Railway sólo copia `ml/`, así que mover el núcleo acá es lo
que permite que el servicio lo use sin duplicarlo. La CLI lo importa agregando
`ml/` al path.

Reglas (§ETL del proyecto), sin cambios respecto de la versión que cargó las
175 líneas hoy en producción:
  * Nada se lee por posición: cada campo se busca por su etiqueta o por su
    forma, nunca por índice de línea o de columna.
  * Nada se descarta. Cada línea de detalle sale con su texto verbatim.
  * No falla en silencio: si la suma de importes no cuadra con el `Total:`
    impreso, o si una línea no cuadra cantidad×precio, se emite un flag.
  * Lo que el documento no dice, no se inventa: `eta` y `destino` no se
    adivinan acá.

Requiere `pdftotext` (poppler-utils) en el PATH.
"""

import hashlib
import re
import subprocess

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

# Campos de cabecera sin los cuales la factura no es cargable.
CABECERA_OBLIGATORIA = ('factura', 'folio_fiscal', 'fecha', 't_cambio', 'total')


class PdfIlegible(Exception):
    """`pdftotext` no pudo leer el archivo (no es un PDF, o está corrupto)."""


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


def pdf_a_texto(datos: bytes) -> str:
    """Corre `pdftotext -layout` sobre los bytes, por stdin (sin archivo temporal)."""
    try:
        r = subprocess.run(
            ['pdftotext', '-layout', '-', '-'],
            input=datos, capture_output=True, check=True, timeout=60,
        )
    except FileNotFoundError as e:  # poppler-utils ausente
        raise PdfIlegible('pdftotext no está instalado en este entorno') from e
    except subprocess.TimeoutExpired as e:
        raise PdfIlegible('pdftotext no terminó en 60 s') from e
    except subprocess.CalledProcessError as e:
        detalle = (e.stderr or b'').decode('utf-8', 'replace').strip()[:200]
        raise PdfIlegible(f'pdftotext falló: {detalle or "sin detalle"}') from e
    return r.stdout.decode('utf-8', 'replace')


def extraer_de_bytes(nombre: str, datos: bytes) -> dict:
    """
    Extrae una factura desde los bytes del PDF.

    `nombre` es sólo procedencia (va al campo `archivo` y de ahí sale el
    correlativo de furgón `G-nnn`); NO se usa para inferir destino ni ETA.
    """
    texto = pdf_a_texto(datos)

    cab = {
        'archivo': nombre,
        'sha256': hashlib.sha256(datos).hexdigest(),
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
    for k in CABECERA_OBLIGATORIA:
        if not cab[k]:
            flags.append(f"{nombre}: falta el campo de cabecera '{k}'")

    cab['lineas'] = lineas
    cab['suma_importes'] = suma
    cab['flags'] = flags
    return cab


def extraer(pdf) -> dict:
    """Extrae desde una ruta en disco. `pdf` es un `pathlib.Path`."""
    return extraer_de_bytes(pdf.name, pdf.read_bytes())
