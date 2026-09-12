"""
Propuesta de SKU para un identificador REYMA nuevo — la inferencia, sin Odoo.

Los nombres son REALES: nombres Odoo y `supplierinfo.product_name` de REYMA
tal como estaban en producción el 2026-09-12. Los dos primeros casos son los
dos incidentes que motivaron el módulo: F173634 (CH2PRXN, 2026-09-01) y el
precedente de agosto (CN9X9D4PXN / G-226, cargado a mano con centinela).
"""

from reyma_identificador_propuesta import (
    Candidato, empaque_de, familia_de, proponer, tallas_de,
)


def _catalogo_reyma():
    """Un recorte del catálogo REYMA en Odoo: los que se parecen al caso y
    varios distractores. `nombre_reyma` = supplierinfo.product_name real."""
    return [
        Candidato('77201001', 'BANDEJA TERMICA NO.2P BLANCA 1/500', None, 'FARDO500', 0.07862),
        Candidato('77201029', 'Bandeja Térmica N4 Duroport ¨1/300 Reyma', 'CHAROLA TERMICA  4P', 'Fardo', 0.1872),
        Candidato('77201052', 'Bandeja Térmica N8H Duroport ¨1/400 Reyma', 'BANDEJA TERMICA BLANCA 8H', 'Fardo', 0.2),
        Candidato('77201022', 'Bandeja Blanca N105 Duroport ¨¨1/500 Reyma', 'CHAROLA TERMICA  105', 'Fardo', 0.1),
        Candidato('77201018', 'Bandeja Termoformada N855 Duroport ¨10/50 Reyma', 'CHAROLA TERMICA MARIEL 855', 'Caja', 0.1),
        Candidato('77201025', 'Portacomida Blanco 9x9 C/D Duroport ¨1/200 Reyma', 'CONTENEDOR TERMICO 9X9-D', 'Fardo', 0.3),
        Candidato('77201024', 'Portacomida Blanco 9x9 Liso Duroport ¨1/200 Reyma', 'CONTENEDOR TERMICO 9X9 L', 'Fardo', 0.3),
        Candidato('77201030', 'Portacomida Blanco 8x8 C/D Duroport ¨1/200 Reyma', 'CONTENEDOR TERMICO 8X8-D', 'Fardo', 0.25),
        Candidato('77201000', 'Vaso Blanco 8oz Duroport ¨40/25 Reyma', 'VASO TERMICO NO 8 REYMA 40 PAQ / 25 PZAS MARCA:REYMA', 'Caja', 0.1),
        Candidato('77201064', 'Vaso 0 16oz Duroport ¨25/20 Reyma', 'VASO TERMICO NO 16 REYMA 25 PAQ / 20 PZAS MARCA:REYMA', 'Caja', 0.1),
        Candidato('77201033', 'Tapa Plástico 16oz Plástico ¨20/50 Reyma', 'TAPA RANURADA P/VASO POLIPRO NO 16 REYMA 20 PAQ/50 PZAS', 'Caja', 0.05),
        Candidato('77201045', 'Cuchara Sopera N1 Plástico ¨40/25 Reyma', 'CUCHARA SOPERA No. 1 VAMSA', 'Caja', 0.05),
    ]


class TestParsersDeDescripcion:
    def test_empaque_reyma_y_odoo_se_leen_igual(self):
        assert empaque_de('CHAROLA TERMICA 2P REYMA 1 PAQ/500 PZAS') == (1, 500)
        assert empaque_de('BANDEJA TERMICA NO.2P BLANCA 1/500') == (1, 500)
        assert empaque_de('VASO TERMICO NO 8 REYMA 40 PAQ / 25 PZAS MARCA:REYMA') == (40, 25)
        assert empaque_de('Vaso Blanco 8oz Duroport ¨40/25 Reyma') == (40, 25)
        assert empaque_de('CUCHARA BLANCA SOPERA REYMA 20X25') == (20, 25)
        assert empaque_de('POPOTE ... NATURAL 22 CM REYMA 4 CAJAS/500') == (4, 500)

    def test_nueve_por_nueve_es_talla_no_empaque(self):
        assert empaque_de('CONTENEDOR TERMICO 9X9-D') is None
        assert '9X9' in tallas_de('CONTENEDOR TERMICO 9X9-D')
        assert '9X9' in tallas_de('Portacomida Blanco 9x9 C/D Duroport ¨1/200 Reyma')

    def test_tallas(self):
        assert '2P' in tallas_de('CHAROLA TERMICA 2P REYMA 1 PAQ/500 PZAS')
        assert '2P' in tallas_de('BANDEJA TERMICA NO.2P BLANCA 1/500')
        assert '16OZ' in tallas_de('Vaso 0 16oz Duroport ¨25/20 Reyma')
        assert 'N16' in tallas_de('VASO TERMICO NO 16 REYMA 25 PAQ / 20 PZAS')
        assert 'N105' in tallas_de('CHAROLA TERMICA  105')
        assert 'N105' in tallas_de('Bandeja Blanca N105 Duroport ¨¨1/500 Reyma')

    def test_familia_con_sinonimos(self):
        assert familia_de('CHAROLA TERMICA 2P') == familia_de('BANDEJA TERMICA NO.2P')
        assert familia_de('CONTENEDOR TERMICO 9X9-D') == familia_de('Portacomida Blanco 9x9')
        assert familia_de('POPOTE EN CAJA') == familia_de('Pajilla Forrada')
        assert familia_de('CHAROLA TERMICA') != familia_de('Vaso Blanco 8oz')


class TestIncidentesReales:
    def test_F173634_CH2PRXN_propone_77201001(self):
        # El incidente del 2026-09-01: sin nombre REYMA en Odoo, sin OC en la
        # señal (se prueba aparte). Sólo estructura: talla 2P + empaque 1/500
        # + tipo (CHAROLA≡BANDEJA) tiene que bastar para PROPONER, y ninguna
        # otra bandeja del catálogo debe acercarse.
        r = proponer('CHAROLA TERMICA 2P REYMA 1 PAQ/500 PZAS', 1414, _catalogo_reyma())
        assert r['propuesta'] is not None
        assert r['propuesta'].sku == '77201001'
        assert any('Misma talla: 2P' in e for e in r['propuesta'].evidencia)
        assert any('Mismo empaque: 1/500' in e for e in r['propuesta'].evidencia)
        # N105 también es 1/500 y también es bandeja — la talla la descarta.
        n105 = next(c for c in r['otras'] if c.sku == '77201022')
        assert n105.puntaje < r['propuesta'].puntaje - 15

    def test_F173634_con_la_orden_de_compra_es_mas_fuerte(self):
        cat = _catalogo_reyma()
        el = next(c for c in cat if c.sku == '77201001')
        el.oc, el.oc_fecha, el.oc_cantidad, el.oc_uom = 'PO-P-3025', '2026-08-25', 1414.0, 'FARDO500'
        r = proponer('CHAROLA TERMICA 2P REYMA 1 PAQ/500 PZAS', 1414, cat)
        assert r['propuesta'].sku == '77201001'
        assert any('PO-P-3025' in e for e in r['propuesta'].evidencia)
        assert any('misma de esa orden' in e for e in r['propuesta'].evidencia)

    def test_precedente_agosto_CN9X9D4PXN_propone_77201025(self):
        # G-226 (2026-08-13). REYMA ya le había puesto nombre al producto en
        # Odoo: supplierinfo 7928 = "CONTENEDOR TERMICO 9X9-D". El 9X9 LISO
        # (77201024) es el distractor: misma familia, misma talla, mismo
        # empaque — sólo el nombre REYMA y la 'D' los separan.
        r = proponer('CONTENEDOR TERMICO 9X9-D REYMA 1 PAQ/200 PZAS', 150, _catalogo_reyma())
        assert r['propuesta'] is not None
        assert r['propuesta'].sku == '77201025'
        assert any('REYMA le llama' in e for e in r['propuesta'].evidencia)


class TestNoSeProponeSinSeparacion:
    def test_dos_candidatos_iguales_no_producen_propuesta(self):
        # Dos SKUs con exactamente las mismas señales: la app NO elige por
        # Alexis — pregunta «¿Cuál es el SKU correcto?» con ambos como sugerencia.
        cat = [
            Candidato('A', 'Bandeja Térmica N4 Duroport ¨1/300 Reyma'),
            Candidato('B', 'Bandeja Térmica N4 Duroport ¨1/300 Reyma'),
        ]
        r = proponer('CHAROLA TERMICA 4P REYMA 1 PAQ/300 PZAS', None, cat)
        assert r['propuesta'] is None
        assert {c.sku for c in r['otras']} == {'A', 'B'}

    def test_sin_candidatos_positivos_no_hay_nada(self):
        r = proponer('BOLSA POLISEDA 30X40', None, _catalogo_reyma())
        assert r['propuesta'] is None
        assert r['otras'] == []

    def test_empaque_distinto_castiga(self):
        cat = [Candidato('77201029', 'Bandeja Térmica N4 Duroport ¨1/300 Reyma', 'CHAROLA TERMICA  4P')]
        r = proponer('CHAROLA TERMICA 4P REYMA 1 PAQ/500 PZAS', None, cat)
        c = r['propuesta'] or r['otras'][0]
        assert any('empaque no coincide' in e for e in c.en_contra)

    def test_sku_ya_mapeado_a_otro_identificador_pesa_en_contra(self):
        cat = [Candidato('77201001', 'BANDEJA TERMICA NO.2P BLANCA 1/500', ya_mapeado_a='CH2PRXN')]
        r = proponer('CHAROLA TERMICA 2P REYMA 1 PAQ/500 PZAS', None, cat)
        c = r['propuesta'] or r['otras'][0]
        assert any('ya está asignado al identificador CH2PRXN' in e for e in c.en_contra)
