"""Odoo -> Supabase sync for the live Reabastecimiento engine (COMPRAS / Wilmer).

Populates `reabastecimiento_inputs` (one row per product x bodega) with the
engine inputs measured from MAYO2026.xlsx (docs/compras/MAYO2026_XLSX_MANIFEST.md §3):
  existencias, reserved, patio, transito, p3, p6, h, win

Design decisions (docs/compras/REABASTECIMIENTO_LIVE_PROGRESS.md B2):
  - Bodegas come from the `bodega_map` table (confirmed 2026-07-28: purchasing
    scope = 1CET 'San Jose VN' + 4ZAC 'Zacapa' + 3PET 'Petén', separadas el
    2026-08-21 por W11 — ver 20260821000002). 'General' is a
    computed DISPLAY aggregate: every */Existencias location EXCEPT 5DEP
    (reempaque — no sales, occasional stock); Entrada stays OUT of the
    aggregate (patio shown separately). Rule: Wilmer 2026-08-06 ("todas las
    que sean de existencias… menos 5DEP… Entrada queda fuera"), superseding
    the 07-28 "también patio, todo" answer (Jorge 2026-08-11: latest
    transcript wins — I6). The page tooltips state this composition so any
    disagreement surfaces as a bug report, not a silent mismatch.
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
import time
import unicodedata
import urllib.parse
import urllib.request
import xmlrpc.client
from collections import defaultdict
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

# ── G4 · invoiced demand (Raquel's lens) ─────────────────────────────────────
# Her filter, verbatim from David demonstrating it in Odoo (2026-07-28,
# Ventas → Análisis de facturas): "todas las facturas que no estén en borrador…
# y todo aquello que no esté cancelado… y el tipo de ingreso… yo no voy a
# mostrar algo que tenga como bancos o circular… y aparte es un tema de gastos".
# account.invoice.report itself is DENIED to uid 199 (measured 2026-08-20), but
# it is only a view over account.move.line, which is readable — so the filter is
# reproduced on the underlying table.
INVOICED_MOVE_TYPES = ['out_invoice', 'out_refund']   # refunds negated, as the report does
INVOICED_ACCOUNT_TYPES = ['income', 'income_other']   # "el tipo de ingreso", never bancos/circular/gastos

# Journal → warehouse. The journal name is the only link between a customer
# invoice and a bodega (invoices carry no warehouse_id, and 52.5% of lines have
# no sale order to inherit one from — measured 2026-08-20). Names verbatim from
# production; matching is accent- and case-insensitive, and anything unmatched
# is flagged, never silently bucketed.
CD_JOURNAL_TO_WH = {
    'facturas cd sjvn': '1CET',
    'facturas cd zacapa': '4ZAC',
    'facturas cd peten': '3PET',
}

SUPABASE_BATCH = 500


# ─── Odoo client ──────────────────────────────────────────────────────────────

# Connection retry (incident 2026-08-14 03:00 GT: this cron died before creating
# its sync_runs row — Odoo unreachable during their nightly window — and Railway
# mailed "Deploy Crashed!". One blip should not page anyone: retry a few times,
# and if it is still down, RECORD the failure so the gap is visible in the app's
# own history instead of only in Railway email. The next hourly run recovers on
# its own (every run is a full snapshot).
ODOO_CONNECT_ATTEMPTS = 3
ODOO_CONNECT_BACKOFF_S = 60


def record_failed_run(kind, message):
    """Best-effort 'failed' row in sync_runs. Never raises: this runs on a path
    that is already failing, and losing the breadcrumb must not mask the cause."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        return
    try:
        now = datetime.now(timezone.utc).isoformat()
        sb_request('POST', 'sync_runs',
                   {'kind': kind, 'status': 'failed', 'finished_at': now,
                    'note': str(message)[:500]})
        logger.info('recorded failed sync_run (kind=%s)', kind)
    except Exception:
        logger.warning('could not record the failed run in sync_runs', exc_info=True)


def connect_odoo(kind='reabastecimiento'):
    if not all([ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY]):
        msg = 'Missing Odoo env vars: ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY'
        logger.error(msg)
        record_failed_run(kind, msg)  # config error: no retry, but leave the trace
        sys.exit(1)

    last = None
    for attempt in range(1, ODOO_CONNECT_ATTEMPTS + 1):
        try:
            return _connect_once(attempt)
        except Exception as e:
            last = e
            logger.warning('Odoo connect attempt %d/%d failed: %s',
                           attempt, ODOO_CONNECT_ATTEMPTS, e)
            if attempt < ODOO_CONNECT_ATTEMPTS:
                time.sleep(ODOO_CONNECT_BACKOFF_S)

    msg = f'Odoo unreachable after {ODOO_CONNECT_ATTEMPTS} attempts: {last}'
    logger.error(msg)
    record_failed_run(kind, msg)
    sys.exit(1)


def _connect_once(attempt):
    common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
    uid = common.authenticate(ODOO_DB, ODOO_USERNAME, ODOO_API_KEY, {})
    if not uid:
        # Also retried: during maintenance Odoo answers but refuses auth.
        raise RuntimeError('Odoo authentication returned no uid (per-database API key?)')
    models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)
    logger.info('Odoo connected: uid=%s db=%s (attempt %d)', uid, ODOO_DB, attempt)

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


# Warehouses excluded from the 'General' aggregate (Wilmer 2026-08-06:
# "Todas, menos 5DEP" — 5DEP is reempaque: no sales, occasional stock).
GENERAL_EXCLUDED_WH = ('5DEP',)
# El nombre de la vista de roll-up. Se usaba como literal 'General' en varios
# puntos; W15-B lo necesita también en la atribución del tránsito, así que aquí
# queda con nombre en vez de repetido.
GENERAL_BODEGA = 'General'


def general_exist_location_ids(by_name):
    """The 'General' display aggregate: every */Existencias location except
    GENERAL_EXCLUDED_WH. Entrada deliberately NOT summed (Wilmer 2026-08-06,
    supersedes 07-28 "también patio" — I6, latest transcript wins)."""
    excluded = tuple(f'{wh}/' for wh in GENERAL_EXCLUDED_WH)
    return [i for n, i in by_name.items()
            if n.endswith('/Existencias') and not n.startswith(excluded)]


def product_label(p):
    """Human-readable identity for an Odoo product record (name, else odoo id)."""
    return (p.get('name') or '').strip() or f"odoo:{p['id']}"


def plan_catalog_rows(odoo_products, by_sku, stored_oid_by_row):
    """Decide, for every Odoo product, whether it maps to an existing Supabase
    row, needs its integration key repaired, or is genuinely new. Pure — no I/O.

    Returns (by_odoo_id, oid_repairs, new_rows, no_sku).

    Products with an empty ``default_code`` go to ``no_sku`` and are NEVER
    inserted: SKU is the only stable key (odoo_id drifts on every build,
    2026-08-06), so a code-less row cannot be matched on the next run and would
    be inserted again — measured 2026-08-20 in production, 50 such products
    (servicios, descuentos, pruebas) had grown ``products`` to 13,806 rows at
    ~1,200/day, and two of them ('Descuento', '88001005') reached Wilmer's
    table with sales velocity. The caller reports them as an issue.
    """
    by_odoo_id = {}   # str(new-build odoo id) -> supabase product id
    oid_repairs = []  # (supabase row id, current odoo id) — stale integration keys to heal
    new_rows, no_sku = [], []
    for p in odoo_products:
        oid = str(p['id'])
        sku = p.get('default_code') or None
        if not sku:
            no_sku.append(p)
        elif sku in by_sku:
            row_id = by_sku[sku]
            by_odoo_id[oid] = row_id
            if stored_oid_by_row.get(row_id) != oid:
                oid_repairs.append((row_id, oid))
        else:
            new_rows.append({
                'odoo_id': oid,
                'sku': sku,
                'name': product_label(p)[:255],
                'category': (p['categ_id'][1][:100] if p.get('categ_id') else None),
                'cost': p.get('standard_price') or None,
                'list_price': p.get('list_price') or None,
                'stock_uom': (p['uom_id'][1][:50] if p.get('uom_id') else None),
                'purchase_ok': bool(p.get('purchase_ok', True)),
            })
    return by_odoo_id, oid_repairs, new_rows, no_sku


def sync_catalog(execute, issues, dry_run):
    """Insert-missing products/suppliers/product_suppliers. Existing rows are
    left alone (the running app reads them; mismatches become issues) except
    for two integration/live-state fields repaired in place: odoo_id (stale
    build ids) and purchase_ok (Odoo's live "Can be Purchased" flag).
    Returns (odoo_pid -> supabase product id) map."""
    odoo_products = odoo_read_all(
        execute, 'product.product', [],
        ['id', 'default_code', 'name', 'standard_price', 'list_price', 'uom_id', 'categ_id',
         'purchase_ok'])
    logger.info('Odoo products: %d', len(odoo_products))

    # Match by SKU (content) ONLY. Odoo database ids CHANGE on every build
    # (measured 2026-08-06 against PRODUCTION: 1,666/1,685 stored odoo_ids are
    # stale — most point at nothing, some at UNRELATED products; the old
    # odoo_id fallback silently credited e.g. a sticker's 14,658 units to a
    # bolsa row — caught by Wilmer's Q3 answer: codes are NEVER reused, they
    # carry the same identity since SAE). SKU is the only stable business key.
    # When a SKU matches, the stored odoo_id is REPAIRED to the current build's
    # id (deliberate exception to "never mutate existing rows": odoo_id is an
    # integration key, not business data, and stale values are proven poison).
    existing = sb_get_all('products?select=id,odoo_id,sku,purchase_ok')
    by_sku, dup_skus = {}, 0
    for p in existing:
        if p['sku']:
            if p['sku'] in by_sku:
                dup_skus += 1
            else:
                by_sku[p['sku']] = p['id']
    stored_oid_by_row = {p['id']: p['odoo_id'] for p in existing}
    stored_purchase_ok_by_row = {p['id']: p['purchase_ok'] for p in existing}
    if dup_skus:
        issues.add('warning', 'product',
                   f'{dup_skus} duplicate SKUs already present in Supabase products '
                   f'(first row wins for matching) — review separately')

    by_odoo_id, oid_repairs, new_rows, no_sku = plan_catalog_rows(
        odoo_products, by_sku, stored_oid_by_row)
    if no_sku:
        names = ', '.join(sorted(product_label(p)[:40] for p in no_sku))
        issues.add('warning', 'product',
                   f'{len(no_sku)} Odoo products without default_code — NOT imported. SKU is '
                   f'the only stable key, so a code-less row can never be re-matched: until '
                   f'2026-08-20 each run inserted them again (products grew to 13.8K rows for '
                   f'1.6K real products). Give one a code in Odoo if it must be planned: '
                   f'{names[:1500]}')
    if oid_repairs:
        issues.add('info', 'product',
                   f'{len(oid_repairs)} stored odoo_ids stale vs this build — repaired to the '
                   f'current id (SKU-matched; sku-only matching since 2026-08-06)')
        if not dry_run:
            # odoo_id is UNIQUE and NOT NULL: rotating ids collides with stale
            # holders (409) and cannot pass through null (23502). Phase 1 —
            # park every row that is about to move (repaired rows + any other
            # row still holding a target value) on a per-row sentinel
            # 'stale:<row_id>' (honest marker: integration key invalid for this
            # build). Phase 2 — write the current-build ids. Rows without a
            # prod SKU match keep the sentinel, which is the truth.
            targets = {oid for _rid, oid in oid_repairs} | {r['odoo_id'] for r in new_rows}
            repair_rows = {rid for rid, _oid in oid_repairs}
            holders = [p['id'] for p in existing
                       if p['odoo_id'] in targets or p['id'] in repair_rows]
            for row_id in holders:
                sb_request('PATCH', f'products?id=eq.{row_id}', {'odoo_id': f'stale:{row_id}'})
            for row_id, oid in oid_repairs:
                sb_request('PATCH', f'products?id=eq.{row_id}', {'odoo_id': oid})

    # purchase_ok tracks Odoo's "Can be Purchased" checkbox and drives the
    # solo-comprables filter on the live table — unlike name/category/cost
    # (fixed once inserted, per this function's docstring), a product going
    # non-purchasable is exactly the change that filter exists to surface, so
    # staleness here would silently defeat it. Same targeted-PATCH mechanism
    # as the odoo_id repair above: existing SKU-matched rows only, one PATCH
    # per row that actually drifted.
    purchase_ok_repairs = []
    for p in odoo_products:
        sku = p.get('default_code') or None
        if not sku or sku not in by_sku:
            continue
        row_id = by_sku[sku]
        odoo_val = bool(p.get('purchase_ok', True))
        if stored_purchase_ok_by_row.get(row_id) != odoo_val:
            purchase_ok_repairs.append((row_id, odoo_val))
    if purchase_ok_repairs:
        issues.add('info', 'product',
                   f'{len(purchase_ok_repairs)} purchase_ok flags updated from Odoo')
        if not dry_run:
            for row_id, val in purchase_ok_repairs:
                sb_request('PATCH', f'products?id=eq.{row_id}', {'purchase_ok': val})

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
                    # sku-only for pre-existing rows; freshly-inserted rows carry
                    # this build's odoo_id, so re_by_oid is safe for them alone
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


# Patio = 1CET/Entrada ONLY (Jorge, 2026-07-30: "Make patio display
# 1CET/Entrada without adding anything else"). The physical yard of furgones
# exists at Bodega Central; other */Entrada locations are receiving steps,
# not Wilmer's patio. Shown identically on every bodega row (global, like
# transit).
PATIO_LOCATION = '1CET/Entrada'


def sync_stock(execute, by_name, bodega_codes, issues):
    """Per bodega: {odoo_pid: {'exist','reserved','patio'}} from stock.quant.
    Patio = 1CET/Entrada only, applied to all bodegas. 'General' existencias =
    ALL physical */Existencias locations (incl. tiendas)."""
    patio_ids = []
    if PATIO_LOCATION in by_name:
        patio_ids = [by_name[PATIO_LOCATION]]
    else:
        issues.add('warning', 'bodega_map',
                   f'patio location "{PATIO_LOCATION}" not found — patio=0 everywhere',
                   odoo_id=PATIO_LOCATION)

    result = {}
    targets = dict(bodega_codes)  # purchasing bodegas from bodega_map
    for bodega, codes in targets.items():
        exist_ids = location_ids_for(by_name, codes, ['Existencias'], issues)
        result[bodega] = _stock_for_locations(execute, exist_ids, patio_ids)

    # General display aggregate: every */Existencias incl. tiendas, minus
    # GENERAL_EXCLUDED_WH; Entrada out (Wilmer 2026-08-06 — see module doc).
    exist_ids = general_exist_location_ids(by_name)
    result['General'] = _stock_for_locations(execute, exist_ids, patio_ids)
    logger.info('stock synced for bodegas: %s (+General over %d Existencias locations, '
                'excl. %s; patio=%s only)', list(targets), len(exist_ids),
                GENERAL_EXCLUDED_WH, PATIO_LOCATION)
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


def minus_months(d, n):
    """`d` shifted back n whole months, keeping the day-of-month."""
    y, m = d.year, d.month - n
    while m <= 0:
        y -= 1
        m += 12
    return d.replace(year=y, month=m)


def month_windows(today):
    """(start_3mo, start_6mo, end) = last 3/6 COMPLETE calendar months."""
    first_of_current = today.replace(day=1)
    return (minus_months(first_of_current, 3),
            minus_months(first_of_current, 6),
            first_of_current)


# Months of monthly demand persisted per product x bodega. Six matches the p6
# window, so the buckets partition exactly the same span the average covers and
# can be cross-checked against it (see sync_velocity).
DEMANDA_MESES = 6


def month_buckets(today, n=DEMANDA_MESES):
    """[(label, start, end)] for the last n COMPLETE calendar months, oldest
    first. `end` is exclusive. The CURRENT month is never included: it is
    partial, and treating it as a month would read as a fall on almost every
    product for most of the month."""
    first_of_current = today.replace(day=1)
    starts = [minus_months(first_of_current, k) for k in range(n, 0, -1)]
    bounds = starts + [first_of_current]
    return [(starts[i].strftime('%Y-%m'), bounds[i], bounds[i + 1]) for i in range(n)]


# ── Unit-of-measure conversion (root cause of Wilmer's 2026-08-20 report) ────
# Sale and invoice lines are expressed in the LINE's UoM, not the product's
# stock UoM. Reading `product_uom_qty` / `quantity` raw mixes bundles with
# loose units. Measured: DOMO GP-10X15 (77202156) is stocked in FARDO50 (a
# bundle of 50); the CDs order it in FARDO50 but the tiendas sell it in
# "Unidad FD", so 960 individual domos were counted as 960 fardos — General p3
# read 479/month against a true 165, and the page suggested buying 257 fardos
# when the honest answer was 0. 441 products were inflated this way, some 100×.
# Odoo UoM: qty_reference = qty ÷ uom.factor; qty_in_stock_uom = qty_reference
# × stock_uom.factor. Purchase lines were measured clean (0/6000 mismatched),
# so tránsito is untouched by this.
def fold_uom_groups(groups, factors, stock_uom_by_product, qty_key, uom_key, extra_key=None):
    """Sum read_group rows into the product's stock UoM.

    `groups` are Odoo read_group dicts carrying product_id, a quantity and the
    line's UoM. Returns (totals, unconverted) where totals is keyed by
    product id — or by (product id, extra) when `extra_key` is given — and
    `unconverted` counts rows whose UoM could not be resolved. Those rows are
    still summed at face value and reported: dropping demand silently is worse
    than an over-count we can see.
    """
    totals, unconverted = defaultdict(float), 0
    for g in groups:
        if not g.get('product_id'):
            continue
        pid = g['product_id'][0]
        qty = g.get(qty_key) or 0.0
        line_uom = g.get(uom_key)
        stock_uom_id = stock_uom_by_product.get(pid)
        line_factor = factors.get(line_uom[0]) if line_uom else None
        stock_factor = factors.get(stock_uom_id)
        if line_factor and stock_factor:
            qty = qty / line_factor * stock_factor
        elif line_uom or stock_uom_id:
            unconverted += 1
        key = pid if extra_key is None else (pid, g[extra_key][1] if g.get(extra_key) else None)
        totals[key] += qty
    return dict(totals), unconverted


def load_uom_context(execute):
    """(uom id -> factor, product id -> stock uom id). Fetched once per run."""
    factors = {u['id']: u['factor'] for u in
               execute('uom.uom', 'search_read', [], fields=['id', 'factor'])}
    stock_uom = {p['id']: (p['uom_id'][0] if p.get('uom_id') else None) for p in
                 execute('product.product', 'search_read', [], fields=['id', 'uom_id'])}
    return factors, stock_uom


def _strip_accents(text):
    """Fold accents so 'Petén' and 'Peten' are the same journal."""
    return ''.join(c for c in unicodedata.normalize('NFD', text or '')
                   if unicodedata.category(c) != 'Mn').lower().strip()


def classify_invoice_journal(name):
    """Which perimeter an invoice journal belongs to.

    Returns ('bodega', warehouse_code) for the distribution centres,
    ('tienda', journal_name) for retail stores — their own perimeter, never
    merged into a purchasing bodega (decision 2026-08-20: tiendas also place
    their own sale orders, so folding their invoices into San José would
    double-count) — or ('otros', journal_name) for anything else, which the
    caller reports as an issue.
    """
    flat = _strip_accents(name)
    if flat in CD_JOURNAL_TO_WH:
        return ('bodega', CD_JOURNAL_TO_WH[flat])
    if 'tienda' in flat:
        return ('tienda', name)
    return ('otros', name)


def aggregate_invoiced(rows6, rows3, bodega_codes):
    """Fold invoiced quantities into the same shape as ordered velocity.

    rows*: iterables of (product_id, journal_name, qty) with refunds already
    negated. Returns (by_bodega, tiendas, unmapped).

    Monthly averages over the SAME windows as p6/p3 (÷6, ÷3) — a comparison
    between differently-averaged numbers would be worse than no comparison.
    'General' mirrors the ordered side: ordered General is every warehouse, so
    invoiced General is every journal (CD + tiendas + otros); the page states
    that perimeter in the column tooltip.
    """
    wh_to_bodega = {code: bodega for bodega, codes in bodega_codes.items() for code in codes}
    by_bodega = defaultdict(lambda: defaultdict(lambda: {'f6': 0.0, 'f3': 0.0}))
    tiendas = defaultdict(lambda: {'f6': 0.0, 'f3': 0.0})
    unmapped = defaultdict(float)
    for rows, key, months in ((rows6, 'f6', 6.0), (rows3, 'f3', 3.0)):
        for pid, journal, qty in rows:
            kind, target = classify_invoice_journal(journal)
            share = qty / months
            by_bodega['General'][pid][key] += share
            if kind == 'bodega':
                bodega = wh_to_bodega.get(target)
                if bodega:
                    by_bodega[bodega][pid][key] += share
                else:
                    unmapped[journal] += qty
            elif kind == 'tienda':
                tiendas[(pid, target)][key] += share
            else:
                unmapped[journal] += qty
    return ({b: dict(v) for b, v in by_bodega.items()}, dict(tiendas), dict(unmapped))


def sync_invoiced(execute, bodega_codes, issues, uom_ctx):
    """G4 — invoiced demand per product, on Raquel's filter (display only).

    Never an engine input: the Sugerido stays ordered-driven (H1, Wilmer:
    "hemos comprado mal y re mal, históricamente").
    """
    today = datetime.now(timezone.utc).date()
    start3, start6, end = month_windows(today)
    accounts = execute('account.account', 'search_read',
                       [['account_type', 'in', INVOICED_ACCOUNT_TYPES]], fields=['id'])
    account_ids = [a['id'] for a in accounts]
    issues.add('info', 'sales',
               f'invoiced windows: f3 {start3}->{end}, f6 {start6}->{end}; filtro Raquel = '
               f'posted, {INVOICED_MOVE_TYPES} (notas de crédito en negativo), '
               f'{len(account_ids)} cuentas de ingreso, líneas de producto')

    factors, stock_uom = uom_ctx
    unconverted_total = 0

    def grouped(start):
        nonlocal unconverted_total
        out = []
        for move_type, sign in (('out_invoice', 1), ('out_refund', -1)):
            domain = [['parent_state', '=', 'posted'],
                      ['move_type', '=', move_type],
                      ['account_id', 'in', account_ids],
                      ['display_type', '=', 'product'],
                      ['date', '>=', str(start)], ['date', '<', str(end)]]
            # move_type is a non-stored related field: filterable, NOT groupable
            # (measured 2026-08-20: "Cannot convert field move_type to SQL"),
            # hence one pass per type instead of grouping by it.
            groups = execute('account.move.line', 'read_group', domain,
                             ['quantity'], ['product_id', 'journal_id', 'product_uom_id'],
                             lazy=False, limit=40000)
            # Invoice lines carry the same UoM trap as sale lines — measured
            # 2026-08-20: ~49% of them are billed in a unit other than the
            # product's stock UoM.
            totals, unconverted = fold_uom_groups(
                groups, factors, stock_uom, 'quantity', 'product_uom_id',
                extra_key='journal_id')
            unconverted_total += unconverted
            for (pid, journal), qty in totals.items():
                if journal:
                    out.append((pid, journal, qty * sign))
        return out

    by_bodega, tiendas, unmapped = aggregate_invoiced(
        grouped(start6), grouped(start3), bodega_codes)
    if unmapped:
        detail = ', '.join(f'{j} ({q:,.0f})' for j, q in sorted(unmapped.items(), key=lambda x: -abs(x[1])))
        issues.add('warning', 'sales',
                   f'{len(unmapped)} diarios de factura sin bodega ni tienda — contados solo en '
                   f'General y listados aquí, nunca repartidos a ciegas: {detail[:400]}')
    for bodega, per_product in sorted(by_bodega.items()):
        logger.info('invoiced %s: %d products', bodega, len(per_product))
    if unconverted_total:
        issues.add('warning', 'sales',
                   f'{unconverted_total} grupos de factura sin unidad resoluble — sumados tal cual '
                   f'y reportados')
    logger.info('invoiced tiendas: %d product×tienda rows', len(tiendas))
    return by_bodega, tiendas


def sync_velocity(execute, bodega_codes, wh_ids_by_code, issues, uom_ctx):
    """p3/p6 monthly averages of ORDERED qty per product per bodega, in the
    product's STOCK UoM. General = all warehouses (no filter)."""
    today = datetime.now(timezone.utc).date()
    start3, start6, end = month_windows(today)
    buckets = month_buckets(today)
    factors, stock_uom = uom_ctx
    issues.add('info', 'sales',
               f'velocity windows: p3 {start3}->{end}, p6 {start6}->{end}; '
               f'states={ORDERED_STATES} (assumption, OQ-D); cantidades convertidas '
               f'a la unidad de stock del producto (las tiendas venden por unidad, '
               f'los CD por fardo/caja — bug medido 2026-08-20)')
    unconverted_total = 0

    def grouped(domain):
        nonlocal unconverted_total
        groups = execute('sale.order.line', 'read_group', domain,
                         ['product_uom_qty'], ['product_id', 'product_uom'],
                         lazy=False, limit=40000)
        totals, unconverted = fold_uom_groups(
            groups, factors, stock_uom, 'product_uom_qty', 'product_uom')
        unconverted_total += unconverted
        return totals

    # Month-to-date: "compara la venta del mes vs el promedio" (Wilmer 2026-08-20).
    # `end` is the first day of the CURRENT month, so this window is exactly the
    # part of the month the averages cannot see yet.
    mtd_dias = today.day

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
        qm = grouped(base + [['order_id.date_order', '>=', str(end)]])

        # Per-month buckets for the rising-trend alert (Wilmer 2026-08-20).
        # Queried SEPARATELY instead of deriving p6/p3 from them: the averages
        # are Wilmer's numbers and are not touched here. The two are then
        # cross-checked below, so a divergence is reported instead of silently
        # shipping a series that disagrees with the average beside it.
        per_month = {}
        for label, m_start, m_end in buckets:
            per_month[label] = grouped(base + [['order_id.date_order', '>=', str(m_start)],
                                               ['order_id.date_order', '<', str(m_end)]])

        pids = set(q6) | set(q3) | set(qm)
        for month_totals in per_month.values():
            pids |= set(month_totals)
        result[bodega] = {pid: {'p6': q6.get(pid, 0.0) / 6.0,
                                'p3': q3.get(pid, 0.0) / 3.0,
                                'mtd': qm.get(pid, 0.0),
                                'mtd_dias': mtd_dias,
                                # Explicit zeros: "did not sell" is a real
                                # datapoint and the trend rule needs a complete,
                                # gap-free series to judge adjacency.
                                'demanda_mensual': {
                                    label: round(per_month[label].get(pid, 0.0), 4)
                                    for label, _s, _e in buckets}}
                          for pid in pids}

        # The 6 buckets partition exactly the p6 window, so their sum must equal
        # it. If it does not, something about the windows or the UoM folding is
        # wrong and the trend alert would be built on a different number than
        # the average shown next to it -- report, never paper over.
        sum_buckets = sum(sum(t.values()) for t in per_month.values())
        sum_q6 = sum(q6.values())
        if abs(sum_buckets - sum_q6) > max(1.0, abs(sum_q6) * 1e-6):
            issues.add('warning', 'sales',
                       f'{bodega}: la suma de los {len(buckets)} meses ({sum_buckets:.2f}) no '
                       f'coincide con la ventana p6 ({sum_q6:.2f}) -- la serie mensual y el '
                       f'promedio no vienen del mismo dato; revisar antes de confiar en la '
                       f'alerta de tendencia')
        logger.info('velocity %s: %d products', bodega, len(result[bodega]))
    if unconverted_total:
        issues.add('warning', 'sales',
                   f'{unconverted_total} grupos de venta sin unidad resoluble — sumados tal cual '
                   f'y reportados (nunca descartados); revisar uom del producto o de la línea')
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


def attribute_transit(lines, wh_by_order, bodega_codes,
                      fecha_por_orden=None, nombre_por_orden=None):
    """Reparte las líneas pendientes entre bodegas según el almacén que las
    recibe. Puro — sin I/O, para poder probarlo (mismo criterio que
    `aggregate_invoiced`).

    Devuelve `(transit, fuera_de_alcance, counted)`:
      * `transit`          {bodega: {odoo_product_id: qty}}
      * `fuera_de_alcance` {warehouse_code: qty} — almacenes sin fila en
                           bodega_map. Se REPORTAN, no se reparten.
      * `counted`          líneas con pendiente > 0 consideradas.

    LA INVARIANTE QUE ESTE REPARTO INTRODUCE: una cantidad pendiente cae en
    EXACTAMENTE UNA bodega de compra. Antes del 2026-08-27 caía en las tres, y
    por eso sumarlas triplicaba. `General` es la única que ve el conjunto, y
    con el mismo perímetro que ya usa su stock (todo menos GENERAL_EXCLUDED_WH).
    """
    transit = defaultdict(lambda: defaultdict(float))
    fuera_de_alcance = defaultdict(float)
    # A6.15 — el mismo recorrido produce el DESGLOSE por fecha. Se arma acá y no
    # en una segunda pasada porque es exactamente la misma decisión de
    # atribución: si se calculara aparte, el día que cambie la regla de bodega
    # el detalle y el total dirían cosas distintas y nadie sabría cuál creer.
    detalle = []
    counted = 0
    wh_to_bodega = {code: bodega for bodega, codes in bodega_codes.items() for code in codes}
    fecha_por_orden = fecha_por_orden or {}
    nombre_por_orden = nombre_por_orden or {}
    for ln in lines:
        if not ln.get('product_id'):
            continue
        pending = (ln.get('product_qty') or 0.0) - (ln.get('qty_received') or 0.0)
        if pending <= 0:
            continue
        opid = ln['product_id'][0]
        code = wh_by_order.get(ln['order_id'][0]) if ln.get('order_id') else None
        bodega = wh_to_bodega.get(code)
        if bodega:
            transit[bodega][opid] += pending
            # La fecha de la LÍNEA es la «Fecha Esperada» con la que se arma la
            # rampa; sólo si falta se cae a la del encabezado. La INCLUSIÓN
            # sigue decidida por el encabezado (arriba), así que el detalle
            # explica el total sin poder alterarlo.
            detalle.append({
                'bodega': bodega,
                'opid': opid,
                'fecha': (ln.get('date_planned') or fecha_por_orden.get(
                    ln['order_id'][0] if ln.get('order_id') else None) or None),
                'qty': pending,
                'orden': nombre_por_orden.get(
                    ln['order_id'][0] if ln.get('order_id') else None),
            })
        else:
            # Sin fila en bodega_map: subcontratación, Zona 11, tiendas o
            # desconocido. Se le pone nombre al hueco en vez de adivinarlo.
            fuera_de_alcance[code or '(sin picking_type)'] += pending
        if code not in GENERAL_EXCLUDED_WH:
            transit[GENERAL_BODEGA][opid] += pending
        counted += 1
    return transit, fuera_de_alcance, counted, detalle


def warehouse_by_picking_type(execute):
    """{picking_type_id: warehouse_code}. Resolves a PO to the warehouse that
    RECEIVES it, which is the only destination Odoo actually holds.

    MEASURED 2026-08-27 against production: 39 future-dated orders, 186 pending
    lines, and `picking_type_id` resolved for 100% of them — 0 unresolvable.
    The attribution below is therefore not best-effort; it is complete."""
    types = odoo_read_all(execute, 'stock.picking.type', [], ['warehouse_id'])
    warehouses = odoo_read_all(execute, 'stock.warehouse', [], ['code'])
    code_by_wh = {w['id']: w.get('code') for w in warehouses}
    return {t['id']: code_by_wh.get(t['warehouse_id'][0]) if t.get('warehouse_id') else None
            for t in types}


def map_detalle_rows(transito_detalle, product_map, sync_id):
    """Traduce el desglose de tránsito a filas de `transito_detalle`.

    Existe como función aparte para que se pueda PROBAR. La primera versión
    vivía suelta dentro de `main()` y buscaba `product_map[opid]` con un int,
    cuando el mapa está indexado por STRING del id de Odoo: devolvía None para
    todas las líneas y escribía una tabla vacía sin lanzar un solo error. Las
    pruebas de `attribute_transit` pasaban perfectas, porque el error no estaba
    en la atribución sino en la traducción — que era la única parte sin cubrir.

    Una línea cuyo producto no está en el catálogo se descarta, igual que en el
    resto del sync: no tendría fila donde mostrarse.
    """
    filas = []
    for d in transito_detalle:
        pid = product_map.get(str(d['opid']))
        if not pid:
            continue
        filas.append({
            'product_id': pid,
            'bodega': d['bodega'],
            'fecha': (d['fecha'] or '')[:10] or None,
            'qty': round(d['qty'], 4),
            'orden': d['orden'],
            'sync_id': sync_id,
        })
    return filas


def sync_transit(execute, issues, bodega_codes):
    """Per-BODEGA transit: confirmed PO lines with pending qty
    (product_qty - qty_received > 0) on orders expected TODAY OR LATER,
    attributed to the warehouse that receives them.

    ⚠️ W15-B — WHAT THIS FIXES, and it was worse than reported.

    Until 2026-08-27 this function returned `{product_id: qty}` with no bodega
    dimension at all, and `assemble_inputs()` wrote that ONE number into EVERY
    bodega row. The transit was not "mixed" as Wilmer described it — it was
    REPLICATED. He reported the symptom exactly right (*"estos 50 en tránsito
    no son de la bodega de Zacapa"* · *"ahorita todos están revueltos"*), and
    since the engine credits `exist + trans` against the forecast, foreign
    transit SUPPRESSED his Sugerido: *"no me da un sugerido porque está tomando
    los 3 saques"*.

    MEASURED IN PRODUCTION 2026-08-27, before the fix (56,847 units pending):
        1CET  (San Jose VN)  39,861   70.1%
        SUB   (Envaica)       9,305   16.4%   ← not a purchasing bodega
        2Z11  (Zona 11)       6,361   11.2%   ← out of scope
        SUBPA (Plást. Amer.)  1,300    2.3%   ← not a purchasing bodega
        T7Z11 (tienda)           20    0.0%   ← out of scope
        4ZAC  (Zacapa)            0
        3PET  (Petén)             0

    Two facts fall out of that table, and both matter more than the mechanism:

      1. **Zacapa and Petén have NO inbound purchase orders at all.** Every
         unit of tránsito those two views showed was somebody else's. That is
         the whole of his complaint, quantified.
      2. **~30% of the total is bound for warehouses outside the purchasing
         scope** (subcontracting, Zona 11, a tienda). It belongs to NO
         purchasing bodega, and it was inflating all three.

    ATTRIBUTION RULE — final destination only (Jorge, Q26/Q2, 2026-08-27):
    a pending quantity belongs to exactly ONE bodega, the warehouse that
    receives it. The three bodegas partition the total instead of each holding
    a copy of it, so summing them is now meaningful.

    Warehouses with no `bodega_map` row are NOT distributed and NOT dropped:
    they go to a reported bucket, because silently folding them into a bodega
    is how the current defect started.

    'General' keeps a roll-up, but of the same perimeter its stock already uses
    (every warehouse except GENERAL_EXCLUDED_WH) — not the raw global total.

    ⚠️ INTERNAL TRANSFERS ARE DELIBERATELY NOT INCLUDED. The chain San José →
    Zacapa → Petén moves on internal `stock.picking`, and those were measured
    the same day: of 300 open internal transfers, 236 are `X/Entrada →
    X/Existencias` — the putaway leg INSIDE one warehouse, i.e. goods that have
    already arrived (that is patio, and counting it here would double it).
    The genuine outbound leg `1CET/Existencias → 1CET a 4ZAC` had exactly **2**
    open transfers, and `4ZAC → 3PET` had none: the internal legs complete too
    fast to be in flight at any instant. Including them would add ~0 and risk
    double counting. Revisit only if that measurement changes.

    RULE CONFIRMED BY WILMER 2026-07-30 (OQ-F): "Tránsito no cuenta fechas
    pasadas." His discipline: when a supplier reschedules, he UPDATES the
    delivery date — MEASURED 2026-08-06: that update lives on the PO HEADER
    date_planned (the "Fecha Esperada" of the rampa schedule, e.g.
    x_studio_horario_rampa_inicio), NOT on the lines (line dates stay stale:
    PO-P-2960 lines said 08-01 while the header said 08-06 with rampa booked).
    Also measured: orders arriving today sit in state='done' (locked) with
    receipts still pending — so state must include 'done', and "today" counts
    as transit until received (falsified live by Wilmer 2026-08-06: transit=0
    while 4 trucks arrived that day). Past-dated headers remain excluded
    (the never-cancelled pile) and are reported."""
    today0 = datetime.now(timezone.utc).strftime('%Y-%m-%d 00:00:00')
    orders = odoo_read_all(execute, 'purchase.order',
                           [['state', 'in', ['purchase', 'done']]],
                           ['name', 'date_planned', 'picking_type_id'])
    future = [o for o in orders if (o.get('date_planned') or '') >= today0]
    future_ids = [o['id'] for o in future]
    past_ids = [o['id'] for o in orders if (o.get('date_planned') or '') < today0]

    # Order -> receiving warehouse code. Measured 100% resolvable 2026-08-27.
    pt_wh = warehouse_by_picking_type(execute)
    wh_by_order = {}
    sin_picking_type = 0
    for o in future:
        pt = o['picking_type_id'][0] if o.get('picking_type_id') else None
        code = pt_wh.get(pt) if pt else None
        if code is None:
            sin_picking_type += 1
        wh_by_order[o['id']] = code

    lines = odoo_read_all(execute, 'purchase.order.line',
                          [['order_id', 'in', future_ids]],
                          ['order_id', 'product_id', 'product_qty', 'qty_received', 'date_planned']) \
        if future_ids else []
    past_lines = odoo_read_all(execute, 'purchase.order.line',
                               [['order_id', 'in', past_ids]],
                               ['product_id', 'product_qty', 'qty_received']) if past_ids else []

    past_excluded = sum(
        1 for ln in past_lines
        if ln.get('product_id') and ((ln.get('product_qty') or 0.0) - (ln.get('qty_received') or 0.0)) > 0)
    # A6.15 — el detalle necesita la fecha y el correlativo de la orden, que ya
    # se leyeron arriba: se pasan en lugar de volver a consultarlos.
    fecha_por_orden = {o['id']: (o.get('date_planned') or None) for o in future}
    nombre_por_orden = {o['id']: o.get('name') for o in future}
    transit, fuera_de_alcance, counted, transito_detalle = attribute_transit(
        lines, wh_by_order, bodega_codes, fecha_por_orden, nombre_por_orden)

    por_bodega = ', '.join(
        f'{b}={sum(v.values()):,.0f}' for b, v in sorted(transit.items()) if b != GENERAL_BODEGA
    ) or '(ninguna)'
    issues.add('info', 'transit',
               f'transit = pending on orders expected today-or-later, header date, '
               f'states purchase+done (rule fixed 2026-08-06 after Wilmer falsified transit=0): '
               f'{counted} lines counted; {past_excluded} pending lines on past-dated orders excluded '
               f'(incl. the no-auto-cancel pile back to 2024-10 — cleanup with David). '
               f'W15-B: atribuido por bodega destino (picking_type -> almacén) — {por_bodega}')
    if sin_picking_type:
        issues.add('warning', 'transit',
                   f'{sin_picking_type} órdenes futuras sin picking_type resoluble — '
                   f'su pendiente NO se atribuyó a ninguna bodega')
    if fuera_de_alcance:
        detalle = ', '.join(f'{k}={v:,.0f}' for k, v in
                            sorted(fuera_de_alcance.items(), key=lambda kv: -kv[1]))
        total_fuera = sum(fuera_de_alcance.values())
        issues.add('info', 'transit',
                   f'tránsito hacia almacenes SIN fila en bodega_map: {total_fuera:,.0f} unidades '
                   f'({detalle}). NO se reparte entre las bodegas de compra — antes del 2026-08-27 '
                   f'este volumen inflaba las tres por igual (subcontratación, Zona 11, tiendas)')

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
            # Draft lines carry no confirmed receiving warehouse, so under the
            # final-destination rule they cannot be attributed. They would have
            # to be resolved the same way (order -> picking_type) before this
            # flag is ever turned on; until then, turning it on with the old
            # global behaviour would silently reintroduce the replication bug.
            issues.add('warning', 'transit',
                       'INCLUDE_DRAFT_TRANSIT=True pero las líneas borrador no se '
                       'pueden atribuir a una bodega destino — se OMITEN (W15-B). '
                       'Resolverlas por picking_type antes de habilitar el flag.')
    logger.info('transit: %s',
                ', '.join(f'{b}={len(v)} productos' for b, v in sorted(transit.items())) or 'vacío')
    return {b: dict(v) for b, v in transit.items()}, transito_detalle


WINDOW_BY_BODEGA = {'General': 10}  # measured: General=10, locations=5
DEFAULT_WINDOW = 5


def assemble_inputs(product_map, stock, velocity, transit, seasonal, invoiced, sync_id, issues):
    """Join everything into reabastecimiento_inputs rows. pending_reserve is
    NEVER set (decision 2026-07-30 — manual only)."""
    as_of = datetime.now(timezone.utc).isoformat()
    # A product can have stock and NO sale line in the whole 6-month window: it
    # then has no velocity entry at all. Its monthly demand is a known ZERO, not
    # an unknown -- measured 2026-08-21, that is 596 of 2,970 rows. Writing NULL
    # for them would make the page say "not evaluable yet, waiting on the next
    # sync" forever about products the sync has already fully answered.
    # NULL is reserved for exactly one thing: this column predates the row.
    zero_series = {label: 0.0 for label, _s, _e in
                   month_buckets(datetime.now(timezone.utc).date())}
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
            # G4: invoiced lens, display only — never read by the engine.
            fac = invoiced.get(bodega, {}).get(opid, {})
            rows.append({
                'product_id': sb_pid,
                'bodega': bodega,
                'p6': round(vel.get('p6', 0.0), 4),
                'p3': round(vel.get('p3', 0.0), 4),
                'h': round(seasonal.get(opid, 0.0), 4),
                'existencias': round(st.get('exist', 0.0), 4),
                'reserved': round(st.get('reserved', 0.0), 4),
                'patio': round(st.get('patio', 0.0), 4),
                # W15-B — por (bodega, producto). Antes era el MISMO número
                # global replicado en las tres bodegas.
                'transito': round(transit.get(bodega, {}).get(opid, 0.0), 4),
                'f6': round(fac.get('f6', 0.0), 4),
                'f3': round(fac.get('f3', 0.0), 4),
                'mtd': round(vel.get('mtd', 0.0), 4),
                'mtd_dias': vel.get('mtd_dias'),
                # Explicit zeros when the product had no sales at all in the
                # window -- "did not sell" is an answer, not a missing value.
                'demanda_mensual': vel.get('demanda_mensual') or zero_series,
                'win': win,
                'as_of': as_of,
                'source_sync_id': sync_id,
            })
    if unmapped:
        issues.add('warning', 'product',
                   f'{len(unmapped)} Odoo products with stock/sales have no Supabase '
                   f'products row — rows skipped (ids sample: {sorted(unmapped)[:10]})')
    return rows


def assemble_tiendas(product_map, tiendas, sync_id, issues):
    """Rows for `invoiced_tiendas` — the retail perimeter, kept separate from
    the purchasing bodegas so nothing is merged behind anyone's back."""
    as_of = datetime.now(timezone.utc).isoformat()
    rows, unmapped = [], set()
    for (opid, tienda), vals in tiendas.items():
        sb_pid = product_map.get(str(opid))
        if not sb_pid:
            unmapped.add(opid)
            continue
        rows.append({
            'product_id': sb_pid,
            'tienda': tienda[:80],
            'f6': round(vals.get('f6', 0.0), 4),
            'f3': round(vals.get('f3', 0.0), 4),
            'as_of': as_of,
            'source_sync_id': sync_id,
        })
    if unmapped:
        issues.add('warning', 'sales',
                   f'{len(unmapped)} productos facturados en tiendas sin fila en products — '
                   f'filas omitidas (ids: {sorted(unmapped)[:10]})')
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
        uom_ctx = load_uom_context(execute)
        stock = sync_stock(execute, by_name, bodega_codes, issues)
        velocity = sync_velocity(execute, bodega_codes, wh_ids_by_code, issues, uom_ctx)
        seasonal = sync_seasonal(execute, sku_to_opid, issues)
        transit, transito_detalle = sync_transit(execute, issues, bodega_codes)
        invoiced, tiendas = sync_invoiced(execute, bodega_codes, issues, uom_ctx)

        rows = assemble_inputs(product_map, stock, velocity, transit, seasonal,
                               invoiced, sync_id, issues)
        tienda_rows = assemble_tiendas(product_map, tiendas, sync_id, issues)

        # A6.15 — desglose por fecha del tránsito. `product_map` traduce el id
        # de Odoo al nuestro; una línea cuyo producto no está en el catálogo se
        # descarta acá igual que en el resto del sync, porque no tendría fila
        # donde mostrarse.
        detalle_rows = map_detalle_rows(transito_detalle, product_map, sync_id)

        # DATA HORIZON — the newest business activity in Odoo (NOT the sync
        # time). Surfaced so the UI never claims freshness the data lacks
        # (2026-07-30: a Jul-29 clone labeled "datos al 30/7" made a correct
        # patio number look wrong — the descargas of the 30th weren't in it).
        horizon = ''
        for model, fld, dom in (('purchase.order', 'date_order', []),
                                ('stock.picking', 'date_done', [['date_done', '!=', False]])):
            r = execute(model, 'search_read', dom, fields=[fld],
                        order=f'{fld} desc', limit=1)
            if r and (r[0].get(fld) or '') > horizon:
                horizon = r[0][fld]
        counts = {
            'odoo_products': n_odoo_products, 'products_inserted': n_inserted,
            'input_rows': len(rows), 'bodegas': sorted(stock.keys()),
            'transit_products': len({p for v in transit.values() for p in v}),
            'transit_por_bodega': {b: len(v) for b, v in sorted(transit.items())}, 'issues': len(issues.rows),
            'invoiced_rows': sum(1 for r in rows if r['f6'] or r['f3']),
            'tienda_rows': len(tienda_rows),
            'data_horizon': horizon or None,
        }
        logger.info('assembled: %s', counts)

        if dry_run:
            logger.info('DRY RUN — nothing written. Sample row: %s',
                        json.dumps(rows[0], default=str) if rows else 'none')
            return

        sb_insert_batched('reabastecimiento_inputs', rows,
                          on_conflict='product_id,bodega')
        sb_insert_batched('invoiced_tiendas', tienda_rows,
                          on_conflict='product_id,tienda')

        # A6.15 — la tabla de detalle se REEMPLAZA entera: es un espejo de
        # Odoo, no una captura de nadie. Borrar primero y escribir después es
        # correcto acá y sería destructivo en `transito_overrides` o
        # `sugerido_bodega`, que son append-only porque ahí el historial ES el
        # dato. Si el borrado funciona y la escritura falla, la próxima corrida
        # (dentro de una hora) lo repone; mientras tanto la columna Tránsito
        # sigue mostrando su total, que no depende de esta tabla.
        # Control: si hay tránsito pero el desglose salió vacío, algo se rompió
        # en la traducción de ids y la columna quedaría sin explicación. Se avisa
        # en vez de escribir una tabla vacía en silencio — que es exactamente lo
        # que pasó la primera vez que esto corrió.
        hay_transito = any(v for b, v in transit.items() if b != GENERAL_BODEGA)
        if hay_transito and not detalle_rows:
            issues.add('warn', 'transito_detalle',
                       'hay transito pero el desglose salio vacio: revisar la traduccion '
                       'de product_id (product_map se indexa por str, no por int)')
        sb_request('DELETE', 'transito_detalle?id=not.is.null')
        sb_insert_batched('transito_detalle', detalle_rows)
        logger.info('transito_detalle: %d lineas', len(detalle_rows))
        # Purge rows this run did NOT touch: products that vanished from Odoo
        # (or lost all data) would otherwise serve a stale snapshot forever —
        # measured 2026-08-06: the mis-matched bolsa 11011048 kept showing the
        # sticker's 14,658 after the identity fix because upsert never removes.
        run_start = min(r['as_of'] for r in rows) if rows else None
        if run_start:
            stale = sb_request(
                'DELETE',
                f'reabastecimiento_inputs?as_of=lt.{urllib.parse.quote(run_start)}',
                prefer='return=representation') or []
            if stale:
                issues.add('info', 'stock',
                           f'{len(stale)} filas de inputs purgadas (productos sin datos en esta '
                           f'corrida — instantáneas viejas no deben sobrevivir)')
        if run_start:
            stale_t = sb_request(
                'DELETE',
                f'invoiced_tiendas?as_of=lt.{urllib.parse.quote(run_start)}',
                prefer='return=representation') or []
            if stale_t:
                issues.add('info', 'sales',
                           f'{len(stale_t)} filas de tiendas purgadas (sin facturación en esta '
                           f'corrida — instantáneas viejas no deben sobrevivir)')
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
