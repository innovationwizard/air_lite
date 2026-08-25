"""
Tests de las reglas de carga de las facturas REYMA (`reyma_factura_carga`).

Son la red que permite que exista UNA sola implementación de las reglas, usada
por la CLI (`scripts/load_reyma_facturas_pdf.py`) y por la página de carga de
Alexis (A12) a través de `POST /reyma/factura/preview`.

Dos niveles:

  * **Unitarios** (siempre corren) — cada regla contra líneas sintéticas,
    claramente rotuladas como tales. Cubren la frontera que más importa:
    RETENIDA (la factura se carga sin esa línea, y se anuncia) vs ERROR (no se
    carga nada).

  * **Regresión contra producción** (corre si están los datos) — reproduce desde
    los 26 PDFs reales las filas que hoy están en `reyma_facturas_pdf`. El
    fixture NO se generó con este código: se descargó de producción el
    2026-08-25, y esas filas se cargaron y verificaron una por una contra el
    total impreso de cada factura. Es el ancla no circular.

    **Ni los PDFs ni el fixture están en git**, y es a propósito: los PDFs viven
    en `docs/` y el fixture son datos reales del cliente (folios fiscales,
    cantidades, precios), que `.gitignore` prohíbe commitear — «Data files -
    NEVER COMMIT BUSINESS DATA». Así que en CI este bloque se SALTA, nunca falla
    en falso, y en la máquina de desarrollo corre de verdad.

    Para regenerar el fixture (requiere SUPABASE_URL y SUPABASE_SECRET_KEY):

        python -c "
        import os, json, csv, urllib.request
        cols = 'guia,folio_fiscal,factura,destino,fecha,codigo,clave,cantidad,\
        cantidad_cfdi,unidad,bultos,precio_unit,eta'.replace(' ', '')
        u = os.environ['SUPABASE_URL'].rstrip('/') + '/rest/v1/reyma_facturas_pdf?select=' + cols
        k = os.environ['SUPABASE_SECRET_KEY']
        r = urllib.request.Request(u)
        r.add_header('apikey', k); r.add_header('Authorization', 'Bearer ' + k)
        rows = json.loads(urllib.request.urlopen(r).read())
        campos = cols.split(',')
        with open('ml/tests/fixtures/reyma_facturas_pdf_produccion_2026-08-25.csv',
                  'w', newline='', encoding='utf-8') as fh:
            w = csv.DictWriter(fh, fieldnames=campos); w.writeheader()
            for x in sorted(rows, key=lambda r: (r['guia'], r['codigo'])):
                w.writerow({c: ('' if x[c] is None else x[c]) for c in campos})
        "

    ⚠️ Regenerarlo contra una producción que cambió NO es lo mismo que
    verificar: si se agregan facturas, hay que actualizar también el conteo
    esperado (174) y revisar que las nuevas entren por las mismas reglas.
"""
import csv
from pathlib import Path

import pytest

from reyma_factura_carga import (
    DESTINOS_VALIDOS,
    DatoInvalido,
    Mapas,
    destino_in_band,
    evaluar,
    fecha_iso,
    guia_de,
    prefijo_de,
)

# ─── Datos sintéticos (SOLO para pruebas) ────────────────────────────────────
# Claves y códigos reales del catálogo, para que los casos se lean como los
# documentos que representan; las CANTIDADES son inventadas salvo donde se
# indica que reproducen una factura.
MAPAS = Mapas(
    por_clave={
        'VT10XN': {'77201046'},
        'BPRCH811XN': {'77206362'},
        'AMBIGUAXN': {'77200001', '77200002'},
    },
    rollos_por_bulto={'77206362': 15.0},
)
AUTOR = 'prueba'


def _linea(**kw):
    """Una línea de detalle sintética con la forma que produce el extractor."""
    base = {
        'archivo': 'G-999-2026 (999999) 01-08-2026.pdf',
        'factura': 'F999999',
        'folio_fiscal': 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE',
        'fecha': '01/08/2026',
        'observ_destino': '',
        'linea': 1,
        'cantidad': 10.0,
        'unidad': 'X4G',
        'identificador': 'VT10XN',
        'descripcion': 'VASO TERMICO No. 10',
        'precio_unitario': 22.0,
        'importe': 220.0,
        'bultos': '',
    }
    base.update(kw)
    return base


def _evaluar(lineas, destino='bodega-san-jose', etas=None):
    return evaluar(lineas, {'G-999': destino}, etas or {}, AUTOR, MAPAS)


# ─── Helpers puros ───────────────────────────────────────────────────────────

class TestHelpers:
    def test_guia_y_prefijo_salen_del_nombre_del_archivo(self):
        assert guia_de('G-236-2026 (172784) 21-08-2026.pdf') == 'G-236-2026'
        assert prefijo_de('G-236-2026') == 'G-236'

    def test_un_nombre_sin_correlativo_no_se_adivina(self):
        with pytest.raises(DatoInvalido):
            guia_de('factura.pdf')

    def test_la_fecha_del_cfdi_se_normaliza_a_iso(self):
        assert fecha_iso('21/08/2026') == '2026-08-21'

    def test_una_fecha_con_otro_formato_no_se_interpreta(self):
        # Mejor detenerse que cargar una factura con la fecha equivocada: la
        # fecha es entrada del ETA calculado Y de la conciliación (las gemelas
        # de $14,652 sólo se separan por fecha).
        for mala in ('2026-08-21', '21-08-2026', '', None):
            with pytest.raises(DatoInvalido):
                fecha_iso(mala)

    def test_el_destino_in_band_se_lee_de_observaciones(self):
        assert destino_in_band('BODEGA ZACAPA') == 'bodega-zacapa'
        assert destino_in_band('BODEGA SAN JOSE') == 'bodega-san-jose'
        assert destino_in_band('BODEGA PETEN') == 'bodega-peten'
        assert destino_in_band('CLIENTE DIRECTO') == 'entrega-directa'

    def test_sin_destino_in_band_devuelve_none_y_no_adivina(self):
        # N2 se sostiene: 5 de las 7 facturas del 24-ago no lo declaran.
        assert destino_in_band('') is None
        assert destino_in_band(None) is None
        assert destino_in_band('TRAILER 53 PIES') is None


# ─── El camino feliz ─────────────────────────────────────────────────────────

class TestCargaNormal:
    def test_una_linea_x4g_entra_1_a_1(self):
        r = _evaluar([_linea()])
        assert r.errores == [] and r.retenidas == []
        (f,) = r.filas
        assert f['codigo'] == '77201046'
        assert f['cantidad'] == 10.0 and f['cantidad_cfdi'] == 10.0
        assert f['unidad'] == 'X4G' and f['bultos'] is None
        assert f['fecha'] == '2026-08-21'.replace('21', '01')  # 01/08/2026
        assert f['destino'] == 'bodega-san-jose'
        assert f['guia'] == 'G-999-2026'

    def test_xpk_tambien_va_1_a_1(self):
        # Q9 respondida por evidencia (§1e): XPK ≡ Fardo, no cambia la conversión.
        (f,) = _evaluar([_linea(unidad='XPK')]).filas
        assert f['cantidad'] == f['cantidad_cfdi'] == 10.0

    def test_la_eta_solo_entra_si_viene_declarada(self):
        assert _evaluar([_linea()]).filas[0]['eta'] is None          # precedente G-226
        assert _evaluar([_linea()], etas={'G-999': '2026-08-25'}).filas[0]['eta'] == '2026-08-25'

    def test_el_autor_lleva_la_procedencia_y_se_recorta_a_la_columna(self):
        r = evaluar([_linea()], {'G-999': 'bodega-san-jose'}, {}, 'x' * 600, MAPAS)
        assert len(r.filas[0]['autor']) == 500


# ─── Destino: la regla con consecuencia de dinero (N13) ──────────────────────

class TestDestino:
    def test_sin_destino_declarado_no_se_carga(self):
        # Nunca hay default silencioso: marcar Zacapa como San José hace que
        # esas cajas descuenten PO-P-3003 sin pertenecerle.
        r = evaluar([_linea()], {}, {}, AUTOR, MAPAS)
        assert r.filas == [] and 'sin destino declarado' in r.errores[0]

    def test_un_destino_fuera_del_catalogo_no_se_carga(self):
        r = _evaluar([_linea()], destino='bodega-inventada')
        assert r.filas == [] and 'destino inválido' in r.errores[0]

    def test_el_documento_manda_cuando_lo_dice(self):
        # N10: si Observaciones declara el destino y el humano declara otro,
        # se detiene. No se elige uno de los dos en silencio.
        r = _evaluar([_linea(observ_destino='BODEGA ZACAPA')], destino='bodega-san-jose')
        assert r.filas == []
        assert 'contradice' in r.errores[0] and 'bodega-zacapa' in r.errores[0]

    def test_una_condicion_de_factura_se_reporta_UNA_vez(self):
        # La contradicción de destino se detecta línea por línea, pero es una
        # condición de la FACTURA. Una de 9 líneas no debe gritar 9 veces lo
        # mismo: la pantalla lo diría nueve veces y el mensaje se pierde.
        nueve = [_linea(linea=i, observ_destino='BODEGA ZACAPA') for i in range(1, 10)]
        r = _evaluar(nueve, destino='bodega-san-jose')
        assert len(r.errores) == 1 and 'contradice' in r.errores[0]

    def test_coincidir_con_el_in_band_carga_normal(self):
        r = _evaluar([_linea(observ_destino='BODEGA SAN JOSE')], destino='bodega-san-jose')
        assert r.errores == [] and len(r.filas) == 1

    def test_sin_in_band_se_confia_en_lo_declarado(self):
        r = _evaluar([_linea(observ_destino='')], destino='bodega-peten')
        assert r.errores == [] and r.filas[0]['destino'] == 'bodega-peten'

    def test_los_cuatro_destinos_del_catalogo_son_cargables(self):
        for d in DESTINOS_VALIDOS:
            assert _evaluar([_linea()], destino=d).filas[0]['destino'] == d


# ─── KGM: la bolsa poliseda (N12) ────────────────────────────────────────────

class TestConversionKgm:
    def test_kgm_se_convierte_por_bultos_nunca_por_peso(self):
        # Caso real de G-231: BPRCH811XN, 2,012.50 KGM, 101 BLTS, ×15 = 1,515 ML.
        (f,) = _evaluar([_linea(
            identificador='BPRCH811XN', unidad='KGM',
            cantidad=2012.50, precio_unitario=1.86, importe=3743.25,
            descripcion='BOLSA POLISEDA EN ROLLO 8X11 101 BLTS',
            bultos=101.0,
        )]).filas
        assert f['cantidad'] == 1515.0        # lo comprable (ML de Odoo)
        assert f['cantidad_cfdi'] == 2012.50  # lo impreso, verbatim
        assert f['unidad'] == 'KGM' and f['bultos'] == 101.0
        assert '101 BLTS × 15 rollos/bulto' in f['autor']

    def test_kgm_sin_blts_se_RETIENE_no_se_estima(self):
        # Alexis: «no podemos poner como que un peso estándar porque… por
        # centavos no va a cuadrar la factura en cuanto a montos».
        r = _evaluar([_linea(identificador='BPRCH811XN', unidad='KGM', bultos='')])
        assert r.filas == [] and r.errores == []
        assert 'no declara BLTS' in r.retenidas[0]['motivo']

    def test_un_codigo_sin_tablita_se_RETIENE(self):
        mapas = Mapas(por_clave={'NUEVAXN': {'77299999'}}, rollos_por_bulto={})
        r = evaluar([_linea(identificador='NUEVAXN', unidad='KGM', bultos=50.0)],
                    {'G-999': 'bodega-san-jose'}, {}, AUTOR, mapas)
        assert r.filas == [] and r.errores == []
        assert 'reyma_conversion_bulto' in r.retenidas[0]['motivo']

    def test_una_unidad_desconocida_se_RETIENE(self):
        r = _evaluar([_linea(unidad='LTR')])
        assert r.filas == [] and r.errores == []
        assert 'sin equivalencia' in r.retenidas[0]['motivo']

    def test_lo_retenido_se_puede_anunciar_con_numeros(self):
        # La pantalla debe poder decir «3 líneas retenidas, $14,178.78» — nunca
        # dejar caer líneas en silencio (precedente G-231).
        r = _evaluar([_linea(unidad='LTR', cantidad=7.0, importe=1234.56)])
        (ret,) = r.retenidas
        assert ret['guia'] == 'G-999-2026' and ret['identificador'] == 'VT10XN'
        assert ret['cantidad'] == 7.0 and ret['importe'] == 1234.56
        assert ret['unidad'] == 'LTR' and ret['motivo']

    def test_lo_retenido_no_impide_cargar_el_resto_de_la_factura(self):
        r = _evaluar([_linea(linea=1), _linea(linea=2, unidad='LTR')])
        assert len(r.filas) == 1 and len(r.retenidas) == 1 and r.errores == []


# ─── Mapeo de claves: error, no retención ────────────────────────────────────

class TestMapeoDeClaves:
    def test_una_clave_sin_mapa_DETIENE_la_carga(self):
        # No se descarta la línea ni se le inventa código. Caso real: N9 /
        # CN9X9D4PXN en G-226, que hubo que cargar a mano con el centinela
        # `odoo:6037` porque el producto está fuera del alcance del modelo.
        r = _evaluar([_linea(identificador='DESCONOCIDAXN')])
        assert r.filas == [] and r.retenidas == []
        assert 'sin mapa en reyma_products.clave' in r.errores[0]

    def test_una_clave_ambigua_DETIENE_la_carga(self):
        r = _evaluar([_linea(identificador='AMBIGUAXN')])
        assert r.filas == []
        assert 'ambigua' in r.errores[0]
        assert '77200001' in r.errores[0] and '77200002' in r.errores[0]

    def test_una_clave_sin_mapa_invalida_la_factura_entera(self):
        # La diferencia con una retención: acá `filas` queda inutilizable
        # porque la factura no está completa. El llamador NO debe escribir.
        r = _evaluar([_linea(linea=1), _linea(linea=2, identificador='DESCONOCIDAXN')])
        assert r.errores and not r.cargable


# ─── Regresión contra producción ─────────────────────────────────────────────

_RAIZ = Path(__file__).resolve().parents[2]
_PDFS = _RAIZ / 'docs' / 'docs-alexis'
_FIXTURE = Path(__file__).parent / 'fixtures' / 'reyma_facturas_pdf_produccion_2026-08-25.csv'

# N9 — el único código que no sale del catálogo: `CN9X9D4PXN` (CONTENEDOR
# TERMICO 9X9 DIVISION) no tiene clave en `reyma_products` y se cargó a mano
# con el centinela `odoo:6037`. Las reglas lo rechazan a propósito (una clave
# sin mapa detiene la carga), así que la reproducción automática lo excluye.
_CARGADA_A_MANO = {('G-226-2026', 'CN9X9D4PXN')}


_HAY_DATOS = _PDFS.is_dir() and _FIXTURE.is_file()
_SIN_DATOS = 'los PDFs y el fixture viven fuera de git (datos del cliente)'


@pytest.mark.skipif(not _HAY_DATOS, reason=_SIN_DATOS)
def test_reproduce_exacto_lo_que_hay_en_produccion():
    from reyma_factura_extract import extraer
    from reyma_factura_carga import lineas_de_factura

    esperado = {}
    with _FIXTURE.open(encoding='utf-8') as fh:
        for row in csv.DictReader(fh):
            if (row['guia'], row['clave']) in _CARGADA_A_MANO:
                continue
            esperado[(row['folio_fiscal'], row['codigo'])] = row
    assert len(esperado) == 174, 'el fixture de producción cambió de tamaño'

    # Los catálogos, derivados del propio fixture: cada clave cargada mapea al
    # código con que se cargó. Es exactamente lo que `reyma_products` contenía
    # cuando esas filas entraron.
    por_clave, rollos = {}, {}
    for row in esperado.values():
        por_clave.setdefault(row['clave'], set()).add(row['codigo'])
        if row['unidad'] == 'KGM':
            rollos[row['codigo']] = float(row['cantidad']) / float(row['bultos'])

    # destino y ETA son dato declarado por un humano, no del PDF: entran como
    # entran en la vida real (los declara quien carga).
    destinos = {r['guia'].rsplit('-', 1)[0]: r['destino'] for r in esperado.values()}
    etas = {r['guia'].rsplit('-', 1)[0]: (r['eta'] or None) for r in esperado.values()}

    lineas, flags = [], []
    pdfs = sorted(_PDFS.rglob('G-*.pdf'))
    assert len(pdfs) == 26, f'se esperaban 26 PDFs, hay {len(pdfs)}'
    for p in pdfs:
        cab = extraer(p)
        flags += cab['flags']
        lineas += lineas_de_factura(cab)
    assert flags == [], f'la extracción levantó flags: {flags[:3]}'

    r = evaluar(lineas, destinos, etas, 'regresión',
                Mapas(por_clave=por_clave, rollos_por_bulto=rollos))

    # El ÚNICO error esperado es N9, y se pinea por nombre en vez de
    # silenciarse: `CN9X9D4PXN` está fuera del alcance del modelo y no tiene
    # clave, así que las reglas lo rechazan — correctamente. Si algún día se le
    # da entrada al catálogo, esta prueba se cae y obliga a decidirlo aquí en
    # vez de descubrirlo en producción. Cualquier OTRO error es una regresión.
    assert r.errores == ['G-226-2026 CN9X9D4PXN: sin mapa en reyma_products.clave'], r.errores
    assert r.retenidas == [], r.retenidas[:3]

    producido = {(f['folio_fiscal'], f['codigo']): f for f in r.filas}
    assert set(producido) == set(esperado), 'el conjunto de filas no coincide'

    for k, exp in esperado.items():
        got = producido[k]
        assert got['clave'] == exp['clave']
        assert got['guia'] == exp['guia']
        assert got['factura'] == exp['factura']
        assert got['fecha'] == exp['fecha']
        assert got['destino'] == exp['destino']
        assert got['unidad'] == exp['unidad']
        assert got['eta'] == (exp['eta'] or None)
        assert abs(got['cantidad'] - float(exp['cantidad'])) < 1e-6
        assert abs(got['cantidad_cfdi'] - float(exp['cantidad_cfdi'])) < 1e-6
        assert abs(got['precio_unit'] - float(exp['precio_unit'])) < 1e-6
        if exp['bultos']:
            assert abs(got['bultos'] - float(exp['bultos'])) < 1e-6
        else:
            assert got['bultos'] is None


@pytest.mark.skipif(not _PDFS.is_dir(), reason=_SIN_DATOS)
def test_las_26_facturas_cuadran_contra_su_total_impreso():
    """La única señal de confianza que la página necesita mostrar."""
    from reyma_factura_extract import extraer
    for p in sorted(_PDFS.rglob('G-*.pdf')):
        cab = extraer(p)
        assert cab['flags'] == [], f'{p.name}: {cab["flags"]}'
        assert abs(cab['suma_importes'] - float(cab['total'].replace(',', ''))) < 0.01
