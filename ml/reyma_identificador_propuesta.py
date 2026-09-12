"""
Propuesta de SKU para un identificador REYMA que la app todavía no conoce.

Vocabulario (decisión de Jorge 2026-09-12, siguiendo el documento de REYMA):
  * **identificador** — el código con el que REYMA nombra el producto en su
    factura CFDI (`CH2PRXN`). Es la columna "identificador" del documento; en
    la BD vive en `reyma_products.clave` / `reyma_clave_map.clave` por razones
    históricas, pero en pantalla NUNCA se le dice "clave" (en ese mismo
    documento "clave" es la clave SAT, otra cosa).
  * **SKU** — el código de Suplicentro en Odoo (`77201001`).

Odoo NO guarda el identificador de REYMA en ningún campo
(`product.supplierinfo.product_code` es literalmente "0" en todas las filas
que lo tienen — verificado 2026-09-12), así que el cruce no puede ser una
consulta: hay que inferirlo. Este módulo hace esa inferencia con las tres
señales que sí existen, y la devuelve como PROPUESTA para que Alexis confirme
con un «Sí» o un «No». **Nunca escribe un mapeo**: la regla de Jorge
(2026-09-12) es que ningún identificador se asigna sin confirmación humana, y
que Alexis es la única fuente autorizada para confirmarlo.

Las señales, de más a menos fuerte:

  1. **La orden de compra.** Un producto REYMA en una OC de Odoo confirmada
     en la ventana de la factura, y que la app todavía no tiene mapeado, es
     casi seguro el producto que REYMA acaba de facturar con un identificador
     nuevo. Si además la cantidad de la línea coincide con la de la OC, más.
  2. **Cómo le dice REYMA al producto en Odoo** (`supplierinfo.product_name`,
     44 de 116 filas). Cuando existe, es la propia palabra de REYMA — resolvió
     sola el precedente de agosto (CN9X9D4PXN: "CONTENEDOR TERMICO 9X9-D").
  3. **La estructura de la descripción**: el empaque ("1 PAQ/500 PZAS" ↔
     "1/500"), la talla ("2P", "9X9", "16 OZ") y el tipo de producto con una
     tabla de sinónimos REYMA↔Odoo (CHAROLA≡BANDEJA, CONTENEDOR≡PORTACOMIDA…).

La asimetría de costos manda el umbral: un mapeo equivocado corrompe stock y
dinero en silencio; una propuesta que Alexis rechaza le cuesta un toque. Por
eso sólo se PROPONE cuando hay un candidato claro y separado del siguiente;
si no, se le pregunta directamente «¿Cuál es el SKU correcto?» con los
candidatos como sugerencia, sin poner uno en su boca.

Módulo puro, sin I/O: `api.py` trae los datos de Odoo y de la BD y llama
`proponer()`. Así la inferencia se prueba sin Odoo.
"""

import re
import unicodedata
from dataclasses import dataclass, field

# ── Vocabulario REYMA ↔ Odoo ─────────────────────────────────────────────────
# Tipo de producto: la palabra de REYMA y las palabras con que Odoo nombra lo
# mismo. Sacado de los 44 `supplierinfo.product_name` de REYMA cruzados con el
# nombre Odoo del mismo template (2026-09-12). Todo normalizado (sin acentos,
# mayúsculas). Cada grupo es una familia; un token de la descripción y uno del
# nombre Odoo "son el mismo tipo" si caen en la misma familia.
FAMILIAS = [
    {'CHAROLA', 'BANDEJA', 'PLATO'},
    {'CONTENEDOR', 'PORTACOMIDA', 'HAMBURGUESERA'},
    {'VASO'},
    {'ENVASE'},
    {'TAPA'},
    {'CUCHARA'},
    {'TENEDOR'},
    {'CUCHILLO'},
    {'POPOTE', 'PAJILLA'},
    {'CLINGFILM', 'FILM'},
    {'BOLSA'},
    {'GUANTE'},
    {'SERVILLETA'},
]
_FAMILIA_DE = {palabra: i for i, fam in enumerate(FAMILIAS) for palabra in fam}

# Material: REYMA dice "TERMICO/TERMICA" donde Odoo dice "DUROPORT" o "FOAM";
# "POLIPRO" donde Odoo dice "PLASTICO". Se usa como refuerzo, no como veto.
MATERIALES = [
    {'TERMICO', 'TERMICA', 'DUROPORT', 'FOAM', 'UNICEL'},
    {'POLIPRO', 'PLASTICO', 'TRANSPARENTE', 'TRANS'},
    {'BIODEGRADABLE', 'BIO'},
]
_MATERIAL_DE = {palabra: i for i, fam in enumerate(MATERIALES) for palabra in fam}

# Piezas por paquete que REYMA usa de verdad. Distingue "20X25" (empaque:
# 20 paquetes de 25) de "9X9" (talla: nueve por nueve pulgadas).
_PIEZAS_TIPICAS = {10, 12, 15, 20, 25, 30, 40, 50, 100, 125, 150, 200, 250, 300, 400, 500, 1000}

_RUIDO_MARCA = {'REYMA', 'REY', 'MA', 'MARCA', 'VAMSA', 'MARIEL'}


def normalizar(texto: str) -> str:
    """Mayúsculas, sin acentos, sin puntuación rara; los separadores quedan como espacio."""
    t = unicodedata.normalize('NFKD', texto or '')
    t = ''.join(c for c in t if not unicodedata.combining(c)).upper()
    t = t.replace('¨', ' ').replace('"', ' ').replace('´', ' ').replace("'", ' ')
    t = re.sub(r'[^A-Z0-9/.\-X ]+', ' ', t)
    return re.sub(r'\s+', ' ', t).strip()


def tokens(texto: str) -> set:
    return {tok for tok in re.split(r'[ /.\-]+', normalizar(texto)) if tok}


# "1 PAQ/500 PZAS", "20 PAQ / 50 PZAS", "4 CAJAS/500", "40/25", "1/500", "20X25",
# "10/50 UN." → (paquetes, piezas).
_EMPAQUE_CON_PALABRA = re.compile(r'(\d+)\s*(?:PAQ|PAQUETES?|CAJAS?|BOLSAS?)\s*/\s*(\d+)')
_EMPAQUE_BARRA = re.compile(r'(?<![\d.])(\d{1,3})\s*/\s*(\d{2,4})(?![\d/])')
_EMPAQUE_X = re.compile(r'(?<![\dX])(\d{1,3})\s*X\s*(\d{2,4})(?![\dX])')


def empaque_de(texto: str):
    """(paquetes, piezas) o None. La 'X' sólo cuenta como empaque cuando el
    segundo número es un conteo de piezas típico — si no, es una talla (9X9)."""
    t = normalizar(texto)
    m = _EMPAQUE_CON_PALABRA.search(t)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = _EMPAQUE_BARRA.search(t)
    if m:
        return int(m.group(1)), int(m.group(2))
    for m in _EMPAQUE_X.finditer(t):
        a, b = int(m.group(1)), int(m.group(2))
        if b in _PIEZAS_TIPICAS and a <= 100 and not (a == b and a <= 12):
            return a, b
    return None


_TALLA_LETRA = re.compile(r'(?<![A-Z0-9])(\d{1,4})\s*-?\s*([A-Z])(?![A-Z0-9])')     # 2P, 4P, 8H, 4A, PH-8 → no; 9-D → 9D
_TALLA_XY = re.compile(r'(?<![\dX])(\d{1,2})\s*X\s*(\d{1,2})(?![\dX])')             # 9X9, 8X8, 6X6
_TALLA_OZ = re.compile(r'(\d{1,2}(?:\.\d)?)\s*(?:OZ|ONZ|ONZAS|OUNCE)')             # 16 OZ, 16OZ, 5.5onz
_TALLA_NO = re.compile(r'(?:^|[ .])(?:NO|N|NUM|NUMERO)\s*\.?\s*(\d{1,4})(?![A-Z0-9])')  # No. 8, N8, NO 10
_TALLA_LITRO = re.compile(r'(\d(?:/\d)?|\d(?:\.\d)?)\s*(?:LT|LTS|LITRO|LITROS|L)(?![A-Z])')
_TALLA_NUM_GRANDE = re.compile(r'(?<![\dX/.])(\d{3,4})(?![\dX/.])')                  # 105, 855


def tallas_de(texto: str) -> set:
    """Tokens de talla comparables entre la descripción REYMA y el nombre Odoo."""
    t = normalizar(texto)
    out = set()
    for m in _TALLA_LETRA.finditer(t):
        if m.group(2) not in ('X',):
            out.add(f'{int(m.group(1))}{m.group(2)}')
    for m in _TALLA_XY.finditer(t):
        out.add(f'{int(m.group(1))}X{int(m.group(2))}')
    for m in _TALLA_OZ.finditer(t):
        out.add(f'{m.group(1)}OZ')
    for m in _TALLA_NO.finditer(t):
        out.add(f'N{int(m.group(1))}')
    for m in _TALLA_LITRO.finditer(t):
        out.add(f'{m.group(1)}L')
    for m in _TALLA_NUM_GRANDE.finditer(t):
        n = int(m.group(1))
        if n not in _PIEZAS_TIPICAS:
            out.add(f'N{n}')
    return out


def familia_de(texto: str):
    for tok in tokens(texto):
        if tok in _FAMILIA_DE:
            return _FAMILIA_DE[tok]
    return None


def materiales_de(texto: str) -> set:
    return {_MATERIAL_DE[tok] for tok in tokens(texto) if tok in _MATERIAL_DE}


def _contiene_nombre_reyma(descripcion: str, nombre_reyma: str) -> bool:
    """¿La descripción del CFDI trae la frase con que REYMA nombró el producto
    en Odoo? Se compara por tokens significativos: si todos los del nombre
    REYMA están en la descripción, es el mismo producto dicho por REYMA."""
    # Sólo se descarta la marca: una letra suelta ("9X9-D" vs "9X9 L") es
    # justamente lo que separa dos productos hermanos, no ruido.
    sig = {t for t in tokens(nombre_reyma) if t not in _RUIDO_MARCA}
    if len(sig) < 2:
        return False
    return sig <= tokens(descripcion)


@dataclass
class Candidato:
    sku: str
    nombre_odoo: str
    nombre_reyma: str | None = None
    uom: str | None = None
    cubicaje: float = 0.0
    activo: bool = True
    odoo_product_id: int | None = None
    # Señal 1 — la OC. `oc` es el nombre de la orden ('PO-P-3025'), `oc_fecha`
    # ISO, `oc_cantidad` lo pedido en esa línea, `oc_uom` su unidad.
    oc: str | None = None
    oc_fecha: str | None = None
    oc_cantidad: float | None = None
    oc_uom: str | None = None
    # ¿La app ya tiene este SKU mapeado a OTRO identificador?
    ya_mapeado_a: str | None = None
    # Resultado del puntaje (lo llena `puntuar`)
    puntaje: int = 0
    evidencia: list = field(default_factory=list)
    en_contra: list = field(default_factory=list)


UMBRAL_PROPUESTA = 45      # menos que esto, no se propone: se pregunta
SEPARACION_MINIMA = 15     # el primero debe despegarse del segundo por esto


def puntuar(descripcion: str, cantidad_cfdi, c: Candidato) -> Candidato:
    """Puntúa UN candidato contra la descripción del CFDI. Deja el porqué en
    `evidencia` (a favor) y `en_contra`, en palabras para Alexis."""
    pts = 0
    a_favor, en_contra = [], []

    # 1. La orden de compra
    if c.oc:
        pts += 20
        cant = f'{c.oc_cantidad:,.0f} {c.oc_uom or ""}'.strip() if c.oc_cantidad else ''
        a_favor.append(f'Está en la orden {c.oc} del {c.oc_fecha or "?"}'
                       + (f' ({cant})' if cant else ''))
        if cantidad_cfdi and c.oc_cantidad and abs(float(cantidad_cfdi) - c.oc_cantidad) < 0.5:
            pts += 20
            a_favor.append(f'La cantidad facturada ({float(cantidad_cfdi):,.0f}) es la misma de esa orden')

    # 2. Cómo le dice REYMA en Odoo
    if c.nombre_reyma and _contiene_nombre_reyma(descripcion, c.nombre_reyma):
        pts += 50
        a_favor.append(f'REYMA le llama «{c.nombre_reyma.strip()}» a este SKU en Odoo')

    # 3. Estructura de la descripción vs. el nombre Odoo
    emp_cfdi, emp_odoo = empaque_de(descripcion), empaque_de(c.nombre_odoo)
    if emp_cfdi and emp_odoo:
        if emp_cfdi == emp_odoo:
            pts += 25
            a_favor.append(f'Mismo empaque: {emp_cfdi[0]}/{emp_cfdi[1]}')
        else:
            pts -= 30
            en_contra.append(f'El empaque no coincide: la factura dice {emp_cfdi[0]}/{emp_cfdi[1]}, '
                             f'Odoo dice {emp_odoo[0]}/{emp_odoo[1]}')

    tal_cfdi, tal_odoo = tallas_de(descripcion), tallas_de(c.nombre_odoo)
    if tal_cfdi and tal_odoo:
        comunes = tal_cfdi & tal_odoo
        if comunes:
            pts += 20
            a_favor.append(f'Misma talla: {", ".join(sorted(comunes))}')
        else:
            pts -= 20
            en_contra.append(f'La talla no coincide: factura {", ".join(sorted(tal_cfdi))} vs. '
                             f'Odoo {", ".join(sorted(tal_odoo))}')

    fam_cfdi, fam_odoo = familia_de(descripcion), familia_de(c.nombre_odoo)
    if fam_cfdi is not None and fam_odoo is not None:
        if fam_cfdi == fam_odoo:
            pts += 15
            a_favor.append('Es el mismo tipo de producto')
        else:
            pts -= 25
            en_contra.append('No es el mismo tipo de producto')

    mat_cfdi, mat_odoo = materiales_de(descripcion), materiales_de(c.nombre_odoo)
    if mat_cfdi and mat_odoo:
        if mat_cfdi & mat_odoo:
            pts += 5
        else:
            pts -= 10
            en_contra.append('El material no parece el mismo')

    if c.ya_mapeado_a and c.ya_mapeado_a != '':
        pts -= 15
        en_contra.append(f'Este SKU ya está asignado al identificador {c.ya_mapeado_a}')

    if not c.activo:
        pts -= 20
        en_contra.append('El producto está inactivo en Odoo')

    c.puntaje = pts
    c.evidencia = a_favor
    c.en_contra = en_contra
    return c


def proponer(descripcion: str, cantidad_cfdi, candidatos: list) -> dict:
    """
    Devuelve {'propuesta': Candidato | None, 'otras': [Candidato, ...]}.

    `propuesta` sólo cuando el mejor candidato pasa el umbral Y se despega del
    segundo. `otras` son los demás con puntaje positivo, de mejor a peor —
    las sugerencias para «¿Cuál es el SKU correcto?» cuando Alexis dice No o
    cuando no hay propuesta.
    """
    puntuados = sorted(
        (puntuar(descripcion, cantidad_cfdi, c) for c in candidatos),
        key=lambda c: (-c.puntaje, c.sku),
    )
    positivos = [c for c in puntuados if c.puntaje > 0]
    if not positivos:
        return {'propuesta': None, 'otras': []}
    mejor = positivos[0]
    segundo = positivos[1].puntaje if len(positivos) > 1 else None
    despegado = segundo is None or (mejor.puntaje - segundo) >= SEPARACION_MINIMA
    if mejor.puntaje >= UMBRAL_PROPUESTA and despegado:
        return {'propuesta': mejor, 'otras': positivos[1:9]}
    return {'propuesta': None, 'otras': positivos[:9]}


def a_dict(c: Candidato) -> dict:
    return {
        'sku': c.sku,
        'nombre_odoo': c.nombre_odoo,
        'nombre_reyma': c.nombre_reyma,
        'uom': c.uom,
        'cubicaje': c.cubicaje,
        'activo': c.activo,
        'odoo_product_id': c.odoo_product_id,
        'oc': c.oc,
        'puntaje': c.puntaje,
        'evidencia': c.evidencia,
        'en_contra': c.en_contra,
    }
