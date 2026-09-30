"""Patio is the Central yard, and only San José and General show it.

Wilmer, 2026-09-29: Zacapa and Petén were still displaying 1CET/Entrada.
On 77205001 that 1,240 was PO-P-3077 sitting in San José's yard, a different
furgón from Zacapa's own purchase order. Those two bodegas store patio 0.
"""
from odoo_sync_reabastecimiento import patio_ids_for

YARD = [976]


def test_san_jose_and_general_keep_the_yard():
    assert patio_ids_for('San Jose VN', YARD) == YARD
    assert patio_ids_for('General', YARD) == YARD


def test_zacapa_and_peten_store_no_patio():
    assert patio_ids_for('Zacapa', YARD) == []
    assert patio_ids_for('Petén', YARD) == []


def test_an_unknown_bodega_does_not_inherit_the_yard():
    assert patio_ids_for('Zona 11', YARD) == []


def test_returns_a_copy_so_callers_cannot_mutate_the_shared_ids():
    ids = patio_ids_for('San Jose VN', YARD)
    ids.append(1)
    assert patio_ids_for('San Jose VN', YARD) == YARD
