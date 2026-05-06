"""
Store in-sample monthly fit for all 23 demo SKUs (sales only) — 2026-05-06.

WHY
---
The forecast-diagnostic page needs to show, for the training period (Oct 2024 –
Jan 2026), both (a) actual historical data and (b) what the Prophet model
*would have predicted* for the same months. The gap between those two series
is the in-sample model fit quality — the primary tool for a decision-maker to
assess whether to trust the Feb–Mar 2026 forward forecast.

In-sample fit is a by-product of Prophet's make_future_dataframe / predict
call. The ML service now returns it as `in_sample_monthly` in the
/forecast/revenue-daily response (added in this session).

SCOPE
-----
Sales only. Purchases use a ratio-derived method (not Prophet), so there is no
direct in-sample fit from the model. The sales in-sample fit is sufficient to
demonstrate model accuracy to the client.

STORAGE
-------
Stored in forecast_results with model_status = 'ok_in_sample'.
Conflict key: (product_id, ssot_label, metric, forecast_month, training_end_date).
forecast_month values will be 2024-10-01 through 2026-01-01.
These never collide with forward prediction rows (2026-02-01, 2026-03-01).

IDEMPOTENT
----------
Upsert with resolution=merge-duplicates. Safe to re-run.
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
SUPA_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
ML_URL   = os.environ['ML_SERVICE_URL']
ML_KEY   = os.environ['ML_SERVICE_API_KEY']

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
PREDICTION_END = '2026-03-31'

SALES_LABEL = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'

DEMO_PIDS = [2,3,5,20,29,33,34,36,37,145,469,539,
             1035,1069,1096,1113,1127,1366,1562,1587,1590,1600,1606]

CONFLICT_COLS = 'product_id,ssot_label,metric,forecast_month,training_end_date'

# ── helpers ───────────────────────────────────────────────────────────────────

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
    prefer = 'resolution=merge-duplicates,return=minimal'
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

# ── main ──────────────────────────────────────────────────────────────────────

print('=' * 70)
print('In-sample monthly fit — sales — all 23 demo SKUs')
print('=' * 70)

rows = []
ok = fail = 0
t0 = time.time()

for pid in DEMO_PIDS:
    status, resp = ml_post('/forecast/revenue-daily', {
        'product_id':     pid,
        'ssot_label':     SALES_LABEL,
        'metric':         'sales',
        'training_start': TRAINING_START,
        'training_end':   TRAINING_END,
        'prediction_end': PREDICTION_END,
    })

    if status >= 400:
        print(f'  [FAIL] pid={pid}: HTTP {status}: {str(resp)[:200]}')
        fail += 1
        continue

    ml_status      = resp.get('status')
    in_sample      = resp.get('in_sample_monthly', [])
    train_pts      = resp.get('training_points')
    nonzero_pts    = resp.get('nonzero_points')

    if ml_status != 'ok' or not in_sample:
        print(f'  [SKIP] pid={pid}: status={ml_status}, in_sample_months={len(in_sample)}')
        fail += 1
        continue

    for m in in_sample:
        rows.append({
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
            'model_status':        'ok_in_sample',
        })

    print(f'  [OK]   pid={pid:4d}  in_sample_months={len(in_sample)}')
    ok += 1

print(f'\n  Done: ok={ok}  fail={fail}  rows={len(rows)}')

if not rows:
    raise SystemExit('ERROR — no rows to upsert. Check ML service deployment.')

print('\n  Upserting in-sample rows into forecast_results…')
upserted = upsert_batch('forecast_results', rows, CONFLICT_COLS)
print(f'  Upserted {upserted} rows.')
print(f'  Duration: {time.time() - t0:.1f}s')

# ── Verification ──────────────────────────────────────────────────────────────

print()
print('=' * 70)
print('VERIFICATION')
print('=' * 70)

pid_filter = ','.join(str(p) for p in DEMO_PIDS)
v_status, v_body = supa(
    'GET',
    f'/rest/v1/forecast_results'
    f'?product_id=in.({pid_filter})'
    f'&model_status=eq.ok_in_sample'
    f'&training_end_date=eq.{TRAINING_END}'
    f'&select=product_id,forecast_month'
    f'&limit=1000',
)
if v_status >= 400:
    print(f'  Verification query failed: HTTP {v_status}: {v_body}')
else:
    count = len(v_body or [])
    expected = len(DEMO_PIDS) * 16  # 23 SKUs × 16 months
    print(f'  Rows with model_status=ok_in_sample: {count} (expected {expected})')
    if count == expected:
        print(f'  All {expected} in-sample cells confirmed.')
    else:
        print(f'  WARNING — {expected - count} cells missing.')
