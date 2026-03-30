#!/usr/bin/env python3
"""
Odoo Database Explorer — Phase 1 & 2
Discovers accessible models, permissions, record counts, and logistics data.

Usage:
    python ml/odoo_explorer.py                # Phase 1: full discovery
    python ml/odoo_explorer.py --deep-dive    # Phase 2: logistics deep dive

Environment variables required:
    ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY
"""

import argparse
import json
import logging
import os
import sys
import xmlrpc.client
from datetime import datetime

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ODOO_URL = os.environ.get('ODOO_URL', '')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')

# Models from the original Solicitud de Conexión
SOLICITUD_MODELS = [
    'product.product', 'product.category',
    'sale.order', 'sale.order.line',
    'purchase.order', 'purchase.order.line',
    'stock.quant', 'stock.move', 'stock.picking',
    'res.partner', 'product.supplierinfo',
    'stock.warehouse', 'stock.location',
    'account.move', 'account.move.line',
]

# Logistics-adjacent models to probe (may or may not exist)
LOGISTICS_PROBE_MODELS = [
    'stock.picking.type',
    'stock.move.line',
    'stock.package.type',
    'product.packaging',
    'delivery.carrier',
    'fleet.vehicle',
    'fleet.vehicle.model',
    'fleet.vehicle.log.fuel',
    'fleet.vehicle.log.services',
    'mrp.production',
    'mrp.bom',
    'stock.route',
    'stock.rule',
    'stock.lot',
]

# Keywords to search in ir.model for any logistics-related custom models
LOGISTICS_KEYWORDS = [
    'truck', 'fleet', 'delivery', 'route', 'carrier',
    'loading', 'container', 'transport', 'furgon', 'camion',
    'carga', 'despacho', 'envio', 'ruta', 'vehiculo',
    'pallet', 'palet', 'empaque', 'packaging',
]

# Custom field prefixes to look for on logistics models
CUSTOM_FIELD_KEYWORDS = [
    'x_truck', 'x_furgon', 'x_carga', 'x_ruta', 'x_capacidad',
    'x_container', 'x_peso', 'x_volumen', 'x_vehicle', 'x_camion',
    'x_despacho', 'x_envio', 'x_pallet', 'x_transport',
]


# ---------------------------------------------------------------------------
# Odoo XML-RPC Connection
# ---------------------------------------------------------------------------

def connect():
    """Authenticate and return (uid, models_proxy)."""
    if not all([ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY]):
        logger.error('Missing environment variables. Need: ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY')
        sys.exit(1)

    logger.info('Connecting to %s (db: %s, user: %s)', ODOO_URL, ODOO_DB, ODOO_USERNAME)

    common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
    version = common.version()
    logger.info('Odoo server version: %s', version.get('server_version', 'unknown'))

    uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
    if not uid:
        logger.error('Authentication FAILED. Check credentials.')
        sys.exit(1)
    logger.info('Authenticated successfully. UID: %s', uid)

    models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)
    return uid, models, version


def call(models, method, model, *args, **kwargs):
    """Wrapper for execute_kw."""
    return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, list(args), kwargs)


# ---------------------------------------------------------------------------
# Phase 1: Discovery
# ---------------------------------------------------------------------------

def test_model_access(models, model_name):
    """Test if we can access a model. Returns dict with access info."""
    result = {
        'model': model_name,
        'accessible': False,
        'can_read': False,
        'can_search': False,
        'record_count': None,
        'field_count': None,
        'fields': None,
        'error': None,
    }
    try:
        count = call(models, 'search_count', model_name, [])
        result['can_search'] = True
        result['record_count'] = count

        fields = call(models, 'fields_get', model_name, [], attributes=['string', 'type', 'required', 'readonly'])
        result['can_read'] = True
        result['field_count'] = len(fields)
        result['fields'] = fields
        result['accessible'] = True

    except xmlrpc.client.Fault as e:
        result['error'] = str(e.faultString)[:200]
        # Try just fields_get if search_count failed
        if not result['can_read']:
            try:
                fields = call(models, 'fields_get', model_name, [], attributes=['string', 'type', 'required', 'readonly'])
                result['can_read'] = True
                result['field_count'] = len(fields)
                result['fields'] = fields
                result['accessible'] = True
            except xmlrpc.client.Fault:
                pass
    except Exception as e:
        result['error'] = str(e)[:200]

    status = 'OK' if result['accessible'] else 'DENIED'
    logger.info('  %-30s %s (records: %s, fields: %s)',
                model_name, status, result['record_count'], result['field_count'])
    return result


def search_logistics_models(models):
    """Search ir.model for any model whose name contains logistics keywords."""
    found = []
    try:
        for keyword in LOGISTICS_KEYWORDS:
            domain = ['|', ('model', 'ilike', keyword), ('name', 'ilike', keyword)]
            results = call(models, 'search_read', 'ir.model', domain,
                           fields=['model', 'name', 'info'], limit=50)
            for r in results:
                if r['model'] not in [f['model'] for f in found]:
                    found.append(r)
    except xmlrpc.client.Fault as e:
        logger.warning('Cannot search ir.model: %s', str(e.faultString)[:200])
    return found


def enumerate_all_models(models):
    """Get a list of ALL models in the system via ir.model."""
    try:
        all_models = call(models, 'search_read', 'ir.model', [],
                          fields=['model', 'name'], limit=0)
        logger.info('Total models in Odoo instance: %d', len(all_models))
        return all_models
    except xmlrpc.client.Fault as e:
        logger.warning('Cannot enumerate ir.model: %s', str(e.faultString)[:200])
        return []


def run_phase1(models):
    """Phase 1: Full discovery."""
    report = {
        'phase': 1,
        'timestamp': datetime.utcnow().isoformat(),
        'odoo_url': ODOO_URL,
        'odoo_db': ODOO_DB,
        'all_models': [],
        'solicitud_models': [],
        'logistics_probe_models': [],
        'logistics_keyword_matches': [],
    }

    # 1. Enumerate all models
    logger.info('--- Enumerating all models ---')
    all_models = enumerate_all_models(models)
    report['all_models'] = [{'model': m['model'], 'name': m['name']} for m in all_models]

    # 2. Test solicitud models
    logger.info('--- Testing Solicitud models (14) ---')
    for model_name in SOLICITUD_MODELS:
        result = test_model_access(models, model_name)
        # Strip full field defs for the summary (keep in raw)
        summary = {k: v for k, v in result.items() if k != 'fields'}
        summary['field_names'] = sorted(result['fields'].keys()) if result['fields'] else []
        report['solicitud_models'].append(summary)

    # 3. Probe logistics models
    logger.info('--- Probing logistics-adjacent models ---')
    for model_name in LOGISTICS_PROBE_MODELS:
        result = test_model_access(models, model_name)
        summary = {k: v for k, v in result.items() if k != 'fields'}
        summary['field_names'] = sorted(result['fields'].keys()) if result['fields'] else []
        report['logistics_probe_models'].append(summary)

    # 4. Search for logistics-related models by keyword
    logger.info('--- Searching for logistics models by keyword ---')
    keyword_matches = search_logistics_models(models)
    report['logistics_keyword_matches'] = keyword_matches
    for m in keyword_matches:
        logger.info('  Found: %-40s (%s)', m['model'], m['name'])

    return report


# ---------------------------------------------------------------------------
# Phase 2: Deep Dive
# ---------------------------------------------------------------------------

def get_sample_records(models, model_name, limit=5):
    """Pull sample records from a model."""
    try:
        records = call(models, 'search_read', model_name, [], limit=limit)
        return records
    except xmlrpc.client.Fault as e:
        return {'error': str(e.faultString)[:200]}


def find_custom_fields(fields_dict):
    """Find x_ prefixed custom fields."""
    custom = {}
    if not fields_dict:
        return custom
    for fname, finfo in fields_dict.items():
        if fname.startswith('x_'):
            custom[fname] = finfo
        # Also check for logistics-related standard fields
        for kw in ['weight', 'volume', 'carrier', 'vehicle', 'truck', 'fleet',
                    'route', 'container', 'pallet', 'package', 'loading',
                    'capacity', 'dimension', 'gross_weight', 'shipping']:
            if kw in fname.lower():
                custom[fname] = finfo
    return custom


def deep_dive_stock_picking(models):
    """Detailed investigation of stock.picking."""
    report = {'model': 'stock.picking', 'accessible': False}
    try:
        # Get picking types
        picking_types = call(models, 'search_read', 'stock.picking.type', [],
                             fields=['name', 'code', 'sequence_code', 'warehouse_id'], limit=50)
        report['picking_types'] = picking_types

        # Get fields
        fields = call(models, 'fields_get', 'stock.picking', [],
                      attributes=['string', 'type', 'required', 'readonly'])
        report['all_field_names'] = sorted(fields.keys())
        report['custom_and_logistics_fields'] = find_custom_fields(fields)

        # Sample records
        samples = call(models, 'search_read', 'stock.picking', [],
                       limit=10, order='id desc')
        report['sample_records'] = samples
        report['total_records'] = call(models, 'search_count', 'stock.picking', [])

        # Check carrier usage
        carrier_count = call(models, 'search_count', 'stock.picking',
                             [('carrier_id', '!=', False)])
        report['records_with_carrier'] = carrier_count

        # Check weight fields
        weight_count = call(models, 'search_count', 'stock.picking',
                            [('weight', '>', 0)])
        report['records_with_weight'] = weight_count

        report['accessible'] = True
    except xmlrpc.client.Fault as e:
        report['error'] = str(e.faultString)[:200]
    return report


def deep_dive_model(models, model_name, label):
    """Generic deep dive for a model."""
    report = {'model': model_name, 'label': label, 'accessible': False}
    try:
        fields = call(models, 'fields_get', model_name, [],
                      attributes=['string', 'type', 'required', 'readonly'])
        report['all_field_names'] = sorted(fields.keys())
        report['custom_and_logistics_fields'] = find_custom_fields(fields)
        report['total_records'] = call(models, 'search_count', model_name, [])
        report['sample_records'] = call(models, 'search_read', model_name, [],
                                        limit=5, order='id desc')
        report['accessible'] = True
    except xmlrpc.client.Fault as e:
        report['error'] = str(e.faultString)[:200]
    return report


def scan_all_models_for_custom_logistics_fields(models, all_models_list):
    """Scan ALL accessible models for x_ fields matching logistics keywords."""
    hits = []
    logger.info('--- Scanning %d models for custom logistics fields ---', len(all_models_list))
    for i, m in enumerate(all_models_list):
        model_name = m['model'] if isinstance(m, dict) else m
        if i % 100 == 0:
            logger.info('  Scanned %d/%d models...', i, len(all_models_list))
        try:
            fields = call(models, 'fields_get', model_name, [],
                          attributes=['string', 'type'])
            custom = {}
            for fname, finfo in fields.items():
                for kw in CUSTOM_FIELD_KEYWORDS:
                    if kw in fname.lower():
                        custom[fname] = finfo
                        break
            if custom:
                hits.append({'model': model_name, 'custom_fields': custom})
        except Exception:
            pass
    return hits


def run_phase2(models, phase1_raw_path='_odoo_exploration_raw.json'):
    """Phase 2: Deep dive into logistics data."""
    report = {
        'phase': 2,
        'timestamp': datetime.utcnow().isoformat(),
    }

    # Load Phase 1 results for the all_models list
    all_models_list = []
    if os.path.exists(phase1_raw_path):
        with open(phase1_raw_path, 'r') as f:
            p1 = json.load(f)
            all_models_list = p1.get('all_models', [])

    # Deep dive: stock.picking
    logger.info('=== Deep Dive: stock.picking ===')
    report['stock_picking'] = deep_dive_stock_picking(models)

    # Deep dive: other logistics models
    dive_targets = [
        ('product.packaging', 'Product Packaging (pallet/box dimensions)'),
        ('stock.package.type', 'Package Types (container definitions)'),
        ('fleet.vehicle', 'Fleet Vehicles (trucks)'),
        ('fleet.vehicle.model', 'Fleet Vehicle Models'),
        ('delivery.carrier', 'Delivery Carriers'),
        ('stock.move.line', 'Stock Move Lines (detailed operations)'),
        ('mrp.production', 'Manufacturing Orders'),
        ('stock.route', 'Stock Routes'),
    ]
    report['model_deep_dives'] = []
    for model_name, label in dive_targets:
        logger.info('=== Deep Dive: %s ===', model_name)
        report['model_deep_dives'].append(deep_dive_model(models, model_name, label))

    # Scan all models for custom logistics fields
    if all_models_list:
        report['custom_logistics_fields_scan'] = scan_all_models_for_custom_logistics_fields(
            models, all_models_list)
    else:
        logger.warning('No Phase 1 data found — skipping full custom field scan')
        report['custom_logistics_fields_scan'] = []

    return report


# ---------------------------------------------------------------------------
# Report Generation
# ---------------------------------------------------------------------------

def generate_markdown_phase1(report):
    """Generate markdown summary for Phase 1."""
    lines = [
        '# Odoo Exploration Results',
        '',
        f'**Date:** {report["timestamp"]}',
        f'**Odoo URL:** {report["odoo_url"]}',
        f'**Database:** {report["odoo_db"]}',
        f'**Total models in instance:** {len(report["all_models"])}',
        '',
        '---',
        '',
        '## Phase 1: Database Discovery',
        '',
        '### Solicitud Models (14 requested)',
        '',
        '| Model | Accessible | Records | Fields | Error |',
        '|-------|-----------|---------|--------|-------|',
    ]
    for m in report['solicitud_models']:
        acc = 'YES' if m['accessible'] else 'NO'
        err = m.get('error', '-') or '-'
        if len(err) > 60:
            err = err[:60] + '...'
        lines.append(f'| `{m["model"]}` | {acc} | {m["record_count"]} | {m["field_count"]} | {err} |')

    lines += [
        '',
        '### Logistics-Adjacent Models (probed)',
        '',
        '| Model | Accessible | Records | Fields | Error |',
        '|-------|-----------|---------|--------|-------|',
    ]
    for m in report['logistics_probe_models']:
        acc = 'YES' if m['accessible'] else 'NO'
        err = m.get('error', '-') or '-'
        if len(err) > 60:
            err = err[:60] + '...'
        lines.append(f'| `{m["model"]}` | {acc} | {m["record_count"]} | {m["field_count"]} | {err} |')

    lines += [
        '',
        '### Logistics Keyword Search Results',
        '',
    ]
    if report['logistics_keyword_matches']:
        lines.append('| Model | Name |')
        lines.append('|-------|------|')
        for m in report['logistics_keyword_matches']:
            lines.append(f'| `{m["model"]}` | {m["name"]} |')
    else:
        lines.append('_No models found matching logistics keywords._')

    lines.append('')
    return '\n'.join(lines)


def generate_markdown_phase2(report):
    """Generate markdown summary for Phase 2."""
    lines = [
        '',
        '---',
        '',
        '## Phase 2: Truck/Loading Data Deep Dive',
        '',
        f'**Date:** {report["timestamp"]}',
        '',
    ]

    # stock.picking
    sp = report.get('stock_picking', {})
    lines += [
        '### stock.picking (Delivery/Receipt Operations)',
        '',
    ]
    if sp.get('accessible'):
        lines += [
            f'- **Total records:** {sp.get("total_records")}',
            f'- **Records with carrier:** {sp.get("records_with_carrier")}',
            f'- **Records with weight > 0:** {sp.get("records_with_weight")}',
            f'- **Total fields:** {len(sp.get("all_field_names", []))}',
            '',
        ]
        custom = sp.get('custom_and_logistics_fields', {})
        if custom:
            lines += ['**Logistics-relevant fields found:**', '']
            for fname, finfo in custom.items():
                lines.append(f'- `{fname}` ({finfo.get("type", "?")}) — {finfo.get("string", "")}')
            lines.append('')

        if sp.get('picking_types'):
            lines += ['**Picking types:**', '']
            for pt in sp['picking_types']:
                lines.append(f'- `{pt.get("code", "?")}` — {pt.get("name", "?")}')
            lines.append('')

        if sp.get('sample_records'):
            lines += ['**Sample record (most recent):**', '', '```json',
                       json.dumps(sp['sample_records'][0], indent=2, default=str),
                       '```', '']
    else:
        lines.append(f'_Not accessible. Error: {sp.get("error", "unknown")}_')
        lines.append('')

    # Other deep dives
    for dive in report.get('model_deep_dives', []):
        lines += [
            f'### {dive["model"]} ({dive["label"]})',
            '',
        ]
        if dive.get('accessible'):
            lines += [
                f'- **Total records:** {dive.get("total_records")}',
                f'- **Total fields:** {len(dive.get("all_field_names", []))}',
                '',
            ]
            custom = dive.get('custom_and_logistics_fields', {})
            if custom:
                lines += ['**Logistics-relevant fields:**', '']
                for fname, finfo in custom.items():
                    lines.append(f'- `{fname}` ({finfo.get("type", "?")}) — {finfo.get("string", "")}')
                lines.append('')
            if dive.get('sample_records') and len(dive['sample_records']) > 0:
                lines += ['**Sample record:**', '', '```json',
                           json.dumps(dive['sample_records'][0], indent=2, default=str),
                           '```', '']
        else:
            lines.append(f'_Not accessible. Error: {dive.get("error", "unknown")}_')
            lines.append('')

    # Custom field scan
    custom_scan = report.get('custom_logistics_fields_scan', [])
    lines += [
        '### Custom Logistics Fields Scan (all models)',
        '',
    ]
    if custom_scan:
        for hit in custom_scan:
            lines.append(f'**{hit["model"]}:**')
            for fname, finfo in hit['custom_fields'].items():
                lines.append(f'- `{fname}` ({finfo.get("type", "?")}) — {finfo.get("string", "")}')
            lines.append('')
    else:
        lines.append('_No custom logistics fields found across any model._')
        lines.append('')

    return '\n'.join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# Module-level uid for call() function
uid = None


def main():
    global uid

    parser = argparse.ArgumentParser(description='Odoo Database Explorer')
    parser.add_argument('--deep-dive', action='store_true', help='Phase 2: logistics deep dive')
    args = parser.parse_args()

    uid_val, models, version = connect()
    uid = uid_val

    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    results_md_path = os.path.join(project_root, '_ODOO_EXPLORATION_RESULTS.md')

    if not args.deep_dive:
        # Phase 1
        logger.info('========== PHASE 1: DISCOVERY ==========')
        report = run_phase1(models)

        raw_path = os.path.join(project_root, '_odoo_exploration_raw.json')
        with open(raw_path, 'w') as f:
            # Strip full field definitions from raw to keep file manageable
            json.dump(report, f, indent=2, default=str)
        logger.info('Raw JSON saved to %s', raw_path)

        md = generate_markdown_phase1(report)
        with open(results_md_path, 'w') as f:
            f.write(md)
        logger.info('Markdown results saved to %s', results_md_path)

        # Summary
        accessible = sum(1 for m in report['solicitud_models'] if m['accessible'])
        total = len(report['solicitud_models'])
        logger.info('========== PHASE 1 COMPLETE ==========')
        logger.info('Solicitud models accessible: %d/%d', accessible, total)
        logistics_accessible = sum(1 for m in report['logistics_probe_models'] if m['accessible'])
        logger.info('Logistics probe models accessible: %d/%d',
                     logistics_accessible, len(report['logistics_probe_models']))
        logger.info('Keyword matches: %d', len(report['logistics_keyword_matches']))

    else:
        # Phase 2
        logger.info('========== PHASE 2: DEEP DIVE ==========')
        raw_p1_path = os.path.join(project_root, '_odoo_exploration_raw.json')
        report = run_phase2(models, phase1_raw_path=raw_p1_path)

        raw_path = os.path.join(project_root, '_odoo_deep_dive_raw.json')
        with open(raw_path, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        logger.info('Raw JSON saved to %s', raw_path)

        md = generate_markdown_phase2(report)
        # Append to existing results
        with open(results_md_path, 'a') as f:
            f.write(md)
        logger.info('Deep dive results appended to %s', results_md_path)

        logger.info('========== PHASE 2 COMPLETE ==========')


if __name__ == '__main__':
    main()
