"""
Emergency recovery: restore revenue_daily purchase rows for 5 PIDs whose
data was zeroed out by the 2026-05-07 UoM fix pipeline partial failure.

ROOT CAUSE (diagnosed 2026-05-08)
----------------------------------
  1. fix_purchase_uom_revenue_daily_2026-05-07.py DELETE'd purchase rows for
     affected PIDs then failed to re-insert them all (HTTP 409 at batch 4).
  2. smooth_oct2024_purchase_anomaly.py ran WHILE revenue_daily was in the
     broken state, rebuilding revenue_daily_for_ml from empty revenue_daily.
  3. find_16_carvajal_tier3_fallback_purchases_for_ml.py ran AFTER smooth
     (explicitly prohibited per 2026-05-06-07 changelog) — masked the problem
     for PIDs 1113 and 1127 with synthetic data in revenue_daily_for_ml, but
     left PIDs 1587, 1590, 1600 with 0 months.
  4. fix_purchase_uom_missing_pids only partially recovered pid=1113 (8/16
     months) and did not recover 1127, 1587, 1590, 1600 at all.

CURRENT STATE (verified 2026-05-08)
-------------------------------------
  pid=1113 (77205035) : revenue_daily=8mo,  rdml=16mo  (find_16 synthetic)
  pid=1127 (77205005) : revenue_daily=0mo,  rdml=15mo  (find_16 synthetic)
  pid=1587 (77201019) : revenue_daily=0mo,  rdml=0mo   RED
  pid=1590 (77201055) : revenue_daily=0mo,  rdml=0mo   RED
  pid=1600 (77201056) : revenue_daily=0mo,  rdml=0mo   RED

  stock_moves has complete 16-month coverage for all 5 PIDs. Data is there.

FIX APPLIED HERE
-----------------
  Derives quantities from stock_moves (vendor→internal, done, training window)
  and UPSERTS to revenue_daily using the correct stock_uom conversion.
  Upsert (not insert) prevents any future 409 duplicate key errors.

PIPELINE TO RUN AFTER THIS SCRIPT
-----------------------------------
  1. python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py
     → rebuilds revenue_daily_for_ml from the now-correct revenue_daily
  2. DO NOT run find_16. It is prohibited after find_15b (see 2026-05-06-07 changelog).
  3. python3 docs/reconciliation/recompute_po_history_real_months_2026-05-07.py
     → patches products_acid_test_active.po_history_real_months
  4. python3 docs/reconciliation/trigger_ml_training_2026-05-07.py
     → re-trains Prophet on sales + purchases for all 23 demo SKUs

Expected result after pipeline: 20 GREEN, 3 AMBER, 0 RED (restores 2026-05-06 state).
"""

import json
import os
import time
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

# ── env ───────────────────────────────────────────────────────────────────────

def load_env() -> None:
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

# The 5 PIDs with broken revenue_daily purchase data. Verified 2026-05-08.
TARGET_PIDS = [1113, 1127, 1587, 1590, 1600]

VENDOR_LOCATION_ID = 41   # Partners/Vendors — verified from stock_locations
SSOT_PO_ORD = 'pol_confirmed_date_planned_product_qty_c40'
SSOT_PO_RCV = 'pol_purchase_done_date_planned_qty_received_c40'
TARGET_TABLE = 'revenue_daily'
TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'

# ── helpers ───────────────────────────────────────────────────────────────────

def supa_get_all(path_base: str) -> list:
    rows: list = []
    offset = 0
    limit = 1000
    sep = '&' if '?' in path_base else '?'
    while True:
        req = urllib.request.Request(
            f'{SUPA}{path_base}{sep}offset={offset}&limit={limit}',
            headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'},
            method='GET',
        )
        with urllib.request.urlopen(req) as r:
            batch = json.loads(r.read().decode())
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < limit:
            break
        offset += limit
    return rows


def upsert_batch(table: str, rows: list, on_conflict: str, batch_size: int = 500) -> int:
    upserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        data = json.dumps(batch).encode()
        req = urllib.request.Request(
            f'{SUPA}/rest/v1/{table}?on_conflict={on_conflict}',
            data=data,
            headers={
                'apikey': KEY,
                'Authorization': f'Bearer {KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'resolution=merge-duplicates,return=minimal',
            },
            method='POST',
        )
        try:
            with urllib.request.urlopen(req) as r:
                pass
        except urllib.error.HTTPError as e:
            raise RuntimeError(
                f'UPSERT {table} batch {i // batch_size}: HTTP {e.code}: '
                f'{e.read().decode()[:400]}'
            )
        upserted += len(batch)
    return upserted

# ── Step 1: UoM ratios ─────────────────────────────────────────────────────────

print('Loading units_of_measure…')
uom_rows = supa_get_all('/rest/v1/units_of_measure?select=name,ratio')
uom_ratio: dict[str, float] = {r['name']: float(r['ratio']) for r in uom_rows}
if 'CAJA40' not in uom_ratio:
    raise SystemExit('ERROR — CAJA40 not in units_of_measure.')
print(f'  {len(uom_ratio)} UoMs loaded')


def to_stock_uom(qty: float, src_uom_name: str, tgt_uom_name: str) -> float | None:
    """Convert qty from src_uom to tgt_uom (both by name).
    Formula: qty * (tgt_ratio / src_ratio)
    Target must be product's stock_uom — NOT CAJA40.
    """
    src = uom_ratio.get(src_uom_name)
    tgt = uom_ratio.get(tgt_uom_name)
    if src is None or src == 0 or tgt is None:
        return None
    return qty * (tgt / src)

# ── Step 2: Load stock_uom for target PIDs ─────────────────────────────────────

print('\nLoading stock_uom for target PIDs…')
pid_csv = ','.join(str(p) for p in TARGET_PIDS)
prod_rows = supa_get_all(f'/rest/v1/products?id=in.({pid_csv})&select=id,sku,stock_uom')
pid_stock_uom: dict[int, str] = {p['id']: (p['stock_uom'] or 'CAJA40') for p in prod_rows}
pid_sku: dict[int, str] = {p['id']: p['sku'] for p in prod_rows}
for pid in TARGET_PIDS:
    print(f'  pid={pid}  sku={pid_sku.get(pid, "?")}  stock_uom={pid_stock_uom.get(pid, "?")}')

# ── Step 3: Load internal stock locations ─────────────────────────────────────

print('\nLoading internal stock locations…')
locs = supa_get_all('/rest/v1/stock_locations?select=id,location_type')
internal_loc_ids: set[int] = {l['id'] for l in locs if l['location_type'] == 'internal'}
print(f'  {len(internal_loc_ids)} internal locations')

# ── Step 4: Fetch stock_moves for target PIDs ──────────────────────────────────

print('\nFetching stock_moves vendor→internal receipts for target PIDs…')
t0 = time.time()
moves = supa_get_all(
    f'/rest/v1/stock_moves'
    f'?product_id=in.({pid_csv})'
    f'&from_location_id=eq.{VENDOR_LOCATION_ID}'
    f'&state=eq.done'
    f'&move_date=gte.{TRAINING_START}'
    f'&move_date=lte.{TRAINING_END}T23:59:59'
    f'&select=product_id,quantity,uom,move_date,to_location_id'
)
purchase_moves = [m for m in moves if m['to_location_id'] in internal_loc_ids]
print(f'  Fetched {len(moves)} vendor→any moves in {time.time()-t0:.1f}s')
print(f'  Filtered to {len(purchase_moves)} vendor→internal (real receipts)')

# ── Step 5: Aggregate to daily ─────────────────────────────────────────────────

print('\nAggregating to daily (product_id, date)…')
daily_agg: dict[tuple, dict] = defaultdict(lambda: {'qty': 0.0, 'docs': 0})
skipped_uom: list[dict] = []

for m in purchase_moves:
    pid  = m['product_id']
    date = str(m['move_date'])[:10]
    uom  = m['uom']
    qty  = float(m['quantity'] or 0)
    if qty <= 0:
        continue
    tgt_uom = pid_stock_uom.get(pid, 'CAJA40')
    norm = to_stock_uom(qty, uom, tgt_uom)
    if norm is None:
        skipped_uom.append({'pid': pid, 'uom': uom, 'date': date})
        continue
    daily_agg[(pid, date)]['qty'] += norm
    daily_agg[(pid, date)]['docs'] += 1

print(f'  Daily cells: {len(daily_agg)}')
if skipped_uom:
    print(f'  WARNING — {len(skipped_uom)} moves skipped (unknown UoM):')
    for s in skipped_uom[:5]:
        print(f'    pid={s["pid"]}  uom={s["uom"]}  date={s["date"]}')

# ── Step 6: Coverage preview ───────────────────────────────────────────────────

print('\n=== Coverage to be written ===')
pid_months: dict[int, set] = defaultdict(set)
for (pid, date) in daily_agg:
    pid_months[pid].add(date[:7])

for pid in TARGET_PIDS:
    months = sorted(pid_months.get(pid, set()))
    sku = pid_sku.get(pid, '?')
    print(f'  pid={pid}  sku={sku}  months={len(months)}  range={months[0] if months else "—"}→{months[-1] if months else "—"}')

# ── Step 7: Build upsert rows ──────────────────────────────────────────────────

out_rows: list[dict] = []
for (pid, date), v in sorted(daily_agg.items()):
    qty = round(v['qty'], 4)
    for metric, ssot in [('purchases_ordered', SSOT_PO_ORD), ('purchases_received', SSOT_PO_RCV)]:
        out_rows.append({
            'product_id':       pid,
            'ssot_label':       ssot,
            'metric':           metric,
            'observation_date': date,
            'quantity':         qty,
            'revenue_gtq':      None,
            'source_doc_count': v['docs'],
        })

print(f'\n  {len(out_rows)} rows to upsert into {TARGET_TABLE}')

# ── Step 8: Upsert to revenue_daily ───────────────────────────────────────────

CONFLICT_KEY = 'product_id,ssot_label,metric,observation_date'
print(f'\nUpserting into {TARGET_TABLE}…')
t0 = time.time()
n = upsert_batch(TARGET_TABLE, out_rows, on_conflict=CONFLICT_KEY)
print(f'  {n} rows upserted in {time.time()-t0:.1f}s')

# ── Step 9: Verify revenue_daily coverage ─────────────────────────────────────

print('\n=== Verification: revenue_daily month coverage after upsert ===')
MONTHS_EXPECTED = (
    {f'2024-{m:02d}' for m in range(10, 13)} |
    {f'2025-{m:02d}' for m in range(1, 13)} |
    {'2026-01'}
)
all_ok = True
for pid in TARGET_PIDS:
    rows = supa_get_all(
        f'/rest/v1/{TARGET_TABLE}'
        f'?product_id=eq.{pid}'
        f'&metric=eq.purchases_ordered'
        f'&observation_date=gte.{TRAINING_START}'
        f'&observation_date=lte.{TRAINING_END}'
        f'&select=observation_date,quantity'
    )
    covered = {r['observation_date'][:7] for r in rows}
    missing = sorted(MONTHS_EXPECTED - covered)
    total = sum(float(r['quantity']) for r in rows)
    sku = pid_sku.get(pid, '?')
    uom = pid_stock_uom.get(pid, '?')
    status = 'OK' if not missing else f'MISSING {len(missing)}'
    print(f'  pid={pid}  sku={sku}  months={len(covered)}/16  total={total:,.1f} {uom}  {status}')
    if missing:
        all_ok = False
        print(f'    missing months: {missing}')

print()
if all_ok:
    print('[PASS] All 5 PIDs now have 16-month purchase coverage in revenue_daily.')
else:
    print('[FAIL] Some months still missing — check stock_moves for those PIDs/months.')

print("""
NEXT STEPS (run in this exact order):
  1. python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py
  2. DO NOT run find_16_carvajal_tier3_fallback_purchases_for_ml.py
  3. python3 docs/reconciliation/recompute_po_history_real_months_2026-05-07.py
  4. python3 docs/reconciliation/trigger_ml_training_2026-05-07.py

Expected result: 20 GREEN, 3 AMBER, 0 RED
""")
