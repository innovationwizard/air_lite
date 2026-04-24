"""
Step 3 — Populate revenue_daily for SKU 77201046 using the user-confirmed
winning triplet:

  - SALES:
      source = account.move.line
      filter = account.account_type='income'
            AND account.move.state='posted'
            AND account.move.move_type IN ('out_invoice','out_refund')
      qty   = quantity, refund_negative=True, normalized to CAJA40
      group by month(account.move.invoice_date)  → at DAILY granularity here
      ssot_label = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'

  - PURCHASES_ORDERED:
      source = purchase.order.line
      filter = state IN ('draft','sent','to approve','purchase','done','cancel')  -- ALL states
      qty   = product_qty, normalized to CAJA40
      group by purchase.order.date_planned (day)
      ssot_label = 'pol_all_states_date_planned_product_qty_c40'

  - PURCHASES_RECEIVED:
      source = purchase.order.line
      filter = state IN ('purchase','done')
      qty   = qty_received, normalized to CAJA40
      group by purchase.order.date_planned (day)
      ssot_label = 'pol_purchase_done_date_planned_qty_received_c40'

Variant scope: all 3 product.product (7090, 1541, 2371) for sales; same for
purchases. (For purchases the result is identical regardless of variant scope
because POL only references variant 7090 in our test env data; left in for
future-proofing other SKUs.)

Idempotency: DELETE WHERE product_id=33 AND ssot_label IN (...) before INSERT.
Safe to re-run.

Pre-requisite: migration 20260423000002_revenue_daily.sql must be applied to
prod first. Script verifies and aborts cleanly if table is missing.
"""
import os
import json
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation')
EXTRACT_OPS = ROOT / 'odoo_extract_77201046_latest.json'
EXTRACT_INV = ROOT / 'odoo_extract_77201046_invoices_latest.json'
PRODUCT_ID = 33  # Supabase products.id for SKU 77201046
VARIANT_IDS = {7090, 1541, 2371}

# SSOT labels (kept short but unambiguous)
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

SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']

def supa_request(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if data is not None:
        headers['Content-Type'] = 'application/json'
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(f"{SUPA}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# Pre-flight: revenue_daily table exists?
status, body = supa_request('GET', '/rest/v1/revenue_daily?limit=1')
if status >= 400:
    print(f"ERROR — revenue_daily table not found in prod (HTTP {status}).")
    print(f"Response: {body[:300] if isinstance(body, str) else body}")
    print("\nApply this migration first:")
    print(f"  supabase/migrations/20260423000002_revenue_daily.sql")
    print(f"\nVia Supabase Studio SQL Editor:")
    print(f"  https://supabase.com/dashboard/project/plirrpkasyytpgzwwztl/sql/new")
    print("\nThen re-run this script.")
    raise SystemExit(2)
print(f"revenue_daily table found (HTTP {status}). Proceeding.")

ops = json.loads(EXTRACT_OPS.read_text())
inv = json.loads(EXTRACT_INV.read_text())
print(f"Loaded extracts. ops aml-related: sale.order={len(ops['sale_order'])}, "
      f"sol={len(ops['sale_order_line'])}, pol={len(ops['purchase_order_line'])}.")
print(f"inv: aml={len(inv['account_move_line'])}, "
      f"move={len(inv['account_move'])}, account={len(inv['account_account'])}.")

# Indexes
move_by_id = {m['id']: m for m in inv['account_move']}
acct_by_id = {a['id']: a for a in inv['account_account']}
po_by_id = {o['id']: o for o in ops['purchase_order']}
uom_by_id = {u['id']: u for u in ops['uom_uom']}
caja40_factor = next(u['factor'] for u in ops['uom_uom'] if u['name'] == 'CAJA40')

def to_caja40(qty, uom_id):
    if not uom_id:
        return qty
    f_src = uom_by_id.get(uom_id, {}).get('factor', 1.0)
    if not f_src or f_src == 0:
        return qty
    return qty * caja40_factor / f_src

# ----- SALES (per day) -----
print("\nComputing SALES per day...")
sales_by_day = defaultdict(lambda: {'qty': 0.0, 'rev': 0.0, 'docs': set()})
for l in inv['account_move_line']:
    pid = l['product_id'][0] if l.get('product_id') else None
    if pid not in VARIANT_IDS:
        continue
    acct = acct_by_id.get(l['account_id'][0]) if l.get('account_id') else None
    if not acct or acct.get('account_type') != 'income':
        continue
    m = move_by_id.get(l['move_id'][0]) if l.get('move_id') else None
    if not m or m.get('state') != 'posted':
        continue
    if m.get('move_type') not in ('out_invoice', 'out_refund'):
        continue
    day = m.get('invoice_date') or m.get('date')
    if not day:
        continue
    day = day[:10]
    qty = float(l.get('quantity') or 0)
    uid = l['product_uom_id'][0] if l.get('product_uom_id') else None
    qty = to_caja40(qty, uid)
    if m['move_type'] == 'out_refund':
        qty = -qty
    rev = float(l.get('price_subtotal') or 0)
    if m['move_type'] == 'out_refund':
        rev = -rev
    sales_by_day[day]['qty'] += qty
    sales_by_day[day]['rev'] += rev
    sales_by_day[day]['docs'].add(m['id'])
print(f"  Days: {len(sales_by_day)}")

# ----- PURCHASES ORDERED (per day) -----
print("\nComputing PURCHASES_ORDERED per day...")
po_ordered_by_day = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
for l in ops['purchase_order_line']:
    pid = l['product_id'][0] if l.get('product_id') else None
    if pid not in VARIANT_IDS:
        continue
    o = po_by_id.get(l['order_id'][0]) if l.get('order_id') else None
    if not o:
        continue
    # ALL states accepted
    day = o.get('date_planned')
    if not day:
        continue
    day = day[:10]
    qty = float(l.get('product_qty') or 0)
    uid = l['product_uom'][0] if l.get('product_uom') else None
    qty = to_caja40(qty, uid)
    po_ordered_by_day[day]['qty'] += qty
    po_ordered_by_day[day]['docs'].add(o['id'])
print(f"  Days: {len(po_ordered_by_day)}")

# ----- PURCHASES RECEIVED (per day) -----
print("\nComputing PURCHASES_RECEIVED per day...")
po_received_by_day = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
for l in ops['purchase_order_line']:
    pid = l['product_id'][0] if l.get('product_id') else None
    if pid not in VARIANT_IDS:
        continue
    o = po_by_id.get(l['order_id'][0]) if l.get('order_id') else None
    if not o or o.get('state') not in ('purchase', 'done'):
        continue
    day = o.get('date_planned')
    if not day:
        continue
    day = day[:10]
    qty = float(l.get('qty_received') or 0)
    uid = l['product_uom'][0] if l.get('product_uom') else None
    qty = to_caja40(qty, uid)
    po_received_by_day[day]['qty'] += qty
    po_received_by_day[day]['docs'].add(o['id'])
print(f"  Days: {len(po_received_by_day)}")

# Build rows
rows = []
for day, v in sales_by_day.items():
    rows.append({
        'product_id': PRODUCT_ID,
        'ssot_label': SSOT_SALES,
        'metric': 'sales',
        'observation_date': day,
        'quantity': round(v['qty'], 4),
        'revenue_gtq': round(v['rev'], 4),
        'source_doc_count': len(v['docs']),
    })
for day, v in po_ordered_by_day.items():
    rows.append({
        'product_id': PRODUCT_ID,
        'ssot_label': SSOT_PO_ORD,
        'metric': 'purchases_ordered',
        'observation_date': day,
        'quantity': round(v['qty'], 4),
        'revenue_gtq': None,
        'source_doc_count': len(v['docs']),
    })
for day, v in po_received_by_day.items():
    if v['qty'] == 0:
        continue
    rows.append({
        'product_id': PRODUCT_ID,
        'ssot_label': SSOT_PO_RCV,
        'metric': 'purchases_received',
        'observation_date': day,
        'quantity': round(v['qty'], 4),
        'revenue_gtq': None,
        'source_doc_count': len(v['docs']),
    })

print(f"\nTotal rows to insert: {len(rows)}")

# Idempotent: delete existing rows for this product+ssot
ssot_labels = [SSOT_SALES, SSOT_PO_ORD, SSOT_PO_RCV]
print("\nClearing existing rows for product 33 + winning ssot labels...")
for label in ssot_labels:
    status, body = supa_request('DELETE',
                                 f'/rest/v1/revenue_daily?product_id=eq.{PRODUCT_ID}&ssot_label=eq.{label}',
                                 prefer='return=representation')
    n = len(body) if isinstance(body, list) else 0
    print(f"  Deleted {n} rows for ssot_label={label}")

# Insert in batches
print("\nInserting new rows...")
inserted = 0
for i in range(0, len(rows), 500):
    batch = rows[i:i+500]
    status, body = supa_request('POST', '/rest/v1/revenue_daily', body=batch,
                                 prefer='return=minimal')
    if status >= 400:
        print(f"  ERROR batch {i//500}: HTTP {status}: {body[:300] if isinstance(body, str) else body}")
        raise SystemExit(1)
    inserted += len(batch)
print(f"  Inserted {inserted} rows.")

# Verify monthly totals
print("\n=== Verification: monthly aggregation ===\n")
month_agg = defaultdict(lambda: defaultdict(float))
for r in rows:
    m = r['observation_date'][:7]
    month_agg[m][r['metric']] += r['quantity']

target_keys = ['2024-11', '2024-12', '2025-01', '2025-02']
print(f"{'Month':<10}{'Sales':>15}{'PO_ordered':>15}{'PO_received':>15}")
for m in sorted(month_agg.keys()):
    if m not in target_keys: continue
    a = month_agg[m]
    print(f"{m:<10}{a.get('sales', 0):>15.2f}{a.get('purchases_ordered', 0):>15.2f}{a.get('purchases_received', 0):>15.2f}")

print("\nTargets (David transcript):")
print(f"  2024-11 sales=6466.25, po_ordered=5917, po_received=5500")
print(f"  2024-12 sales=6496.50")

# Check
nov = month_agg.get('2024-11', {})
dec = month_agg.get('2024-12', {})
checks = [
    ('Nov sales',        nov.get('sales', 0),                6466.25),
    ('Dec sales',        dec.get('sales', 0),                6496.50),
    ('Nov po_ordered',   nov.get('purchases_ordered', 0),    5917),
    ('Nov po_received',  nov.get('purchases_received', 0),   5500),
]
print()
all_pass = True
for name, val, target in checks:
    diff = abs(val - target)
    ok = diff < 0.01
    mark = '✓' if ok else '✗'
    print(f"  {mark} {name}: prod={val:.2f}  target={target}  Δ={val-target:+.4f}")
    if not ok: all_pass = False

if all_pass:
    print("\nALL ANCHOR DATAPOINTS HIT EXACTLY.")
else:
    print("\n⚠ Some datapoints diverge — investigate before scaling.")
