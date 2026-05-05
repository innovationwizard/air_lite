"""
Fix Feb 2026 purchases_received (and purchases_ordered) rows in forecast_results.

PROBLEM
-------
The inline training script used POST with prefer='resolution=merge-duplicates'
which does not UPDATE existing rows — it returns 409 for any row whose unique
key already exists.  Feb 2026 purchases_received rows from the previous Prophet
training run were NOT overwritten, leaving old Prophet values in the table.

FIX
---
1. DELETE all Feb + Mar 2026 purchase rows from forecast_results for the 23
   demo PIDs where training_end_date='2026-01-31'.  (Mar rows were written
   correctly by the last run but we re-derive them anyway for consistency.)
2. Re-call Railway /forecast/purchases-derived for each SKU × 2 metrics.
3. INSERT the results directly (no conflict possible after the delete).

WHY NOT USE THE VERCEL ROUTE
-----------------------------
POST /api/acid-test/forecast/run requires a Supabase session cookie
(middleware auth).  We call Railway directly and persist via service role key.
"""

import json, os, time, urllib.request, urllib.error
from pathlib import Path

# ── env ──────────────────────────────────────────────────────────────────────

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

SUPA_URL    = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPA_KEY    = os.environ['SUPABASE_SERVICE_ROLE_KEY']
ML_URL      = os.environ['ML_SERVICE_URL']
ML_KEY      = os.environ['ML_SERVICE_API_KEY']

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
PREDICTION_END = '2026-03-31'

PURCHASE_TRIPLETS = [
    ('pol_confirmed_date_planned_product_qty_c40',         'purchases_ordered'),
    ('pol_purchase_done_date_planned_qty_received_c40',    'purchases_received'),
]

DEMO_PIDS = [2,3,5,20,29,33,34,36,37,145,469,539,1035,1069,1096,1113,1127,1366,1562,1587,1590,1600,1606]

# ── Supabase helpers ──────────────────────────────────────────────────────────

def supa(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'apikey': SUPA_KEY,
        'Authorization': f'Bearer {SUPA_KEY}',
        'Content-Type': 'application/json',
    }
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(f'{SUPA_URL}{path}', data=data, headers=headers, method=method)
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
        status, body = supa('GET', f'{path_base}{sep}offset={offset}&limit={limit}')
        if status >= 400:
            raise RuntimeError(f'GET {path_base}: HTTP {status}: {body}')
        if not body:
            break
        rows.extend(body)
        if len(body) < limit:
            break
        offset += limit
    return rows

def insert_batch(table, rows, batch_size=200):
    inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        status, body = supa('POST', f'/rest/v1/{table}', body=batch, prefer='return=minimal')
        if status >= 400:
            raise RuntimeError(f'INSERT {table} batch {i//batch_size}: HTTP {status}: {body}')
        inserted += len(batch)
    return inserted

# ── Railway helper ────────────────────────────────────────────────────────────

def ml_post(endpoint, payload):
    data = json.dumps(payload).encode()
    headers = {
        'X-API-Key': ML_KEY,
        'Content-Type': 'application/json',
    }
    req = urllib.request.Request(f'{ML_URL}{endpoint}', data=data, headers=headers, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# ── Step 1: Delete stale purchase rows for Feb + Mar 2026 ────────────────────

pid_filter = ','.join(str(p) for p in DEMO_PIDS)

print('=== Step 1: Delete ALL purchase rows from forecast_results (any ssot_label) ===\n')
# Delete by metric — catches old label (pol_all_states_*) and new labels alike.
# The old Prophet run used pol_all_states_date_planned_product_qty_c40; the new
# derived run should use pol_confirmed_* and pol_purchase_done_*. Deleting by
# metric ensures a clean slate regardless of which label exists.
for _, metric in PURCHASE_TRIPLETS:
    status, body = supa(
        'DELETE',
        f'/rest/v1/forecast_results'
        f'?product_id=in.({pid_filter})'
        f'&metric=eq.{metric}'
        f'&forecast_month=in.(2026-02-01,2026-03-01)',
        prefer='return=minimal',
    )
    if status >= 400:
        raise RuntimeError(f'DELETE {metric}: HTTP {status}: {body}')
    print(f'  Deleted {metric} rows for Feb+Mar 2026 (all ssot labels)')

# Verify deletion
remaining = supa_get_all(
    f'/rest/v1/forecast_results'
    f'?product_id=in.({pid_filter})'
    f'&metric=in.(purchases_ordered,purchases_received)'
    f'&training_end_date=eq.{TRAINING_END}'
    f'&forecast_month=in.(2026-02-01,2026-03-01)'
    f'&select=id,product_id,metric,forecast_month'
)
if remaining:
    raise SystemExit(f'ERROR — {len(remaining)} purchase rows still exist after delete: {remaining[:3]}')
print(f'\n  Verified: 0 rows remain. Safe to insert.\n')

# ── Step 2: Re-derive and insert ─────────────────────────────────────────────

print('=== Step 2: Re-derive purchase forecasts via Railway ===\n')

rows_to_insert = []
ok_count = 0
fail_count = 0
t0 = time.time()

for pid in DEMO_PIDS:
    for ssot_label, metric in PURCHASE_TRIPLETS:
        status, resp = ml_post('/forecast/purchases-derived', {
            'product_id':     pid,
            'ssot_label':     ssot_label,
            'metric':         metric,
            'training_start': TRAINING_START,
            'training_end':   TRAINING_END,
            'prediction_end': PREDICTION_END,
        })

        if status >= 400:
            print(f'  [FAIL] pid={pid} {metric}: HTTP {status}: {str(resp)[:200]}')
            fail_count += 1
            continue

        derived_status = resp.get('status')
        monthly = resp.get('monthly', [])
        ratio_detail = resp.get('ratio_detail', {})
        R = ratio_detail.get('R')
        months_used = ratio_detail.get('months_used', 0)
        months_excl = ratio_detail.get('months_excluded', 0)

        if derived_status != 'ok_derived' or not monthly:
            print(f'  [SKIP] pid={pid} {metric}: status={derived_status}')
            fail_count += 1
            continue

        for m in monthly:
            rows_to_insert.append({
                'product_id':        pid,
                'ssot_label':        ssot_label,
                'metric':            metric,
                'forecast_month':    f"{m['month']}-01",
                'training_start_date': TRAINING_START,
                'training_end_date': TRAINING_END,
                'yhat_sum':          round(float(m['yhat_sum']), 4),
                'yhat_lower_sum':    round(float(m['yhat_lower_sum']), 4),
                'yhat_upper_sum':    round(float(m['yhat_upper_sum']), 4),
                'training_points':   resp.get('training_points'),
                'nonzero_points':    resp.get('nonzero_points'),
                'model_status':      'ok_derived',
            })

        excl_str = f', excl={months_excl}' if months_excl else ''
        print(f'  [OK]   pid={pid} {metric}: R={R}, months={months_used}{excl_str}, {len(monthly)} forecast months')
        ok_count += 1

print(f'\n  Done calling ML: ok={ok_count}  failed={fail_count}  rows_to_insert={len(rows_to_insert)}\n')

if not rows_to_insert:
    raise SystemExit('ERROR — no rows to insert. Something went wrong.')

# ── Step 3: Insert ────────────────────────────────────────────────────────────

print('=== Step 3: Insert derived rows into forecast_results ===\n')
inserted = insert_batch('forecast_results', rows_to_insert)
print(f'  Inserted {inserted} rows.\n')

# ── Step 4: Verification ──────────────────────────────────────────────────────

print('=== Step 4: Verification ===\n')
verify = supa_get_all(
    f'/rest/v1/forecast_results'
    f'?product_id=in.({pid_filter})'
    f'&metric=in.(purchases_ordered,purchases_received)'
    f'&training_end_date=eq.{TRAINING_END}'
    f'&forecast_month=in.(2026-02-01,2026-03-01)'
    f'&select=product_id,metric,forecast_month,yhat_sum,model_status'
    f'&order=product_id.asc,metric.asc,forecast_month.asc'
)

derived_rows = [r for r in verify if r.get('model_status') == 'ok_derived']
expected = len(DEMO_PIDS) * 2 * 2  # 23 pids × 2 metrics × 2 months = 92

print(f'  Total purchase forecast rows in table: {len(verify)}')
print(f'  Rows with model_status=ok_derived: {len(derived_rows)} (expected {expected})')

# Print a compact table
print(f'\n  {"pid":>6}  {"metric":>20}  {"feb_yhat":>12}  {"mar_yhat":>12}')
print(f'  {"-"*6}  {"-"*20}  {"-"*12}  {"-"*12}')

by_pid_metric = {}
for r in verify:
    key = (r['product_id'], r['metric'])
    month = r['forecast_month'][:7]
    if key not in by_pid_metric:
        by_pid_metric[key] = {}
    by_pid_metric[key][month] = r['yhat_sum']

for pid in DEMO_PIDS:
    for _, metric in PURCHASE_TRIPLETS:
        key = (pid, metric)
        d = by_pid_metric.get(key, {})
        feb = d.get('2026-02', '—')
        mar = d.get('2026-03', '—')
        if isinstance(feb, float): feb = f'{feb:,.2f}'
        if isinstance(mar, float): mar = f'{mar:,.2f}'
        print(f'  {pid:>6}  {metric:>20}  {feb:>12}  {mar:>12}')

print(f'\nDuration: {time.time()-t0:.1f}s')
if len(derived_rows) == expected:
    print(f'\nAll {expected} purchase forecast cells confirmed ok_derived. Acid Test 2 is ready to score.')
else:
    print(f'\nWARNING — only {len(derived_rows)}/{expected} cells confirmed. Investigate missing rows.')
