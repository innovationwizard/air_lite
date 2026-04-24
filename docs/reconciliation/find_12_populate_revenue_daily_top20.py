"""
Step 6 — Populate revenue_daily for the top 20 SKUs across ALL months with data.

Reads odoo_extract_top20_latest.json and applies the THREE winning formulas:

  SSOT_SALES   = aml_income_posted_invoice_refund_neg_invoice_date_c40
  SSOT_PO_ORD  = pol_all_states_date_planned_product_qty_c40
  SSOT_PO_RCV  = pol_purchase_done_date_planned_qty_received_c40

For each (Supabase product_id, ssot_label, metric, day):
  - DELETE existing rows for that product+ssot
  - INSERT computed rows

Maps Odoo product.product.id → Supabase products.id via SKU lookup.

Pre-flight checks that all 20 SKUs exist in Supabase prod's products table.
If any missing, prints which and aborts (we'd need to backfill those SKUs in
prod's products table first — separate task).

Re-fetches account.account chart fresh from Odoo (was truncated in earlier
extract because it was filtered to only accounts seen in the truncated AML
set).
"""
import os
import json
import xmlrpc.client
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime
from pathlib import Path

EXTRACT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_top20_latest.json')

SSOT_SALES = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'
SSOT_PO_ORD = 'pol_all_states_date_planned_product_qty_c40'
SSOT_PO_RCV = 'pol_purchase_done_date_planned_qty_received_c40'

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

print("Authenticating to Odoo...")
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(DB, USER, KEY, {})
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object', allow_none=True)
def call(method, model, *args, **kwargs):
    return models.execute_kw(DB, uid, KEY, model, method, list(args), kwargs)

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

print(f"Loading extract: {EXTRACT.resolve().name}")
extract = json.loads(EXTRACT.resolve().read_text())
print(f"  sales_aml: {len(extract['account_move_line_sales']):,}")
print(f"  purch_aml: {len(extract['account_move_line_purchases']):,}")
print(f"  sale_order_line: {len(extract['sale_order_line']):,}")
print(f"  purchase_order_line: {len(extract['purchase_order_line']):,}")

# ─── 1. Refetch account.account chart (fresh, includes all referenced) ──
all_acct_ids = sorted({l['account_id'][0] for l in
                        (extract['account_move_line_sales'] + extract['account_move_line_purchases'])
                        if l.get('account_id')})
print(f"\nDistinct account IDs in AML: {len(all_acct_ids)}")
acct_fields = ['id', 'name', 'code', 'account_type']
print("Fetching all referenced accounts from Odoo...")
accounts = []
for i in range(0, len(all_acct_ids), 200):
    sub = call('search_read', 'account.account',
                [['id', 'in', all_acct_ids[i:i+200]]], fields=acct_fields)
    accounts.extend(sub)
print(f"  accounts: {len(accounts)}")
acct_by_id = {a['id']: a for a in accounts}

income_acct_ids = {a['id'] for a in accounts if a.get('account_type') == 'income'}
print(f"  income account IDs: {len(income_acct_ids)}")

# ─── 2. UoM machinery ──────────────────────────────────────────────────
uom_by_id = {u['id']: u for u in extract['uom_uom']}
def uom_factor_to_target(src_uom_id, target_uom_id):
    """Multiplier to convert qty in src to qty in target (cross-ratio in same category)."""
    if not src_uom_id or src_uom_id == target_uom_id:
        return 1.0
    f_src = uom_by_id.get(src_uom_id, {}).get('factor', 1.0)
    f_tgt = uom_by_id.get(target_uom_id, {}).get('factor', 1.0)
    if not f_src or f_src == 0:
        return 1.0
    return f_tgt / f_src

# Per-product stock UoM
product_stock_uom = {p['id']: (p['uom_id'][0] if p.get('uom_id') else None)
                     for p in extract['product_product']}

# ─── 3. Pre-flight: top20 SKUs all in Supabase products table ───────────
print("\n=== Pre-flight: SKUs in Supabase products table ===")
top20 = extract['top20_sku_meta']
top20_default_codes = [r['default_code'] for r in top20]
print(f"  Top20 SKUs: {top20_default_codes}")

# Supabase products by SKU
codes_csv = ','.join(f'"{c}"' for c in top20_default_codes)
s, b = supa('GET', f'/rest/v1/products?sku=in.({codes_csv})&select=id,sku,name,odoo_id')
assert s == 200, f"HTTP {s}: {b}"
supa_products = b
supa_pid_by_sku = {p['sku']: p['id'] for p in supa_products}
print(f"  Found in Supabase: {len(supa_products)}/20")

missing = [c for c in top20_default_codes if c not in supa_pid_by_sku]
if missing:
    print(f"  ⚠ Missing in Supabase: {missing}")
    # We need to ADD these. Pull product details from Odoo and INSERT minimal row.
    print("\n  Auto-creating missing products in Supabase...")
    for code in missing:
        pp_match = next((p for p in extract['product_product']
                         if p.get('default_code') == code), None)
        if not pp_match:
            print(f"    {code}: not in Odoo extract??")
            continue
        # The Odoo product_tmpl_id is what our ingest historically stored as odoo_id
        tmpl_id = pp_match['product_tmpl_id'][0] if pp_match.get('product_tmpl_id') else None
        new_row = {
            'odoo_id': str(tmpl_id),
            'sku': code,
            'name': (pp_match['name'] or f'Product {code}')[:200],
            'stock_uom': pp_match['uom_id'][1] if pp_match.get('uom_id') else None,
            'is_active': pp_match.get('active', True),
        }
        s, b = supa('POST', '/rest/v1/products?on_conflict=odoo_id', body=[new_row],
                    prefer='resolution=merge-duplicates,return=representation')
        if s >= 400:
            print(f"    {code}: HTTP {s}: {b[:200]}")
        else:
            print(f"    {code}: OK")
    # Re-fetch
    s, b = supa('GET', f'/rest/v1/products?sku=in.({codes_csv})&select=id,sku,name')
    supa_products = b
    supa_pid_by_sku = {p['sku']: p['id'] for p in supa_products}
    print(f"  After auto-create: {len(supa_products)}/20")

# Final mapping: Odoo product.product.id → Supabase products.id
pp_to_supa = {}
for tr in top20:
    spid = supa_pid_by_sku.get(tr['default_code'])
    if not spid: continue
    for pp_id in tr['product_product_ids']:
        pp_to_supa[pp_id] = spid
print(f"  Odoo→Supabase product mapping: {len(pp_to_supa)} entries")

# ─── 4. Build move-info index ──────────────────────────────────────────
move_by_id = {m['id']: m for m in extract['account_move']}

# ─── 5. Compute SSOT_SALES daily aggregations ──────────────────────────
print("\n=== Computing SSOT_SALES daily aggregations ===")
sales_agg = defaultdict(lambda: {'qty': 0.0, 'rev': 0.0, 'docs': set()})
filtered = 0
for l in extract['account_move_line_sales']:
    pid = l['product_id'][0] if l.get('product_id') else None
    if pid not in pp_to_supa: continue
    aid = l['account_id'][0] if l.get('account_id') else None
    if aid not in income_acct_ids: continue
    mid = l['move_id'][0] if l.get('move_id') else None
    m = move_by_id.get(mid) if mid else None
    if not m or m.get('state') != 'posted': continue
    mtype = m.get('move_type')
    if mtype not in ('out_invoice', 'out_refund'): continue
    day = m.get('invoice_date') or m.get('date')
    if not day: continue
    day = day[:10]
    qty = float(l.get('quantity') or 0)
    rev = float(l.get('price_subtotal') or 0)
    src_uom = l['product_uom_id'][0] if l.get('product_uom_id') else None
    tgt_uom = product_stock_uom.get(pid)
    qty *= uom_factor_to_target(src_uom, tgt_uom)
    if mtype == 'out_refund':
        qty = -qty
        rev = -rev
    key = (pp_to_supa[pid], day)
    sales_agg[key]['qty'] += qty
    sales_agg[key]['rev'] += rev
    sales_agg[key]['docs'].add(mid)
    filtered += 1
print(f"  filtered sales lines: {filtered}, distinct (supa_pid, day) cells: {len(sales_agg)}")

# ─── 6. Compute SSOT_PO_ORD and SSOT_PO_RCV daily aggregations ─────────
print("\n=== Computing PO_ORDERED / PO_RECEIVED daily aggregations ===")
po_by_id = {o['id']: o for o in extract['purchase_order']}

po_ordered_agg = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
po_received_agg = defaultdict(lambda: {'qty': 0.0, 'docs': set()})

for l in extract['purchase_order_line']:
    pid = l['product_id'][0] if l.get('product_id') else None
    if pid not in pp_to_supa: continue
    o = po_by_id.get(l['order_id'][0]) if l.get('order_id') else None
    if not o: continue
    day = o.get('date_planned')
    if not day: continue
    day = day[:10]
    src_uom = l['product_uom'][0] if l.get('product_uom') else None
    tgt_uom = product_stock_uom.get(pid)
    factor = uom_factor_to_target(src_uom, tgt_uom)

    # Ordered: ALL states
    qord = float(l.get('product_qty') or 0) * factor
    po_ordered_agg[(pp_to_supa[pid], day)]['qty'] += qord
    po_ordered_agg[(pp_to_supa[pid], day)]['docs'].add(o['id'])

    # Received: state in (purchase, done)
    if o.get('state') in ('purchase', 'done'):
        qrcv = float(l.get('qty_received') or 0) * factor
        po_received_agg[(pp_to_supa[pid], day)]['qty'] += qrcv
        po_received_agg[(pp_to_supa[pid], day)]['docs'].add(o['id'])

print(f"  PO ordered  daily cells: {len(po_ordered_agg)}")
print(f"  PO received daily cells: {len(po_received_agg)}")

# ─── 7. Build rows ─────────────────────────────────────────────────────
rows = []
for (spid, day), v in sales_agg.items():
    rows.append({
        'product_id': spid, 'ssot_label': SSOT_SALES, 'metric': 'sales',
        'observation_date': day, 'quantity': round(v['qty'], 4),
        'revenue_gtq': round(v['rev'], 4), 'source_doc_count': len(v['docs']),
    })
for (spid, day), v in po_ordered_agg.items():
    rows.append({
        'product_id': spid, 'ssot_label': SSOT_PO_ORD, 'metric': 'purchases_ordered',
        'observation_date': day, 'quantity': round(v['qty'], 4),
        'revenue_gtq': None, 'source_doc_count': len(v['docs']),
    })
for (spid, day), v in po_received_agg.items():
    if v['qty'] == 0: continue
    rows.append({
        'product_id': spid, 'ssot_label': SSOT_PO_RCV, 'metric': 'purchases_received',
        'observation_date': day, 'quantity': round(v['qty'], 4),
        'revenue_gtq': None, 'source_doc_count': len(v['docs']),
    })

print(f"\nTotal revenue_daily rows to insert: {len(rows)}")

# ─── 8. Wipe existing rows for these products + ssot_labels ────────────
print("\nClearing existing revenue_daily rows for top20 SKUs + winning ssot labels...")
top20_supa_pids = sorted(set(pp_to_supa.values()))
pid_csv = ','.join(str(p) for p in top20_supa_pids)
ssot_labels = [SSOT_SALES, SSOT_PO_ORD, SSOT_PO_RCV]
for label in ssot_labels:
    s, b = supa('DELETE',
                 f'/rest/v1/revenue_daily?product_id=in.({pid_csv})&ssot_label=eq.{label}',
                 prefer='return=representation')
    n = len(b) if isinstance(b, list) else 0
    print(f"  Deleted {n} for ssot_label={label}")

# ─── 9. Insert in batches ─────────────────────────────────────────────
print(f"\nInserting {len(rows)} rows...")
inserted = 0
for i in range(0, len(rows), 500):
    batch = rows[i:i+500]
    s, b = supa('POST', '/rest/v1/revenue_daily', body=batch, prefer='return=minimal')
    if s >= 400:
        print(f"  ERROR batch {i//500}: HTTP {s}: {b[:300] if isinstance(b, str) else b}")
        raise SystemExit(1)
    inserted += len(batch)
print(f"  Inserted: {inserted}")

# ─── 10. Verification: monthly aggregation per SKU ─────────────────────
print("\n=== Verification: monthly aggregation ===")
month_agg = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
for r in rows:
    m = r['observation_date'][:7]
    spid = r['product_id']
    month_agg[spid][m][r['metric']] += r['quantity']

# For SKU 77201046 (anchor), verify the 4 datapoints
ANCHOR_SUPA_PID = supa_pid_by_sku.get('77201046')
if ANCHOR_SUPA_PID:
    print(f"\n  Anchor verification for SKU 77201046 (Supabase pid={ANCHOR_SUPA_PID}):")
    nov = month_agg[ANCHOR_SUPA_PID].get('2024-11', {})
    dec = month_agg[ANCHOR_SUPA_PID].get('2024-12', {})
    checks = [
        ('Nov sales', nov.get('sales', 0), 6466.25),
        ('Dec sales', dec.get('sales', 0), 6496.50),
        ('Nov po_ordered', nov.get('purchases_ordered', 0), 5917),
        ('Nov po_received', nov.get('purchases_received', 0), 5500),
    ]
    for name, val, target in checks:
        diff = abs(val - target)
        ok = diff < 0.01
        mark = '✓' if ok else '✗'
        print(f"    {mark} {name}: prod={val:.2f}  target={target}  Δ={val-target:+.4f}")

# Period range
all_days = sorted({r['observation_date'] for r in rows})
print(f"\n  Period range: {all_days[0]} → {all_days[-1]}")
all_months = sorted({d[:7] for d in all_days})
print(f"  Months covered: {len(all_months)} ({all_months[0]} → {all_months[-1]})")

print("\n  Per-SKU summary (sales total all-time):")
for tr in top20:
    spid = supa_pid_by_sku.get(tr['default_code'])
    if not spid: continue
    total_sales = sum(m.get('sales', 0) for m in month_agg[spid].values())
    months_with_sales = sum(1 for m in month_agg[spid].values() if m.get('sales', 0) > 0)
    print(f"    cls={tr['supplier_class']:<8} sku={tr['default_code']:<10} "
          f"sales_total={total_sales:>12,.2f}  months_w_sales={months_with_sales:>3}  "
          f"{tr['representative_name'][:50]!r}")

print("\nDONE.")
