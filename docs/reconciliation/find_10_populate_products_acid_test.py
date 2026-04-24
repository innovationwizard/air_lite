"""
Step 4 — Populate products_acid_test_active and _archived from Odoo live.

Scope:
  REYMA   = product.product where name ILIKE '%reyma%'
            (also probes supplier link to REYMA DEL SURESTE id=22733 — but
             current supplier-only set is empty after excluding broken links;
             SOURCE column will say NAME unless we find both)

  CARVAJAL = product.product where name ILIKE '%carvajal%'
            ∪ product.supplierinfo links to ANY active Carvajal partner
              EXCLUDING `NO USAR CARVAJAL EMPAQUES` (id=20092)
              EXCLUDING `DEPOSITO REYMAPLAST` (id=17694, customer-only anyway)
            Carvajal-family partner IDs (active, supplier_rank>0):
              24255  CARVAJAL EMPAQUES CENTROAMERICA
              24388  CARVAJAL EMPAQUES, S.A. DE C.V.
              24254  Carvajal Empaques, CALI, COLOMBIA
              42114  DISTRIBUIDORA CARVAJAL EMPAQUES
              (NOT 20092 NO USAR; NOT individual people CARVAJAL,PULUC etc.)

For each candidate template:
  - Collect all product.product variants (active + archived)
  - Compute Net Sales using winning formula (aml + income + posted +
    out_invoice/out_refund refund-as-negative + invoice_date + UoM-norm)
  - Active table: row if any variant is active
  - Archived table: row if all variants are archived; flag has_recent_activity
    if any sales in last 12 months
  - Rank by net_sales_quantity (descending) within each supplier_class
  - Mark top 10 of each class

Cross-reference: tag rows whose default_code is in the run58_36_list.
"""
import os
import json
import xmlrpc.client
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/find_10_populate_products_acid_test_output.json')
EXTRACT_OPS = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_77201046_latest.json')

# Supplier IDs to INCLUDE for Carvajal (active companies, supplier_rank > 0)
CARVAJAL_SUPPLIER_IDS = [24255, 24388, 24254, 42114]
# Explicitly EXCLUDED (per user direction)
EXCLUDED_SUPPLIER_IDS = [20092]  # NO USAR CARVAJAL EMPAQUES

def load_env():
    for f in ['/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
              '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env']:
        p = Path(f)
        if not p.exists(): continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip()
                if k not in os.environ:
                    os.environ[k] = v
load_env()

URL = os.environ['ODOO_URL']
DB = os.environ['ODOO_DB']
USER = os.environ['ODOO_USERNAME']
KEY = os.environ['ODOO_API_KEY']
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']

print(f"Auth → {URL}")
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(DB, USER, KEY, {})
print(f"uid={uid}")
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object', allow_none=True)

def call(method, model, *args, **kwargs):
    """Wrapper with simple retry on transient 502/timeout."""
    import time as _time
    last_exc = None
    for attempt in range(4):
        try:
            return models.execute_kw(DB, uid, KEY, model, method, list(args), kwargs)
        except (xmlrpc.client.ProtocolError, ConnectionError, TimeoutError) as e:
            last_exc = e
            wait = 2 ** attempt
            print(f"      retry {attempt + 1}/4 after {wait}s — {type(e).__name__}: {str(e)[:120]}")
            _time.sleep(wait)
    raise last_exc

def supa(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'}
    if data is not None: headers['Content-Type'] = 'application/json'
    if prefer: headers['Prefer'] = prefer
    req = urllib.request.Request(f"{SUPA}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# ─── 1. Pre-flight: tables exist? ───────────────────────────────────────
for t in ('products_acid_test_active', 'products_acid_test_archived'):
    s, b = supa('GET', f'/rest/v1/{t}?limit=1')
    if s >= 400:
        print(f"ERROR — {t} not in prod (HTTP {s}). Apply migration first:")
        print(f"  docs/reconciliation/PASTE_TO_SUPABASE_STUDIO_002.sql")
        raise SystemExit(2)
print("Tables exist. Proceeding.")

# ─── 2. Pull run-58 36-SKU list for cross-ref ───────────────────────────
print("\nPulling run-58 36-SKU Carvajal+Reyma list for cross-reference...")
s, b = supa('POST', '/rest/v1/rpc/rpc_gerencia_validation',
             body={'p_run_id': 58, 'p_carvajal_reyma_only': True})
run58_skus = {row['sku'] for row in b}
print(f"  run-58 SKUs: {len(run58_skus)}")

# ─── 3. Identify candidate product.products ─────────────────────────────
PRODUCT_FIELDS = ['id', 'name', 'default_code', 'active', 'product_tmpl_id', 'uom_id']

print("\n=== Identifying REYMA candidates (name only per user) ===")
reyma_products = call('search_read', 'product.product',
                       ['|', ['active', '=', True], ['active', '=', False],
                        ['name', 'ilike', 'reyma']],
                       fields=PRODUCT_FIELDS)
print(f"  REYMA name match: {len(reyma_products)} products "
      f"(active={sum(1 for p in reyma_products if p['active'])}, "
      f"archived={sum(1 for p in reyma_products if not p['active'])})")

print("\n=== Identifying CARVAJAL candidates (name + supplier link) ===")
carvajal_by_name = call('search_read', 'product.product',
                         ['|', ['active', '=', True], ['active', '=', False],
                          ['name', 'ilike', 'carvajal']],
                         fields=PRODUCT_FIELDS)
print(f"  CARVAJAL name match: {len(carvajal_by_name)}")

# Supplier-link expansion (templates linked to active Carvajal partners, excl. NO USAR)
print(f"  Probing product.supplierinfo for partners {CARVAJAL_SUPPLIER_IDS}...")
sups = call('search_read', 'product.supplierinfo',
             [['partner_id', 'in', CARVAJAL_SUPPLIER_IDS]],
             fields=['id', 'partner_id', 'product_id', 'product_tmpl_id'])
print(f"  Carvajal supplierinfo rows: {len(sups)}")
direct_pp_ids = {s['product_id'][0] for s in sups if s.get('product_id')}
template_ids = {s['product_tmpl_id'][0] for s in sups if s.get('product_tmpl_id')}
print(f"    direct product links: {len(direct_pp_ids)}, template links: {len(template_ids)}")

carvajal_by_supplier_pp = []
if direct_pp_ids:
    carvajal_by_supplier_pp = call('search_read', 'product.product',
                                     ['|', ['active', '=', True], ['active', '=', False],
                                      ['id', 'in', list(direct_pp_ids)]],
                                     fields=PRODUCT_FIELDS)
if template_ids:
    extra = call('search_read', 'product.product',
                  ['|', ['active', '=', True], ['active', '=', False],
                   ['product_tmpl_id', 'in', list(template_ids)]],
                  fields=PRODUCT_FIELDS)
    seen = {p['id'] for p in carvajal_by_supplier_pp}
    carvajal_by_supplier_pp.extend([p for p in extra if p['id'] not in seen])
print(f"  CARVAJAL supplier link expansion (including via template): {len(carvajal_by_supplier_pp)} products")

# ─── 4. Build template → variants mapping + supplier_class + source_indicator ─
print("\n=== Building template universe ===")

# Index: template_id -> {variants: [...], reyma_name: bool, carvajal_name: bool, carvajal_supplier: bool}
templates = defaultdict(lambda: {'variants': [], 'reyma_name': False,
                                  'carvajal_name': False, 'carvajal_supplier': False})

def add_to_template(p, flag):
    if not p.get('product_tmpl_id'): return
    tid = p['product_tmpl_id'][0]
    if not any(v['id'] == p['id'] for v in templates[tid]['variants']):
        templates[tid]['variants'].append(p)
    templates[tid][flag] = True

for p in reyma_products:
    add_to_template(p, 'reyma_name')
for p in carvajal_by_name:
    add_to_template(p, 'carvajal_name')
for p in carvajal_by_supplier_pp:
    add_to_template(p, 'carvajal_supplier')

print(f"  Distinct templates in universe: {len(templates)}")

# Compute supplier_class + source_indicator for each
for tid, d in templates.items():
    is_reyma = d['reyma_name']
    is_carvajal = d['carvajal_name'] or d['carvajal_supplier']
    if is_reyma and is_carvajal:
        d['supplier_class'] = 'BOTH'
    elif is_reyma:
        d['supplier_class'] = 'REYMA'
    elif is_carvajal:
        d['supplier_class'] = 'CARVAJAL'
    else:
        d['supplier_class'] = 'UNKNOWN'

    # Source indicator (relative to that class)
    if is_carvajal:
        if d['carvajal_name'] and d['carvajal_supplier']:
            si = 'BOTH'
        elif d['carvajal_name']:
            si = 'NAME'
        else:
            si = 'SUPPLIER_LINK'  # ← visual flag
    else:  # REYMA
        si = 'NAME'  # Reyma is name-only per user
    d['source_indicator'] = si

cls_counts = defaultdict(int)
src_counts = defaultdict(int)
for d in templates.values():
    cls_counts[d['supplier_class']] += 1
    src_counts[d['source_indicator']] += 1
print(f"  Class distribution: {dict(cls_counts)}")
print(f"  Source-indicator distribution: {dict(src_counts)}")

# ─── 5. Compute Net Sales per template using winning formula ─────────────
all_pp_ids = sorted({v['id'] for d in templates.values() for v in d['variants']})
print(f"\n  Total product.product IDs across all templates: {len(all_pp_ids)}")

# UoM data — we need uom factors. Reuse from prior extract or fetch fresh.
uom_recs = call('search_read', 'uom.uom', [], fields=['id', 'name', 'factor'])
uom_by_id = {u['id']: u for u in uom_recs}
caja40_factor = next(u['factor'] for u in uom_recs if u['name'] == 'CAJA40')
def to_stock_uom(qty, src_uom_id, target_uom_id):
    """Convert qty in src UoM to target UoM (cross-ratio inside same category)."""
    if not src_uom_id or src_uom_id == target_uom_id:
        return qty
    f_src = uom_by_id.get(src_uom_id, {}).get('factor', 1.0)
    f_tgt = uom_by_id.get(target_uom_id, {}).get('factor', 1.0)
    if not f_src or f_src == 0:
        return qty
    return qty * f_tgt / f_src

# Per-product stock UoM (from product.product.uom_id)
product_stock_uom = {p['id']: (p['uom_id'][0] if p.get('uom_id') else None)
                     for d in templates.values() for p in d['variants']}

# Fetch account.move.line totals for ALL candidate products in 2 chunks
# (one for out_invoice, one for out_refund — refund counted negative)
print(f"\n  Fetching account.move.line for all {len(all_pp_ids)} products...")
print("    Pull 1: out_invoice + posted + income account")
aml_fields = ['id', 'product_id', 'quantity', 'price_subtotal', 'product_uom_id',
              'move_id', 'date', 'account_id']
inv_amls = []
move_ids_seen = set()
chunk = 25  # very small — aml volume is high (avg ~150 lines per product)
for i in range(0, len(all_pp_ids), chunk):
    batch_ids = all_pp_ids[i:i+chunk]
    sub = call('search_read', 'account.move.line',
                [['product_id', 'in', batch_ids],
                 ['parent_state', '=', 'posted'],
                 ['move_id.move_type', 'in', ['out_invoice', 'out_refund']]],
                fields=aml_fields,
                limit=20000)
    inv_amls.extend(sub)
    for l in sub:
        if l.get('move_id'):
            move_ids_seen.add(l['move_id'][0])
    if (i // chunk) % 4 == 0:
        print(f"      ...{i + len(batch_ids)}/{len(all_pp_ids)} products, {len(inv_amls)} lines so far")
print(f"    Total amls fetched: {len(inv_amls)}, distinct moves: {len(move_ids_seen)}")

# Fetch parent moves to get move_type
print("    Fetching parent moves for move_type...")
move_type_by_id = {}
move_invoice_date_by_id = {}
move_ids_list = sorted(move_ids_seen)
for i in range(0, len(move_ids_list), 500):
    sub = call('search_read', 'account.move',
                [['id', 'in', move_ids_list[i:i+500]]],
                fields=['id', 'move_type', 'invoice_date', 'date', 'state'])
    for m in sub:
        move_type_by_id[m['id']] = m['move_type']
        move_invoice_date_by_id[m['id']] = m.get('invoice_date') or m.get('date')
print(f"    Moves cached: {len(move_type_by_id)}")

# Filter aml further: account_type = income (the search filter we used was move_id.move_type;
# but we need to filter by account.account.account_type='income' too)
print("    Fetching income account IDs (account.account.account_type='income')...")
income_acct = call('search_read', 'account.account',
                    [['account_type', '=', 'income']],
                    fields=['id', 'name'])
income_acct_ids = {a['id'] for a in income_acct}
print(f"      Income accounts: {len(income_acct_ids)}")

# Aggregate net sales per product, per template
net_sales_by_product = defaultdict(lambda: {'qty': 0.0, 'rev': 0.0, 'last_sale_date': None})
twelve_months_ago = (datetime.now() - timedelta(days=365)).date().isoformat()

filtered_lines = 0
for l in inv_amls:
    pid = l['product_id'][0] if l.get('product_id') else None
    if not pid: continue
    aid = l['account_id'][0] if l.get('account_id') else None
    if aid not in income_acct_ids: continue
    mid = l['move_id'][0] if l.get('move_id') else None
    if mid is None: continue
    mtype = move_type_by_id.get(mid)
    if mtype not in ('out_invoice', 'out_refund'): continue
    qty = float(l.get('quantity') or 0)
    rev = float(l.get('price_subtotal') or 0)
    src_uom = l['product_uom_id'][0] if l.get('product_uom_id') else None
    tgt_uom = product_stock_uom.get(pid)
    qty_norm = to_stock_uom(qty, src_uom, tgt_uom)
    if mtype == 'out_refund':
        qty_norm = -qty_norm
        rev = -rev
    net_sales_by_product[pid]['qty'] += qty_norm
    net_sales_by_product[pid]['rev'] += rev
    move_date = move_invoice_date_by_id.get(mid)
    if move_date:
        cur = net_sales_by_product[pid]['last_sale_date']
        if not cur or move_date > cur:
            net_sales_by_product[pid]['last_sale_date'] = move_date
    filtered_lines += 1
print(f"  Filtered (income-account) lines: {filtered_lines}")

# Aggregate to template level + recent_activity_12mo
template_net = {}
for tid, d in templates.items():
    qty = sum(net_sales_by_product[v['id']]['qty'] for v in d['variants'])
    rev = sum(net_sales_by_product[v['id']]['rev'] for v in d['variants'])
    last_date = max((net_sales_by_product[v['id']]['last_sale_date'] or '' for v in d['variants']), default='')
    has_recent = bool(last_date and last_date >= twelve_months_ago)
    # 12-month qty for archived rows
    twelve_mo_qty = 0.0
    twelve_mo_rev = 0.0
    for l in inv_amls:
        pid = l['product_id'][0] if l.get('product_id') else None
        if pid not in {v['id'] for v in d['variants']}: continue
        aid = l['account_id'][0] if l.get('account_id') else None
        if aid not in income_acct_ids: continue
        mid = l['move_id'][0] if l.get('move_id') else None
        if mid is None: continue
        mtype = move_type_by_id.get(mid)
        if mtype not in ('out_invoice', 'out_refund'): continue
        move_date = move_invoice_date_by_id.get(mid)
        if not move_date or move_date < twelve_months_ago: continue
        q = float(l.get('quantity') or 0)
        r = float(l.get('price_subtotal') or 0)
        src_uom = l['product_uom_id'][0] if l.get('product_uom_id') else None
        tgt_uom = product_stock_uom.get(pid)
        qn = to_stock_uom(q, src_uom, tgt_uom)
        if mtype == 'out_refund':
            qn = -qn
            r = -r
        twelve_mo_qty += qn
        twelve_mo_rev += r
    template_net[tid] = {
        'qty': qty, 'rev': rev,
        'last_sale_date': last_date,
        'has_recent_activity_12mo': has_recent,
        'qty_12mo': twelve_mo_qty,
        'rev_12mo': twelve_mo_rev,
    }

# ─── 6. Split active vs archived ─────────────────────────────────────────
active_rows = []
archived_rows = []
for tid, d in templates.items():
    if d['supplier_class'] == 'UNKNOWN':
        continue  # shouldn't happen
    any_active = any(v['active'] for v in d['variants'])
    representative = next((v for v in d['variants'] if v['active']), d['variants'][0])
    pp_ids = sorted([v['id'] for v in d['variants']])
    code = representative.get('default_code') or None
    name = representative.get('name') or ''
    nt = template_net[tid]
    base = {
        'default_code': code,
        'representative_name': name,
        'product_template_id': tid,
        'product_product_ids': pp_ids,
        'supplier_class': d['supplier_class'],
        'source_indicator': d['source_indicator'],
        'in_run58_36_list': bool(code and code in run58_skus),
    }
    if any_active:
        active_rows.append({**base,
                             'net_sales_quantity': round(nt['qty'], 4),
                             'net_sales_revenue_gtq': round(nt['rev'], 4),
                             'movement_rank_within_class': None,
                             'is_top_10_in_class': False,
                            })
    else:
        archived_rows.append({**base,
                               'has_recent_activity_12mo': nt['has_recent_activity_12mo'],
                               'net_sales_quantity_last_12mo': round(nt['qty_12mo'], 4),
                               'net_sales_revenue_gtq_last_12mo': round(nt['rev_12mo'], 4),
                               'net_sales_quantity_all_time': round(nt['qty'], 4),
                              })
        # remove cols not in archived schema
        archived_rows[-1].pop('in_run58_36_list', None)

print(f"\n  Active rows: {len(active_rows)}")
print(f"  Archived rows: {len(archived_rows)}")

# ─── 7. Rank within class + mark top 10 ──────────────────────────────────
for cls in ('REYMA', 'CARVAJAL', 'BOTH'):
    sub = [r for r in active_rows if r['supplier_class'] == cls]
    sub.sort(key=lambda r: -r['net_sales_quantity'])
    for i, r in enumerate(sub, 1):
        r['movement_rank_within_class'] = i
        r['is_top_10_in_class'] = (i <= 10)

# ─── 8. Wipe + insert (idempotent) ───────────────────────────────────────
print("\n  Wiping existing rows...")
supa('DELETE', '/rest/v1/products_acid_test_active?id=gte.0', prefer='return=minimal')
supa('DELETE', '/rest/v1/products_acid_test_archived?id=gte.0', prefer='return=minimal')

print(f"  Inserting {len(active_rows)} active rows...")
for i in range(0, len(active_rows), 500):
    batch = active_rows[i:i+500]
    s, b = supa('POST', '/rest/v1/products_acid_test_active', body=batch,
                 prefer='return=minimal')
    if s >= 400:
        print(f"    ERROR: HTTP {s}: {b[:300] if isinstance(b, str) else b}")
        raise SystemExit(1)

print(f"  Inserting {len(archived_rows)} archived rows...")
for i in range(0, len(archived_rows), 500):
    batch = archived_rows[i:i+500]
    s, b = supa('POST', '/rest/v1/products_acid_test_archived', body=batch,
                 prefer='return=minimal')
    if s >= 400:
        print(f"    ERROR: HTTP {s}: {b[:300] if isinstance(b, str) else b}")
        raise SystemExit(1)

# ─── 9. Top-10 print + persist summary ──────────────────────────────────
print("\n=== TOP 10 REYMA (active) by Net Sales (CAJA40 units) ===")
top_reyma = sorted([r for r in active_rows if r['supplier_class'] == 'REYMA'],
                   key=lambda r: r['movement_rank_within_class'])[:10]
for r in top_reyma:
    rl = '✓' if r['in_run58_36_list'] else ' '
    print(f"  #{r['movement_rank_within_class']:>2} {rl} src={r['source_indicator']:<13} "
          f"sku={str(r['default_code'])[:12]:<12} "
          f"qty={r['net_sales_quantity']:>12,.2f}  rev={r['net_sales_revenue_gtq']:>14,.2f}  {r['representative_name'][:60]!r}")

print("\n=== TOP 10 CARVAJAL (active) by Net Sales ===")
top_carvajal = sorted([r for r in active_rows if r['supplier_class'] == 'CARVAJAL'],
                      key=lambda r: r['movement_rank_within_class'])[:10]
for r in top_carvajal:
    rl = '✓' if r['in_run58_36_list'] else ' '
    src_flag = ' 🚩' if r['source_indicator'] == 'SUPPLIER_LINK' else ''
    print(f"  #{r['movement_rank_within_class']:>2} {rl} src={r['source_indicator']:<13}{src_flag} "
          f"sku={str(r['default_code'])[:12]:<12} "
          f"qty={r['net_sales_quantity']:>12,.2f}  rev={r['net_sales_revenue_gtq']:>14,.2f}  {r['representative_name'][:60]!r}")

print("\n=== Archived with recent (12mo) activity ===")
ar_recent = sorted([r for r in archived_rows if r['has_recent_activity_12mo']],
                    key=lambda r: -r['net_sales_quantity_last_12mo'])
print(f"  Total archived rows: {len(archived_rows)}; with recent activity: {len(ar_recent)}")
for r in ar_recent[:15]:
    print(f"  cls={r['supplier_class']:<8} sku={str(r['default_code'])[:12]:<12} "
          f"12mo_qty={r['net_sales_quantity_last_12mo']:>10,.2f}  "
          f"all_time_qty={r['net_sales_quantity_all_time']:>10,.2f}  "
          f"{r['representative_name'][:60]!r}")

# Persist a summary
summary = {
    'run_at': datetime.now().isoformat(),
    'totals': {
        'active': len(active_rows),
        'archived': len(archived_rows),
        'archived_with_recent_activity': len(ar_recent),
    },
    'class_counts_active': dict(cls_counts),
    'top_10_reyma_active': top_reyma,
    'top_10_carvajal_active': top_carvajal,
    'archived_with_recent_activity_top15': ar_recent[:15],
    'run58_36_list_overlap_active': sum(1 for r in active_rows if r['in_run58_36_list']),
}
OUT.write_text(json.dumps(summary, indent=2, ensure_ascii=False, default=str))
print(f"\nSaved summary: {OUT}")
