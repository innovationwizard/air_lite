#!/usr/bin/env python3
"""
Reglas de lectura del libro «Punto de Reorden · Alcance Máximo» — A4.27.

⚠️ LAS REGLAS VIVEN ACÁ, NO EN EL SCRIPT. `scripts/cargar_modelo_reorden.py` es
sólo la CLI: argumentos, impresión y escritura. Mismo reparto que
`ml/reyma_factura_carga.py`, y por la misma razón: el día que el proveedor
cambie el libro, no puede haber dos lugares donde arreglarlo.

═══════════════════════════════════════════════════════════════════════════════
POR QUÉ SE MAPEA POR SIGNIFICADO Y NUNCA POR NÚMERO DE COLUMNA
═══════════════════════════════════════════════════════════════════════════════

Este libro es el argumento entero. Medido el 2026-09-01:

  · Los encabezados viven en DOS filas, con celdas combinadas: la fila 2 tiene
    los grupos («INVENTARIO ACTUAL (fardos)») y la 3 las columnas («San Jose»).
  · Los encabezados traen SALTOS DE LÍNEA adentro: `'Cod\\nPlasticentro'`,
    `'Cub.\\nMillar\\nm3/ML'`.
  · Varios encabezados llevan la FECHA y el NÚMERO DE PROFORMA dentro del texto:
    `"PRECIO JUL'26 (23/07/2026) DNV0013333"`.
  · El tránsito confirmado son CUATRO COLUMNAS FECHADAS, y cada embarque nuevo
    agrega una. Cualquier índice fijo se rompe en el próximo embarque.
  · Hay una columna vacía antes del bloque de proformas.
  · El libro NO define un solo rango con nombre. No hay anclas: hay que
    construirlas.

De ahí la estrategia, en dos capas:

  1. CAMPOS FIJOS → se casan contra una lista de sinónimos normalizados. Si el
     proveedor renombra «San Jose» a «S. José» o «SJ», sigue entrando.
  2. CAMPOS REPETIDOS (tránsito, precios) → NO se pueden enumerar, porque son
     variables. Se detectan por el GRUPO al que pertenecen y se les lee la fecha
     o la proforma DEL PROPIO ENCABEZADO.

Y una regla de cierre: una columna que no case se REPORTA; una obligatoria que
falte DETIENE la carga. Nunca se adivina una posición, porque un mapeo
equivocado no falla — escribe números plausibles en la columna de al lado.
"""

import re
import unicodedata
from datetime import date

# ─── Normalización ───────────────────────────────────────────────────────────

MESES_ES = {
    'ene': 1, 'feb': 2, 'mar': 3, 'abr': 4, 'may': 5, 'jun': 6,
    'jul': 7, 'ago': 8, 'sep': 9, 'set': 9, 'oct': 10, 'nov': 11, 'dic': 12,
}


def normalizar(texto):
    """Un encabezado reducido a su significado comparable.

    Quita acentos, colapsa saltos de línea y espacios, baja a minúsculas y
    elimina la puntuación que sólo es decoración. `'Cub.\\nMillar\\nm3/ML'` y
    `'cub millar m3 ml'` tienen que dar lo mismo, porque son lo mismo.
    """
    if texto is None:
        return ''
    s = str(texto)
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r'[^\w\s]', ' ', s)      # puntuación → espacio
    s = re.sub(r'\s+', ' ', s)          # saltos y espacios múltiples → uno
    return s.strip()


# ─── Campos fijos y sus sinónimos ────────────────────────────────────────────
#
# Cada campo lista las formas en que ese encabezado podría venir escrito. El
# primero es el que trae el libro hoy; los demás son variantes plausibles del
# mismo concepto. Agregar un sinónimo es más barato y mucho más seguro que
# volver a mapear por posición.

CAMPOS = {
    # (obligatorio, [sinónimos normalizados])
    'codigo':         (True,  ['cod plasticentro', 'codigo plasticentro', 'codigo', 'cod']),
    'cod_proveedor':  (False, ['cod proveedor', 'codigo proveedor', 'cod darnel', 'codigo darnel']),
    'descripcion':    (False, ['descripcion', 'descripcion del producto', 'articulo']),
    'um':             (False, ['um', 'unidad', 'unidad de medida']),
    'und_fardo':      (True,  ['und fardo und', 'und fardo', 'unidades por fardo', 'und x fardo']),
    'cub_millar':     (False, ['cub millar m3 ml', 'cub millar', 'cubicaje millar', 'm3 millar']),

    'sj':             (True,  ['san jose fardos', 'san jose', 'sj']),
    'z11':            (False, ['zona 11 fardos', 'zona 11', 'z11']),
    'zacapa':         (False, ['zacapa fardos', 'zacapa']),
    'peten':          (False, ['peten fardos', 'peten']),
    'patios_sj':      (False, ['patios sj fardos', 'patios sj', 'patio sj', 'patios']),

    'pend_surtir_sj':     (False, ['pend surtir sj fardos', 'pend surtir sj', 'pendiente surtir sj']),
    'pend_surtir_peten':  (False, ['pend surtir pet fardos', 'pend surtir pet', 'pend surtir peten']),
    'pend_surtir_zacapa': (False, ['pend surtir zac fardos', 'pend surtir zac', 'pend surtir zacapa']),

    'transito_pendiente': (False, ['trans pend ml', 'trans pend', 'transito pendiente']),
    'venta_proy_mensual': (True,  ['vta proy mensual ml mes', 'vta proy mensual',
                                   'venta proyectada mensual', 'vta proy mes']),
    'precio_ml':          (False, ['precio ml', 'precio ml usd', 'precio usd ml', 'precio']),
}

# --- Columnas que el libro CALCULA y nosotros NO cargamos -------------------
#
# El motor recalcula cobertura, estado, pedido optimo y todo lo derivado, asi
# que estas columnas se ignoran a proposito. Se enumeran para poder DISTINGUIR
# "no la cargo porque la recalculo" de "no se que es esto". Sin esa distincion
# el reporte de carga escupe 21 columnas sin casar y una columna NUEVA de
# verdad --la senal que importa-- se pierde entre el ruido esperado.
CALCULADAS = {
    'n', 'inv neto fardos', 'inv neto millares', 'trans conf ml',
    'inv total n tc tp ml', 'vta proy semanal ml sem', 'ml conten ml',
    'sem conten sem', 'stock segur ml', 'pto reorden ml', 'inv max sem sem',
    'inv maximo ml', 'cob neta sem', 'cob total sem', 'estado', 'vs max',
    'pedir optimo ml', 'pedir fardos', 'valor pedido usd',
}


def es_calculada(etiqueta_normalizada):
    """Si el libro la calcula, no se carga: se recalcula."""
    if etiqueta_normalizada in CALCULADAS:
        return True
    # Las columnas de pedido llevan el numero de orden en el encabezado
    # ('AJO-11 DNV0013235 09/Jul/2026'): son historia de pedidos, no insumo.
    return bool(re.match(r'^ajo\s*\d+', etiqueta_normalizada))


# Grupos que contienen columnas REPETIDAS, que no se pueden enumerar.
GRUPO_TRANSITO_CONF = 'transito confirmado'
GRUPO_PRECIOS = 'precio'


def mapear_encabezados(fila_grupos, fila_columnas, anio=None):
    """Devuelve `(mapa, transito, sin_casar, faltantes)`.

    `mapa`      {campo: índice 0-based}
    `transito`  [(índice, etiqueta cruda, fecha|None)] — las columnas fechadas
    `sin_casar` [(índice, etiqueta cruda)] — se reportan, no se adivinan
    `faltantes` [campo] — obligatorios que no aparecieron; con esto la carga para

    `anio` se usa SÓLO para las columnas de tránsito, cuyos encabezados traen
    día y mes pero no año (`'18/Ago'`). Se pasa explícito para que la suposición
    quede en manos de quien carga y no escondida acá adentro; sin él se usa el
    año en curso, que es correcto mientras el libro sea del año en curso y deja
    de serlo en enero.

    `fila_grupos` puede traer huecos: en el libro los grupos son celdas
    combinadas, así que el título sólo aparece en la primera columna del grupo.
    Se arrastra hacia la derecha, que es lo que la combinación significa.
    """
    grupos, actual = [], ''
    for g in fila_grupos:
        n = normalizar(g)
        if n:
            actual = n
        grupos.append(actual)

    por_sinonimo = {}
    for campo, (_req, sinonimos) in CAMPOS.items():
        for s in sinonimos:
            por_sinonimo.setdefault(s, campo)

    mapa, transito, sin_casar = {}, [], []
    for i, cruda in enumerate(fila_columnas):
        etiqueta = normalizar(cruda)
        if not etiqueta:
            continue
        grupo = grupos[i] if i < len(grupos) else ''

        # 1) Columnas repetidas: se identifican por el GRUPO, y la fecha se lee
        #    del encabezado. Es la única forma de sobrevivir a que el proveedor
        #    agregue un embarque.
        if GRUPO_TRANSITO_CONF in grupo:
            transito.append((i, str(cruda), parsear_fecha_encabezado(cruda, anio)))
            continue

        # 2) Campos fijos, por sinónimo. Primero el que gana es el que queda:
        #    un libro con dos columnas del mismo concepto es un problema del
        #    libro, y duplicar silenciosamente sería peor que quedarse con una.
        campo = por_sinonimo.get(etiqueta)
        if campo and campo not in mapa:
            mapa[campo] = i
        elif not campo and not es_calculada(etiqueta):
            sin_casar.append((i, str(cruda)))

    faltantes = [c for c, (req, _s) in CAMPOS.items() if req and c not in mapa]
    return mapa, transito, sin_casar, faltantes


def parsear_fecha_encabezado(cruda, anio=None):
    """Saca la fecha de un encabezado como `'18/Ago\\nML'` o `'(23/07/2026)'`.

    ⚠️ EL AÑO NO SIEMPRE ESTÁ. El libro escribe `18/Ago` sin año, así que hay
    que suponerlo — y eso se hace explícito: el llamador pasa `anio`, y si no lo
    pasa se usa el año en curso. La etiqueta cruda se conserva SIEMPRE en la
    referencia del embarque, para que la suposición sea auditable y nadie tenga
    que confiar en ella a ciegas.
    """
    if cruda is None:
        return None
    s = str(cruda)

    # dd/mm/aaaa — el año viene dado, no hay nada que suponer
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', s)
    if m:
        d, mes, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return _fecha_segura(a, mes, d)

    # dd/Mmm — mes en letras, sin año
    m = re.search(r'(\d{1,2})\s*/\s*([A-Za-zÁÉÍÓÚáéíóú]{3,})', s)
    if m:
        d = int(m.group(1))
        mes = MESES_ES.get(normalizar(m.group(2))[:3])
        if mes:
            return _fecha_segura(anio or date.today().year, mes, d)
    return None


def _fecha_segura(a, m, d):
    try:
        return date(a, m, d)
    except ValueError:
        return None


def parsear_proforma(cruda):
    """El número de proforma que el libro esconde dentro del encabezado del
    precio: `"PRECIO JUL'26 (23/07/2026) DNV0013333"` → `DNV0013333`."""
    if cruda is None:
        return None
    m = re.search(r'\b([A-Z]{2,}\d{4,})\b', str(cruda))
    return m.group(1) if m else None


def a_numero(v):
    """Un valor de celda a número, o None.

    `'N/D'`, `'—'`, vacío y cualquier texto no numérico dan None y NO cero. La
    diferencia importa: cero es una afirmación («no hay»), None es la ausencia
    de dato, y confundirlos es cómo un producto sin precio termina valorizado
    en 0 sin que nadie lo note.
    """
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(',', '')
    if not s or s.upper() in {'N/D', 'ND', 'NA', 'N/A', '—', '-', '#REF!', '#N/A'}:
        return None
    try:
        return float(s)
    except ValueError:
        return None


ESTADOS_PRODUCTO = {'ACTIVO', 'LIQUIDACION', 'SIN MOV.'}


def normalizar_estado(v):
    """El estado del producto tal como lo trae la hoja de precios.

    Es la fuente BUENA: en la hoja del motor la regla de liquidación está rota
    por un `#REF!` y clasifica cero productos, cuando 11 están en liquidación.
    Lo desconocido cae en ACTIVO, que es el comportamiento actual del libro.
    """
    n = normalizar(v)
    if 'liquid' in n:
        return 'LIQUIDACION'
    if 'sin mov' in n:
        return 'SIN MOV.'
    return 'ACTIVO'
