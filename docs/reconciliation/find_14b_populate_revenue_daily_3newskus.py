"""
Populate revenue_daily for the 3 new SKUs (77201019, 77201038, 77205035)
using the saved Odoo extract — no live Odoo connection required.

Source extract: odoo_extract_3newSKUs_20260423_173701.json
Replaces:       find_14_extend_top20_to_23.py (requires live Odoo XML-RPC)

SSOT formulas:
  SALES          = aml_income_posted_invoice_refund_neg_invoice_date_c40
  PO_ORDERED     = pol_confirmed_date_planned_product_qty_c40
                   state IN ('purchase', 'locked', 'done') — DEMO scope, confirmed 2026-04-28
  PO_RECEIVED    = pol_purchase_done_date_planned_qty_received_c40
                   state IN ('purchase', 'locked', 'done') — locked has qty_received values

Supabase product_id mapping (looked up 2026-04-28):
  77201019 → 1587
  77201038 → 539
  77205035 → 1113

Idempotent: DELETE existing rows for these 3 products + ssot_labels, then INSERT.
"""

import os
import json
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation')
EXTRACT = ROOT / 'odoo_extract_3newSKUs_20260423_173701.json'

SSOT_SALES  = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'
SSOT_PO_ORD = 'pol_confirmed_date_planned_product_qty_c40'
SSOT_PO_RCV = 'pol_purchase_done_date_planned_qty_received_c40'

# Supabase product_ids — looked up 2026-04-28 via /rest/v1/products?sku=eq.<sku>
SUPA_PID_BY_SKU = {
    '77201019': 1587,
    '77201038': 539,
    '77205035': 1113,
}

def load_env():
    for f in ['/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
              '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env']:
        p = Path(f)
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip()
                if k not in os.environ:
                    os.environ[k] = v

load_env()
SUPA     = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SECRET_KEY']

def supa(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'}
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

# ── Load extract ──────────────────────────────────────────────────────────────

print(f"Loading extract: {EXTRACT.name}")
extract = json.loads(EXTRACT.read_text())
print(f"  SKUs in extract:         {extract.get('skus')}")
print(f"  purchase_order:          {len(extract['purchase_order'])}")
print(f"  purchase_order_line:     {len(extract['purchase_order_line'])}")
print(f"  account_move_line_sales: {len(extract['account_move_line_sales'])}")
print(f"  account_move:            {len(extract['account_move'])}")

# ── Accounts (income filter for sales) ────────────────────────────────────────

accounts = extract['account_account']
acct_by_id = {a['id']: a for a in accounts}
income_acct_ids = {a['id'] for a in accounts if a.get('account_type') == 'income'}
print(f"\nAccounts: {len(accounts)}, income: {len(income_acct_ids)}")

# ── UoM machinery ─────────────────────────────────────────────────────────────

uom_by_id = {u['id']: u for u in extract['uom_uom']}

def uom_factor_to_target(src_uom_id, target_uom_id):
    if not src_uom_id or src_uom_id == target_uom_id:
        return 1.0
    f_src = uom_by_id.get(src_uom_id, {}).get('factor', 1.0)
    f_tgt = uom_by_id.get(target_uom_id, {}).get('factor', 1.0)
    if not f_src or f_src == 0:
        return 1.0
    return f_tgt / f_src

# Per product.product stock UoM
product_stock_uom = {p['id']: (p['uom_id'][0] if p.get('uom_id') else None)
                     for p in extract['product_product']}

# ── product.product.id → Supabase product_id ─────────────────────────────────

pp_to_supa = {}
for pp in extract['product_product']:
    sku = pp.get('default_code')
    supa_pid = SUPA_PID_BY_SKU.get(sku)
    if supa_pid:
        pp_to_supa[pp['id']] = supa_pid

print(f"\nOdoo→Supabase product mapping: {len(pp_to_supa)} variant entries")
for pp_id, supa_pid in sorted(pp_to_supa.items()):
    pp = next(p for p in extract['product_product'] if p['id'] == pp_id)
    print(f"  odoo pp_id={pp_id} ({pp.get('default_code')}) → supa_pid={supa_pid}")

# ── Sales ─────────────────────────────────────────────────────────────────────

print("\n=== Computing SALES ===")
move_by_id = {m['id']: m for m in extract['account_move']}
sales_agg = defaultdict(lambda: {'qty': 0.0, 'rev': 0.0, 'docs': set()})
filtered = 0

for l in extract['account_move_line_sales']:
    pid = l['product_id'][0] if l.get('product_id') else None
    if pid not in pp_to_supa:
        continue
    aid = l['account_id'][0] if l.get('account_id') else None
    if aid not in income_acct_ids:
        continue
    mid = l['move_id'][0] if l.get('move_id') else None
    m = move_by_id.get(mid) if mid else None
    if not m or m.get('state') != 'posted':
        continue
    mtype = m.get('move_type')
    if mtype not in ('out_invoice', 'out_refund'):
        continue
    day = m.get('invoice_date') or m.get('date')
    if not day:
        continue
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

print(f"  Sales AML lines used: {filtered}, day cells: {len(sales_agg)}")

# ── Purchases ─────────────────────────────────────────────────────────────────

print("\n=== Computing PURCHASES ===")
po_by_id = {o['id']: o for o in extract['purchase_order']}
po_ordered_agg  = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
po_received_agg = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
skipped_states = defaultdict(int)

for l in extract['purchase_order_line']:
    pid = l['product_id'][0] if l.get('product_id') else None
    if pid not in pp_to_supa:
        continue
    o = po_by_id.get(l['order_id'][0]) if l.get('order_id') else None
    if not o:
        continue
    state = o.get('state')
    if state not in ('purchase', 'locked', 'done'):
        skipped_states[state] += 1
        continue
    day = o.get('date_planned')
    if not day:
        continue
    day = day[:10]
    src_uom = l['product_uom'][0] if l.get('product_uom') else None
    tgt_uom = product_stock_uom.get(pid)
    factor = uom_factor_to_target(src_uom, tgt_uom)

    qord = float(l.get('product_qty') or 0) * factor
    po_ordered_agg[(pp_to_supa[pid], day)]['qty'] += qord
    po_ordered_agg[(pp_to_supa[pid], day)]['docs'].add(o['id'])

    qrcv = float(l.get('qty_received') or 0) * factor
    po_received_agg[(pp_to_supa[pid], day)]['qty'] += qrcv
    po_received_agg[(pp_to_supa[pid], day)]['docs'].add(o['id'])

print(f"  PO ordered  day cells: {len(po_ordered_agg)}")
print(f"  PO received day cells: {len(po_received_agg)}")
if skipped_states:
    print(f"  Skipped POLs by state: {dict(skipped_states)}")

# ── Build row list ────────────────────────────────────────────────────────────

rows = []
for (spid, day), v in sales_agg.items():
    rows.append({'product_id': spid, 'ssot_label': SSOT_SALES, 'metric': 'sales',
                 'observation_date': day, 'quantity': round(v['qty'], 4),
                 'revenue_gtq': round(v['rev'], 4), 'source_doc_count': len(v['docs'])})
for (spid, day), v in po_ordered_agg.items():
    rows.append({'product_id': spid, 'ssot_label': SSOT_PO_ORD, 'metric': 'purchases_ordered',
                 'observation_date': day, 'quantity': round(v['qty'], 4),
                 'revenue_gtq': None, 'source_doc_count': len(v['docs'])})
for (spid, day), v in po_received_agg.items():
    if v['qty'] == 0:
        continue
    rows.append({'product_id': spid, 'ssot_label': SSOT_PO_RCV, 'metric': 'purchases_received',
                 'observation_date': day, 'quantity': round(v['qty'], 4),
                 'revenue_gtq': None, 'source_doc_count': len(v['docs'])})

print(f"\nTotal rows to insert: {len(rows)}")

# ── Wipe + insert ─────────────────────────────────────────────────────────────

pid_csv = ','.join(str(p) for p in sorted(SUPA_PID_BY_SKU.values()))
print(f"\nClearing revenue_daily for product_ids ({pid_csv})...")
for label in (SSOT_SALES, SSOT_PO_ORD, SSOT_PO_RCV):
    s, b = supa('DELETE',
                f'/rest/v1/revenue_daily?product_id=in.({pid_csv})&ssot_label=eq.{label}',
                prefer='return=representation')
    n = len(b) if isinstance(b, list) else 0
    print(f"  Deleted {n} for {label}")

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

# ── Verification ─────────────────────────────────────────────────────────────

print("\n=== Monthly summary ===")
month_agg = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
for r in rows:
    month_agg[r['product_id']][r['observation_date'][:7]][r['metric']] += r['quantity']

for supa_pid, sku in sorted((v, k) for k, v in SUPA_PID_BY_SKU.items()):
    print(f"\n  SKU {sku} (product_id={supa_pid}):")
    for month in sorted(month_agg[supa_pid]):
        d = month_agg[supa_pid][month]
        print(f"    {month}  sales={d.get('sales', 0):>10.2f}  "
              f"po_ord={d.get('purchases_ordered', 0):>10.2f}  "
              f"po_rcv={d.get('purchases_received', 0):>10.2f}")

print("\nDone. Run smooth_oct2024_purchase_anomaly.py next to rebuild revenue_daily_for_ml.")
