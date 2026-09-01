"""
Mapeo por significado del libro de punto de reorden — A4.27.

LO QUE ESTAS PRUEBAS PROTEGEN. Un mapeo equivocado no explota: escribe números
plausibles en el campo de al lado. Si «Zacapa» se lee como «Petén», el modelo
sigue calculando, el semáforo sigue pintando y el pedido sale mal sin que nada
avise. Por eso el mapeo se prueba con los encabezados REALES del archivo —
saltos de línea incluidos— y no con versiones limpias que nadie va a mandar.
"""
from datetime import date

from modelo_reorden_carga import (
    a_numero, es_calculada, mapear_encabezados, normalizar, normalizar_estado,
    parsear_fecha_encabezado, parsear_proforma,
)

# Encabezados TAL COMO están en el archivo del 2026-08-20, con sus saltos de
# línea internos. Si alguien los "limpia" para que la prueba se lea mejor, la
# prueba deja de probar lo único que importa.
GRUPOS_REALES = [
    'REFERENCIA', None, None, None, None, None, None,
    'INVENTARIO ACTUAL (fardos)', None, None, None, None, None, None, None,
    'TRANSITO CONFIRMADO (ML)', None, None, None,
    'TRANSITO PENDIENTE (ML)',
    'INVENTARIO NETO + TRANSITO (ML)', None, None, None, None,
    'VENTA PROY prom Jul-Sep 26', None,
]
COLUMNAS_REALES = [
    'N', 'Cod\nPlasticentro', 'Cod\nProveedor', 'Descripcion', 'UM',
    'Und/\nFardo\nund', 'Cub.\nMillar\nm3/ML',
    'San Jose\nfardos', 'Zona 11\nfardos', 'Zacapa\nfardos', 'Peten\nfardos',
    'Patios\nSJ\nfardos', 'Pend\nSurtir SJ\nfardos', 'Pend\nSurtir Pet\nfardos',
    'Pend\nSurtir Zac\nfardos',
    '18/Ago\nML', '26/Jun\nML', '03/Jul\nML', '10/Jul\nML',
    'Trans\nPend\nML',
    'Inv.Neto\nfardos', 'Inv.Neto\nMILLARES', 'Trans\nConf.\nML',
    'Trans\nPend.\nML', 'Inv.Total\n(N+TC+TP)\nML',
    'Vta.Proy\nMensual\nML/mes', 'Vta.Proy\nSemanal\nML/sem',
]


class TestNormalizar:
    def test_quita_saltos_de_linea_internos(self):
        # El caso que rompe cualquier comparacion literal.
        assert normalizar('Cod\nPlasticentro') == 'cod plasticentro'
        assert normalizar('Cub.\nMillar\nm3/ML') == 'cub millar m3 ml'

    def test_quita_acentos_y_baja_a_minusculas(self):
        assert normalizar('PETÉN') == normalizar('peten') == 'peten'
        assert normalizar('Descripción') == 'descripcion'

    def test_la_puntuacion_no_distingue(self):
        assert normalizar('Und/Fardo') == normalizar('Und Fardo') == 'und fardo'

    def test_vacio_y_none_dan_cadena_vacia(self):
        assert normalizar(None) == '' and normalizar('   \n ') == ''


class TestMapeo:
    def setup_method(self):
        self.mapa, self.transito, self.sin_casar, self.faltantes = mapear_encabezados(
            GRUPOS_REALES, COLUMNAS_REALES)

    def test_casa_los_campos_del_archivo_real(self):
        assert self.mapa['codigo'] == 1
        assert self.mapa['und_fardo'] == 5
        assert self.mapa['cub_millar'] == 6
        assert self.mapa['sj'] == 7
        assert self.mapa['zacapa'] == 9
        assert self.mapa['peten'] == 10
        assert self.mapa['venta_proy_mensual'] == 25

    def test_no_confunde_bodegas_entre_si(self):
        # El error mas caro posible y el mas silencioso.
        assert len({self.mapa['sj'], self.mapa['z11'],
                    self.mapa['zacapa'], self.mapa['peten']}) == 4

    def test_distingue_los_tres_pendientes_por_surtir(self):
        assert self.mapa['pend_surtir_sj'] == 12
        assert self.mapa['pend_surtir_peten'] == 13
        assert self.mapa['pend_surtir_zacapa'] == 14

    def test_no_faltan_obligatorios(self):
        assert self.faltantes == []

    def test_el_transito_confirmado_se_detecta_por_GRUPO_no_por_posicion(self):
        # Son cuatro columnas fechadas hoy; el proveedor agrega una por embarque.
        assert [i for i, _e, _f in self.transito] == [15, 16, 17, 18]

    def test_le_lee_la_fecha_a_cada_embarque(self):
        # El anio se pasa EXPLICITO: los encabezados traen dia y mes nada mas.
        _m, transito, _sc, _f = mapear_encabezados(
            GRUPOS_REALES, COLUMNAS_REALES, anio=2026)
        assert [f for _i, _e, f in transito] == [
            date(2026, 8, 18), date(2026, 6, 26), date(2026, 7, 3), date(2026, 7, 10),
        ]

    def test_conserva_la_etiqueta_cruda_del_embarque(self):
        # La fecha lleva un anio supuesto; la etiqueta original es la prueba de
        # que la suposicion se puede auditar despues.
        assert [e for _i, e, _f in self.transito][0] == '18/Ago\nML'


class TestTransitoDinamico:
    def test_una_columna_nueva_de_embarque_entra_sola(self):
        # LA prueba del enfoque: agregar un embarque NO deberia requerir tocar
        # el codigo. Con indices fijos, esto habria roto todo el mapeo.
        grupos = GRUPOS_REALES[:19] + ['TRANSITO CONFIRMADO (ML)'] + GRUPOS_REALES[19:]
        cols = COLUMNAS_REALES[:19] + ['05/Sep\nML'] + COLUMNAS_REALES[19:]
        mapa, transito, _sc, faltantes = mapear_encabezados(grupos, cols)
        assert faltantes == []
        assert len(transito) == 5
        # y los campos fijos siguieron a su columna, corrida en uno
        assert mapa['transito_pendiente'] == 20
        assert mapa['venta_proy_mensual'] == 26

    def test_un_encabezado_renombrado_sigue_casando(self):
        grupos = ['REFERENCIA', None, 'INVENTARIO ACTUAL (fardos)', None]
        cols = ['Codigo Plasticentro', 'Und x Fardo', 'SJ', 'Vta Proy Mensual']
        mapa, _t, _sc, faltantes = mapear_encabezados(grupos, cols)
        assert faltantes == []
        assert mapa['codigo'] == 0 and mapa['sj'] == 2

    def test_una_columna_desconocida_se_reporta_y_no_se_adivina(self):
        grupos = ['REFERENCIA', None, None, None]
        cols = ['Cod Plasticentro', 'Und/Fardo', 'San Jose', 'COLUMNA RARA NUEVA']
        _m, _t, sin_casar, _f = mapear_encabezados(grupos, cols)
        assert [c for _i, c in sin_casar] == ['COLUMNA RARA NUEVA']

    def test_si_falta_un_obligatorio_lo_dice(self):
        # La carga se detiene con esto; escribir el modelo a medias es peor.
        _m, _t, _sc, faltantes = mapear_encabezados(['REFERENCIA'], ['Descripcion'])
        assert 'codigo' in faltantes and 'und_fardo' in faltantes


class TestFechasYProformas:
    def test_lee_dia_mes_en_letras_con_anio_explicito(self):
        assert parsear_fecha_encabezado('18/Ago\nML', anio=2026) == date(2026, 8, 18)
        assert parsear_fecha_encabezado('26/Jun\nML', anio=2026) == date(2026, 6, 26)

    def test_lee_la_fecha_completa_cuando_el_encabezado_la_trae(self):
        assert parsear_fecha_encabezado("PRECIO JUL'26 (23/07/2026) DNV0013333") == date(2026, 7, 23)

    def test_una_fecha_imposible_no_revienta_ni_se_inventa(self):
        assert parsear_fecha_encabezado('31/Feb', anio=2026) is None
        assert parsear_fecha_encabezado('sin fecha') is None
        assert parsear_fecha_encabezado(None) is None

    def test_saca_la_proforma_de_adentro_del_encabezado(self):
        assert parsear_proforma("PRECIO JUL'26 (23/07/2026) DNV0013333") == 'DNV0013333'
        assert parsear_proforma("PRECIO JUN'26 (05/06/2026) DNV0012848") == 'DNV0012848'
        assert parsear_proforma('VAR. vs ANTERIOR (%)') is None


class TestValores:
    def test_ND_y_guiones_son_AUSENCIA_no_cero(self):
        # Un precio ausente valorizado en 0 desaparece del total sin avisar.
        assert a_numero('N/D') is None
        assert a_numero('—') is None
        assert a_numero('') is None
        assert a_numero('#REF!') is None

    def test_numeros_con_separador_de_miles(self):
        assert a_numero('1,724') == 1724.0
        assert a_numero(196.0257) == 196.0257

    def test_cero_es_cero_y_no_ausencia(self):
        assert a_numero(0) == 0.0
        assert a_numero('0') == 0.0


class TestEstadoProducto:
    def test_reconoce_los_tres_estados_del_libro(self):
        assert normalizar_estado('LIQUIDACION') == 'LIQUIDACION'
        assert normalizar_estado('Liquidación') == 'LIQUIDACION'
        assert normalizar_estado('SIN MOV.') == 'SIN MOV.'
        assert normalizar_estado('ACTIVO') == 'ACTIVO'

    def test_lo_desconocido_cae_en_activo(self):
        assert normalizar_estado(None) == 'ACTIVO'
        assert normalizar_estado('cualquier cosa') == 'ACTIVO'


class TestColumnasCalculadas:
    """Lo que el libro calcula no se carga: se recalcula. Pero hay que poder
    distinguirlo de una columna genuinamente nueva, que es la senal que importa."""

    def test_el_archivo_real_no_deja_NINGUNA_columna_desconocida(self):
        # 44 columnas: 17 campos + 4 embarques + 23 calculadas = 0 sorpresas.
        _m, _t, sin_casar, _f = mapear_encabezados(GRUPOS_REALES, COLUMNAS_REALES)
        assert [c for _i, c in sin_casar] == []

    def test_las_calculadas_no_se_confunden_con_insumos(self):
        assert es_calculada('cob total sem')
        assert es_calculada('pedir optimo ml')
        assert es_calculada('estado')
        assert not es_calculada('san jose fardos')
        assert not es_calculada('vta proy mensual ml mes')

    def test_las_columnas_de_pedido_se_reconocen_por_su_prefijo(self):
        # 'AJO-11 DNV0013235 09/Jul/2026' -> historia de pedidos, no insumo.
        assert es_calculada('ajo 11 dnv0013235 09 jul 2026')
        assert es_calculada('ajo 12 dnv0013333 23 jul 2026')

    def test_una_columna_nueva_de_verdad_SI_se_reporta(self):
        # Lo unico que deberia llegar al reporte de carga.
        cols = list(COLUMNAS_REALES) + ['DESCUENTO POR VOLUMEN']
        grupos = list(GRUPOS_REALES) + [None]
        _m, _t, sin_casar, _f = mapear_encabezados(grupos, cols)
        assert [c for _i, c in sin_casar] == ['DESCUENTO POR VOLUMEN']
