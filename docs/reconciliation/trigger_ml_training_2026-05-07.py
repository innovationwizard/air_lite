"""
Trigger ML training directly against Railway ML service.
Bypasses Next.js middleware (which requires a browser session cookie).

Replicates the two-pass logic from /api/acid-test/forecast/run/route.ts:
  Pass 1: Prophet for sales (all 23 demo SKUs)
  Pass 2: Derived ratio for purchases_ordered + purchases_received (all 23 SKUs)

Also persists results to forecast_results table using service role key.
"""

import json
import os
import time
import urllib.request
import urllib.error
from pathlib import Path

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
SUPA     = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
ML_URL   = os.environ['ML_SERVICE_URL']
ML_KEY   = os.environ['ML_SERVICE_API_KEY']

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
PREDICTION_END = '2026-03-31'

SALES_LABEL    = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'
PURCHASE_TRIPLETS = [
    ('pol_confirmed_date_planned_product_qty_c40',      'purchases_ordered'),
    ('pol_purchase_done_date_planned_qty_received_c40', 'purchases_received'),
]

# ── helpers ───────────────────────────────────────────────────────────────────

def supa_get(path):
    rows, offset, limit = [], 0, 1000
    sep = '&' if '?' in path else '?'
    while True:
        req = urllib.request.Request(
            f'{SUPA}{path}{sep}offset={offset}&limit={limit}',
            headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'},
        )
        with urllib.request.urlopen(req) as r:
            body = json.loads(r.read().decode())
        rows.extend(body)
        if len(body) < limit:
            break
        offset += limit
    return rows


FORECAST_CONFLICT_COLS = 'product_id,ssot_label,metric,forecast_month,training_end_date'

def supa_upsert(table, rows, on_conflict=None):
    data = json.dumps(rows).encode()
    url = f'{SUPA}/rest/v1/{table}'
    if on_conflict:
        url += f'?on_conflict={on_conflict}'
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            'apikey': SUPA_KEY,
            'Authorization': f'Bearer {SUPA_KEY}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]


def ml_post(endpoint, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{ML_URL}{endpoint}',
        data=data,
        headers={
            'X-API-Key': ML_KEY,
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, {'error': e.read().decode()[:500]}
    except Exception as e:
        return 0, {'error': str(e)}


def persist_monthly(pid, label, metric, data):
    monthly = data.get('monthly') or []
    if not monthly:
        return 0
    rows = [{
        'product_id':        pid,
        'ssot_label':        label,
        'metric':            metric,
        'forecast_month':    f"{m['month']}-01",
        'training_start_date': TRAINING_START,
        'training_end_date': TRAINING_END,
        'yhat_sum':          round(float(m['yhat_sum']), 4),
        'yhat_lower_sum':    round(float(m['yhat_lower_sum']), 4),
        'yhat_upper_sum':    round(float(m['yhat_upper_sum']), 4),
        'training_points':   data.get('training_points'),
        'nonzero_points':    data.get('nonzero_points'),
        'model_status':      data.get('status'),
    } for m in monthly]
    status, err = supa_upsert('forecast_results', rows, on_conflict=FORECAST_CONFLICT_COLS)
    if status >= 400:
        print(f'    PERSIST ERROR {status}: {err}')
        return 0
    return len(rows)


def persist_status_row(pid, label, metric, data):
    row = {
        'product_id':        pid,
        'ssot_label':        label,
        'metric':            metric,
        'forecast_month':    f"{PREDICTION_END[:7]}-01",
        'training_start_date': TRAINING_START,
        'training_end_date': TRAINING_END,
        'yhat_sum':          0,
        'yhat_lower_sum':    None,
        'yhat_upper_sum':    None,
        'training_points':   data.get('training_points'),
        'nonzero_points':    data.get('nonzero_points'),
        'model_status':      data.get('status'),
    }
    supa_upsert('forecast_results', [row], on_conflict=FORECAST_CONFLICT_COLS)


# ── Load demo SKUs ────────────────────────────────────────────────────────────

print('Loading 23 demo SKUs from products_acid_test_active…')
active = supa_get(
    '/rest/v1/products_acid_test_active'
    '?is_top_10_in_class=eq.true'
    '&select=default_code'
)
skus = [r['default_code'] for r in active]
print(f'  {len(skus)} SKUs in scope')

skus_csv = ','.join(f'"{s}"' for s in skus)
prods = supa_get(f'/rest/v1/products?sku=in.({skus_csv})&select=id,sku')
sku_to_pid = {p['sku']: p['id'] for p in prods}
print(f'  {len(sku_to_pid)} product IDs resolved')

# ── Pass 1: Prophet for sales ─────────────────────────────────────────────────

print('\n=== Pass 1: Prophet (sales) ===')
ok1, fail1 = 0, 0
for sku in skus:
    pid = sku_to_pid.get(sku)
    if not pid:
        print(f'  SKIP {sku}: no product_id')
        fail1 += 1
        continue

    t0 = time.time()
    status, body = ml_post('/forecast/revenue-daily', {
        'product_id':     pid,
        'ssot_label':     SALES_LABEL,
        'metric':         'sales',
        'training_start': TRAINING_START,
        'training_end':   TRAINING_END,
        'prediction_end': PREDICTION_END,
    })
    elapsed = time.time() - t0

    ml_ok = status == 200 and body.get('status') == 'ok' and body.get('monthly')
    if ml_ok:
        n = persist_monthly(pid, SALES_LABEL, 'sales', body)
        feb = next((m for m in body['monthly'] if m['month'].startswith('2026-02')), None)
        mar = next((m for m in body['monthly'] if m['month'].startswith('2026-03')), None)
        print(f'  [OK] {sku:>12}  Feb={feb["yhat_sum"]:,.0f}  Mar={mar["yhat_sum"]:,.0f}  persisted={n}  ({elapsed:.1f}s)')
        ok1 += 1
    else:
        persist_status_row(pid, SALES_LABEL, 'sales', body)
        print(f'  [FAIL] {sku:>12}  HTTP {status}  status={body.get("status")}  ({elapsed:.1f}s)')
        fail1 += 1

print(f'\nPass 1 done: {ok1} OK, {fail1} FAIL')

# ── Pass 2: Derived purchases ─────────────────────────────────────────────────

print('\n=== Pass 2: Derived purchases ===')
ok2, fail2 = 0, 0
for sku in skus:
    pid = sku_to_pid.get(sku)
    if not pid:
        fail2 += 2
        continue

    for label, metric in PURCHASE_TRIPLETS:
        t0 = time.time()
        status, body = ml_post('/forecast/purchases-derived', {
            'product_id':     pid,
            'ssot_label':     label,
            'metric':         metric,
            'training_start': TRAINING_START,
            'training_end':   TRAINING_END,
            'prediction_end': PREDICTION_END,
        })
        elapsed = time.time() - t0

        ml_ok = status == 200 and body.get('status') == 'ok_derived' and body.get('monthly')
        if ml_ok:
            n = persist_monthly(pid, label, metric, body)
            feb = next((m for m in body['monthly'] if m['month'].startswith('2026-02')), None)
            feb_val = f"{feb['yhat_sum']:,.0f}" if feb else 'N/A'
            print(f'  [OK] {sku:>12} {metric:>22}  Feb={feb_val}  persisted={n}  ({elapsed:.1f}s)')
            ok2 += 1
        else:
            persist_status_row(pid, label, metric, body)
            print(f'  [FAIL] {sku:>12} {metric:>22}  status={body.get("status")}  monthly_count={len(body.get("monthly") or [])}  ({elapsed:.1f}s)')
            fail2 += 1

print(f'\nPass 2 done: {ok2} OK, {fail2} FAIL')
print(f'\nTotal: {ok1+ok2} OK, {fail1+fail2} FAIL out of {len(skus)*3} cells')

# ── Quick spot check: SKU 77205001 (pid=2) purchases_received Feb 2026 ───────

print('\n=== Spot check: 77205001 (pid=2) ===')
check = supa_get(
    '/rest/v1/forecast_results'
    '?product_id=eq.2'
    '&training_end_date=eq.2026-01-31'
    '&select=metric,forecast_month,yhat_sum,model_status'
    '&order=metric.asc,forecast_month.asc'
)
for r in check:
    print(f'  {r["metric"]:>22}  {r["forecast_month"][:7]}  {r["yhat_sum"]:>10,.1f}  {r["model_status"]}')
