"""
Train Prophet on metric='demand' for all 23 demo SKUs and persist to forecast_results.

Companion to trigger_ml_training_2026-05-07.py (which covers sales + purchases).
This script covers only the demand metric to avoid re-running the full pipeline.

Calls Railway ML service /forecast/revenue-daily directly (bypasses Next.js
middleware which requires a browser session cookie). Persists results to
forecast_results table via Supabase service role key.

DEMAND METRIC CONTEXT
---------------------
  ssot_label : sol_confirmed_order_date_qty_ordered_native_uom
  metric     : demand
  source     : sale_order_lines.quantity (ordered qty, not delivered)
  date field : sale_orders.order_date (demand arrival date)
  filter     : sale_orders.state = 'sale' (confirmed orders only)
  cap        : training data up to 2026-01-31 (blind test cutoff)

Expected result for SKU 77205001 (pid=2, FARDO10):
  Historical avg demand Oct–Jan 2026: ~38,435/month
  Recent trend (Q4 2025): ~44,000/month (Nov=45k, Dec=52k, Jan=45k)
  Expected forecast Feb/Mar 2026: 40,000–48,000 FARDO10
  Current sales forecast: 35,172/35,851 FARDO10 (supply-constrained)
  Gap (lost sales visible to client): ~5,000–12,000 FARDO10/month
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
SUPA_KEY = os.environ['SUPABASE_SECRET_KEY']
ML_URL   = os.environ['ML_SERVICE_URL']
ML_KEY   = os.environ['ML_SERVICE_API_KEY']

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
PREDICTION_END = '2026-03-31'
DEMAND_LABEL   = 'sol_confirmed_order_date_qty_ordered_native_uom'
METRIC         = 'demand'
FORECAST_CONFLICT = 'product_id,ssot_label,metric,forecast_month,training_end_date'

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


def supa_upsert(table, rows, on_conflict):
    data = json.dumps(rows).encode()
    req = urllib.request.Request(
        f'{SUPA}/rest/v1/{table}?on_conflict={on_conflict}',
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
        headers={'X-API-Key': ML_KEY, 'Content-Type': 'application/json'},
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
        'product_id':         pid,
        'ssot_label':         label,
        'metric':             metric,
        'forecast_month':     f"{m['month']}-01",
        'training_start_date': TRAINING_START,
        'training_end_date':  TRAINING_END,
        'yhat_sum':           round(float(m['yhat_sum']), 4),
        'yhat_lower_sum':     round(float(m['yhat_lower_sum']), 4),
        'yhat_upper_sum':     round(float(m['yhat_upper_sum']), 4),
        'training_points':    data.get('training_points'),
        'nonzero_points':     data.get('nonzero_points'),
        'model_status':       data.get('status'),
    } for m in monthly]
    status, err = supa_upsert('forecast_results', rows, on_conflict=FORECAST_CONFLICT)
    if status >= 400:
        print(f'    PERSIST ERROR {status}: {err}')
        return 0
    return len(rows)


def persist_status_row(pid, label, metric, data):
    row = {
        'product_id':         pid,
        'ssot_label':         label,
        'metric':             metric,
        'forecast_month':     f"{PREDICTION_END[:7]}-01",
        'training_start_date': TRAINING_START,
        'training_end_date':  TRAINING_END,
        'yhat_sum':           0,
        'yhat_lower_sum':     None,
        'yhat_upper_sum':     None,
        'training_points':    data.get('training_points'),
        'nonzero_points':     data.get('nonzero_points'),
        'model_status':       data.get('status'),
    }
    supa_upsert('forecast_results', [row], on_conflict=FORECAST_CONFLICT)


# ── Load demo SKUs ────────────────────────────────────────────────────────────

print('Loading 23 demo SKUs from products_acid_test_active…')
active = supa_get('/rest/v1/products_acid_test_active?is_top_10_in_class=eq.true&select=default_code')
skus = [r['default_code'] for r in active]
skus_csv = ','.join(f'"{s}"' for s in skus)
prods = supa_get(f'/rest/v1/products?sku=in.({skus_csv})&select=id,sku,stock_uom')
sku_to_pid = {p['sku']: p['id'] for p in prods}
pid_to_uom = {p['id']: (p['stock_uom'] or 'CAJA40') for p in prods}
print(f'  {len(skus)} SKUs, {len(sku_to_pid)} product IDs resolved')

# ── Idempotency check ─────────────────────────────────────────────────────────

pid2_check = supa_get(
    f'/rest/v1/forecast_results'
    f'?product_id=eq.2&metric=eq.{METRIC}'
    f'&training_end_date=eq.{TRAINING_END}'
    f'&select=forecast_month,yhat_sum'
)
if pid2_check and any(float(r['yhat_sum'] or 0) > 0 for r in pid2_check):
    print(f'Demand forecast already exists for pid=2. Re-running will overwrite (upsert).')

# ── Train Prophet on demand for all 23 SKUs ───────────────────────────────────

print(f'\n=== Prophet training: metric=demand ({len(skus)} SKUs) ===')
ok_count, fail_count = 0, 0
results_summary = []

for sku in skus:
    pid = sku_to_pid.get(sku)
    if not pid:
        print(f'  SKIP {sku}: no product_id')
        fail_count += 1
        continue

    t0 = time.time()
    status, body = ml_post('/forecast/revenue-daily', {
        'product_id':     pid,
        'ssot_label':     DEMAND_LABEL,
        'metric':         METRIC,
        'training_start': TRAINING_START,
        'training_end':   TRAINING_END,
        'prediction_end': PREDICTION_END,
    })
    elapsed = time.time() - t0

    ml_ok = status == 200 and body.get('status') == 'ok' and body.get('monthly')
    if ml_ok:
        n = persist_monthly(pid, DEMAND_LABEL, METRIC, body)
        monthly = body['monthly']
        feb = next((m for m in monthly if m['month'].startswith('2026-02')), None)
        mar = next((m for m in monthly if m['month'].startswith('2026-03')), None)
        feb_val = f"{feb['yhat_sum']:,.0f}" if feb else 'N/A'
        mar_val = f"{mar['yhat_sum']:,.0f}" if mar else 'N/A'
        uom = pid_to_uom.get(pid, '?')
        print(f'  [OK] {sku:>12}  Feb={feb_val:>8}  Mar={mar_val:>8} {uom}  pts={body.get("training_points")}  persisted={n}  ({elapsed:.1f}s)')
        results_summary.append({'sku': sku, 'pid': pid, 'feb': feb['yhat_sum'] if feb else 0, 'mar': mar['yhat_sum'] if mar else 0})
        ok_count += 1
    else:
        persist_status_row(pid, DEMAND_LABEL, METRIC, body)
        pts = body.get('training_points', '?')
        nonzero = body.get('nonzero_points', '?')
        print(f'  [FAIL] {sku:>12}  HTTP {status}  status={body.get("status")}  pts={pts}  nonzero={nonzero}  ({elapsed:.1f}s)')
        fail_count += 1

print(f'\nTraining done: {ok_count} OK, {fail_count} FAIL out of {len(skus)} SKUs')

# ── Spot check: SKU 77205001 demand vs sales forecast ─────────────────────────

print('\n=== Spot check: 77205001 (pid=2) — demand vs sales forecast Feb/Mar 2026 ===')
fr = supa_get(
    '/rest/v1/forecast_results'
    '?product_id=eq.2'
    '&training_end_date=eq.2026-01-31'
    '&select=metric,forecast_month,yhat_sum,model_status'
    '&order=metric.asc,forecast_month.asc'
)
for r in fr:
    mo = r['forecast_month'][:7]
    if mo >= '2026-02':
        print(f'  {r["metric"]:>42}  {mo}  {float(r["yhat_sum"] or 0):>10,.1f}  {r["model_status"]}')

print('\nDone.')
