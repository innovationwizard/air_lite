"""
Add CARVAJAL Tier 3 fallback purchase rows to revenue_daily_for_ml.

MUST BE RUN AFTER smooth_oct2024_purchase_anomaly.py.

PROBLEM
-------
Six CARVAJAL SKUs (77205003, 77205034, 77205208, 77205190, 77205035, 77205005)
have purchase orders ONLY in October 2024 in revenue_daily (the anomaly month).
After smoothing, they have zero usable purchase history outside October, so
forecast_purchases_derived.py returns insufficient_ratio_data and writes
yhat_sum=0 to forecast_results — a guaranteed-wrong zero for every purchase
forecast cell.

FIX
---
For each of the 6 Tier 3 SKUs, for every non-October training month where
the SKU has sales data in revenue_daily_for_ml, insert a synthetic purchase row:
    quantity = monthly_sales × R_class
where R_class is the Tukey-cleaned (IQR × 1.5) median ratio computed from all
other CARVAJAL SKUs that have usable purchase history.

The resulting rows carry the correct SSOT labels so that
forecast_purchases_derived.py reads them naturally without code changes.

IDEMPOTENCY
-----------
Deletes all non-October purchase rows for the 6 Tier 3 SKUs before inserting.
Safe to re-run. October 2024 rows (the smoothed synthetic median row left by
smooth_oct2024_purchase_anomaly.py) are preserved.

RATIOS (computed 2026-04-29, Tukey-cleaned from 11 CARVAJAL paired months):
    R_ORD = 0.4969  (purchases_ordered / sales)
    R_RCV = 0.5687  (purchases_received / sales)

ARCHITECTURE
------------
revenue_daily        — source of truth, never touched here.
revenue_daily_for_ml — ML-only clone; this script appends to it post-smoothing.

PIPELINE ORDER
--------------
1. find_15_populate_revenue_daily_purchases_from_supabase.py   (populates revenue_daily)
2. smooth_oct2024_purchase_anomaly.py                          (rebuilds revenue_daily_for_ml)
3. THIS SCRIPT                                                 (adds fallback rows for Tier 3 SKUs)
4. ML training via POST /api/acid-test/forecast/run

⚠️  DEPRECATION WARNING — READ BEFORE RUNNING
-----------------------------------------------
This script is PROHIBITED after find_15b has been applied to the pipeline.

REASON: find_15b (find_15b_supplement_purchases_from_stock_moves_2026-05-06.py)
populates revenue_daily with REAL stock_moves receipts for the 6 Tier 3 PIDs
(5, 29, 36, 145, 1113, 1127) AND the other 8 red-tier PIDs. Running this script
AFTER find_15b deletes that real data from revenue_daily_for_ml and replaces it
with synthetic estimates — strictly worse.

INCIDENT 2026-05-07/08: This script was run after find_15b was already applied.
It deleted real stock_moves data for PIDs 1113 and 1127 from revenue_daily_for_ml
and replaced with synthetic ratios. It also masked data-loss for those PIDs while
PIDs 1587, 1590, 1600 (not in TIER3_PIDS) were left at 0 months.
Result: stoplight regression from 20/3/0 → 16/4/3.
Fix: docs/reconciliation/fix_revenue_daily_5_pids_2026-05-08.py

This script is ONLY valid for the pre-find_15b pipeline state where the 6 Tier 3
CARVAJAL PIDs had zero real purchase data outside October 2024.

DO NOT RUN unless you have confirmed that find_15b has NOT been applied.
"""

import os, json, statistics, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

raise RuntimeError(
    "find_16 is PROHIBITED after find_15b has been applied.\n"
    "Running this script deletes real stock_moves purchase data from\n"
    "revenue_daily_for_ml and replaces it with synthetic estimates.\n"
    "Incident 2026-05-08: caused stoplight regression 20/3/0 → 16/4/3.\n"
    "Fix: docs/reconciliation/fix_revenue_daily_5_pids_2026-05-08.py\n"
    "If you genuinely need the pre-find_15b fallback behavior, remove this\n"
    "guard explicitly and document why in the commit message."
)

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
ANOMALY_MONTH  = '2024-10'
SYNTHETIC_DATE_TEMPLATE = '{month}-15'

TIER3_PIDS  = [5, 29, 36, 145, 1113, 1127]
DEMO_PIDS   = [2,3,5,20,29,33,34,36,37,145,469,539,1035,1069,1096,1113,1127,1366,1562,1587,1590,1600,1606]
CARVAJAL_PIDS = [2, 3, 5, 29, 36, 37, 145, 1035, 1069, 1113, 1127]

SSOT_ORD = 'pol_confirmed_date_planned_product_qty_c40'
SSOT_RCV = 'pol_purchase_done_date_planned_qty_received_c40'
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
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            if k.strip() not in os.environ:
                os.environ[k.strip()] = v.strip()

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
    rows, offset, limit = [], 0, 1000
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
            raise RuntimeError(f"INSERT {table} batch {i // batch_size}: HTTP {status}: {body}")
        inserted += len(batch)
    return inserted

# ── Tukey IQR×1.5 median ─────────────────────────────────────────────────────

def _percentile(sorted_vals, pct):
    n = len(sorted_vals)
    idx = pct / 100 * (n - 1)
    lo_i = int(idx)
    hi_i = min(lo_i + 1, n - 1)
    return sorted_vals[lo_i] * (1 - (idx - lo_i)) + sorted_vals[hi_i] * (idx - lo_i)

def tukey_cleaned_median(values):
    if not values:
        return None
    if len(values) < 4:
        return statistics.median(values)
    vs = sorted(values)
    q1 = _percentile(vs, 25)
    q3 = _percentile(vs, 75)
    iqr = q3 - q1
    lo, hi = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    inliers = [v for v in vs if lo <= v <= hi]
    if not inliers:
        inliers = vs
    return statistics.median(inliers)

# ── Pre-flight ────────────────────────────────────────────────────────────────

status, _ = supa_request('GET', f'/rest/v1/{TARGET_TABLE}?limit=1')
if status >= 400:
    raise SystemExit(f"ERROR — {TARGET_TABLE} not found. Run migrations first.")
print(f"{TARGET_TABLE} confirmed. Proceeding.\n")

# ── Step 1: Load revenue_daily_for_ml monthly totals ─────────────────────────

pid_filter = ','.join(str(p) for p in DEMO_PIDS)
print("Loading revenue_daily_for_ml for all 23 demo SKUs...")
ml_rows = supa_get_all(
    f'/rest/v1/{TARGET_TABLE}'
    f'?select=product_id,metric,observation_date,quantity'
    f'&product_id=in.({pid_filter})'
    f'&order=product_id.asc,observation_date.asc'
)
print(f"  {len(ml_rows)} rows loaded.\n")

monthly = defaultdict(lambda: defaultdict(float))
for r in ml_rows:
    key = (r['product_id'], r['metric'])
    month = r['observation_date'][:7]
    monthly[key][month] += float(r['quantity'] or 0)

# ── Step 2: Compute Tukey-cleaned CARVAJAL cross-SKU ratios ──────────────────

print("Computing Tukey-cleaned CARVAJAL class ratios (excl. Oct 2024)...")
raw_ratios_ord, raw_ratios_rcv = [], []

for pid in CARVAJAL_PIDS:
    sales_m = {
        m: q for m, q in monthly[(pid, 'sales')].items()
        if m != ANOMALY_MONTH
        and TRAINING_START[:7] <= m <= TRAINING_END[:7]
        and q > 0
    }
    ord_m = {
        m: q for m, q in monthly[(pid, 'purchases_ordered')].items()
        if m != ANOMALY_MONTH and q > 0
    }
    rcv_m = {
        m: q for m, q in monthly[(pid, 'purchases_received')].items()
        if m != ANOMALY_MONTH and q > 0
    }
    for m in sales_m:
        if m in ord_m:
            raw_ratios_ord.append(ord_m[m] / sales_m[m])
        if m in rcv_m:
            raw_ratios_rcv.append(rcv_m[m] / sales_m[m])

R_ORD = tukey_cleaned_median(raw_ratios_ord)
R_RCV = tukey_cleaned_median(raw_ratios_rcv)

if R_ORD is None or not (0.01 <= R_ORD <= 5.0):
    raise SystemExit(f"ERROR — R_ORD={R_ORD} is None or outside [0.01, 5.0]. Investigate.")
if R_RCV is None or not (0.01 <= R_RCV <= 5.0):
    raise SystemExit(f"ERROR — R_RCV={R_RCV} is None or outside [0.01, 5.0]. Investigate.")

print(f"  R_ORD (purchases_ordered/sales) = {R_ORD:.4f}  ({len(raw_ratios_ord)} raw pairs, Tukey-cleaned)")
print(f"  R_RCV (purchases_received/sales) = {R_RCV:.4f}  ({len(raw_ratios_rcv)} raw pairs, Tukey-cleaned)\n")

# ── Step 3: Build synthetic rows for Tier 3 SKUs ─────────────────────────────

out_rows = []
plan_summary = []

for pid in TIER3_PIDS:
    sales_months = {
        m: q for m, q in monthly[(pid, 'sales')].items()
        if m != ANOMALY_MONTH
        and TRAINING_START[:7] <= m <= TRAINING_END[:7]
        and q > 0
    }
    for month, sales_qty in sorted(sales_months.items()):
        date_str = SYNTHETIC_DATE_TEMPLATE.format(month=month)
        ord_qty = round(sales_qty * R_ORD, 4)
        rcv_qty = round(sales_qty * R_RCV, 4)
        out_rows.append({
            'product_id': pid, 'ssot_label': SSOT_ORD,
            'metric': 'purchases_ordered', 'observation_date': date_str,
            'quantity': ord_qty, 'revenue_gtq': None, 'source_doc_count': 1,
        })
        out_rows.append({
            'product_id': pid, 'ssot_label': SSOT_RCV,
            'metric': 'purchases_received', 'observation_date': date_str,
            'quantity': rcv_qty, 'revenue_gtq': None, 'source_doc_count': 1,
        })
        plan_summary.append((pid, month, round(sales_qty, 2), round(ord_qty, 2), round(rcv_qty, 2)))

print(f"Synthetic row plan — {len(out_rows)} rows for {len(TIER3_PIDS)} SKUs:\n")
print(f"  {'pid':>5}  {'month':<8}  {'sales_qty':>12}  {'ord_qty':>12}  {'rcv_qty':>12}")
print(f"  {'-'*5}  {'-'*8}  {'-'*12}  {'-'*12}  {'-'*12}")
for pid, month, sq, oq, rq in plan_summary:
    print(f"  {pid:>5}  {month:<8}  {sq:>12.2f}  {oq:>12.4f}  {rq:>12.4f}")
print()

# ── Step 4: Delete existing non-October purchase rows for Tier 3 SKUs ─────────

tier3_filter = ','.join(str(p) for p in TIER3_PIDS)
print("Clearing existing non-October purchase rows for Tier 3 SKUs (idempotency)...")
for ssot_label in (SSOT_ORD, SSOT_RCV):
    status, body = supa_request(
        'DELETE',
        f'/rest/v1/{TARGET_TABLE}'
        f'?product_id=in.({tier3_filter})'
        f'&ssot_label=eq.{ssot_label}'
        f'&observation_date=gte.2024-11-01',
        prefer='return=minimal',
    )
    if status >= 400:
        raise RuntimeError(f"DELETE {ssot_label}: HTTP {status}: {body}")
    print(f"  Cleared {ssot_label}")

# ── Step 5: Insert ────────────────────────────────────────────────────────────

print(f"\nInserting {len(out_rows)} rows into {TARGET_TABLE}...")
inserted = insert_batch(TARGET_TABLE, out_rows)
print(f"  Inserted {inserted} rows.\n")

# ── Step 6: Verification ──────────────────────────────────────────────────────

print("=== Verification ===\n")
all_pass = True
for pid in TIER3_PIDS:
    check = supa_get_all(
        f'/rest/v1/{TARGET_TABLE}'
        f'?select=metric,observation_date,quantity'
        f'&product_id=eq.{pid}'
        f'&metric=in.(purchases_ordered,purchases_received)'
        f'&observation_date=gte.2024-11-01'
        f'&order=metric.asc,observation_date.asc'
    )
    ord_rows = [r for r in check if r['metric'] == 'purchases_ordered']
    rcv_rows = [r for r in check if r['metric'] == 'purchases_received']
    expected = len([m for m, _ in {
        m: q for m, q in monthly[(pid, 'sales')].items()
        if m != ANOMALY_MONTH and TRAINING_START[:7] <= m <= TRAINING_END[:7] and q > 0
    }.items()])
    ok = (len(ord_rows) == expected and len(rcv_rows) == expected)
    mark = 'PASS' if ok else 'FAIL'
    if not ok:
        all_pass = False
    print(f"  [{mark}] pid={pid}: {len(ord_rows)} ordered rows, {len(rcv_rows)} received rows"
          f"  (expected {expected} each)")

print()
if all_pass:
    print("All 6 Tier 3 SKUs verified. forecast_purchases_derived.py will now compute")
    print(f"a ratio close to R_ORD={R_ORD:.4f} for purchases_ordered and R_RCV={R_RCV:.4f}")
    print("for purchases_received for these SKUs instead of returning insufficient_ratio_data.")
else:
    print("WARNING — one or more Tier 3 SKUs failed verification. Investigate before ML training.")

print("\nNext step: ML training via POST /api/acid-test/forecast/run")
print("  scope=top  training_start=2024-10-01  training_end=2026-01-31  prediction_end=2026-03-31")
