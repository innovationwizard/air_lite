"""
Supplement revenue_daily purchase data for the 14 red-tier demo SKUs by
reading actual stock receipt moves (stock_moves) from Supabase.

WHY
---
find_15 populates revenue_daily.purchases_ordered and purchases_received from
purchase_order_lines. For 14 of 23 demo SKUs, purchase_order_lines only has
Oct–Nov 2024 data (onboarding batch). The remaining 14–16 months of purchase
activity for those SKUs flowed through stock.picking "Recibidos Internacional"
and is already in the Supabase `stock_moves` table with complete coverage
(verified 2026-05-06 via direct query).

MUST RUN AFTER find_15
----------------------
find_15 deletes and rebuilds all purchase rows for the 23 demo SKUs. This
script inserts supplemental rows for months not covered by find_15's output.
Running this script before find_15 would result in those rows being deleted.

PIPELINE ORDER
--------------
1. find_15_populate_revenue_daily_purchases_from_supabase.py
2. THIS SCRIPT (find_15b)
3. smooth_oct2024_purchase_anomaly.py    → revenue_daily_for_ml
4. ML training

SCOPE
-----
14 red-tier PIDs: products whose purchase_order_lines coverage < 3 months.
These are defined explicitly below. Adding a new product to this list requires
verification that its purchase data is in stock_moves, not purchase_order_lines.

SOURCE: stock_moves WHERE:
  - from_location_id = 41 (Partners/Vendors — the single vendor location)
  - state = 'done' (actual physical receipt confirmed)
  - product_id IN (red_tier_pids)

DATE FIELD: stock_moves.move_date (the actual receipt date)

UOM NORMALIZATION: convert to product's stock_uom (NOT to CAJA40)
  normalized = raw_qty * (stock_uom_ratio / src_ratio)
  where stock_uom_ratio = units_of_measure.ratio for the product's stock_uom

  BUG HISTORY: the original formula was raw_qty * CAJA40_RATIO / src_ratio which
  converted to CAJA40 units. Since revenue_daily.sales stores quantities in each
  product's stock_uom (FARDO10, CAJA20, etc.), purchases appeared 2-40x too low
  on the chart. Fixed 2026-05-07. See memory/reference_uom_semantics.md.

SSOT LABELS: same as find_15 (ML pipeline reads these labels)
  purchases_ordered:  pol_confirmed_date_planned_product_qty_c40
  purchases_received: pol_purchase_done_date_planned_qty_received_c40

Both metrics are populated from stock_moves.quantity because stock receipt
moves represent goods physically received, and for these products there is no
separate "ordered but not received" distinction available. Using the same
quantity for both is correct: the received quantity IS the ordered quantity
for these import products.

IDEMPOTENCY
-----------
Skips any (product_id, observation_date, metric) already in revenue_daily.
Safe to run multiple times; will not duplicate existing find_15 rows.

NEXT STEP AFTER THIS SCRIPT
----------------------------
python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py
"""

import json
import os
import time
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

# ── configuration ─────────────────────────────────────────────────────────────

# PIDs whose purchase data is in stock_moves, not purchase_order_lines.
# Verified 2026-05-06: each has 0 POL rows for Dec 2024–Mar 2026 in the Odoo export.
RED_TIER_PIDS = [2, 3, 5, 29, 34, 36, 145, 1069, 1096, 1113, 1127, 1587, 1590, 1600]

VENDOR_LOCATION_ID = 41   # Partners/Vendors — verified from stock_locations table

SSOT_PO_ORD = 'pol_confirmed_date_planned_product_qty_c40'
SSOT_PO_RCV = 'pol_purchase_done_date_planned_qty_received_c40'
TARGET_TABLE = 'revenue_daily'

TRAINING_START = '2024-10-01'
TRAINING_END   = '2026-01-31'   # inclusive; ignore receipts after this for ML purposes

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
KEY  = os.environ['SUPABASE_SERVICE_ROLE_KEY']

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


def insert_batch(table: str, rows: list, batch_size: int = 500) -> int:
    inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        data = json.dumps(batch).encode()
        req = urllib.request.Request(
            f'{SUPA}/rest/v1/{table}',
            data=data,
            headers={
                'apikey': KEY,
                'Authorization': f'Bearer {KEY}',
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal',
            },
            method='POST',
        )
        try:
            with urllib.request.urlopen(req) as r:
                pass
        except urllib.error.HTTPError as e:
            raise RuntimeError(
                f'INSERT {table} batch {i // batch_size}: HTTP {e.code}: '
                f'{e.read().decode()[:400]}'
            )
        inserted += len(batch)
    return inserted

# ── Step 1: UoM conversion ─────────────────────────────────────────────────────

print('Loading units_of_measure…')
uom_rows = supa_get_all('/rest/v1/units_of_measure?select=name,ratio')
uom_ratio: dict[str, float] = {r['name']: float(r['ratio']) for r in uom_rows}
if 'CAJA40' not in uom_ratio:
    raise SystemExit('ERROR — CAJA40 not in units_of_measure.')
CAJA40_RATIO = uom_ratio['CAJA40']
print(f'  {len(uom_ratio)} UoMs. CAJA40 ratio={CAJA40_RATIO}')


def to_stock_uom(qty: float, src_uom_name: str, tgt_uom_name: str) -> float | None:
    """Convert qty from src_uom to tgt_uom (both by name).
    Formula: qty * (tgt_ratio / src_ratio)
    CORRECT: target is product's stock_uom, NOT CAJA40.
    """
    src = uom_ratio.get(src_uom_name)
    tgt = uom_ratio.get(tgt_uom_name)
    if src is None or src == 0 or tgt is None:
        return None
    return qty * (tgt / src)

# ── Step 2a: Load product stock_uoms for red-tier PIDs ───────────────────────

print('\nLoading product stock_uoms for red-tier PIDs…')
pid_csv_uom = ','.join(str(p) for p in RED_TIER_PIDS)
prod_rows = supa_get_all(f'/rest/v1/products?id=in.({pid_csv_uom})&select=id,sku,stock_uom')
pid_stock_uom: dict[int, str] = {p['id']: (p['stock_uom'] or 'CAJA40') for p in prod_rows}
for pid, uom in sorted(pid_stock_uom.items()):
    factor = uom_ratio.get(uom, CAJA40_RATIO) / CAJA40_RATIO
    print(f'  pid={pid:>6}  stock_uom={uom:>8}  factor vs CAJA40={factor:.4f}')

# ── Step 2b: Stock locations — internal locations ─────────────────────────────

print('\nLoading internal stock locations…')
locs = supa_get_all('/rest/v1/stock_locations?select=id,name,location_type')
internal_loc_ids: set[int] = {l['id'] for l in locs if l['location_type'] == 'internal'}
print(f'  {len(internal_loc_ids)} internal locations')
print(f'  Vendor location_id: {VENDOR_LOCATION_ID}')

# ── Step 3: Fetch stock_moves purchase receipts for red-tier PIDs ──────────────

print('\nFetching stock_moves purchase receipts for red-tier PIDs…')
pid_csv = ','.join(str(p) for p in RED_TIER_PIDS)
moves = supa_get_all(
    f'/rest/v1/stock_moves'
    f'?product_id=in.({pid_csv})'
    f'&from_location_id=eq.{VENDOR_LOCATION_ID}'
    f'&state=eq.done'
    f'&move_date=gte.{TRAINING_START}'
    f'&move_date=lte.{TRAINING_END}T23:59:59'
    f'&select=product_id,quantity,uom,move_date,to_location_id'
)
# Filter to internal destination only (exclude transit-to-transit moves)
purchase_moves = [
    m for m in moves if m['to_location_id'] in internal_loc_ids
]
print(f'  Total vendor→any moves fetched: {len(moves)}')
print(f'  Filtered to vendor→internal (real receipts): {len(purchase_moves)}')

# ── Step 4: Aggregate to daily (product_id, date) ─────────────────────────────

print('\nAggregating to daily…')
# (pid, date) → {qty_sum, docs_count, skipped_uom}
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

# ── Step 5: Load existing revenue_daily to avoid double-counting ───────────────

print('\nLoading existing revenue_daily purchase rows for red-tier PIDs…')
existing = supa_get_all(
    f'/rest/v1/{TARGET_TABLE}'
    f'?product_id=in.({pid_csv})'
    f'&metric=in.(purchases_ordered,purchases_received)'
    f'&select=product_id,observation_date,metric'
)
existing_keys: set[tuple] = {
    (r['product_id'], str(r['observation_date'])[:10], r['metric'])
    for r in existing
}
print(f'  Existing purchase rows: {len(existing)} → {len(existing_keys)} unique (pid, date, metric) keys')

# ── Step 6: Build output rows (only for cells not already in revenue_daily) ────

print('\nBuilding new rows (skipping already-covered cells)…')
out_rows: list[dict] = []
skipped_existing_ord = skipped_existing_rcv = 0

for (pid, date), v in sorted(daily_agg.items()):
    qty = round(v['qty'], 4)

    key_ord = (pid, date, 'purchases_ordered')
    if key_ord in existing_keys:
        skipped_existing_ord += 1
    else:
        out_rows.append({
            'product_id':       pid,
            'ssot_label':       SSOT_PO_ORD,
            'metric':           'purchases_ordered',
            'observation_date': date,
            'quantity':         qty,
            'revenue_gtq':      None,
            'source_doc_count': v['docs'],
        })

    key_rcv = (pid, date, 'purchases_received')
    if key_rcv in existing_keys:
        skipped_existing_rcv += 1
    else:
        out_rows.append({
            'product_id':       pid,
            'ssot_label':       SSOT_PO_RCV,
            'metric':           'purchases_received',
            'observation_date': date,
            'quantity':         qty,
            'revenue_gtq':      None,
            'source_doc_count': v['docs'],
        })

print(f'  Skipped (already in revenue_daily from find_15): '
      f'{skipped_existing_ord} ordered, {skipped_existing_rcv} received')
print(f'  New rows to insert: {len(out_rows)}')

if not out_rows:
    print('\nNothing to insert — revenue_daily already up to date for red-tier SKUs.')
    raise SystemExit(0)

# ── Step 7: Coverage preview by PID ───────────────────────────────────────────

print('\n=== Coverage preview: months being added per PID ===')
pid_months: dict[int, set] = defaultdict(set)
for r in out_rows:
    if r['metric'] == 'purchases_ordered':
        pid_months[r['product_id']].add(r['observation_date'][:7])

pid_to_sku: dict[int, str] = {}
demo_meta = supa_get_all(
    '/rest/v1/products_acid_test_active'
    '?select=default_code,products_id'
    '&is_top_10_in_class=eq.true'
)
for r in demo_meta:
    pid_to_sku[r['products_id']] = r['default_code']

for pid in sorted(RED_TIER_PIDS):
    sku = pid_to_sku.get(pid, '?')
    months = sorted(pid_months.get(pid, set()))
    print(f'  pid={pid:5d}  sku={sku}  months_added={len(months)}  range={months[0] if months else "—"}→{months[-1] if months else "—"}')

# ── Step 8: Insert ─────────────────────────────────────────────────────────────

print(f'\nInserting {len(out_rows)} rows into {TARGET_TABLE}…')
t0 = time.time()
inserted = insert_batch(TARGET_TABLE, out_rows)
print(f'  Inserted {inserted} rows in {time.time() - t0:.1f}s')

# ── Step 9: Verification — month coverage for each red-tier PID ───────────────

print('\n=== Verification: purchases_ordered month coverage after insert ===')
verify = supa_get_all(
    f'/rest/v1/{TARGET_TABLE}'
    f'?product_id=in.({pid_csv})'
    f'&metric=eq.purchases_ordered'
    f'&select=product_id,observation_date'
)
by_pid: dict[int, set] = defaultdict(set)
for r in verify:
    by_pid[r['product_id']].add(str(r['observation_date'])[:7])

months_expected = {
    f'2024-{m:02d}' for m in range(10, 13)
} | {
    f'2025-{m:02d}' for m in range(1, 13)
} | {'2026-01'}   # 16-month training window

print(f'  {"PID":>6}  {"SKU":>12}  {"Months":>6}  {"Missing from window":>22}')
print(f'  {"-"*6}  {"-"*12}  {"-"*6}  {"-"*22}')
all_complete = True
for pid in sorted(RED_TIER_PIDS):
    sku = pid_to_sku.get(pid, '?')
    covered = by_pid.get(pid, set())
    missing = sorted(months_expected - covered)
    status = 'OK' if not missing else f'MISSING {len(missing)}'
    if missing:
        all_complete = False
    print(f'  {pid:>6}  {sku:>12}  {len(covered):>6}  {status}  {missing if missing else ""}')

print()
if all_complete:
    print('All 14 red-tier PIDs now have complete 16-month purchase coverage.')
else:
    print('WARNING — some months still missing. Check stock_moves for those PIDs.')

print('\nNext step: python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py')
