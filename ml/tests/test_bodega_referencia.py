"""CD Zona 11 is a reference warehouse, not a purchasing tab."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from odoo_sync_reabastecimiento import split_bodega_map  # noqa: E402


def test_zona_11_sale_de_compras_aunque_este_en_alcance():
    rows = [
        {'odoo_warehouse_code': '1CET', 'bodega': 'San Jose VN', 'in_scope': True},
        {'odoo_warehouse_code': '4ZAC', 'bodega': 'Zacapa', 'in_scope': True},
        {'odoo_warehouse_code': '3PET', 'bodega': 'Petén', 'in_scope': True},
        {'odoo_warehouse_code': '2Z11', 'bodega': 'Zona 11', 'in_scope': True},
        {'odoo_warehouse_code': '5DEP', 'bodega': 'Reempaque', 'in_scope': False},
    ]
    purchasing, referencia = split_bodega_map(rows)
    assert purchasing == {
        'San Jose VN': ['1CET'],
        'Zacapa': ['4ZAC'],
        'Petén': ['3PET'],
    }
    assert referencia == {'Zona 11': ['2Z11']}
    assert 'Reempaque' not in purchasing
    assert 'Reempaque' not in referencia


def test_zona_11_fuera_de_alcance_sigue_siendo_referencia():
    rows = [
        {'odoo_warehouse_code': '2Z11', 'bodega': 'Zona 11', 'in_scope': False},
        {'odoo_warehouse_code': '1CET', 'bodega': 'San Jose VN', 'in_scope': True},
    ]
    purchasing, referencia = split_bodega_map(rows)
    assert list(purchasing) == ['San Jose VN']
    assert referencia == {'Zona 11': ['2Z11']}
