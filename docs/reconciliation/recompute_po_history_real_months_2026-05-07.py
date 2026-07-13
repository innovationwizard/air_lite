"""
Recompute products_acid_test_active.po_history_real_months for all 23 demo SKUs.

WHEN TO RUN
-----------
After the full purchase pipeline:
  1. find_15  → revenue_daily (POL-based, clears and rebuilds)
  2. find_15b → revenue_daily (stock_moves supplement for 14 red-tier PIDs)
  3. smooth_oct2024_purchase_anomaly.py → revenue_daily_for_ml

DEFINITION
----------
po_history_real_months = count of distinct calendar months in 2024-10..2026-01
  where revenue_daily_for_ml has at least one row for the product with:
    metric     = 'purchases_ordered'
    ssot_label = 'pol_confirmed_date_planned_product_qty_c40'

Data from find_16 (synthetic fallback) uses the same ssot_label. If find_16
has been run before this script, the counts will include synthetic months.
Run this BEFORE find_16 to get real-only counts.

IDEMPOTENT — safe to re-run.
"""

import json, os, urllib.request, urllib.error
from pathlib import Path
from collections import defaultdict

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'
SSOT_ORD = 'pol_confirmed_date_planned_product_qty_c40'

DEMO_23_SKUS = [
    '77205001','77205003','77205207','77205034','77205287','77205208',
    '77205190','77205005','77205002','77205035','77205187','77201046',
    '77201000','77201055','77201053','77201069','77201041','77201014',
    '77201056','77201019','77201038','77201047','77201023',
]

def load_env():
    for f in ['/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
              '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env']:
        p = Path(f)
        if not p.exists(): continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line: continue
            k, v = line.split('=', 1)
            if k.strip() not in os.environ: os.environ[k.strip()] = v.strip()

load_env()
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY  = os.environ['SUPABASE_SECRET_KEY']

def supa_get_all(path_base):
    rows, offset, limit = [], 0, 1000
    sep = '&' if '?' in path_base else '?'
    while True:
        req = urllib.request.Request(
            f'{SUPA}{path_base}{sep}offset={offset}&limit={limit}',
            headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'}, method='GET')
        with urllib.request.urlopen(req) as r:
            batch = json.loads(r.read().decode())
        if not batch: break
        rows.extend(batch)
        if len(batch) < limit: break
        offset += limit
    return rows

def patch_row(table, row_id, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{SUPA}/rest/v1/{table}?id=eq.{row_id}',
        data=data,
        headers={
            'apikey': KEY, 'Authorization': f'Bearer {KEY}',
            'Content-Type': 'application/json', 'Prefer': 'return=minimal',
        },
        method='PATCH',
    )
    try:
        with urllib.request.urlopen(req) as r:
            return r.status
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'PATCH {table} id={row_id}: HTTP {e.code}: {e.read().decode()[:300]}')

# ── Step 1: Resolve SKU → products_id and acid_test row id ───────────────────

print('Loading products_acid_test_active…')
acid = supa_get_all('/rest/v1/products_acid_test_active?select=id,products_id,default_code,po_history_real_months')
acid_by_sku = {r['default_code']: r for r in acid if r['default_code'] in DEMO_23_SKUS}
print(f'  {len(acid_by_sku)} demo SKU rows found')

pid_to_sku = {r['products_id']: r['default_code'] for r in acid_by_sku.values()}
demo_pids  = list(pid_to_sku.keys())
pid_csv    = ','.join(str(p) for p in demo_pids)

# ── Step 2: Fetch purchase months from revenue_daily_for_ml ──────────────────

print('\nFetching purchases_ordered months from revenue_daily_for_ml…')
rdml_rows = supa_get_all(
    f'/rest/v1/revenue_daily_for_ml'
    f'?product_id=in.({pid_csv})'
    f'&metric=eq.purchases_ordered'
    f'&ssot_label=eq.{SSOT_ORD}'
    f'&observation_date=gte.{TRAINING_START}'
    f'&observation_date=lte.{TRAINING_END}'
    f'&select=product_id,observation_date'
)
print(f'  {len(rdml_rows)} rows fetched')

months_by_pid: dict[int, set] = defaultdict(set)
for r in rdml_rows:
    months_by_pid[r['product_id']].add(str(r['observation_date'])[:7])

# ── Step 3: Compute and apply updates ────────────────────────────────────────

MONTHS_EXPECTED = {
    f'2024-{m:02d}' for m in range(10, 13)
} | {
    f'2025-{m:02d}' for m in range(1, 13)
} | {'2026-01'}

print('\n=== Results ===')
print(f'  {"SKU":>12}  {"PID":>6}  {"Old":>5}  {"New":>5}  {"Missing":}')
print(f'  {"-"*12}  {"-"*6}  {"-"*5}  {"-"*5}  {"-"*30}')

updates = []
for sku in sorted(DEMO_23_SKUS):
    if sku not in acid_by_sku:
        print(f'  {sku:>12}  {"?":>6}  NOT FOUND in products_acid_test_active')
        continue
    row  = acid_by_sku[sku]
    pid  = row['products_id']
    old  = row['po_history_real_months']
    covered = months_by_pid.get(pid, set())
    new  = len(covered)
    missing = sorted(MONTHS_EXPECTED - covered)
    updates.append({'id': row['id'], 'pid': pid, 'sku': sku, 'old': old, 'new': new})
    flag = '  ← CHANGED' if old != new else ''
    print(f'  {sku:>12}  {pid:>6}  {str(old):>5}  {new:>5}  {missing if missing else "complete"}{flag}')

# ── Step 4: PATCH rows where value changed ───────────────────────────────────

changed = [u for u in updates if u['old'] != u['new']]
print(f'\n{len(changed)} rows need update, {len(updates) - len(changed)} unchanged.')

if not changed:
    print('Nothing to update.')
else:
    print('Patching…')
    for u in changed:
        status = patch_row('products_acid_test_active', u['id'], {'po_history_real_months': u['new']})
        print(f'  {u["sku"]}  pid={u["pid"]}  {u["old"]} → {u["new"]}  HTTP {status}')

# ── Step 5: Verify ────────────────────────────────────────────────────────────

print('\nVerification: final values in DB…')
after = supa_get_all(
    f'/rest/v1/products_acid_test_active'
    f'?products_id=in.({pid_csv})'
    f'&select=default_code,products_id,po_history_real_months'
    f'&order=po_history_real_months.desc'
)
green = sum(1 for r in after if r['po_history_real_months'] == 16)
amber = sum(1 for r in after if r['po_history_real_months'] is not None and 3 <= r['po_history_real_months'] <= 15)
red   = sum(1 for r in after if r['po_history_real_months'] is not None and r['po_history_real_months'] <= 2)
print(f'  Green (16/16): {green}  Amber (3-15): {amber}  Red (0-2): {red}')
for r in after:
    tier = 'GREEN' if r['po_history_real_months'] == 16 else ('AMBER' if r['po_history_real_months'] and r['po_history_real_months'] >= 3 else 'RED')
    print(f'  {r["default_code"]:>12}  {r["products_id"]:>6}  {str(r["po_history_real_months"]):>4}  {tier}')

print('\nDone. Next step: trigger ML training via POST /api/acid-test/forecast/run')
