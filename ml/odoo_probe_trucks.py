#!/usr/bin/env python3
"""
Quick probe: check how populated the truck/loading fields are on stock.picking.
Specifically targets outgoing delivery orders where loading data would live.
"""

import json
import os
import xmlrpc.client

ODOO_URL = os.environ.get('ODOO_URL', '')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')

common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)

def call(method, model, *args, **kwargs):
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, list(args), kwargs)

TRUCK_FIELDS = [
    'name', 'state', 'picking_type_code', 'scheduled_date', 'date_done',
    'partner_id', 'origin', 'weight', 'shipping_weight', 'amount_volume',
    'carrier_id', 'x_studio_vehculo', 'x_studio_camin',
    'x_studio_ruta_departamentales', 'x_studio_zona',
    'x_studio_placa', 'x_studio_bultos',
    'x_studio_inicio_carga', 'x_studio_terminacin_carga',
    'x_studio_fecha_y_hora_entrante', 'x_studio_fecha_y_hora_salida_dulgon',
    'x_studio_picker', 'x_studio_picker_oficial',
    'x_studio_auxiliares_de_carga', 'x_studio_verificador',
    'x_studio_municipio', 'x_studio_vendedor',
    'x_studio_orden', 'x_studio_total', 'x_studio_subtotal',
    'demand_quantity', 'done_quantity',
]

print("=== 1. Count outgoing deliveries with populated truck fields ===")
total_outgoing = call('search_count', 'stock.picking', [('picking_type_code', '=', 'outgoing')])
print(f"Total outgoing pickings: {total_outgoing}")

checks = {
    'x_studio_vehculo (Vehículo)': [('picking_type_code', '=', 'outgoing'), ('x_studio_vehculo', '!=', False)],
    'x_studio_camin (Camión)': [('picking_type_code', '=', 'outgoing'), ('x_studio_camin', '!=', False)],
    'x_studio_placa (Placa)': [('picking_type_code', '=', 'outgoing'), ('x_studio_placa', '!=', False)],
    'x_studio_ruta (Ruta)': [('picking_type_code', '=', 'outgoing'), ('x_studio_ruta_departamentales', '!=', False)],
    'x_studio_zona (Zona)': [('picking_type_code', '=', 'outgoing'), ('x_studio_zona', '!=', False), ('x_studio_zona', '!=', '0')],
    'x_studio_inicio_carga': [('picking_type_code', '=', 'outgoing'), ('x_studio_inicio_carga', '!=', False)],
    'x_studio_terminacin_carga': [('picking_type_code', '=', 'outgoing'), ('x_studio_terminacin_carga', '!=', False)],
    'x_studio_bultos (Bultos)': [('picking_type_code', '=', 'outgoing'), ('x_studio_bultos', '>', 0)],
    'weight > 0': [('picking_type_code', '=', 'outgoing'), ('weight', '>', 0)],
    'amount_volume > 0': [('picking_type_code', '=', 'outgoing'), ('amount_volume', '>', 0)],
    'x_studio_municipio': [('picking_type_code', '=', 'outgoing'), ('x_studio_municipio', '!=', False)],
    'x_studio_fecha_y_hora_salida_dulgon': [('picking_type_code', '=', 'outgoing'), ('x_studio_fecha_y_hora_salida_dulgon', '!=', False)],
}

for label, domain in checks.items():
    try:
        count = call('search_count', 'stock.picking', domain)
        pct = (count / total_outgoing * 100) if total_outgoing else 0
        print(f"  {label}: {count} ({pct:.1f}%)")
    except Exception as e:
        print(f"  {label}: ERROR - {str(e)[:100]}")

print("\n=== 2. Sample outgoing deliveries WITH vehicle/truck data ===")
try:
    samples = call('search_read', 'stock.picking',
                   [('picking_type_code', '=', 'outgoing'), ('x_studio_vehculo', '!=', False)],
                   fields=TRUCK_FIELDS, limit=5, order='date_done desc')
    for s in samples:
        print(json.dumps(s, indent=2, default=str))
        print("---")
except Exception as e:
    print(f"ERROR: {e}")

# If no vehiculo, try camin
if not samples:
    print("\n=== 2b. Sample with x_studio_camin instead ===")
    try:
        samples = call('search_read', 'stock.picking',
                       [('picking_type_code', '=', 'outgoing'), ('x_studio_camin', '!=', False)],
                       fields=TRUCK_FIELDS, limit=5, order='date_done desc')
        for s in samples:
            print(json.dumps(s, indent=2, default=str))
            print("---")
    except Exception as e:
        print(f"ERROR: {e}")

print("\n=== 3. Get selection values for Ruta and Zona ===")
try:
    fields_info = call('fields_get', 'stock.picking',
                       ['x_studio_ruta_departamentales', 'x_studio_zona'],
                       attributes=['string', 'type', 'selection'])
    for fname, finfo in fields_info.items():
        print(f"\n{fname} ({finfo.get('string')}):")
        if finfo.get('selection'):
            for val, label in finfo['selection']:
                print(f"  {val} = {label}")
except Exception as e:
    print(f"ERROR: {e}")

print("\n=== 4. Check what x_studio_vehculo and x_studio_camin link to ===")
try:
    fields_info = call('fields_get', 'stock.picking',
                       ['x_studio_vehculo', 'x_studio_camin'],
                       attributes=['string', 'type', 'relation'])
    for fname, finfo in fields_info.items():
        print(f"{fname}: type={finfo.get('type')}, relation={finfo.get('relation')}, string={finfo.get('string')}")
        # If it's a many2one, try to read the related model
        if finfo.get('relation'):
            try:
                rel_count = call('search_count', finfo['relation'], [])
                rel_samples = call('search_read', finfo['relation'], [], limit=10)
                print(f"  -> {finfo['relation']}: {rel_count} records")
                for r in rel_samples:
                    print(f"     {json.dumps(r, default=str)[:200]}")
            except Exception as e2:
                print(f"  -> Cannot read {finfo['relation']}: {str(e2)[:100]}")
except Exception as e:
    print(f"ERROR: {e}")

print("\n=== 5. Product packaging details (all 9 records) ===")
try:
    pkgs = call('search_read', 'product.packaging', [])
    for p in pkgs:
        print(json.dumps(p, indent=2, default=str))
        print("---")
except Exception as e:
    print(f"ERROR: {e}")
