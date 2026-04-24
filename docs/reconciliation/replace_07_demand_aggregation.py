"""
Step 07 — Per-product demand aggregation for product_id=33 (SKU 77201046).

Implements the same logic as supabase/migrations/20260423000001_aggregate_demand_daily_for_product.sql
but client-side via PostgREST since the migration isn't applied to prod yet.

SSOT rules (must match aggregate_demand_daily()):
  - Filter: state IN ('sale','done') AND delivered_qty > 0 AND effective_date IS NOT NULL
  - Group by: (product_id, DATE(effective_date))
  - Aggregate: SUM(delivered_qty), SUM(subtotal), COUNT(DISTINCT order_id)
  - Censored days: where SUM(inventory_daily.quantity_on_hand) <= 0 AND no demand row

After this completes, demand_daily for product_id=33 should hold the Odoo-live truth.
"""
import os
import json
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime
from pathlib import Path

def load_env():
    for f in ['/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
              '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env']:
        p = Path(f)
        if not p.exists(): continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip()
                if k not in os.environ:
                    os.environ[k] = v
load_env()

SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
PRODUCT_ID = 33

def get(path):
    out = []
    offset = 0
    while True:
        sep = '&' if '?' in path else '?'
        url = f"{SUPA}{path}{sep}offset={offset}&limit=1000"
        req = urllib.request.Request(url, headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
        with urllib.request.urlopen(req) as r:
            batch = json.loads(r.read().decode())
        if not batch: break
        out.extend(batch)
        if len(batch) < 1000: break
        offset += 1000
    return out

def delete_where(table, q):
    req = urllib.request.Request(
        f"{SUPA}/rest/v1/{table}?{q}",
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'return=representation'},
        method='DELETE')
    with urllib.request.urlopen(req) as r:
        body = json.loads(r.read().decode())
    return len(body) if isinstance(body, list) else 0

def insert_batched(table, rows):
    if not rows: return 0
    n = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        body = json.dumps(batch).encode()
        req = urllib.request.Request(
            f"{SUPA}/rest/v1/{table}",
            data=body,
            headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                     'Content-Type': 'application/json',
                     'Prefer': 'return=minimal'},
            method='POST')
        try:
            with urllib.request.urlopen(req) as r:
                r.read()
            n += len(batch)
        except urllib.error.HTTPError as e:
            print(f"   ERROR batch {i//500}: {e.code} — {e.read().decode()[:300]}")
            raise
    return n

# === Step 1: clear existing demand_daily rows for product_id=33 ===
print(f"DELETE demand_daily WHERE product_id={PRODUCT_ID}...")
n = delete_where('demand_daily', f'product_id=eq.{PRODUCT_ID}')
print(f"  Deleted: {n}")

# === Step 2: pull all sale_order_lines for product_id=33 with embedded sale_orders ===
print(f"\nFetching all sale_order_lines for product_id={PRODUCT_ID} with parent orders...")
lines = get(f'/rest/v1/sale_order_lines?product_id=eq.{PRODUCT_ID}&select=order_id,delivered_qty,subtotal,sale_orders(state,effective_date)')
print(f"  Lines fetched: {len(lines)}")

# === Step 3: aggregate by day applying SSOT filter ===
agg = defaultdict(lambda: {'qty': 0.0, 'rev': 0.0, 'orders': set()})
filtered_in = 0
filtered_out = 0
for l in lines:
    o = l.get('sale_orders') or {}
    state = o.get('state')
    eff = o.get('effective_date')
    dq = float(l.get('delivered_qty') or 0)
    if state not in ('sale', 'done') or dq <= 0 or not eff:
        filtered_out += 1
        continue
    day = eff[:10]
    agg[day]['qty'] += dq
    agg[day]['rev'] += float(l.get('subtotal') or 0)
    agg[day]['orders'].add(l['order_id'])
    filtered_in += 1

print(f"  Filtered in: {filtered_in}, filtered out: {filtered_out}")
print(f"  Distinct days: {len(agg)}")

# === Step 4: insert demand rows ===
rows = []
for day, v in sorted(agg.items()):
    rows.append({
        'product_id': PRODUCT_ID,
        'demand_date': day,
        'quantity_sold': round(v['qty'], 4),
        'revenue': round(v['rev'], 4),
        'is_censored': False,
        'orders_count': len(v['orders']),
    })
print(f"\nInserting {len(rows)} demand_daily rows...")
n = insert_batched('demand_daily', rows)
print(f"  Inserted: {n}")

# === Step 5: censored days from inventory (must be inserted, not updated, since we just deleted) ===
# inventory_daily was also wiped in Phase A — there are no rows yet. We'll need to
# re-derive inventory_daily for product 33 too. Let's check.
print("\nChecking inventory_daily coverage for product_id=33...")
inv = get(f'/rest/v1/inventory_daily?product_id=eq.{PRODUCT_ID}&select=snapshot_date&limit=10')
print(f"  inventory_daily sample rows: {inv}")

if not inv:
    print(f"\n  inventory_daily for product_id={PRODUCT_ID} is empty — censored-day detection skipped this run.")
    print(f"  To rebuild it, run reconstruct_inventory_daily() for product_id={PRODUCT_ID} after this script.")
else:
    # Insert censored days where stock<=0 and no demand row
    inv_by_day = defaultdict(float)
    inv_full = get(f'/rest/v1/inventory_daily?product_id=eq.{PRODUCT_ID}&select=snapshot_date,quantity_on_hand')
    for r in inv_full:
        inv_by_day[r['snapshot_date']] += float(r['quantity_on_hand'] or 0)
    censored_days = [d for d, q in inv_by_day.items() if q <= 0 and d not in agg]
    print(f"  Candidate censored days: {len(censored_days)}")
    if censored_days:
        cens_rows = [{'product_id': PRODUCT_ID, 'demand_date': d,
                      'quantity_sold': 0, 'revenue': 0,
                      'is_censored': True, 'orders_count': 0} for d in censored_days]
        n = insert_batched('demand_daily', cens_rows)
        print(f"  Inserted censored: {n}")

# === Step 6: per-month verification ===
print("\nVerifying per-month totals from new demand_daily...")
verify = get(f'/rest/v1/demand_daily?product_id=eq.{PRODUCT_ID}&select=demand_date,quantity_sold,is_censored')
month_qty = defaultdict(float)
month_days = defaultdict(int)
month_censored = defaultdict(int)
for r in verify:
    m = r['demand_date'][:7]
    month_qty[m] += float(r['quantity_sold'] or 0)
    month_days[m] += 1
    if r['is_censored']:
        month_censored[m] += 1

print(f"\n{'Month':<10}{'qty':>12}{'days':>8}{'censored':>10}")
for m in sorted(month_qty.keys()):
    print(f"{m:<10}{month_qty[m]:>12.2f}{month_days[m]:>8}{month_censored[m]:>10}")

target_months = {
    '2024-11': 6466.25,
    '2024-12': 6496.50,
}
print(f"\nVs SSOT (Odoo live B_combo):")
for m, ssot in target_months.items():
    actual = month_qty.get(m, 0)
    print(f"  {m}: prod={actual:.2f}  SSOT={ssot}  Δ={actual-ssot:+.4f}")
