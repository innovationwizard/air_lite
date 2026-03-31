#!/usr/bin/env python3
"""
Odoo → Supabase Sync for OA v2
Pulls product volumes and dimensions from Odoo and updates Supabase.

Matches by SKU (default_code → sku) because the Supabase DB was imported
from production Odoo while this script reads from test Odoo — different
database IDs but same SKUs.

Usage:
    ODOO_URL=... ODOO_DB=... ODOO_USERNAME=... ODOO_API_KEY=... \
    SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
    python ml/odoo_sync_oa_v2.py
"""

import json
import logging
import os
import sys
import time
import urllib.request
import xmlrpc.client

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

ODOO_URL = os.environ.get('ODOO_URL', '')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')
SUPABASE_URL = os.environ.get('SUPABASE_URL', os.environ.get('NEXT_PUBLIC_SUPABASE_URL', ''))
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')

RETRY_ATTEMPTS = 3
RETRY_DELAY_SECS = 3


def connect_odoo():
    """Authenticate with Odoo and return (uid, execute_kw helper)."""
    if not all([ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY]):
        logger.error('Missing Odoo env vars: ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY')
        sys.exit(1)

    logger.info('Connecting to Odoo: %s (db: %s)', ODOO_URL, ODOO_DB)
    common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
    if not uid:
        logger.error('Odoo authentication failed')
        sys.exit(1)
    logger.info('Authenticated as UID %d', uid)

    models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)

    def execute_kw(model, method, *args, **kwargs):
        return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, list(args), kwargs)

    return uid, execute_kw


def supabase_request(method, path, data=None):
    """Make a Supabase REST API request with retry."""
    url = f'{SUPABASE_URL}/rest/v1/{path}'
    body = json.dumps(data).encode('utf-8') if data else None

    for attempt in range(1, RETRY_ATTEMPTS + 1):
        try:
            req = urllib.request.Request(url, data=body, method=method)
            req.add_header('apikey', SUPABASE_KEY)
            req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
            req.add_header('Content-Type', 'application/json')
            req.add_header('Prefer', 'return=minimal')
            urllib.request.urlopen(req, timeout=15)
            return True
        except Exception as e:
            if attempt < RETRY_ATTEMPTS:
                time.sleep(RETRY_DELAY_SECS * attempt)
            else:
                logger.error('FAILED %s %s: %s', method, path, e)
                return False


def supabase_get_all(path):
    """GET all rows from Supabase, handling pagination."""
    results = []
    for offset in range(0, 10000, 1000):
        sep = '&' if '?' in path else '?'
        url = f'{SUPABASE_URL}/rest/v1/{path}{sep}offset={offset}&limit=1000'
        req = urllib.request.Request(url)
        req.add_header('apikey', SUPABASE_KEY)
        req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
        batch = json.loads(urllib.request.urlopen(req, timeout=15).read())
        if not batch:
            break
        results.extend(batch)
    return results


def sync_product_volumes(execute_kw):
    """Pull product volumes and dimensions from Odoo, match by SKU, update Supabase."""
    logger.info('--- SYNCING PRODUCT VOLUMES & DIMENSIONS ---')
    logger.info('Match strategy: SKU (Odoo default_code → Supabase sku)')

    # 1) Get ALL Odoo products including archived, with volume + dimensions
    logger.info('Fetching all products from Odoo (including archived)...')
    odoo_products = execute_kw(
        'product.product', 'search_read',
        ['|', ['active', '=', True], ['active', '=', False]],
        fields=['id', 'default_code', 'name', 'volume', 'weight',
                'x_studio_alto', 'x_studio_ancho', 'x_studio_largo'],
        limit=False,
    )
    logger.info('Odoo: %d total products fetched', len(odoo_products))

    # Index by SKU — only products with volume or dimensions
    odoo_by_sku = {}
    for p in odoo_products:
        sku = p.get('default_code')
        if not sku:
            continue
        has_data = (
            (p.get('volume') and p['volume'] > 0) or
            (p.get('weight') and p['weight'] > 0) or
            (p.get('x_studio_alto') and p['x_studio_alto'] > 0)
        )
        if has_data:
            odoo_by_sku[sku] = p

    with_vol = sum(1 for p in odoo_by_sku.values() if p.get('volume') and p['volume'] > 0)
    with_dims = sum(1 for p in odoo_by_sku.values() if p.get('x_studio_alto') and p['x_studio_alto'] > 0)
    with_weight = sum(1 for p in odoo_by_sku.values() if p.get('weight') and p['weight'] > 0)
    logger.info('Odoo indexed by SKU: %d with data (vol: %d, dims: %d, weight: %d)',
                len(odoo_by_sku), with_vol, with_dims, with_weight)

    # 2) Get all Supabase products
    logger.info('Fetching all products from Supabase...')
    supa_products = supabase_get_all('products?select=id,sku,volume_m3,height_m,width_m,length_m')
    logger.info('Supabase: %d total products', len(supa_products))

    # 3) Match and update
    updated = 0
    skipped = 0
    failed = 0
    no_match = 0

    matchable = [(p, odoo_by_sku[p['sku']]) for p in supa_products
                 if p.get('sku') and p['sku'] in odoo_by_sku]
    logger.info('Matched by SKU: %d / %d Supabase products', len(matchable), len(supa_products))

    for i, (supa_p, odoo_p) in enumerate(matchable):
        patch = {}

        # Volume
        if odoo_p.get('volume') and odoo_p['volume'] > 0:
            current_vol = float(supa_p['volume_m3']) if supa_p.get('volume_m3') else 0
            if abs(current_vol - odoo_p['volume']) > 0.000001:
                patch['volume_m3'] = odoo_p['volume']

        # Dimensions (Alto/Ancho/Largo → height_m/width_m/length_m)
        for odoo_field, supa_field in [
            ('x_studio_alto', 'height_m'),
            ('x_studio_ancho', 'width_m'),
            ('x_studio_largo', 'length_m'),
        ]:
            if odoo_p.get(odoo_field) and odoo_p[odoo_field] > 0:
                current = float(supa_p[supa_field]) if supa_p.get(supa_field) else 0
                if abs(current - odoo_p[odoo_field]) > 0.0001:
                    patch[supa_field] = odoo_p[odoo_field]

        if not patch:
            skipped += 1
            continue

        ok = supabase_request('PATCH', f'products?sku=eq.{urllib.parse.quote(supa_p["sku"])}', patch)
        if ok:
            updated += 1
        else:
            failed += 1

        if (i + 1) % 200 == 0:
            logger.info('  Progress: %d / %d (updated: %d, skipped: %d, failed: %d)',
                        i + 1, len(matchable), updated, skipped, failed)

    no_match = len(supa_products) - len(matchable)
    logger.info('Sync complete: %d updated, %d skipped (already current), %d failed, %d no SKU match',
                updated, skipped, failed, no_match)
    return updated, failed, skipped, no_match


def main():
    uid, execute_kw = connect_odoo()

    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error('Missing Supabase env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY')
        sys.exit(1)

    logger.info('=== OA v3 SYNC STARTED ===')

    # Critical sync: product volumes matched by SKU
    updated, failed, skipped, no_match = sync_product_volumes(execute_kw)

    # Informational checks (non-critical)
    for label, fn in [
        ('Inventory snapshot', lambda: execute_kw('stock.quant', 'search_count', [['quantity', '>', 0]])),
        ('Pending POs', lambda: execute_kw('purchase.order', 'search_count', [['state', 'in', ['purchase', 'locked']]])),
        ('Active SOs', lambda: execute_kw('sale.order', 'search_count', [['state', 'in', ['sale', 'done']]])),
    ]:
        try:
            count = fn()
            logger.info('  %s: %d', label, count)
        except Exception as e:
            logger.warning('  %s: failed (non-critical) — %s', label, e)

    logger.info('=== OA v2 SYNC COMPLETE ===')
    logger.info('Summary: %d updated, %d failed, %d already current, %d unmatched',
                updated, failed, skipped, no_match)


if __name__ == '__main__':
    import urllib.parse
    main()
