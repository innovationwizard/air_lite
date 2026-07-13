"""
Full two-pass ML training for all 23 demo SKUs — 2026-05-05.

WHY THIS IS NEEDED
------------------
revenue_daily_for_ml was rebuilt on 2026-04-29 (computed_at range:
2026-04-29T04:18 – 13:18 UTC). The sales Prophet forecasts were computed on
2026-04-24T17:29 UTC. The training data changed after the forecasts were
written, so all forecasts must be re-run.

TWO-PASS ARCHITECTURE
---------------------
Pass 1 — Prophet for sales (all 23 PIDs).
         Persists to forecast_results. Required before Pass 2 can read it.
Pass 2 — Derived ratio for purchases_ordered + purchases_received (all 23 PIDs).
         Reads the Pass 1 sales forecasts from forecast_results and multiplies
         by the per-SKU median(PO/Sales ratio) with Tukey IQR×1.5 outlier
         exclusion.

PERSISTENCE
-----------
Upsert with onConflict=(product_id, ssot_label, metric, forecast_month,
training_end_date). The unique constraint handles idempotency — re-running
updates existing rows in place. No DELETE needed because:
  - Sales ssot_label has not changed.
  - Purchase ssot_labels were corrected on 2026-04-29 (fix_feb2026 script).
"""

import json, os, time, urllib.request, urllib.error
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

SUPA_URL = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SECRET_KEY']
ML_URL   = os.environ['ML_SERVICE_URL']
ML_KEY   = os.environ['ML_SERVICE_API_KEY']

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
PREDICTION_END = '2026-03-31'

SALES_LABEL  = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'
PURCHASE_TRIPLETS = [
    ('pol_confirmed_date_planned_product_qty_c40',      'purchases_ordered'),
    ('pol_purchase_done_date_planned_qty_received_c40', 'purchases_received'),
]

DEMO_PIDS = [2,3,5,20,29,33,34,36,37,145,469,539,
             1035,1069,1096,1113,1127,1366,1562,1587,1590,1600,1606]

# ── Supabase helpers ──────────────────────────────────────────────────────────

def supa(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {
        'apikey':        SUPA_KEY,
        'Authorization': f'Bearer {SUPA_KEY}',
        'Content-Type':  'application/json',
    }
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(
        f'{SUPA_URL}{path}', data=data, headers=headers, method=method,
    )
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def upsert_batch(table, rows, conflict_cols, batch_size=200):
    inserted = 0
    prefer = f'resolution=merge-duplicates,return=minimal'
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        status, body = supa(
            'POST',
            f'/rest/v1/{table}?on_conflict={conflict_cols}',
            body=batch,
            prefer=prefer,
        )
        if status >= 400:
            raise RuntimeError(
                f'UPSERT {table} batch {i // batch_size}: HTTP {status}: {body}',
            )
        inserted += len(batch)
    return inserted

# ── Railway helper ────────────────────────────────────────────────────────────

def ml_post(endpoint, payload, timeout=180):
    data = json.dumps(payload).encode()
    headers = {'X-API-Key': ML_KEY, 'Content-Type': 'application/json'}
    req = urllib.request.Request(
        f'{ML_URL}{endpoint}', data=data, headers=headers, method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# ── Pass 1: Prophet for sales ─────────────────────────────────────────────────

CONFLICT_COLS = 'product_id,ssot_label,metric,forecast_month,training_end_date'

print('=' * 70)
print('PASS 1 — Prophet: sales')
print('=' * 70)

sales_rows = []
pass1_ok = pass1_fail = 0
t0 = time.time()

for pid in DEMO_PIDS:
    status, resp = ml_post('/forecast/revenue-daily', {
        'product_id':    pid,
        'ssot_label':    SALES_LABEL,
        'metric':        'sales',
        'training_start': TRAINING_START,
        'training_end':  TRAINING_END,
        'prediction_end': PREDICTION_END,
    })

    if status >= 400:
        print(f'  [FAIL] pid={pid} sales: HTTP {status}: {str(resp)[:200]}')
        pass1_fail += 1
        continue

    ml_status  = resp.get('status')
    monthly    = resp.get('monthly', [])
    train_pts  = resp.get('training_points')
    nonzero_pts = resp.get('nonzero_points')

    if ml_status != 'ok' or not monthly:
        print(f'  [SKIP] pid={pid} sales: status={ml_status}')
        pass1_fail += 1
        continue

    for m in monthly:
        sales_rows.append({
            'product_id':          pid,
            'ssot_label':          SALES_LABEL,
            'metric':              'sales',
            'forecast_month':      f"{m['month']}-01",
            'training_start_date': TRAINING_START,
            'training_end_date':   TRAINING_END,
            'yhat_sum':            round(float(m['yhat_sum']), 4),
            'yhat_lower_sum':      round(float(m['yhat_lower_sum']), 4),
            'yhat_upper_sum':      round(float(m['yhat_upper_sum']), 4),
            'training_points':     train_pts,
            'nonzero_points':      nonzero_pts,
            'model_status':        'ok',
        })

    feb = next((m for m in monthly if m['month'] == '2026-02'), None)
    mar = next((m for m in monthly if m['month'] == '2026-03'), None)
    print(
        f'  [OK]   pid={pid:4d}  '
        f'Feb={feb["yhat_sum"]:>10,.0f}  Mar={mar["yhat_sum"]:>10,.0f}'
        if feb and mar else f'  [OK]   pid={pid}  months={[m["month"] for m in monthly]}'
    )
    pass1_ok += 1

print(f'\n  Pass 1 done: ok={pass1_ok}  fail={pass1_fail}  rows={len(sales_rows)}')

if pass1_fail > 0 and pass1_ok == 0:
    raise SystemExit('ERROR — all Pass 1 calls failed. Aborting before Pass 2.')

print('\n  Upserting sales rows into forecast_results…')
upserted = upsert_batch('forecast_results', sales_rows, CONFLICT_COLS)
print(f'  Upserted {upserted} sales rows.')

# ── Pass 2: Derived purchases ─────────────────────────────────────────────────

print()
print('=' * 70)
print('PASS 2 — Derived ratio: purchases_ordered + purchases_received')
print('=' * 70)

purchase_rows = []
pass2_ok = pass2_fail = 0

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
            pass2_fail += 1
            continue

        derived_status = resp.get('status')
        monthly        = resp.get('monthly', [])
        ratio_detail   = resp.get('ratio_detail', {})
        R              = ratio_detail.get('R')
        months_used    = ratio_detail.get('months_used', 0)
        months_excl    = ratio_detail.get('months_excluded', 0)

        if derived_status != 'ok_derived' or not monthly:
            print(f'  [SKIP] pid={pid} {metric}: status={derived_status}')
            pass2_fail += 1
            continue

        for m in monthly:
            purchase_rows.append({
                'product_id':          pid,
                'ssot_label':          ssot_label,
                'metric':              metric,
                'forecast_month':      f"{m['month']}-01",
                'training_start_date': TRAINING_START,
                'training_end_date':   TRAINING_END,
                'yhat_sum':            round(float(m['yhat_sum']), 4),
                'yhat_lower_sum':      round(float(m['yhat_lower_sum']), 4),
                'yhat_upper_sum':      round(float(m['yhat_upper_sum']), 4),
                'training_points':     resp.get('training_points'),
                'nonzero_points':      resp.get('nonzero_points'),
                'model_status':        'ok_derived',
            })

        excl_str = f', excl={months_excl}' if months_excl else ''
        print(
            f'  [OK]   pid={pid:4d}  {metric:<22}'
            f'  R={R}  months={months_used}{excl_str}'
        )
        pass2_ok += 1

print(f'\n  Pass 2 done: ok={pass2_ok}  fail={pass2_fail}  rows={len(purchase_rows)}')

if purchase_rows:
    print('\n  Upserting purchase rows into forecast_results…')
    upserted2 = upsert_batch('forecast_results', purchase_rows, CONFLICT_COLS)
    print(f'  Upserted {upserted2} purchase rows.')

# ── Verification ──────────────────────────────────────────────────────────────

print()
print('=' * 70)
print('VERIFICATION')
print('=' * 70)

pid_filter = ','.join(str(p) for p in DEMO_PIDS)

def supa_get_all(path_base):
    rows, offset, limit = [], 0, 1000
    sep = '&' if '?' in path_base else '?'
    while True:
        status, body = supa('GET', f'{path_base}{sep}offset={offset}&limit={limit}')
        if status >= 400:
            raise RuntimeError(f'GET: HTTP {status}: {body}')
        if not body:
            break
        rows.extend(body)
        if len(body) < limit:
            break
        offset += limit
    return rows

verify = supa_get_all(
    f'/rest/v1/forecast_results'
    f'?product_id=in.({pid_filter})'
    f'&training_end_date=eq.{TRAINING_END}'
    f'&forecast_month=in.(2026-02-01,2026-03-01)'
    f'&select=product_id,metric,forecast_month,yhat_sum,model_status,computed_at'
    f'&order=product_id.asc,metric.asc,forecast_month.asc'
)

by_key = {}
for r in verify:
    key = (r['product_id'], r['metric'], r['forecast_month'][:7])
    by_key[key] = r

expected_metrics = ['sales', 'purchases_ordered', 'purchases_received']
total_expected = len(DEMO_PIDS) * len(expected_metrics) * 2  # 23 × 3 × 2 = 138

print(f'\n  Total rows found: {len(verify)} (expected {total_expected})')
print(f'\n  {"pid":>5}  {"metric":>22}  {"Feb yhat":>12}  {"Mar yhat":>12}  status')
print(f'  {"—"*5}  {"—"*22}  {"—"*12}  {"—"*12}  {"—"*12}')

for pid in DEMO_PIDS:
    for metric in expected_metrics:
        feb_r = by_key.get((pid, metric, '2026-02'))
        mar_r = by_key.get((pid, metric, '2026-03'))
        feb_v = f'{feb_r["yhat_sum"]:>12,.0f}' if feb_r else '           —'
        mar_v = f'{mar_r["yhat_sum"]:>12,.0f}' if mar_r else '           —'
        status_v = feb_r.get('model_status', '—') if feb_r else '—'
        print(f'  {pid:>5}  {metric:>22}  {feb_v}  {mar_v}  {status_v}')

ok_rows = [r for r in verify if r.get('model_status') in ('ok', 'ok_derived')]
print(f'\n  Rows with ok/ok_derived status: {len(ok_rows)} / {len(verify)}')
print(f'  Duration: {time.time() - t0:.1f}s')

if len(verify) == total_expected:
    print(f'\n  All {total_expected} forecast cells confirmed. Training complete.')
else:
    print(f'\n  WARNING — {total_expected - len(verify)} cells missing.')
