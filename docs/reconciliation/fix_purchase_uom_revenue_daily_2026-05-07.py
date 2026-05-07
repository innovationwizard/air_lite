"""
Fix purchase UoM mismatch in revenue_daily for 17 of 23 demo SKUs.

ROOT CAUSE
----------
find_15 and find_15b both apply to_caja40() to purchase quantities before
storing them in revenue_daily. This converts quantities to CAJA40 units.

Sales data (from find_12 / Odoo AML) is stored in each product's stock_uom
(e.g. FARDO10 for SKU 77205001), NOT in CAJA40.

Both metrics share the same revenue_daily.quantity column and the same y-axis
in the forecast-diagnostic chart. When purchase is in CAJA40 and sales is in
FARDO10, they appear on the same axis with different implicit units:

    SKU 77205001: sales ~33,427 FARDO10 vs purchases ~9,314 CAJA40
                  in FARDO10 terms: 33,427 sales vs 37,256 received
                  THE CHART SHOWS 9,314 as if it were FARDO10 → 4x undercount

This is why the client sees "10k received vs 36k sold" for SKU 77205001.

FIX
---
Multiply all purchase rows in revenue_daily by (stock_uom_ratio / CAJA40_ratio)
for each affected SKU. For CAJA40 products the factor = 1.0 (no change).

IDEMPOTENCY
-----------
Pre-check: compare revenue_daily purchases_Jul_2025 for pid=2 against the
expected stock_moves value (~37,257 FARDO10). If ratio > 0.9, already fixed.

PIPELINE ORDER — run this BEFORE:
  smooth_oct2024_purchase_anomaly.py      → rebuilds revenue_daily_for_ml
  find_16_carvajal_tier3_fallback_purchases_for_ml.py
  recompute_po_history_real_months_2026-05-07.py
  Trigger ML training via /api/acid-test/forecast/run

CONFIRMED BUG (2026-05-07):
  stock_moves vendor→internal Jul 2025 for pid=2: 34,225 FARDO10
  revenue_daily purchases_received Jul 2025 for pid=2: 9,314
  ratio: 9,314 / 34,225 = 0.272 ≈ CAJA40_RATIO / FARDO10_RATIO = 0.025 / 0.1 = 0.25
  This confirms the to_caja40() factor was applied when it should not have been.
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
KEY  = os.environ['SUPABASE_SERVICE_ROLE_KEY']

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


def insert_batch(table, rows, batch_size=500):
    inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        status, body = supa_request('POST', f'/rest/v1/{table}', body=batch,
                                    prefer='return=minimal')
        if status >= 400:
            raise RuntimeError(f'INSERT {table} batch {i // batch_size}: HTTP {status}: {body}')
        inserted += len(batch)
    return inserted


# ── Step 1: Build correction map ──────────────────────────────────────────────

print('Loading UoM ratios…')
uom_rows = get_all('/rest/v1/units_of_measure?select=name,ratio')
uom_ratio = {r['name']: float(r['ratio']) for r in uom_rows}
CAJA40_RATIO = uom_ratio['CAJA40']
print(f'  CAJA40 ratio: {CAJA40_RATIO}')

DEMO_23_SKUS = [
    '77205001','77205003','77205207','77205034','77205287','77205208',
    '77205190','77205005','77205002','77205035','77205187','77201046',
    '77201000','77201055','77201053','77201069','77201041','77201014',
    '77201056','77201019','77201038','77201047','77201023',
]
skus_csv = ','.join(f'"{s}"' for s in DEMO_23_SKUS)

print('\nLoading demo SKU stock_uoms…')
prods = get_all(f'/rest/v1/products?sku=in.({skus_csv})&select=id,sku,stock_uom')
pid_to_sku = {p['id']: p['sku'] for p in prods}
sku_to_pid = {p['sku']: p['id'] for p in prods}

# Build correction factors — only for SKUs where stock_uom != CAJA40
corrections: dict[int, dict] = {}  # pid → {uom, factor}
for p in prods:
    pid = p['id']
    stock_uom = p['stock_uom']
    if not stock_uom:
        print(f'  WARNING: pid={pid} ({p["sku"]}) has no stock_uom — skipping')
        continue
    uom_r = uom_ratio.get(stock_uom)
    if uom_r is None:
        print(f'  WARNING: pid={pid} ({p["sku"]}) stock_uom={stock_uom} not in UoM table — skipping')
        continue
    factor = uom_r / CAJA40_RATIO
    if abs(factor - 1.0) > 0.001:
        corrections[pid] = {'sku': p['sku'], 'stock_uom': stock_uom, 'factor': factor}

print(f'\n  Affected PIDs (factor ≠ 1.0): {len(corrections)}')
for pid, c in sorted(corrections.items()):
    print(f'    pid={pid:>6}  sku={c["sku"]:>12}  stock_uom={c["stock_uom"]:>8}  factor={c["factor"]:.4f}')

# ── Step 2: Idempotency check ──────────────────────────────────────────────────

print('\n=== Idempotency check (pid=2, purchases_received, 2025-07) ===')
check_rows = get_all(
    '/rest/v1/revenue_daily?product_id=eq.2&metric=eq.purchases_received'
    '&observation_date=gte.2025-07-01&observation_date=lte.2025-07-31'
    '&select=quantity'
)
check_total = sum(float(r['quantity'] or 0) for r in check_rows)
EXPECTED_AFTER_FIX = 34_225.0    # stock_moves Jul 2025 vendor→internal for pid=2
EXPECTED_BEFORE_FIX = 9_314.0    # what find_15b stored (CAJA40 units)

print(f'  Current Jul 2025 purchases_received for pid=2: {check_total:,.1f}')
if check_total > EXPECTED_BEFORE_FIX * 2:
    print('  ALREADY FIXED — purchases look correct (>2× the pre-fix value).')
    print('  Aborting to avoid double-correction.')
    raise SystemExit(0)
else:
    print(f'  Pre-fix detected ({check_total:,.1f} ≈ {EXPECTED_BEFORE_FIX:,.1f}). Proceeding with correction.')

# ── Step 3: Fetch, correct, and rewrite purchase rows ────────────────────────

PURCHASE_METRICS = ('purchases_ordered', 'purchases_received')
PURCHASE_SSOTS   = (
    'pol_confirmed_date_planned_product_qty_c40',
    'pol_purchase_done_date_planned_qty_received_c40',
)

affected_pids_csv = ','.join(str(p) for p in sorted(corrections))

print(f'\nFetching all purchase rows from revenue_daily for {len(corrections)} affected PIDs…')
t0 = time.time()
existing_rows = get_all(
    f'/rest/v1/revenue_daily'
    f'?product_id=in.({affected_pids_csv})'
    f'&metric=in.(purchases_ordered,purchases_received)'
    f'&select=id,product_id,metric,ssot_label,observation_date,quantity,revenue_gtq,source_doc_count'
)
print(f'  {len(existing_rows)} rows fetched in {time.time()-t0:.1f}s')

# Build corrected rows
corrected_rows: list[dict] = []
by_pid_month: dict[int, dict] = defaultdict(lambda: defaultdict(float))
for row in existing_rows:
    pid = row['product_id']
    c   = corrections.get(pid)
    if c is None:
        continue  # should not happen since we filtered by affected_pids_csv
    factor = c['factor']
    old_qty = float(row['quantity'] or 0)
    new_qty = round(old_qty * factor, 4)
    corrected_rows.append({
        'product_id':       pid,
        'ssot_label':       row['ssot_label'],
        'metric':           row['metric'],
        'observation_date': row['observation_date'],
        'quantity':         new_qty,
        'revenue_gtq':      row['revenue_gtq'],
        'source_doc_count': row['source_doc_count'],
    })
    mo = str(row['observation_date'])[:7]
    by_pid_month[pid][mo] += new_qty

print(f'  {len(corrected_rows)} rows to rewrite')

# Monthly preview for SKU 77205001 (pid=2) — the focus SKU
print('\n=== Preview: corrected monthly purchases_received for pid=2 (77205001) ===')
pid2_months = {}
for row in existing_rows:
    if row['product_id'] == 2 and row['metric'] == 'purchases_received':
        mo = str(row['observation_date'])[:7]
        c  = corrections[2]
        old = float(row['quantity'] or 0)
        new = round(old * c['factor'], 4)
        pid2_months[mo] = pid2_months.get(mo, 0) + new
for mo in sorted(pid2_months):
    print(f'  {mo}: {pid2_months[mo]:,.1f} FARDO10')

# ── Step 4: Delete and reinsert ───────────────────────────────────────────────

print(f'\nDeleting existing purchase rows for {len(corrections)} affected PIDs from revenue_daily…')
t0 = time.time()
for metric in PURCHASE_METRICS:
    status, body = supa_request(
        'DELETE',
        f'/rest/v1/revenue_daily?product_id=in.({affected_pids_csv})&metric=eq.{metric}',
        prefer='return=minimal',
    )
    if status >= 400:
        raise RuntimeError(f'DELETE revenue_daily metric={metric}: HTTP {status}: {body}')
    print(f'  Deleted {metric} rows')
print(f'  Deletion completed in {time.time()-t0:.1f}s')

print(f'\nInserting {len(corrected_rows)} corrected rows into revenue_daily…')
t0 = time.time()
inserted = insert_batch('revenue_daily', corrected_rows)
print(f'  Inserted {inserted} rows in {time.time()-t0:.1f}s')

# ── Step 5: Verification ──────────────────────────────────────────────────────

print('\n=== Verification ===')
verify = get_all(
    '/rest/v1/revenue_daily?product_id=eq.2&metric=eq.purchases_received'
    '&observation_date=gte.2025-07-01&observation_date=lte.2025-07-31'
    '&select=quantity'
)
verify_total = sum(float(r['quantity'] or 0) for r in verify)
delta = abs(verify_total - EXPECTED_AFTER_FIX) / EXPECTED_AFTER_FIX
print(f'  pid=2 Jul 2025 purchases_received after fix: {verify_total:,.1f}')
print(f'  Expected (from stock_moves): ~{EXPECTED_AFTER_FIX:,.1f}')
print(f'  Delta: {delta*100:.1f}%')
if delta < 0.15:
    print('  [PASS] Correction applied correctly')
else:
    print('  [WARN] Delta > 15% — verify manually')

# ── Step 6: Summary across all 23 demo SKUs ──────────────────────────────────

print('\n=== Monthly purchases_received summary for ALL 23 demo SKUs (CAJA40-corrected) ===')
summary = get_all(
    f'/rest/v1/revenue_daily'
    f'?product_id=in.({",".join(str(p["id"]) for p in prods)})'
    f'&metric=eq.purchases_received'
    f'&select=product_id,observation_date,quantity'
    f'&order=observation_date.asc'
)
total_by_month: dict[str, float] = defaultdict(float)
for r in summary:
    mo = str(r['observation_date'])[:7]
    total_by_month[mo] += float(r['quantity'] or 0)

print(f"  {'Month':>10}  {'Total PO Rcv (stock_uom)':>25}")
for mo in sorted(total_by_month):
    if mo <= '2026-01':
        print(f'  {mo}  {total_by_month[mo]:>25,.1f}')

print('\nDone. NEXT STEPS (in order):')
print('  1. python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py')
print('  2. python3 docs/reconciliation/find_16_carvajal_tier3_fallback_purchases_for_ml.py')
print('  3. python3 docs/reconciliation/recompute_po_history_real_months_2026-05-07.py')
print('  4. Trigger ML: POST /api/acid-test/forecast/run')
