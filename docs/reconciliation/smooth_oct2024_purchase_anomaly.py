"""
Populate revenue_daily_for_ml with October 2024 purchase anomaly smoothed out.

ARCHITECTURE
------------
revenue_daily        — original source of truth, NEVER modified by this script.
                       Holds verified acid-test data. Acid Test 1 has a perfect
                       score and must remain intact.

revenue_daily_for_ml     — ML-training-only clone created by migration
                       20260428000001_revenue_daily_for_ml.sql.
                       This script populates it from scratch each run.

The ML training pipeline reads revenue_daily_for_ml. All UI pages, acid tests,
and reconciliation scripts read revenue_daily only.

PROBLEM
-------
October 2024 shows 5–12 confirmed POs per SKU simultaneously across the 23 demo
SKUs (ML_PURCHASE_HYPOTHESIS_REVALIDATION_2026-04-28.md). The most likely cause
is historical PO data bulk-loaded during system onboarding, with date_planned
values landing in October 2024. Prophet sees October as a dense, high-volume
purchase month and fits a spurious seasonal component to an artifact.

FIX
---
For every row in revenue_daily for the 23 demo SKUs:
  - Sales rows: copied unchanged.
  - Purchase rows (purchases_ordered, purchases_received):
      Oct 2024 rows deleted; replaced with ONE synthetic row on 2024-10-15
      whose quantity = median of the other 15 months in the training window.
      If median == 0 (no purchases outside October), no synthetic row inserted.

IDEMPOTENCY
-----------
Clears ALL rows from revenue_daily_for_ml before copying. Safe to re-run.
After running: re-run ML training for all 23 demo SKUs.
"""

import os
import json
import urllib.request
import urllib.error
import statistics
from collections import defaultdict
from pathlib import Path

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
ANOMALY_MONTH  = '2024-10'
SYNTHETIC_DATE = '2024-10-15'   # representative mid-month placeholder
PURCHASE_METRICS = {'purchases_ordered', 'purchases_received'}
TARGET_TABLE = 'revenue_daily_for_ml'

# ── env ───────────────────────────────────────────────────────────────────────

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
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY  = os.environ['SUPABASE_SERVICE_ROLE_KEY']

# ── Supabase helpers ──────────────────────────────────────────────────────────

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

def supa_get_all(path_base):
    """Paginate through Supabase REST results (default page = 1000 rows)."""
    rows = []
    offset = 0
    limit  = 1000
    sep = '&' if '?' in path_base else '?'
    while True:
        status, body = supa_request('GET', f"{path_base}{sep}offset={offset}&limit={limit}")
        if status >= 400:
            raise RuntimeError(f"GET {path_base}: HTTP {status}: {body}")
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
            raise RuntimeError(f"INSERT into {table} batch {i//batch_size}: HTTP {status}: {body}")
        inserted += len(batch)
    return inserted

# ── Pre-flight: verify both tables exist ─────────────────────────────────────

for table in ('revenue_daily', TARGET_TABLE):
    status, _ = supa_request('GET', f'/rest/v1/{table}?limit=1')
    if status >= 400:
        migration = '20260428000001_revenue_daily_for_ml.sql' if table == TARGET_TABLE else '20260423000002_revenue_daily.sql'
        raise SystemExit(f"ERROR — {table} not found. Apply migration {migration} first.")
print("Both tables found. Proceeding.\n")

# ── Step 1: Get the 23 demo product_ids ───────────────────────────────────────
#
# CRITICAL: products_acid_test_active.id is an unrelated BIGSERIAL sequence.
# The correct FK for revenue_daily / revenue_daily_for_ml / forecast_results is
# products.id, resolved via products.sku = products_acid_test_active.default_code.

print("Fetching 23 demo SKUs from products_acid_test_active...")
demo_meta = supa_get_all(
    '/rest/v1/products_acid_test_active'
    '?select=default_code'
    '&is_top_10_in_class=eq.true'
)
demo_skus = [r['default_code'] for r in demo_meta if r.get('default_code')]
if len(demo_skus) != 23:
    raise SystemExit(f"ERROR — expected 23 top demo SKUs, got {len(demo_skus)}: {demo_skus}")
print(f"  {len(demo_skus)} demo SKUs: {sorted(demo_skus)}")

print("Resolving products.id for each SKU from products table...")
sku_csv = ','.join(demo_skus)
prod_rows = supa_get_all(f'/rest/v1/products?select=id,sku&sku=in.({sku_csv})')
sku_to_pid = {r['sku']: r['id'] for r in prod_rows}
missing = [s for s in demo_skus if s not in sku_to_pid]
if missing:
    raise SystemExit(f"ERROR — {len(missing)} demo SKUs not found in products table: {missing}")

demo_product_ids = [sku_to_pid[s] for s in demo_skus]
print(f"  Resolved {len(demo_product_ids)} products.id values: {sorted(demo_product_ids)}\n")

# ── Step 2: Fetch ALL revenue_daily rows for demo SKUs ────────────────────────

id_filter = ','.join(str(x) for x in demo_product_ids)
print("Fetching all rows from revenue_daily for demo SKUs (source of truth)...")
source_rows = supa_get_all(
    f'/rest/v1/revenue_daily'
    f'?select=product_id,ssot_label,metric,observation_date,quantity,revenue_gtq,source_doc_count'
    f'&product_id=in.({id_filter})'
    f'&order=id.asc'
)
print(f"  {len(source_rows)} rows fetched from revenue_daily.\n")

# ── Step 3: Compute per-metric smoothing medians ───────────────────────────────

# key = (product_id, metric, ssot_label) → month_str → total_qty
monthly = defaultdict(lambda: defaultdict(float))
for r in source_rows:
    if r['metric'] not in PURCHASE_METRICS:
        continue
    obs = r['observation_date']
    if not (TRAINING_START <= obs <= TRAINING_END):
        continue
    key   = (r['product_id'], r['metric'], r['ssot_label'])
    month = obs[:7]
    monthly[key][month] += float(r['quantity'] or 0)

# key → median_qty (or None if October has no data to replace)
median_by_key = {}
for key, month_map in monthly.items():
    if ANOMALY_MONTH not in month_map:
        continue   # no October data for this key — nothing to smooth
    other_qtys = [qty for m, qty in month_map.items() if m != ANOMALY_MONTH]
    if not other_qtys:
        continue   # October is the only month — cannot compute median; leave as-is
    median_by_key[key] = statistics.median(other_qtys)

print(f"Smoothing plan — {len(median_by_key)} (product, metric, ssot_label) combinations will have Oct 2024 replaced:\n")
print(f"  {'product_id':>10} {'metric':<22} {'Oct-2024 qty':>14} {'median (replacement)':>22}")
print(f"  {'-'*10} {'-'*22} {'-'*14} {'-'*22}")
for (pid, met, label), med in sorted(median_by_key.items()):
    oct_qty = monthly[(pid, met, label)].get(ANOMALY_MONTH, 0)
    print(f"  {pid:>10} {met:<22} {oct_qty:>14.2f} {med:>22.2f}")
print()

# ── Step 4: Build the output row list ─────────────────────────────────────────

out_rows = []

for r in source_rows:
    key = (r['product_id'], r['metric'], r['ssot_label'])
    obs = r['observation_date']

    # Purchase row in the anomaly month for a smoothed key → skip (replaced below)
    if r['metric'] in PURCHASE_METRICS and obs[:7] == ANOMALY_MONTH and key in median_by_key:
        continue

    out_rows.append({
        'product_id':       r['product_id'],
        'ssot_label':       r['ssot_label'],
        'metric':           r['metric'],
        'observation_date': obs,
        'quantity':         r['quantity'],
        'revenue_gtq':      r['revenue_gtq'],
        'source_doc_count': r['source_doc_count'],
    })

# Append synthetic October rows
synthetic_count = 0
for (pid, met, label), med in median_by_key.items():
    if round(med, 4) == 0:
        continue   # zero is correct — do not insert a synthetic zero row
    out_rows.append({
        'product_id':       pid,
        'ssot_label':       label,
        'metric':           met,
        'observation_date': SYNTHETIC_DATE,
        'quantity':         round(med, 4),
        'revenue_gtq':      None,
        'source_doc_count': 1,
    })
    synthetic_count += 1

print(f"Output: {len(out_rows)} rows ({len(source_rows)} source − dropped Oct purchase rows + {synthetic_count} synthetic)\n")

# ── Step 5: Clear revenue_daily_for_ml and re-populate ────────────────────────────

print(f"Clearing {TARGET_TABLE} for all 23 demo SKUs (using products.id values)...")
status, body = supa_request(
    'DELETE',
    f'/rest/v1/{TARGET_TABLE}?product_id=in.({id_filter})',
    prefer='return=minimal'
)
if status >= 400:
    raise RuntimeError(f"DELETE from {TARGET_TABLE}: HTTP {status}: {body}")
print(f"  Cleared.\n")

print(f"Inserting {len(out_rows)} rows into {TARGET_TABLE}...")
inserted = insert_batch(TARGET_TABLE, out_rows)
print(f"  Inserted {inserted} rows.\n")

# ── Step 6: Verification summary ──────────────────────────────────────────────

print("=== Verification — monthly purchase totals for Oct 2024 ===\n")
ml_rows = supa_get_all(
    f'/rest/v1/{TARGET_TABLE}'
    f'?select=product_id,metric,observation_date,quantity'
    f'&product_id=in.({id_filter})'
    f'&metric=in.(purchases_ordered,purchases_received)'
    f'&observation_date=gte.2024-10-01'
    f'&observation_date=lte.2024-10-31'
)

oct_by_pid_metric = defaultdict(float)
for r in ml_rows:
    oct_by_pid_metric[(r['product_id'], r['metric'])] += float(r['quantity'] or 0)

print(f"  {len(ml_rows)} rows in revenue_daily_for_ml for October 2024 purchases.")
print(f"  (Expected: {synthetic_count} — one synthetic row per smoothed combination)\n")

print("=== Verification — revenue_daily unchanged (acid test must still pass) ===\n")
acid_check = supa_get_all(
    '/rest/v1/revenue_daily'
    '?select=metric,observation_date,quantity'
    '&product_id=eq.33'  # SKU 77201046 — acid test SKU
    '&metric=in.(sales,purchases_ordered,purchases_received)'
    '&observation_date=gte.2024-11-01'
    '&observation_date=lte.2024-12-31'
)
month_agg = defaultdict(lambda: defaultdict(float))
for r in acid_check:
    month_agg[r['observation_date'][:7]][r['metric']] += float(r['quantity'] or 0)

targets = {
    ('2024-11', 'sales'):              6466.25,
    ('2024-12', 'sales'):              6496.50,
    ('2024-11', 'purchases_ordered'):  5855.0,  # corrected: 5917 was pol_all_states (incl. draft/RFQ); confirmed DEMO scope gives 5855
    ('2024-11', 'purchases_received'): 5500.0,
}
all_pass = True
for (month, metric), target in sorted(targets.items()):
    val  = month_agg[month].get(metric, 0)
    diff = abs(val - target)
    ok   = diff < 0.01
    mark = 'PASS' if ok else 'FAIL'
    print(f"  [{mark}] {month} {metric:<22}: prod={val:.2f}  target={target}  Δ={val-target:+.4f}")
    if not ok:
        all_pass = False

print()
if all_pass:
    print("Acid Test 1 intact — revenue_daily untouched, perfect score preserved.")
else:
    print("WARNING — revenue_daily values do not match acid test targets. Investigate immediately.")

print()
print("Next step: re-run ML training pipeline pointing at revenue_daily_for_ml.")
