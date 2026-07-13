"""
Fix B — Add Uncensored Demand Metric to revenue_daily and revenue_daily_for_ml.

ROOT CAUSE (Dealbreaker 2)
--------------------------
Prophet trains on revenue_daily_for_ml metric='sales', which is populated from
account.move.line (invoiced/shipped quantities). During stockouts, invoiced qty =
stock available < true customer demand. Prophet learns the supply-constrained
signal, not actual demand.

FIX
---
Use sale_order_lines.quantity (ordered qty) grouped by sale_orders.order_date
as the uncensored demand signal. Customers place orders on the demand date
regardless of stock — the order is recorded even if it cannot be fulfilled.

This is Method 1 (Lost Sales Reconstruction) from industry research:
  demand_qty  = SUM(sol.quantity)          — what customers asked for
  lost_sales  = SUM(sol.quantity - sol.delivered_qty) where gap > 0  — unmet demand
  supply_qty  = SUM(sol.delivered_qty)     — what was actually shipped (= invoiced)

DATA SOURCE
-----------
sale_orders table (Supabase): 80,525 confirmed orders (state='sale'), Sep 2024 – Mar 2026
sale_order_lines table (Supabase): 122,460 rows for the 23 demo SKUs

UOM NORMALIZATION
-----------------
Convert sale_order_lines.uom to product.stock_uom using the same UoM ratio table
used everywhere else. Formula: qty * (stock_uom_ratio / src_uom_ratio).
FARDO10 products: source UoM is usually FARDO10 → factor=1.0 (no change).

DATE CUTOFF
-----------
Observation dates capped at 2026-01-31 per project_data_cutoff.md.
Feb/Mar 2026 are blind test months — demand HISTORY for those months is
not shown. The Prophet FORECAST of demand (trained on ≤Jan 2026 data) IS shown.

SSOT LABEL
----------
sol_confirmed_order_date_qty_ordered_native_uom
Follows naming convention: source + filter + date field + qty field + UoM basis.

WRITES TO
---------
1. revenue_daily      (metric='demand') — UI forecast-diagnostic page reads this
2. revenue_daily_for_ml (metric='demand') — ML Prophet training reads this

Writing to revenue_daily is additive (new metric, new ssot_label). It does not
touch existing sales/purchases rows and does not affect Acid Test 1 validation.
The smooth script copies ALL non-purchase rows verbatim → demand rows survive
future smooth re-runs.

IDEMPOTENCY
-----------
Checks for existing demand rows in revenue_daily_for_ml. If already populated
(total > 0 for pid=2 Oct 2024 – Jan 2026), aborts cleanly.

PIPELINE ORDER
--------------
Run AFTER fix_purchase_uom_revenue_daily_2026-05-07.py (UoM fix already applied).
Run BEFORE trigger_ml_training_2026-05-07.py (ML training reads from revenue_daily_for_ml).
"""

import json
import os
import time
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

# ── env ───────────────────────────────────────────────────────────────────────

def load_env():
    for f in [
        '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
        '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env',
    ]:
        p = Path(f)
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            if k.strip() not in os.environ:
                os.environ[k.strip()] = v.strip()

load_env()
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY  = os.environ['SUPABASE_SECRET_KEY']

# ── constants ─────────────────────────────────────────────────────────────────

SSOT_LABEL     = 'sol_confirmed_order_date_qty_ordered_native_uom'
METRIC         = 'demand'
TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'   # blind test cutoff — do not include Feb/Mar 2026 history

DEMO_23_SKUS = [
    '77205001','77205003','77205207','77205034','77205287','77205208',
    '77205190','77205005','77205002','77205035','77205187','77201046',
    '77201000','77201055','77201053','77201069','77201041','77201014',
    '77201056','77201019','77201038','77201047','77201023',
]

# ── helpers ───────────────────────────────────────────────────────────────────

def supa_request(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if data:
        headers['Content-Type'] = 'application/json'
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(f'{SUPA}{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def get_all(path_base):
    rows, offset, limit = [], 0, 1000
    sep = '&' if '?' in path_base else '?'
    while True:
        status, body = supa_request('GET', f'{path_base}{sep}offset={offset}&limit={limit}')
        if status >= 400:
            raise RuntimeError(f'GET {path_base}: HTTP {status}: {body}')
        if not body:
            break
        rows.extend(body)
        if len(body) < limit:
            break
        offset += limit
    return rows


def upsert_batch(table, rows, on_conflict, batch_size=500):
    upserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        status, body = supa_request(
            'POST', f'/rest/v1/{table}?on_conflict={on_conflict}',
            body=batch,
            prefer='resolution=merge-duplicates,return=minimal',
        )
        if status >= 400:
            raise RuntimeError(f'UPSERT {table} batch {i // batch_size}: HTTP {status}: {body}')
        upserted += len(batch)
    return upserted


# ── Step 1: Idempotency check ─────────────────────────────────────────────────

print('=== Idempotency check ===')
check = get_all(
    f'/rest/v1/revenue_daily_for_ml'
    f'?product_id=eq.2&metric=eq.{METRIC}'
    f'&observation_date=gte.{TRAINING_START}'
    f'&observation_date=lte.{TRAINING_END}'
    f'&select=quantity'
)
already_total = sum(float(r['quantity'] or 0) for r in check)
if already_total > 0:
    print(f'  demand rows already populated for pid=2 (total={already_total:,.1f}). Aborting.')
    raise SystemExit(0)
print(f'  No existing demand rows found. Proceeding.\n')

# ── Step 2: Load UoM ratios ───────────────────────────────────────────────────

print('Loading UoM ratios…')
uom_rows = get_all('/rest/v1/units_of_measure?select=name,ratio')
uom_ratio = {r['name']: float(r['ratio']) for r in uom_rows}
print(f'  {len(uom_ratio)} UoMs loaded')

# ── Step 3: Load demo product IDs and stock_uoms ──────────────────────────────

print('\nLoading demo product stock_uoms…')
skus_csv = ','.join(f'"{s}"' for s in DEMO_23_SKUS)
prods = get_all(f'/rest/v1/products?sku=in.({skus_csv})&select=id,sku,stock_uom')
pid_to_sku      = {p['id']: p['sku']       for p in prods}
pid_to_stock_uom = {p['id']: (p['stock_uom'] or 'CAJA40') for p in prods}
demo_pids       = sorted(pid_to_sku)
demo_pids_csv   = ','.join(str(p) for p in demo_pids)
print(f'  {len(prods)} demo products loaded')

# ── Step 4: Load confirmed sale orders (state='sale') → id → date map ─────────

print('\nLoading confirmed sale orders (state=sale)…')
t0 = time.time()
so_rows = get_all(
    '/rest/v1/sale_orders'
    '?state=eq.sale'
    '&select=id,order_date'
)
# Build order_id → order_date (date string YYYY-MM-DD)
order_date: dict[int, str] = {}
for r in so_rows:
    d = str(r['order_date'])[:10]
    if TRAINING_START <= d <= TRAINING_END:
        order_date[r['id']] = d
print(f'  {len(so_rows):,} total confirmed orders loaded in {time.time()-t0:.1f}s')
print(f'  {len(order_date):,} orders within training window ({TRAINING_START} to {TRAINING_END})')

# ── Step 5: Load sale_order_lines for demo SKUs ────────────────────────────────

print('\nLoading sale_order_lines for 23 demo PIDs…')
t0 = time.time()
sol_rows = get_all(
    f'/rest/v1/sale_order_lines'
    f'?product_id=in.({demo_pids_csv})'
    f'&select=order_id,product_id,quantity,delivered_qty,uom'
)
print(f'  {len(sol_rows):,} SOL rows loaded in {time.time()-t0:.1f}s')

# ── Step 6: Aggregate demand by (product_id, order_date) ─────────────────────

print('\nAggregating demand by (product_id, order_date)…')

# (pid, date) → {demand_qty, lost_sales_qty, source_count}
daily: dict[tuple, dict] = defaultdict(lambda: {'demand': 0.0, 'lost': 0.0, 'docs': 0})
skipped_no_date   = 0
skipped_uom       = 0
skipped_zero_qty  = 0

for row in sol_rows:
    oid = row['order_id']
    pid = row['product_id']
    d   = order_date.get(oid)
    if d is None:
        skipped_no_date += 1
        continue

    raw_qty = float(row['quantity'] or 0)
    if raw_qty <= 0:
        skipped_zero_qty += 1
        continue

    # Convert to product's stock_uom
    src_uom = row.get('uom') or 'CAJA40'
    tgt_uom = pid_to_stock_uom.get(pid, 'CAJA40')
    src_r = uom_ratio.get(src_uom)
    tgt_r = uom_ratio.get(tgt_uom)
    if src_r is None or src_r == 0 or tgt_r is None:
        skipped_uom += 1
        continue

    qty_in_stock_uom = raw_qty * (tgt_r / src_r)
    dlv_qty = float(row.get('delivered_qty') or 0) * (tgt_r / src_r)
    lost_qty = max(0.0, qty_in_stock_uom - dlv_qty)

    daily[(pid, d)]['demand'] += qty_in_stock_uom
    daily[(pid, d)]['lost']   += lost_qty
    daily[(pid, d)]['docs']   += 1

print(f'  Daily aggregation cells: {len(daily):,}')
print(f'  Skipped (order not confirmed/in-window): {skipped_no_date:,}')
print(f'  Skipped (unknown UoM):                  {skipped_uom:,}')
print(f'  Skipped (zero qty):                     {skipped_zero_qty:,}')

# ── Step 7: Monthly preview for pid=2 (SKU 77205001) ─────────────────────────

print('\n=== Monthly demand preview for pid=2 (77205001, FARDO10) ===')
pid2_monthly: dict[str, dict] = defaultdict(lambda: {'demand': 0.0, 'lost': 0.0})
for (pid, d), v in daily.items():
    if pid == 2:
        mo = d[:7]
        pid2_monthly[mo]['demand'] += v['demand']
        pid2_monthly[mo]['lost']   += v['lost']
for mo in sorted(pid2_monthly):
    dm = pid2_monthly[mo]['demand']
    ls = pid2_monthly[mo]['lost']
    fill = (dm - ls) / dm * 100 if dm > 0 else 0
    print(f'  {mo}  demand={dm:>10,.1f}  lost_sales={ls:>10,.1f}  fill_rate={fill:.1f}%')

# ── Step 8: Build rows for insert ─────────────────────────────────────────────

rd_rows = []
rdml_rows = []
for (pid, d), v in sorted(daily.items()):
    row = {
        'product_id':       pid,
        'ssot_label':       SSOT_LABEL,
        'metric':           METRIC,
        'observation_date': d,
        'quantity':         round(v['demand'], 4),
        'revenue_gtq':      None,
        'source_doc_count': v['docs'],
    }
    rd_rows.append(row)
    rdml_rows.append({k: v for k, v in row.items()})   # same structure

print(f'\n  {len(rd_rows)} rows to insert into revenue_daily')
print(f'  {len(rdml_rows)} rows to insert into revenue_daily_for_ml')

# ── Step 9: Upsert into revenue_daily ─────────────────────────────────────────

CONFLICT_RD   = 'product_id,ssot_label,metric,observation_date'
CONFLICT_RDML = 'product_id,ssot_label,metric,observation_date'

print('\nUpserting demand rows into revenue_daily…')
t0 = time.time()
n1 = upsert_batch('revenue_daily', rd_rows, on_conflict=CONFLICT_RD)
print(f'  {n1} rows upserted in {time.time()-t0:.1f}s')

# ── Step 10: Upsert into revenue_daily_for_ml ─────────────────────────────────

print('\nUpserting demand rows into revenue_daily_for_ml…')
t0 = time.time()
n2 = upsert_batch('revenue_daily_for_ml', rdml_rows, on_conflict=CONFLICT_RDML)
print(f'  {n2} rows upserted in {time.time()-t0:.1f}s')

# ── Step 11: Verification ─────────────────────────────────────────────────────

print('\n=== Verification ===')
for table in ('revenue_daily', 'revenue_daily_for_ml'):
    v_rows = get_all(
        f'/rest/v1/{table}'
        f'?product_id=eq.2&metric=eq.demand'
        f'&observation_date=gte.{TRAINING_START}'
        f'&observation_date=lte.{TRAINING_END}'
        f'&select=quantity'
    )
    v_total = sum(float(r['quantity'] or 0) for r in v_rows)
    print(f'  {table}: pid=2 demand total={v_total:,.1f} FARDO10 in {len(v_rows)} daily rows')

print('\n=== Per-PID row counts (revenue_daily) ===')
all_pids_ok = True
for pid in demo_pids:
    rows = get_all(
        f'/rest/v1/revenue_daily'
        f'?product_id=eq.{pid}&metric=eq.demand'
        f'&select=quantity'
    )
    total = sum(float(r['quantity'] or 0) for r in rows)
    sku = pid_to_sku.get(pid, '?')
    uom = pid_to_stock_uom.get(pid, '?')
    status = 'OK' if len(rows) > 0 else 'MISSING'
    if len(rows) == 0:
        all_pids_ok = False
    print(f'  pid={pid:>6}  sku={sku:>12}  {len(rows):>5} rows  {total:>12,.1f} {uom:<8}  {status}')

if all_pids_ok:
    print('\n[PASS] All 23 demo PIDs have demand rows in revenue_daily.')
else:
    print('\n[WARN] Some PIDs have no demand rows — check SKU coverage in sale_order_lines.')
    # Not an error — some SKUs may have zero confirmed orders in the window

print('\nDone. NEXT STEPS:')
print('  1. python3 docs/reconciliation/trigger_ml_training_demand_2026-05-07.py')
print('     (trains Prophet on demand metric for all 23 demo SKUs)')
