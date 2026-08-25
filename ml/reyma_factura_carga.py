"""
Reglas de carga de las facturas REYMA a `reyma_facturas_pdf` — núcleo puro.

Estas son las reglas que cargaron las 175 filas que hoy están en producción sin
un solo error de mapeo. Viven acá, en un módulo SIN I/O, porque tienen dos
consumidores y no puede haber dos implementaciones:

  * `scripts/load_reyma_facturas_pdf.py` — la CLI (backfill y red de seguridad).
  * `ml/api.py` → `POST /reyma/factura/preview` — la página de carga de Alexis.

Reescribirlas en TypeScript del lado de Next.js daría dos juegos de reglas que
se separan el día que REYMA cambie algo, y la regresión que las protege
(«reproduce EXACTO las filas ya cargadas») sólo vale si hay un implementador.

Las reglas que hace cumplir este módulo (no son opcionales):

  * `destino` NO se infiere del CFDI. Se declara por furgón; el módulo verifica
    que coincida con el destino in-band de las Observaciones (`TRAILER 53 PIES
    BODEGA ZACAPA` / `... BODEGA SAN JOSE` / `... CLIENTE DIRECTO`, hallazgo
    N10) cuando el documento lo trae, y se niega a cargar si se contradicen.
  * `eta` NO se inventa. Sólo entra si viene declarada; si no, queda NULL —
    precedente G-226.
  * Unidades: X4G ≡ caja/bulto y XPK ≡ Fardo van 1:1 contra la UoM de compra de
    Odoo. `KGM` (bolsa poliseda, que REYMA factura POR PESO) se convierte con la
    tablita de Alexis (`reyma_conversion_bulto`):
        cantidad = BLTS de la descripción × rollos_por_bulto
    NO se deriva del peso: Alexis, verbatim, «no podemos poner como que un peso
    estándar porque… por centavos no va a cuadrar la factura en cuanto a
    montos». Si falta la tablita para un código, o el documento no trae los
    BLTS, la línea se RETIENE — nunca se estima.
  * Siempre se guarda lo verbatim del papel además de lo convertido:
    `cantidad_cfdi` + `unidad` + `bultos`.
  * `codigo` sale de `reyma_products.clave`. Una clave sin mapa detiene la
    carga: no se descarta la línea ni se le inventa código.

**Retenida vs error.** Una línea RETENIDA es una que el documento trae pero no
sabemos convertir con certeza — el resto de la factura sí se puede cargar, y lo
retenido se anuncia con números. Un ERROR es una condición que invalida la
factura entera: nada se carga. La diferencia importa porque decide qué ve el
usuario y qué se escribe.
"""

import re
from dataclasses import dataclass, field

# Unidades del CFDI con equivalencia 1:1 probada contra la UoM de compra de
# Odoo (verificado línea a línea contra PO-PZ11-0489, PO-PZ-0132 y las líneas
# ya cargadas): X4G = caja/bulto, XPK = Fardo.
UNIDADES_1A1 = {'X4G', 'XPK'}
# Unidades que requieren conversión con `reyma_conversion_bulto`.
UNIDADES_CONVERTIBLES = {'KGM'}

DESTINOS_VALIDOS = ('bodega-san-jose', 'bodega-zacapa', 'bodega-peten', 'entrega-directa')

# Destino declarado en Observaciones (hallazgo N10) → valor de la columna.
OBSERV_A_DESTINO = {
    'BODEGA ZACAPA': 'bodega-zacapa',
    'BODEGA SAN JOSE': 'bodega-san-jose',
    'BODEGA PETEN': 'bodega-peten',
    'CLIENTE DIRECTO': 'entrega-directa',
}

# Ancho de la columna `autor` en la BD (migración 20260814000001).
AUTOR_MAX = 500

_GUIA = re.compile(r'(G-\d+-\d{4})')
_FECHA_CFDI = re.compile(r'^(\d{2})/(\d{2})/(\d{4})$')


class DatoInvalido(Exception):
    """Entrada que no se puede procesar (destino fuera de catálogo, etc.)."""


@dataclass(frozen=True)
class Mapas:
    """Los dos catálogos que las reglas necesitan leer de la BD."""
    # clave REYMA → códigos Suplicentro. Es un set a propósito: una clave que
    # mapea a más de un código es ambigua y detiene la carga.
    por_clave: dict
    # código Suplicentro → rollos por bulto (tablita de Alexis).
    rollos_por_bulto: dict = field(default_factory=dict)


@dataclass
class Resultado:
    filas: list = field(default_factory=list)
    retenidas: list = field(default_factory=list)
    errores: list = field(default_factory=list)

    @property
    def cargable(self) -> bool:
        return not self.errores and bool(self.filas)

    def _error(self, mensaje: str) -> None:
        """
        Registra un error UNA vez. Las condiciones de factura (destino que
        contradice Observaciones, destino sin declarar) se detectan al recorrer
        las líneas, así que sin esto una factura de 9 líneas produce 9 copias
        del mismo mensaje — ruido en el log y, peor, una pantalla que repite
        nueve veces lo mismo en vez de decirlo una vez y claro.
        """
        if mensaje not in self.errores:
            self.errores.append(mensaje)


def guia_de(archivo: str) -> str:
    """Correlativo de furgón desde el nombre del archivo: 'G-236-2026'."""
    m = _GUIA.match(archivo)
    if not m:
        raise DatoInvalido(f'No se pudo leer el correlativo de furgón de: {archivo}')
    return m.group(1)


def prefijo_de(guia: str) -> str:
    """'G-236-2026' → 'G-236' — la llave con que se declaran destino y ETA."""
    return guia.rsplit('-', 1)[0]


def fecha_iso(fecha_cfdi: str) -> str:
    """'21/08/2026' → '2026-08-21'. No adivina: exige el formato del CFDI."""
    m = _FECHA_CFDI.match((fecha_cfdi or '').strip())
    if not m:
        raise DatoInvalido(f'fecha con formato inesperado: {fecha_cfdi!r}')
    d, mth, y = m.groups()
    return f'{y}-{mth}-{d}'


def destino_in_band(observ_destino) -> str | None:
    """Destino que declara el propio CFDI en Observaciones (N10), o None."""
    return OBSERV_A_DESTINO.get((observ_destino or '').strip()) or None


def lineas_de_factura(cab: dict) -> list:
    """
    Aplana la salida de `reyma_factura_extract.extraer*` a las filas planas que
    consume `evaluar` — exactamente la forma del CSV de la CLI, para que los dos
    caminos entren por la misma puerta.
    """
    comunes = {
        'archivo': cab['archivo'], 'factura': cab['factura'], 'pv': cab.get('pv'),
        'folio_fiscal': cab['folio_fiscal'], 'fecha': cab['fecha'],
        'hora': cab.get('hora'), 't_cambio': cab.get('t_cambio'),
        'oc_in_band': cab.get('oc') or '', 'op': cab.get('op') or '',
        'conf': cab.get('conf') or '', 'observ_destino': cab.get('observ_destino') or '',
        'sha256': cab['sha256'],
    }
    return [{**comunes, **ln} for ln in cab['lineas']]


def _a_float(v):
    """Los dos caminos difieren: la CLI lee CSV (todo str), la API trae floats."""
    if v is None or v == '':
        return None
    return float(v)


def evaluar(lineas, destinos: dict, etas: dict, autor: str, mapas: Mapas) -> Resultado:
    """
    Evalúa las reglas sobre líneas ya extraídas y devuelve qué se carga, qué se
    retiene y qué invalida la factura. **No escribe nada.**

    `destinos` y `etas` se indexan por PREFIJO de furgón ('G-236'), que es como
    se declaran tanto en la CLI (`--destinos`) como en la página (un destino por
    factura).
    """
    r = Resultado()
    for ln in lineas:
        try:
            guia = guia_de(ln['archivo'])
        except DatoInvalido as e:
            r._error(str(e))
            continue
        prefijo = prefijo_de(guia)

        destino = destinos.get(prefijo)
        if not destino:
            r._error(f'{guia}: sin destino declarado')
            continue
        if destino not in DESTINOS_VALIDOS:
            r._error(f'{guia}: destino inválido "{destino}" '
                     f'(válidos: {", ".join(DESTINOS_VALIDOS)})')
            continue

        # El documento manda cuando lo dice (N10): contradicción = alto.
        in_band = destino_in_band(ln.get('observ_destino'))
        if in_band and in_band != destino:
            r._error(f'{guia}: destino declarado "{destino}" contradice '
                     f'Observaciones "{ln["observ_destino"]}" → {in_band}')
            continue

        unidad = ln['unidad']
        if unidad not in UNIDADES_1A1 | UNIDADES_CONVERTIBLES:
            r.retenidas.append(_retenida(guia, ln, 'unidad sin equivalencia ni tabla de conversión'))
            continue

        codigos = mapas.por_clave.get(ln['identificador'])
        if not codigos:
            r._error(f"{guia} {ln['identificador']}: sin mapa en reyma_products.clave")
            continue
        if len(codigos) > 1:
            r._error(f"{guia} {ln['identificador']}: clave ambigua → {sorted(codigos)}")
            continue
        codigo = next(iter(codigos))

        cantidad_cfdi = _a_float(ln['cantidad'])
        bultos = _a_float(ln.get('bultos'))

        # Conversión a la unidad de compra de Odoo. Sólo por BULTOS, nunca por
        # peso (regla de Alexis). Si falta un insumo, se retiene la línea.
        if unidad in UNIDADES_CONVERTIBLES:
            factor = mapas.rollos_por_bulto.get(codigo)
            if bultos is None:
                r.retenidas.append(_retenida(
                    guia, ln, f'unidad {unidad} y la descripción no declara BLTS'))
                continue
            if factor is None:
                r.retenidas.append(_retenida(
                    guia, ln, f'{codigo} sin fila en reyma_conversion_bulto '
                              '(pedirle la tablita a Alexis para este código)'))
                continue
            cantidad = bultos * factor
            nota_conv = (f' [{unidad} → {bultos:,.0f} BLTS × {factor:g} rollos/bulto '
                         f'= {cantidad:,.0f}]')
        else:
            cantidad = cantidad_cfdi
            nota_conv = ''

        try:
            fecha = fecha_iso(ln['fecha'])
        except DatoInvalido as e:
            r._error(f'{guia}: {e}')
            continue

        r.filas.append({
            'folio_fiscal': ln['folio_fiscal'],
            'factura': ln['factura'],
            'guia': guia,
            'destino': destino,
            'fecha': fecha,
            'codigo': codigo,
            'clave': ln['identificador'],
            'cantidad': cantidad,
            'cantidad_cfdi': cantidad_cfdi,
            'unidad': unidad,
            'bultos': bultos,
            'precio_unit': _a_float(ln['precio_unitario']),
            'eta': etas.get(prefijo) or None,
            'autor': (autor + nota_conv)[:AUTOR_MAX],
        })
    return r


def _retenida(guia: str, ln: dict, motivo: str) -> dict:
    """Una línea retenida, con lo suficiente para explicarla en pantalla."""
    return {
        'guia': guia,
        'identificador': ln['identificador'],
        'descripcion': (ln.get('descripcion') or '')[:200],
        'cantidad': _a_float(ln['cantidad']),
        'unidad': ln['unidad'],
        'importe': _a_float(ln.get('importe')),
        'motivo': motivo,
    }
