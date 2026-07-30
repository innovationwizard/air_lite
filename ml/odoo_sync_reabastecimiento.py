"""Odoo -> Supabase sync for the live Reabastecimiento engine (COMPRAS / Wilmer).

Populates `reabastecimiento_inputs` (one row per product x bodega) with the
engine inputs measured from MAYO2026.xlsx (docs/compras/MAYO2026_XLSX_MANIFEST.md §3):
  existencias, reserved, patio, transito, p3, p6, h, win

Design decisions (docs/compras/REABASTECIMIENTO_LIVE_PROGRESS.md B2):
  - Bodegas come from the `bodega_map` table (confirmed 2026-07-28: purchasing
    scope = 1CET 'San Jose VN' + 4ZAC/3PET 'Zacapa-Petén'). 'General' is a
    computed DISPLAY aggregate across ALL physical warehouses (+ patio), per
    Wilmer: "todo el inventario de todas las bodegas físicas... también patio".
  - Patio = the `<WH>/Entrada` locations (confirmed 2026-07-28).
  - Tránsito = confirmed purchase.order.line with pending qty and STRICTLY
    FUTURE date_planned — RULE CONFIRMED BY WILMER 2026-07-30: "Tránsito no
    cuenta fechas pasadas" (he updates delivery dates when suppliers
    reschedule, so late-but-expected becomes future; un-updated past = dead).
    Past-dated pending (never-cancelled pile) excluded + reported. GLOBAL per
    product (the workbook's Tránsito sheet is not bodega-split). Draft-PO
    ("cotización") counting for import suppliers is implemented but OFF until
    David confirms mechanics (INCLUDE_DRAFT_TRANSIT).
  - Velocity p3/p6 = monthly average of ORDERED qty (sale.order.line
    product_uom_qty, states 'sale'/'done') over the last 3/6 COMPLETE calendar
    months. State set is a flagged assumption (OQ-D minor open).
  - Seasonal h: attempted from the custom `sales.history` model (SAE 2023-25,
    resolved 2026-07-29). Its field layout is UNPROBED (instance was down when
    this was written) -> discovered at runtime; if not interpretable, h=0 for
    all rows and a warning sync_issue is emitted. Never guessed.
  - pending_reserve is NEVER written by this sync (decision 2026-07-30: no
    system stores it; Wilmer keys it manually via pending_reserve_overrides).
  - products/suppliers/product_suppliers: INSERT-MISSING-ONLY. Existing rows
    are never mutated (the running app reads them); differences are reported
    as sync_issues instead.

The sync does not fail loudly-but-uselessly and never drops silently: every
anomaly lands in `sync_issues` with severity + odoo_id (SOP §12).

Usage:
    ODOO_URL=... ODOO_DB=... ODOO_USERNAME=... ODOO_API_KEY=... \
    SUPABASE_URL=... SUPABASE_SECRET_KEY=... \
    python ml/odoo_sync_reabastecimiento.py [--dry-run]

--dry-run: read everything from Odoo, compute all rows, print the summary,
write NOTHING to Supabase.
"""

import json
import logging
import os
import sys
import urllib.parse
import urllib.request
import xmlrpc.client
from datetime import datetime, timezone

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

ODOO_URL = os.environ.get('ODOO_URL', '')
ODOO_DB = os.environ.get('ODOO_DB', '')
ODOO_USERNAME = os.environ.get('ODOO_USERNAME', '')
ODOO_API_KEY = os.environ.get('ODOO_API_KEY', '')
SUPABASE_URL = os.environ.get('SUPABASE_URL', os.environ.get('NEXT_PUBLIC_SUPABASE_URL', ''))
SUPABASE_KEY = os.environ.get('SUPABASE_SECRET_KEY', '')

# Draft-PO ("cotización") transit for import suppliers — Wilmer's 2026-07-29
# proposal, pending David's confirmation of Odoo mechanics. Keep OFF until
# confirmed; future-dated draft lines are counted and reported as an info
# issue either way so adoption is visible.
INCLUDE_DRAFT_TRANSIT = False

# Ordered-demand states (OQ-D minor open: flagged as assumption in sync_issues).
ORDERED_STATES = ['sale', 'done']

SUPABASE_BATCH = 500


# ─── Odoo client ──────────────────────────────────────────────────────────────

def connect_odoo():
    if not all([ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY]):
        logger.error('Missing Odoo env vars: ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY')
        sys.exit(1)
    common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
    if not uid:
        logger.error('Odoo authentication failed (per-database API key?)')
        sys.exit(1)
    models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)
    logger.info('Odoo connected: uid=%s db=%s', uid, ODOO_DB)

    def execute(model, method, *args, **kwargs):
        return models.execute_kw(ODOO_DB, uid, ODOO_API_KEY, model, method, list(args), kwargs)

    return execute


def odoo_read_all(execute, model, domain, fields, page=1000):
    """search_read with offset paging — never trusts a single call to be complete."""
    out = []
    offset = 0
    while True:
        batch = execute(model, 'search_read', domain, fields=fields, limit=page, offset=offset)
        out.extend(batch)
        if len(batch) < page:
            return out
        offset += page


# ─── Supabase REST client (service key; RLS service_write policies) ───────────

def sb_request(method, path, data=None, prefer='return=minimal'):
    url = f'{SUPABASE_URL}/rest/v1/{path}'
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('apikey', SUPABASE_KEY)
    req.add_header('Authorization', f'Bearer {SUPABASE_KEY}')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Prefer', prefer)
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read()
        return json.loads(raw) if raw else None


def sb_get_all(path_base, page=1000):
    out = []
    offset = 0
    sep = '&' if '?' in path_base else '?'
    while True:
        batch = sb_request('GET', f'{path_base}{sep}limit={page}&offset={offset}')
        out.extend(batch)
        if len(batch) < page:
            return out
        offset += page


def sb_insert_batched(table, rows, on_conflict=None):
    if not rows:
        return
    prefer = 'return=minimal'
    path = table
    if on_conflict:
        prefer += ',resolution=merge-duplicates'
        path = f'{table}?on_conflict={on_conflict}'
    for i in range(0, len(rows), SUPABASE_BATCH):
        sb_request('POST', path, rows[i:i + SUPABASE_BATCH], prefer=prefer)


# ─── Issue collection (the ETL flags; it never drops silently) ────────────────

class Issues:
    def __init__(self):
        self.rows = []

    def add(self, severity, entity, message, odoo_id=None, product_id=None):
        self.rows.append({
            'severity': severity, 'entity': entity, 'message': message,
            'odoo_id': str(odoo_id) if odoo_id is not None else None,
            'product_id': product_id,
        })
        log = logger.warning if severity in ('warning', 'error') else logger.info
        log('[issue:%s] %s: %s', severity, entity, message)

    def has_errors(self):
        return any(r['severity'] == 'error' for r in self.rows)


# ─── Sync steps ───────────────────────────────────────────────────────────────

def load_bodega_map(issues):
    """bodega name -> list of Odoo warehouse codes (in_scope only)."""
    rows = sb_get_all('bodega_map?select=odoo_warehouse_code,bodega,in_scope')
    by_bodega = {}
    for r in rows:
        if r['in_scope']:
            by_bodega.setdefault(r['bodega'], []).append(r['odoo_warehouse_code'])
    if not by_bodega:
        issues.add('error', 'bodega_map', 'bodega_map is empty — cannot sync')
    logger.info('bodega_map: %s', by_bodega)
    return by_bodega


def resolve_locations(execute, issues):
    """All internal Existencias/Entrada locations, found by CONTENT (complete_name),
    never by id. Returns {complete_name: id} plus warehouse code index."""
    locs = odoo_read_all(execute, 'stock.location', [['usage', '=', 'internal']],
                         ['id', 'complete_name'])
    by_name = {loc['complete_name']: loc['id'] for loc in locs}
    logger.info('internal locations: %d', len(by_name))
    return by_name


def location_ids_for(by_name, wh_codes, kinds, issues):
    """Location ids for the given warehouse codes and kinds ('Existencias'/'Entrada')."""
    ids = []
    for code in wh_codes:
        for kind in kinds:
            name = f'{code}/{kind}'
            if name in by_name:
                ids.append(by_name[name])
            else:
                issues.add('warning', 'bodega_map',
                           f'location "{name}" not found in Odoo — skipped', odoo_id=name)
    return ids


def all_physical_location_ids(by_name):
    """For the 'General' display aggregate: every */Existencias and */Entrada."""
    return [i for n, i in by_name.items()
            if n.endswith('/Existencias') or n.endswith('/Entrada')]


def sync_catalog(execute, issues, dry_run):
    """Insert-missing products/suppliers/product_suppliers. Never mutates existing
    rows (the running app reads them); mismatches become issues.
    Returns (odoo_pid -> supabase product id) map."""
    odoo_products = odoo_read_all(
        execute, 'product.product', [],
        ['id', 'default_code', 'name', 'standard_price', 'list_price', 'uom_id', 'categ_id'])
    logger.info('Odoo products: %d', len(odoo_products))

    # Match by SKU (content) FIRST, odoo_id second. Odoo database ids CHANGE on
    # every dev-build clone (verified 2026-07-30: only ~400/1597 matched by id
    # against the March snapshot; blind id-matching would have inserted ~1,199
    # near-duplicates). SKU is the stable business key.
    existing = sb_get_all('products?select=id,odoo_id,sku')
    by_sku, dup_skus = {}, 0
    for p in existing:
        if p['sku']:
            if p['sku'] in by_sku:
                dup_skus += 1
            else:
                by_sku[p['sku']] = p['id']
    by_odoo_id_existing = {p['odoo_id']: p['id'] for p in existing}
    if dup_skus:
        issues.add('warning', 'product',
                   f'{dup_skus} duplicate SKUs already present in Supabase products '
                   f'(first row wins for matching) — review separately')

    by_odoo_id = {}   # str(new-build odoo id) -> supabase product id
    id_drift = 0
    new_rows = []
    for p in odoo_products:
        oid = str(p['id'])
        sku = p.get('default_code') or None
        if sku and sku in by_sku:
            by_odoo_id[oid] = by_sku[sku]
            if oid not in by_odoo_id_existing:
                id_drift += 1
        elif oid in by_odoo_id_existing:
            by_odoo_id[oid] = by_odoo_id_existing[oid]
        else:
            new_rows.append({
                'odoo_id': oid,
                'sku': sku,
                'name': (p.get('name') or '')[:255] or f'odoo:{oid}',
                'category': (p['categ_id'][1][:100] if p.get('categ_id') else None),
                'cost': p.get('standard_price') or None,
                'list_price': p.get('list_price') or None,
                'stock_uom': (p['uom_id'][1][:50] if p.get('uom_id') else None),
            })
    if id_drift:
        issues.add('info', 'product',
                   f'{id_drift} products bridged by SKU (odoo_id drift across builds '
                   f'— existing rows reused, never mutated)')
    if new_rows:
        issues.add('info', 'product',
                   f'{len(new_rows)} genuinely new products (no SKU/odoo_id match) — inserted')
        if not dry_run:
            sb_insert_batched('products', new_rows)
            refreshed = sb_get_all('products?select=id,odoo_id,sku')
            re_by_sku = {p['sku']: p['id'] for p in refreshed if p['sku']}
            re_by_oid = {p['odoo_id']: p['id'] for p in refreshed}
            for p in odoo_products:
                oid = str(p['id'])
                if oid not in by_odoo_id:
                    sku = p.get('default_code') or None
                    mapped = (re_by_sku.get(sku) if sku else None) or re_by_oid.get(oid)
                    if mapped:
                        by_odoo_id[oid] = mapped

    # suppliers + primary vendor per product (lowest supplierinfo sequence)
    sinfo = odoo_read_all(execute, 'product.supplierinfo', [],
                          ['partner_id', 'product_tmpl_id', 'product_id', 'sequence', 'delay', 'price'])
    # Suppliers: same id-drift reality — match odoo_id, then VERBATIM name.
    existing_sup = sb_get_all('suppliers?select=id,odoo_id,name')
    sup_by_odoo_existing = {s['odoo_id']: s['id'] for s in existing_sup}
    sup_by_name = {}
    for s in existing_sup:
        sup_by_name.setdefault(s['name'], s['id'])
    sup_by_odoo = {}   # str(new-build partner id) -> supabase supplier id
    sup_drift = 0
    new_sups, seen = [], set()
    for si in sinfo:
        if not si.get('partner_id'):
            continue
        pid, pname = si['partner_id'][0], si['partner_id'][1]
        key = str(pid)
        if key in sup_by_odoo or pid in seen:
            continue
        if key in sup_by_odoo_existing:
            sup_by_odoo[key] = sup_by_odoo_existing[key]
        elif pname in sup_by_name:
            sup_by_odoo[key] = sup_by_name[pname]
            sup_drift += 1
        else:
            seen.add(pid)
            new_sups.append({'odoo_id': key, 'name': pname[:255],
                             'lead_time_days': si.get('delay') or 30})
    if sup_drift:
        issues.add('info', 'supplier',
                   f'{sup_drift} suppliers bridged by verbatim name (partner-id drift)')
    if new_sups:
        issues.add('info', 'supplier',
                   f'{len(new_sups)} genuinely new suppliers — inserted')
        if not dry_run:
            sb_insert_batched('suppliers', new_sups)
            for s in sb_get_all('suppliers?select=id,odoo_id,name'):
                if s['odoo_id'] not in sup_by_odoo_existing:
                    sup_by_odoo[s['odoo_id']] = s['id']

    # product_suppliers links: supplierinfo is per template; map templates to variants.
    tmpl_to_products = {}
    tmpl_rows = odoo_read_all(execute, 'product.product', [], ['id', 'product_tmpl_id'])
    for r in tmpl_rows:
        if r.get('product_tmpl_id'):
            tmpl_to_products.setdefault(r['product_tmpl_id'][0], []).append(r['id'])
    existing_links = sb_get_all('product_suppliers?select=product_id,supplier_id')
    link_set = {(lk['product_id'], lk['supplier_id']) for lk in existing_links}
    new_links = []
    for si in sorted(sinfo, key=lambda s: s.get('sequence') or 0):
        if not (si.get('partner_id') and si.get('product_tmpl_id')):
            continue
        sup_id = sup_by_odoo.get(str(si['partner_id'][0]))
        for opid in tmpl_to_products.get(si['product_tmpl_id'][0], []):
            prod_id = by_odoo_id.get(str(opid))
            if sup_id and prod_id and (prod_id, sup_id) not in link_set:
                link_set.add((prod_id, sup_id))
                new_links.append({'product_id': prod_id, 'supplier_id': sup_id,
                                  'lead_time_days': si.get('delay') or 0,
                                  'supplier_price': si.get('price') or None})
    if new_links:
        issues.add('info', 'supplier', f'{len(new_links)} product-supplier links inserted')
        if not dry_run:
            sb_insert_batched('product_suppliers', new_links)

    sku_to_opid = {p['default_code']: p['id'] for p in odoo_products if p.get('default_code')}
    return by_odoo_id, sku_to_opid, len(odoo_products), len(new_rows)


def sync_stock(execute, by_name, bodega_codes, issues):
    """Per bodega: {odoo_pid: {'exist','reserved','patio'}} from stock.quant.
    Patio = */Entrada locations (2026-07-28). 'General' = ALL physical locations."""
    result = {}
    targets = dict(bodega_codes)  # purchasing bodegas from bodega_map
    for bodega, codes in targets.items():
        exist_ids = location_ids_for(by_name, codes, ['Existencias'], issues)
        patio_ids = location_ids_for(by_name, codes, ['Entrada'], issues)
        result[bodega] = _stock_for_locations(execute, exist_ids, patio_ids)

    # General display aggregate: every physical warehouse, incl. tiendas.
    all_ids = all_physical_location_ids(by_name)
    exist_ids = [i for n, i in by_name.items() if n.endswith('/Existencias')]
    patio_ids = [i for n, i in by_name.items() if n.endswith('/Entrada')]
    result['General'] = _stock_for_locations(execute, exist_ids, patio_ids)
    logger.info('stock synced for bodegas: %s (+General over %d locations)',
                list(targets), len(all_ids))
    return result


def _stock_for_locations(execute, exist_ids, patio_ids):
    out = {}
    if exist_ids:
        for q in odoo_read_all(execute, 'stock.quant', [['location_id', 'in', exist_ids]],
                               ['product_id', 'quantity', 'reserved_quantity']):
            pid = q['product_id'][0]
            row = out.setdefault(pid, {'exist': 0.0, 'reserved': 0.0, 'patio': 0.0})
            row['exist'] += q.get('quantity') or 0.0
            row['reserved'] += q.get('reserved_quantity') or 0.0
    if patio_ids:
        for q in odoo_read_all(execute, 'stock.quant', [['location_id', 'in', patio_ids]],
                               ['product_id', 'quantity']):
            pid = q['product_id'][0]
            row = out.setdefault(pid, {'exist': 0.0, 'reserved': 0.0, 'patio': 0.0})
            row['patio'] += q.get('quantity') or 0.0
    return out


def month_windows(today):
    """(start_3mo, start_6mo, end) = last 3/6 COMPLETE calendar months."""
    first_of_current = today.replace(day=1)

    def minus_months(d, n):
        y, m = d.year, d.month - n
        while m <= 0:
            y -= 1
            m += 12
        return d.replace(year=y, month=m)

    return minus_months(first_of_current, 3), minus_months(first_of_current, 6), first_of_current


def sync_velocity(execute, bodega_codes, wh_ids_by_code, issues):
    """p3/p6 monthly averages of ORDERED qty per product per bodega.
    General = all warehouses (no filter)."""
    today = datetime.now(timezone.utc).date()
    start3, start6, end = month_windows(today)
    issues.add('info', 'sales',
               f'velocity windows: p3 {start3}->{end}, p6 {start6}->{end}; '
               f'states={ORDERED_STATES} (assumption, OQ-D)')

    def grouped(domain):
        groups = execute('sale.order.line', 'read_group', domain,
                         ['product_uom_qty'], ['product_id'], lazy=False)
        return {g['product_id'][0]: g.get('product_uom_qty') or 0.0
                for g in groups if g.get('product_id')}

    result = {}
    targets = dict(bodega_codes)
    targets['General'] = None  # no warehouse filter
    for bodega, codes in targets.items():
        base = [['state', 'in', ORDERED_STATES]]
        if codes is not None:
            wh_ids = [wh_ids_by_code[c] for c in codes if c in wh_ids_by_code]
            base.append(['warehouse_id', 'in', wh_ids])
        q6 = grouped(base + [['order_id.date_order', '>=', str(start6)],
                             ['order_id.date_order', '<', str(end)]])
        q3 = grouped(base + [['order_id.date_order', '>=', str(start3)],
                             ['order_id.date_order', '<', str(end)]])
        result[bodega] = {pid: {'p6': q6.get(pid, 0.0) / 6.0, 'p3': q3.get(pid, 0.0) / 3.0}
                          for pid in set(q6) | set(q3)}
        logger.info('velocity %s: %d products', bodega, len(result[bodega]))
    return result


SPANISH_MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
# Decision 2026-07-29 (Wilmer/David/Jorge): 2023-2025 only — 2021-22 are
# pandemic-distorted; punto-de-venta (ISC) is excluded upstream by the model.
SEASONAL_YEAR_FIELDS = ['quantity_23', 'quantity_24', 'quantity_25']


def sync_seasonal(execute, sku_to_opid, issues):
    """Seasonal h per product from `sales.history` (SAE history pre-loaded in
    Odoo; layout probed 2026-07-30: one row per code x month x canal x vendedor
    with per-year quantity_2X columns; `month` is a Spanish month name).

    h = same-month quantity for the CURRENT month, summed across canal/vendedor
    rows, then averaged over 2023-25 counting only years with data (>0). Years
    without data are excluded rather than averaged as zero — averaging zeros is
    exactly the "estacional tan bajo" distortion Raquel flagged. Rule is
    reported as an info issue; final validation is B6 with Wilmer.

    Returns {odoo_product_id: h}. Missing model/fields -> {} + warning.
    """
    current_month = SPANISH_MONTHS[datetime.now(timezone.utc).month - 1]
    try:
        rows = odoo_read_all(execute, 'sales.history', [['month', '=', current_month]],
                             ['code'] + SEASONAL_YEAR_FIELDS)
    except Exception as e:
        issues.add('warning', 'sales',
                   f'sales.history unavailable ({e}) — seasonal h=0 for all rows')
        return {}

    per_code = {}
    skipped_no_code = 0
    for r in rows:
        code = (r.get('code') or '').strip()
        if not code:
            skipped_no_code += 1
            continue
        sums = per_code.setdefault(code, dict.fromkeys(SEASONAL_YEAR_FIELDS, 0.0))
        for f in SEASONAL_YEAR_FIELDS:
            sums[f] += r.get(f) or 0.0

    result = {}
    unmatched_codes = 0
    for code, sums in per_code.items():
        opid = sku_to_opid.get(code)
        if not opid:
            unmatched_codes += 1
            continue
        year_values = [v for v in sums.values() if v > 0]
        result[opid] = (sum(year_values) / len(year_values)) if year_values else 0.0

    issues.add('info', 'sales',
               f'seasonal h ({current_month}): {len(result)} products from '
               f'{len(rows)} sales.history rows; rule = mean over 2023-25 years '
               f'with data>0 (zero-years excluded); {skipped_no_code} rows without '
               f'code skipped; {unmatched_codes} codes with no matching product SKU')
    return result


def sync_transit(execute, issues):
    """Global per-product transit: confirmed PO lines with pending qty
    (product_qty - qty_received > 0) and STRICTLY FUTURE date_planned.

    RULE CONFIRMED BY WILMER 2026-07-30 (OQ-F): "Tránsito no cuenta fechas
    pasadas." His discipline: when a supplier reschedules, he UPDATES the
    delivery date on the PO — so a late-but-still-expected delivery becomes
    future-dated and counts; an un-updated past date is dead. All past-dated
    pending (the never-cancelled pile, back to 2024-10) is excluded and
    reported. Transit near 0 is therefore CORRECT under this rule whenever no
    future-dated confirmed lines exist (locals deliver same-week; the Carvajal
    monthly enters via cotización or the manual override)."""
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    lines = odoo_read_all(execute, 'purchase.order.line',
                          [['state', '=', 'purchase']],
                          ['product_id', 'product_qty', 'qty_received', 'date_planned'])
    transit = {}
    counted = past_excluded = 0
    for ln in lines:
        if not ln.get('product_id'):
            continue
        pending = (ln.get('product_qty') or 0.0) - (ln.get('qty_received') or 0.0)
        if pending <= 0:
            continue
        if (ln.get('date_planned') or '') > now:
            transit[ln['product_id'][0]] = transit.get(ln['product_id'][0], 0.0) + pending
            counted += 1
        else:
            past_excluded += 1
    issues.add('info', 'transit',
               f'transit = FUTURE-dated pending only (Wilmer 2026-07-30): {counted} lines '
               f'counted; {past_excluded} past-dated pending lines excluded '
               f'(incl. the no-auto-cancel pile back to 2024-10 — cleanup with David)')

    # Data-horizon staleness: newest purchase order date vs now.
    latest_po = execute('purchase.order', 'search_read', [],
                        fields=['date_order'], order='date_order desc', limit=1)
    if latest_po:
        newest = latest_po[0].get('date_order') or ''
        cutoff = (datetime.now(timezone.utc)
                  .replace(hour=0, minute=0, second=0, microsecond=0))
        days_old = (cutoff.date() - datetime.strptime(newest[:10], '%Y-%m-%d').date()).days \
            if newest else 999
        if days_old > 3:
            issues.add('warning', 'transit',
                       f'newest purchase order is {newest[:10]} ({days_old} days old) — '
                       f'Odoo data horizon appears stale; numbers lag reality')

    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    draft_lines = odoo_read_all(execute, 'purchase.order.line',
                                [['state', 'in', ['draft', 'sent']], ['date_planned', '>', now]],
                                ['product_id', 'product_qty'])
    if draft_lines:
        issues.add('info', 'transit',
                   f'{len(draft_lines)} future-dated DRAFT PO lines found (cotización '
                   f'candidate, INCLUDE_DRAFT_TRANSIT={INCLUDE_DRAFT_TRANSIT})')
        if INCLUDE_DRAFT_TRANSIT:
            for ln in draft_lines:
                if ln.get('product_id'):
                    transit[ln['product_id'][0]] = (transit.get(ln['product_id'][0], 0.0)
                                                    + (ln.get('product_qty') or 0.0))
    logger.info('transit: %d products with pending qty', len(transit))
    return transit


WINDOW_BY_BODEGA = {'General': 10}  # measured: General=10, locations=5
DEFAULT_WINDOW = 5


def assemble_inputs(product_map, stock, velocity, transit, seasonal, sync_id, issues):
    """Join everything into reabastecimiento_inputs rows. pending_reserve is
    NEVER set (decision 2026-07-30 — manual only)."""
    as_of = datetime.now(timezone.utc).isoformat()
    rows = []
    unmapped = set()
    for bodega in stock:
        win = WINDOW_BY_BODEGA.get(bodega, DEFAULT_WINDOW)
        pids = set(stock[bodega]) | set(velocity.get(bodega, {}))
        for opid in pids:
            sb_pid = product_map.get(str(opid))
            if not sb_pid:
                unmapped.add(opid)
                continue
            st = stock[bodega].get(opid, {})
            vel = velocity.get(bodega, {}).get(opid, {})
            rows.append({
                'product_id': sb_pid,
                'bodega': bodega,
                'p6': round(vel.get('p6', 0.0), 4),
                'p3': round(vel.get('p3', 0.0), 4),
                'h': round(seasonal.get(opid, 0.0), 4),
                'existencias': round(st.get('exist', 0.0), 4),
                'reserved': round(st.get('reserved', 0.0), 4),
                'patio': round(st.get('patio', 0.0), 4),
                'transito': round(transit.get(opid, 0.0), 4),
                'win': win,
                'as_of': as_of,
                'source_sync_id': sync_id,
            })
    if unmapped:
        issues.add('warning', 'product',
                   f'{len(unmapped)} Odoo products with stock/sales have no Supabase '
                   f'products row — rows skipped (ids sample: {sorted(unmapped)[:10]})')
    return rows


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    dry_run = '--dry-run' in sys.argv
    if not SUPABASE_URL or not SUPABASE_KEY:
        logger.error('Missing Supabase env vars: SUPABASE_URL, SUPABASE_SECRET_KEY')
        sys.exit(1)

    issues = Issues()
    execute = connect_odoo()

    sync_id = None
    if not dry_run:
        run = sb_request('POST', 'sync_runs',
                         {'kind': 'reabastecimiento', 'status': 'running'},
                         prefer='return=representation')
        sync_id = run[0]['id']
        logger.info('sync_run %s started', sync_id)

    try:
        bodega_codes = load_bodega_map(issues)
        by_name = resolve_locations(execute, issues)
        whs = execute('stock.warehouse', 'search_read', [], fields=['id', 'code'])
        wh_ids_by_code = {w['code']: w['id'] for w in whs}

        product_map, sku_to_opid, n_odoo_products, n_inserted = sync_catalog(execute, issues, dry_run)
        stock = sync_stock(execute, by_name, bodega_codes, issues)
        velocity = sync_velocity(execute, bodega_codes, wh_ids_by_code, issues)
        seasonal = sync_seasonal(execute, sku_to_opid, issues)
        transit = sync_transit(execute, issues)

        rows = assemble_inputs(product_map, stock, velocity, transit, seasonal,
                               sync_id, issues)
        counts = {
            'odoo_products': n_odoo_products, 'products_inserted': n_inserted,
            'input_rows': len(rows), 'bodegas': sorted(stock.keys()),
            'transit_products': len(transit), 'issues': len(issues.rows),
        }
        logger.info('assembled: %s', counts)

        if dry_run:
            logger.info('DRY RUN — nothing written. Sample row: %s',
                        json.dumps(rows[0], default=str) if rows else 'none')
            return

        sb_insert_batched('reabastecimiento_inputs', rows,
                          on_conflict='product_id,bodega')
        for issue in issues.rows:
            issue['sync_id'] = sync_id
        sb_insert_batched('sync_issues', issues.rows)
        status = 'partial' if issues.has_errors() else 'success'
        sb_request('PATCH', f'sync_runs?id=eq.{urllib.parse.quote(sync_id)}',
                   {'finished_at': datetime.now(timezone.utc).isoformat(),
                    'status': status, 'counts': counts})
        logger.info('=== SYNC %s: %d input rows ===', status.upper(), len(rows))
    except Exception as e:
        logger.exception('sync failed: %s', e)
        if sync_id:
            sb_request('PATCH', f'sync_runs?id=eq.{urllib.parse.quote(sync_id)}',
                       {'finished_at': datetime.now(timezone.utc).isoformat(),
                        'status': 'failed', 'note': str(e)[:500]})
        sys.exit(1)


if __name__ == '__main__':
    main()
