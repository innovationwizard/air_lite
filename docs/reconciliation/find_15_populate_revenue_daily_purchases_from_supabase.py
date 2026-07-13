"""
Populate revenue_daily — purchases_ordered and purchases_received — for the 23
demo SKUs directly from Supabase production tables.

Replaces the Odoo XML-RPC extraction step for purchase data. All source data
is read from Supabase, which holds the complete production purchase history
including locked-state POs (the 74.5% that were absent from Odoo test-env
extracts and therefore missing from revenue_daily until now).

SOURCE TABLES (read-only):
  purchase_orders       — PO headers: state, expected_delivery
  purchase_order_lines  — PO lines: product_id (= products.id), quantity,
                          received_qty, uom
  units_of_measure      — UoM conversion ratios for CAJA40 normalization

SSOT LABELS (unchanged from existing revenue_daily rows):
  purchases_ordered:  pol_confirmed_date_planned_product_qty_c40
  purchases_received: pol_purchase_done_date_planned_qty_received_c40

DEMO SCOPE — state filter:
  state IN ('purchase', 'locked', 'done')
  Excluded: draft, solicitud de cotización, cancel

DATE FIELD:
  purchase_orders.expected_delivery (= Odoo date_planned, order-level)
  Cross-checked 2026-04-28: SKU 77201046 Nov 2024 = 5,855.00 CAJA40 — exact match
  to acid test anchor. confirmation_date and order_date both diverge (+42%).

UOM NORMALIZATION:
  normalized_qty = raw_qty * CAJA40_RATIO / src_ratio
  where CAJA40_RATIO = 0.025 (units_of_measure.ratio for 'CAJA40')
  Lines with a UoM not found in units_of_measure are skipped and reported.

IDEMPOTENCY:
  Deletes existing purchases_ordered + purchases_received rows for the 23 demo
  product_ids (both SSOT labels) before inserting fresh data. Sales rows are
  never touched.

NEXT STEP AFTER THIS SCRIPT:
  python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py
  Then re-trigger ML training via acid-test/forecast/run (all 23 SKUs).
"""

import os
import json
import urllib.request
import urllib.error
from collections import defaultdict
from pathlib import Path

DEMO_STATES   = {'purchase', 'locked', 'done'}
SSOT_PO_ORD   = 'pol_confirmed_date_planned_product_qty_c40'
SSOT_PO_RCV   = 'pol_purchase_done_date_planned_qty_received_c40'
TARGET_TABLE  = 'revenue_daily'

# Acid-test verification anchor (SKU 77201046, products.id=33)
ACID_SKU_PID  = 33
ACID_MONTH    = '2024-11'
ACID_ORD_TARGET = 5855.0
ACID_RCV_TARGET = 5500.0  # Nov 2024 purchases_received anchor

# ── env ───────────────────────────────────────────────────────────────────────

def load_env():
    for f in ['/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
              '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env']:
        p = Path(f)
        if not p.exists():
            continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                k, v = line.split('=', 1)
                k, v = k.strip(), v.strip()
                if k not in os.environ:
                    os.environ[k] = v

load_env()
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
KEY  = os.environ['SUPABASE_SECRET_KEY']

# ── Supabase helpers ──────────────────────────────────────────────────────────

def supa_request(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if data:
        headers['Content-Type'] = 'application/json'
    if prefer:
        headers['Prefer'] = prefer
    req = urllib.request.Request(f"{SUPA}{path}", data=data, headers=headers, method=method)
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
        status, body = supa_request('GET', f"{path_base}{sep}offset={offset}&limit={limit}")
        if status >= 400:
            raise RuntimeError(f"GET {path_base}: HTTP {status}: {body}")
        if not body:
            break
        rows.extend(body)
        if len(body) < limit:
            break
        offset += limit
    return rows

def insert_batch(table, rows, batch_size=500):
    inserted = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        status, body = supa_request('POST', f'/rest/v1/{table}', body=batch,
                                    prefer='return=minimal')
        if status >= 400:
            raise RuntimeError(f"INSERT {table} batch {i // batch_size}: HTTP {status}: {body}")
        inserted += len(batch)
    return inserted

# ── Pre-flight ────────────────────────────────────────────────────────────────

print("Pre-flight: verifying required tables exist...")
for table in ('revenue_daily', 'purchase_orders', 'purchase_order_lines', 'units_of_measure'):
    status, _ = supa_request('GET', f'/rest/v1/{table}?limit=1')
    if status >= 400:
        raise SystemExit(f"ERROR — table '{table}' not accessible (HTTP {status}). "
                         f"Verify Supabase project and service role key.")
    print(f"  {table} OK")
print()

# ── Step 1: UoM conversion table ─────────────────────────────────────────────

print("Loading units_of_measure...")
uom_rows = get_all('/rest/v1/units_of_measure?select=name,ratio&order=id.asc')
uom_ratio = {u['name']: float(u['ratio']) for u in uom_rows}

if 'CAJA40' not in uom_ratio:
    raise SystemExit("ERROR — 'CAJA40' not found in units_of_measure table.")
CAJA40_RATIO = uom_ratio['CAJA40']
print(f"  {len(uom_ratio)} UoMs loaded. CAJA40 ratio = {CAJA40_RATIO}")

def to_stock_uom(qty, src_uom_name, tgt_uom_name):
    """Convert qty from src_uom to tgt_uom (both by name).
    Formula: qty * (tgt_ratio / src_ratio)
    CORRECT target: product's stock_uom (NOT CAJA40).
    BUG FIX 2026-05-07: previous version used to_caja40() which converted to
    CAJA40 while sales are stored in stock_uom → purchases appeared 2-40× too low.
    """
    src = uom_ratio.get(src_uom_name)
    tgt = uom_ratio.get(tgt_uom_name)
    if src is None or src == 0 or tgt is None:
        return None
    return qty * (tgt / src)

print()

# ── Step 2: 23 demo product_ids ───────────────────────────────────────────────

print("Fetching 23 demo product_ids from products_acid_test_active.products_id...")
demo_meta = get_all(
    '/rest/v1/products_acid_test_active'
    '?select=default_code,products_id,supplier_class,movement_rank_within_class'
    '&is_top_10_in_class=eq.true'
    '&products_id=not.is.null'
    '&order=supplier_class.asc,movement_rank_within_class.asc'
)
if len(demo_meta) != 23:
    raise SystemExit(f"ERROR — expected 23 demo SKUs with non-null products_id, "
                     f"got {len(demo_meta)}. Apply migration "
                     f"20260428000002_products_acid_test_add_products_id.sql first.")

demo_product_ids = [r['products_id'] for r in demo_meta]
pid_to_sku = {r['products_id']: r['default_code'] for r in demo_meta}
print(f"  {len(demo_product_ids)} product_ids: {sorted(demo_product_ids)}\n")

# ── Step 2b: Load stock_uom per product (for correct UoM conversion) ─────────

print("Loading stock_uom for 23 demo products…")
pid_csv_uom = ','.join(str(p) for p in demo_product_ids)
prod_uom_rows = get_all(f'/rest/v1/products?id=in.({pid_csv_uom})&select=id,stock_uom')
pid_stock_uom: dict[int, str] = {p['id']: (p['stock_uom'] or 'CAJA40') for p in prod_uom_rows}
print(f"  Loaded {len(pid_stock_uom)} stock_uoms\n")

# ── Step 3: Fetch all purchase_orders ─────────────────────────────────────────

print("Fetching all purchase_orders...")
all_orders = get_all(
    '/rest/v1/purchase_orders'
    '?select=id,state,expected_delivery'
    '&order=id.asc'
)
print(f"  {len(all_orders)} total orders fetched")

from collections import Counter
state_counts = Counter(o['state'] for o in all_orders)
print(f"  State breakdown: {dict(sorted(state_counts.items()))}")

# Filter to DEMO scope states; skip orders with no delivery date
in_scope_orders = {
    o['id']: o['expected_delivery'][:10]
    for o in all_orders
    if o['state'] in DEMO_STATES and o.get('expected_delivery')
}
print(f"  In DEMO scope (state IN purchase/locked/done) with delivery date: "
      f"{len(in_scope_orders)} orders\n")

# ── Step 4: Fetch all purchase_order_lines for the 23 demo SKUs ───────────────

print("Fetching purchase_order_lines for 23 demo SKUs...")
pid_csv = ','.join(str(p) for p in demo_product_ids)
all_lines = get_all(
    f'/rest/v1/purchase_order_lines'
    f'?select=id,order_id,product_id,quantity,received_qty,uom'
    f'&product_id=in.({pid_csv})'
    f'&order=id.asc'
)
print(f"  {len(all_lines)} lines fetched for demo SKUs\n")

# ── Step 5: Build daily aggregates ───────────────────────────────────────────

print("Computing daily aggregates (filtering to DEMO scope orders)...")

# (product_id, date) → {qty, docs}
ordered_agg  = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
received_agg = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
skipped_unknown_uom = []
skipped_no_date     = 0
skipped_out_scope   = 0

for line in all_lines:
    oid = line['order_id']

    if oid not in in_scope_orders:
        skipped_out_scope += 1
        continue

    date = in_scope_orders[oid]
    pid  = line['product_id']
    uom  = line['uom']

    tgt_uom = pid_stock_uom.get(pid, 'CAJA40')

    # purchases_ordered
    raw_ord = float(line.get('quantity') or 0)
    if raw_ord > 0:
        norm_ord = to_stock_uom(raw_ord, uom, tgt_uom)
        if norm_ord is None:
            skipped_unknown_uom.append({'line_id': line['id'], 'uom': uom,
                                        'product_id': pid, 'metric': 'ordered'})
        else:
            ordered_agg[(pid, date)]['qty'] += norm_ord
            ordered_agg[(pid, date)]['docs'].add(oid)

    # purchases_received
    raw_rcv = float(line.get('received_qty') or 0)
    if raw_rcv > 0:
        norm_rcv = to_stock_uom(raw_rcv, uom, tgt_uom)
        if norm_rcv is None:
            skipped_unknown_uom.append({'line_id': line['id'], 'uom': uom,
                                        'product_id': pid, 'metric': 'received'})
        else:
            received_agg[(pid, date)]['qty'] += norm_rcv
            received_agg[(pid, date)]['docs'].add(oid)

print(f"  ordered  day-cells: {len(ordered_agg)}")
print(f"  received day-cells: {len(received_agg)}")
print(f"  lines skipped (out of scope state):  {skipped_out_scope}")
if skipped_unknown_uom:
    print(f"  WARNING — {len(skipped_unknown_uom)} lines skipped (unknown UoM):")
    for s in skipped_unknown_uom[:10]:
        print(f"    line_id={s['line_id']}  product_id={s['product_id']}  "
              f"uom={s['uom']}  metric={s['metric']}")
    if len(skipped_unknown_uom) > 10:
        print(f"    ... and {len(skipped_unknown_uom) - 10} more")
print()

# ── Step 6: Monthly summary before writing ────────────────────────────────────

print("=== Monthly totals across all 23 demo SKUs ===\n")
monthly_ord = defaultdict(float)
monthly_rcv = defaultdict(float)
for (pid, date), v in ordered_agg.items():
    monthly_ord[date[:7]] += v['qty']
for (pid, date), v in received_agg.items():
    monthly_rcv[date[:7]] += v['qty']

all_months = sorted(set(monthly_ord) | set(monthly_rcv))
print(f"  {'Month':>10}  {'PO Ordered (C40)':>18}  {'PO Received (C40)':>19}")
print(f"  {'-'*10}  {'-'*18}  {'-'*19}")
for m in all_months:
    print(f"  {m}  {monthly_ord.get(m, 0):>18,.1f}  {monthly_rcv.get(m, 0):>19,.1f}")
print()

# ── Step 7: Build output rows ─────────────────────────────────────────────────

out_rows = []
for (pid, date), v in ordered_agg.items():
    out_rows.append({
        'product_id':       pid,
        'ssot_label':       SSOT_PO_ORD,
        'metric':           'purchases_ordered',
        'observation_date': date,
        'quantity':         round(v['qty'], 4),
        'revenue_gtq':      None,
        'source_doc_count': len(v['docs']),
    })
for (pid, date), v in received_agg.items():
    out_rows.append({
        'product_id':       pid,
        'ssot_label':       SSOT_PO_RCV,
        'metric':           'purchases_received',
        'observation_date': date,
        'quantity':         round(v['qty'], 4),
        'revenue_gtq':      None,
        'source_doc_count': len(v['docs']),
    })

print(f"Total rows to write: {len(out_rows)} "
      f"({len(ordered_agg)} ordered + {len(received_agg)} received)\n")

# ── Step 8: Wipe existing purchase rows, insert fresh ─────────────────────────

print(f"Clearing existing purchase rows from {TARGET_TABLE} for 23 demo SKUs...")
for ssot_label in (SSOT_PO_ORD, SSOT_PO_RCV):
    status, body = supa_request(
        'DELETE',
        f'/rest/v1/{TARGET_TABLE}'
        f'?product_id=in.({pid_csv})'
        f'&ssot_label=eq.{ssot_label}',
        prefer='return=minimal',
    )
    if status >= 400:
        raise RuntimeError(f"DELETE {TARGET_TABLE} ssot={ssot_label}: "
                           f"HTTP {status}: {body}")
    print(f"  Cleared {ssot_label}")
print()

print(f"Inserting {len(out_rows)} rows into {TARGET_TABLE}...")
inserted = insert_batch(TARGET_TABLE, out_rows)
print(f"  Inserted {inserted} rows.\n")

# ── Step 9: Verification ──────────────────────────────────────────────────────

print("=== Verification ===\n")

# Re-read from revenue_daily for the acid-test SKU
check_rows = get_all(
    f'/rest/v1/{TARGET_TABLE}'
    f'?select=metric,observation_date,quantity'
    f'&product_id=eq.{ACID_SKU_PID}'
    f'&metric=in.(purchases_ordered,purchases_received)'
    f'&observation_date=gte.{ACID_MONTH}-01'
    f'&observation_date=lte.{ACID_MONTH}-30'
)
month_agg = defaultdict(float)
for r in check_rows:
    month_agg[r['metric']] += float(r['quantity'] or 0)

checks = [
    ('Nov 2024 purchases_ordered  (77201046)', month_agg.get('purchases_ordered', 0),  ACID_ORD_TARGET),
    ('Nov 2024 purchases_received (77201046)', month_agg.get('purchases_received', 0), ACID_RCV_TARGET),
]
all_pass = True
for label, val, target in checks:
    diff = abs(val - target)
    ok   = diff < 0.01
    mark = 'PASS' if ok else 'FAIL'
    print(f"  [{mark}] {label}: got={val:.2f}  target={target:.2f}  Δ={val - target:+.4f}")
    if not ok:
        all_pass = False

print()
if all_pass:
    print("Acid test anchors matched — revenue_daily purchase data is correct.")
else:
    print("WARNING — one or more anchors failed. Do NOT proceed to smoothing script "
          "or ML training until root cause is identified.")

# ── Step 10: Per-SKU coverage summary ────────────────────────────────────────

print("\n=== Per-SKU coverage (months with data) ===\n")
sku_ord_months  = defaultdict(set)
sku_rcv_months  = defaultdict(set)
sku_ord_total   = defaultdict(float)
sku_rcv_total   = defaultdict(float)
for (pid, date), v in ordered_agg.items():
    sku_ord_months[pid].add(date[:7])
    sku_ord_total[pid] += v['qty']
for (pid, date), v in received_agg.items():
    sku_rcv_months[pid].add(date[:7])
    sku_rcv_total[pid] += v['qty']

print(f"  {'SKU':>12}  {'Ordered months':>14}  {'Rcvd months':>11}  "
      f"{'Total Ord (C40)':>16}  {'Total Rcv (C40)':>16}")
print(f"  {'-'*12}  {'-'*14}  {'-'*11}  {'-'*16}  {'-'*16}")
for r in demo_meta:
    pid = r['products_id']
    sku = r['default_code']
    print(f"  {sku:>12}  {len(sku_ord_months[pid]):>14}  {len(sku_rcv_months[pid]):>11}  "
          f"{sku_ord_total[pid]:>16,.1f}  {sku_rcv_total[pid]:>16,.1f}")

print()
print("Next step: python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py")
