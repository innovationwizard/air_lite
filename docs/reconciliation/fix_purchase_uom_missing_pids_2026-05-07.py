"""
Targeted recovery for 6 PIDs that still have 0 purchase rows in revenue_daily
after the partial fix. PIDs: 1113, 1127, 1366, 1587, 1590, 1600.

UoM semantics:
  FARDO10 = a package containing 10 individual units; ratio = 0.1
  FARDO5  = a package containing 5 individual units;  ratio = 0.05
  FARDO4  = a package containing 4 individual units;  ratio = 0.025 (same as CAJA40 -- wait check)
  FARDO20 = a package containing 20 individual units; ratio = 0.2 (check)
  CAJA40  = a box containing 40 individual units;     ratio = 0.025
  CAJA20  = a box containing 20 individual units;     ratio = 0.05
  CAJA10  = a box containing 10 individual units;     ratio = 0.1
  CAJA    = a generic box;                            ratio = 1.0 (check)

The bug: find_15b applied to_caja40() which converts any UoM to CAJA40 units.
The fix: convert to stock_uom units instead (use tgt_ratio/src_ratio where tgt=stock_uom).

RED_TIER_PIDS (procurement via stock.picking 'Recibidos Internacional', not standard POL):
  [2, 3, 5, 29, 34, 36, 145, 1069, 1096, 1113, 1127, 1587, 1590, 1600]
  Source: stock_moves vendor->internal, state=done

Non-RED_TIER (procurement via purchase.order.line):
  Source: purchase_order_lines joined to purchase_orders

MISSING PIDs:
  1113  77205035  FARDO4  factor=10   → RED_TIER
  1127  77205005  FARDO4  factor=10   → RED_TIER
  1366  77201014  CAJA20  factor=2    → NOT RED_TIER → source: purchase_order_lines
  1587  77201019  CAJA20  factor=2    → RED_TIER
  1590  77201055  CAJA20  factor=2    → RED_TIER
  1600  77201056  CAJA20  factor=2    → RED_TIER
"""

import json
import os
import time
import urllib.request
import urllib.error
from collections import defaultdict
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
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY  = os.environ['SUPABASE_SERVICE_ROLE_KEY']

# ── helpers ───────────────────────────────────────────────────────────────────

def supa_request(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if data:
        headers['Content-Type'] = 'application/json'
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(f'{SUPA}{path}', data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def get_all(path_base):
    rows, offset, limit = [], 0, 1000
    sep = '&' if '?' in path_base else '?'
    while True:
        status, body = supa_request('GET', f'{path_base}{sep}offset={offset}&limit={limit}')
        if status >= 400:
            raise RuntimeError(f'GET {path_base}: HTTP {status}: {body}')
        if not body:
            break
        rows.extend(body)
        if len(body) < limit:
            break
        offset += limit
    return rows


def upsert_batch(table, rows, batch_size=500):
    upserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        status, body = supa_request(
            'POST', f'/rest/v1/{table}', body=batch,
            prefer='resolution=merge-duplicates,return=minimal',
        )
        if status >= 400:
            raise RuntimeError(f'UPSERT {table} batch {i // batch_size}: HTTP {status}: {body}')
        upserted += len(batch)
        print(f'  Upserted batch {i // batch_size}: {upserted} total rows')
    return upserted


# ── Constants ─────────────────────────────────────────────────────────────────

MISSING_PIDS = [1113, 1127, 1366, 1587, 1590, 1600]
RED_TIER_PIDS = {2, 3, 5, 29, 34, 36, 145, 1069, 1096, 1113, 1127, 1587, 1590, 1600}
VENDOR_LOCATION_ID = 41  # Partners/Vendors

SSOT_POL_ORDERED   = 'pol_confirmed_date_planned_product_qty_c40'
SSOT_SM_RECEIVED   = 'pol_purchase_done_date_planned_qty_received_c40'

# ── Step 1: Load UoM ratios ───────────────────────────────────────────────────

print('Loading UoM ratios…')
uom_rows = get_all('/rest/v1/units_of_measure?select=id,name,ratio')
uom_ratio = {r['name']: float(r['ratio']) for r in uom_rows}
uom_by_id = {r['id']: r for r in uom_rows}
CAJA40_RATIO = uom_ratio['CAJA40']
print(f'  CAJA40 (box of 40) ratio: {CAJA40_RATIO}')

# ── Step 2: Load product info for missing PIDs ────────────────────────────────

print('\nLoading product info for missing PIDs…')
missing_pids_csv = ','.join(str(p) for p in MISSING_PIDS)
prods = get_all(f'/rest/v1/products?id=in.({missing_pids_csv})&select=id,sku,stock_uom')
pid_info = {p['id']: p for p in prods}

for pid in MISSING_PIDS:
    p = pid_info.get(pid, {})
    stock_uom = p.get('stock_uom', 'UNKNOWN')
    tgt_ratio = uom_ratio.get(stock_uom, CAJA40_RATIO)
    factor = tgt_ratio / CAJA40_RATIO
    source = 'RED_TIER (stock_moves)' if pid in RED_TIER_PIDS else 'POL (purchase_order_lines)'
    print(f'  pid={pid:>6}  sku={p.get("sku","?"):>12}  stock_uom={stock_uom:>8}  factor={factor:.4f}  source={source}')

# ── Step 3: Idempotency check ─────────────────────────────────────────────────

print('\nVerifying these PIDs truly have 0 rows…')
for pid in MISSING_PIDS:
    rows = get_all(f'/rest/v1/revenue_daily?product_id=eq.{pid}&metric=eq.purchases_received&select=quantity')
    total = sum(float(r['quantity'] or 0) for r in rows)
    print(f'  pid={pid}: {len(rows)} rows, total={total:,.1f}')
    if total > 0:
        print(f'  WARNING: pid={pid} already has data — this script will upsert, not double-count')

# ── Step 4: Recover RED_TIER PIDs from stock_moves ───────────────────────────

red_tier_missing = [p for p in MISSING_PIDS if p in RED_TIER_PIDS]
print(f'\nRecovering {len(red_tier_missing)} RED_TIER PIDs from stock_moves: {red_tier_missing}')

loc_rows = get_all('/rest/v1/stock_locations?select=id,location_type')
internal_loc_ids = [r['id'] for r in loc_rows if r['location_type'] == 'internal']
internal_csv = ','.join(str(x) for x in internal_loc_ids)
red_tier_csv = ','.join(str(p) for p in red_tier_missing)

print(f'  {len(internal_loc_ids)} internal locations')

sm_rows = get_all(
    f'/rest/v1/stock_moves'
    f'?product_id=in.({red_tier_csv})'
    f'&from_location_id=eq.{VENDOR_LOCATION_ID}'
    f'&state=eq.done'
    f'&select=product_id,quantity,uom,move_date,to_location_id'
)
# Filter to internal destinations only
sm_rows = [m for m in sm_rows if m['to_location_id'] in internal_loc_ids]
print(f'  {len(sm_rows)} stock_move rows found (vendor→internal, done)')

# Aggregate to daily, converting to stock_uom
sm_daily: dict[tuple, dict] = {}
for row in sm_rows:
    pid = row['product_id']
    p = pid_info.get(pid, {})
    stock_uom_name = p.get('stock_uom', 'CAJA40')
    tgt_ratio = uom_ratio.get(stock_uom_name, CAJA40_RATIO)

    src_uom_name = row.get('uom') or 'CAJA40'
    src_ratio = uom_ratio.get(src_uom_name, CAJA40_RATIO)

    # Correct UoM conversion: from source UoM → stock_uom
    # tgt_ratio/src_ratio = how many stock_uom units per 1 source unit
    qty_done = float(row['quantity'] or 0)
    qty_in_stock_uom = qty_done * (tgt_ratio / src_ratio)

    obs_date = str(row['move_date'])[:10]
    key = (pid, SSOT_SM_RECEIVED, 'purchases_received', obs_date)

    if key not in sm_daily:
        sm_daily[key] = {
            'product_id': pid,
            'ssot_label': SSOT_SM_RECEIVED,
            'metric': 'purchases_received',
            'observation_date': obs_date,
            'quantity': 0.0,
            'revenue_gtq': None,
            'source_doc_count': 0,
        }
    sm_daily[key]['quantity'] = round(sm_daily[key]['quantity'] + qty_in_stock_uom, 4)
    sm_daily[key]['source_doc_count'] += 1

sm_rows_to_insert = list(sm_daily.values())
print(f'  → {len(sm_rows_to_insert)} daily rows to upsert for RED_TIER missing PIDs')

# Preview per pid
for pid in red_tier_missing:
    pid_rows = [r for r in sm_rows_to_insert if r['product_id'] == pid]
    total = sum(r['quantity'] for r in pid_rows)
    print(f'    pid={pid}: {len(pid_rows)} daily rows, total={total:,.1f} {pid_info.get(pid,{}).get("stock_uom","?")}')

# ── Step 5: Recover non-RED_TIER from purchase_order_lines ───────────────────

non_red_missing = [p for p in MISSING_PIDS if p not in RED_TIER_PIDS]
print(f'\nRecovering {len(non_red_missing)} non-RED_TIER PIDs from purchase_order_lines: {non_red_missing}')

pol_rows_to_insert = []
if non_red_missing:
    non_red_csv = ','.join(str(p) for p in non_red_missing)

    # Fetch purchase_order_lines for these pids
    # Actual columns: id, order_id, product_id, quantity, received_qty, uom
    pol_rows = get_all(
        f'/rest/v1/purchase_order_lines'
        f'?product_id=in.({non_red_csv})'
        f'&select=product_id,quantity,received_qty,uom,order_id'
    )
    print(f'  {len(pol_rows)} POL rows found')

    # Get order dates from purchase_orders (date field: expected_delivery)
    order_ids = list({r['order_id'] for r in pol_rows if r.get('order_id')})
    po_dates: dict = {}
    if order_ids:
        chunk_size = 200
        for i in range(0, len(order_ids), chunk_size):
            chunk = order_ids[i:i+chunk_size]
            ids_csv = ','.join(str(x) for x in chunk)
            po_chunk = get_all(f'/rest/v1/purchase_orders?id=in.({ids_csv})&select=id,expected_delivery,state')
            for po in po_chunk:
                if po.get('expected_delivery') and po.get('state') in ('purchase', 'locked', 'done'):
                    po_dates[po['id']] = po['expected_delivery'][:10]

    # Build ordered and received rows using stock_uom conversion
    ordered_daily: dict[tuple, dict] = {}
    received_daily: dict[tuple, dict] = {}

    for row in pol_rows:
        pid = row['product_id']
        p = pid_info.get(pid, {})
        stock_uom_name = p.get('stock_uom', 'CAJA40')
        tgt_ratio = uom_ratio.get(stock_uom_name, CAJA40_RATIO)

        src_uom_name = row.get('uom') or 'CAJA40'
        src_ratio = uom_ratio.get(src_uom_name, CAJA40_RATIO)
        uom_factor = tgt_ratio / src_ratio

        order_date = po_dates.get(row.get('order_id'), '')
        if not order_date:
            continue

        # purchases_ordered
        planned_qty = float(row.get('quantity') or 0) * uom_factor
        if planned_qty > 0:
            key = (pid, SSOT_POL_ORDERED, 'purchases_ordered', order_date)
            if key not in ordered_daily:
                ordered_daily[key] = {
                    'product_id': pid, 'ssot_label': SSOT_POL_ORDERED,
                    'metric': 'purchases_ordered', 'observation_date': order_date,
                    'quantity': 0.0, 'revenue_gtq': None, 'source_doc_count': 0,
                }
            ordered_daily[key]['quantity'] = round(ordered_daily[key]['quantity'] + planned_qty, 4)
            ordered_daily[key]['source_doc_count'] += 1

        # purchases_received
        recv_qty = float(row.get('received_qty') or 0) * uom_factor
        if recv_qty > 0:
            key = (pid, SSOT_SM_RECEIVED, 'purchases_received', order_date)
            if key not in received_daily:
                received_daily[key] = {
                    'product_id': pid, 'ssot_label': SSOT_SM_RECEIVED,
                    'metric': 'purchases_received', 'observation_date': order_date,
                    'quantity': 0.0, 'revenue_gtq': None, 'source_doc_count': 0,
                }
            received_daily[key]['quantity'] = round(received_daily[key]['quantity'] + recv_qty, 4)
            received_daily[key]['source_doc_count'] += 1

    pol_rows_to_insert = list(ordered_daily.values()) + list(received_daily.values())
    for pid in non_red_missing:
        pid_r = [r for r in pol_rows_to_insert if r['product_id'] == pid]
        total = sum(r['quantity'] for r in pid_r if r['metric'] == 'purchases_received')
        print(f'    pid={pid}: {len(pid_r)} rows, purchases_received total={total:,.1f} {pid_info.get(pid,{}).get("stock_uom","?")}')

# ── Step 6: Upsert all recovery rows ─────────────────────────────────────────

all_rows = sm_rows_to_insert + pol_rows_to_insert
print(f'\nUpserting {len(all_rows)} total recovery rows…')
t0 = time.time()
upserted = upsert_batch('revenue_daily', all_rows)
print(f'Upserted {upserted} rows in {time.time()-t0:.1f}s')

# ── Step 7: Final verification ────────────────────────────────────────────────

print('\n=== Final verification for all 6 missing PIDs ===')
all_ok = True
for pid in MISSING_PIDS:
    p = pid_info.get(pid, {})
    rows = get_all(f'/rest/v1/revenue_daily?product_id=eq.{pid}&metric=eq.purchases_received&select=quantity')
    total = sum(float(r['quantity'] or 0) for r in rows)
    stock_uom = p.get('stock_uom', '?')
    status_str = 'OK' if len(rows) > 0 else 'STILL MISSING'
    if len(rows) == 0:
        all_ok = False
    print(f'  pid={pid:>6}  sku={p.get("sku","?"):>12}  {len(rows):>4} rows  {total:>12,.1f} {stock_uom}  {status_str}')

if all_ok:
    print('\n[PASS] All 6 missing PIDs recovered.')
else:
    print('\n[FAIL] Some PIDs still missing — investigate manually.')
    raise SystemExit(1)
