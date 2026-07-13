"""
Load the 982 purchase_order_lines rows present in the Odoo CSV export but
missing from Supabase.

SCOPE
-----
Source: real_data/purchase.order.line_20260303.csv
Target: Supabase `purchase_order_lines`

WHY
---
The Supabase import was incomplete. The CSV has 20,540 rows; Supabase has
16,159. The gap consists of:
  - 982 rows that ARE resolvable (known SKU → products.id) but not loaded
  - 1,418 rows with [0] SKU (no internal code in Odoo) — cannot load
  - 1,191 rows with barcode/unknown prefix — cannot load

This script loads only the 982 resolvable rows.

DEDUP STRATEGY
--------------
No odoo_id column in purchase_order_lines. Natural key used:
  (order_id, description, expected_delivery)
Any row with this triple already in Supabase is skipped.

NOTE ON RED-TIER DEMO SKUS
--------------------------
The CSV export confirms that the red-tier demo SKUs (77205001, 77205287,
etc.) have zero purchase.order.line records after Nov 2024 in Odoo. Their
procurement flows through stock.picking "Recibidos Internacional", not
through standard POs. Loading this script does NOT fix po_history_real_months
for those SKUs — that requires a separate stock_moves-based SSOT.

IDEMPOTENT — safe to re-run.
"""

import csv, json, os, re, sys, time, urllib.request, urllib.error
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
KEY  = os.environ['SUPABASE_SECRET_KEY']
CSV_PATH = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/real_data/purchase.order.line_20260303.csv')

SKU_RE = re.compile(r'^\[([^\]]+)\]')

# ── helpers ───────────────────────────────────────────────────────────────────

def supa_get_all(path_base: str) -> list:
    rows, offset, limit = [], 0, 1000
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


def insert_batch(table: str, rows: list, batch_size: int = 200) -> int:
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
                f'INSERT {table} batch {i // batch_size}: HTTP {e.code}: {e.read().decode()[:400]}'
            )
        inserted += len(batch)
    return inserted


# ── Step 1: Build lookups ──────────────────────────────────────────────────────

print('Loading reference data from Supabase…')

products = supa_get_all('/rest/v1/products?select=id,sku')
sku_to_pid: dict[str, int] = {p['sku'].strip(): p['id'] for p in products if p.get('sku')}
print(f'  products: {len(sku_to_pid)} SKUs loaded')

po_rows = supa_get_all('/rest/v1/purchase_orders?select=id,order_ref')
ref_to_id: dict[str, int] = {r['order_ref'].strip(): r['id'] for r in po_rows}
print(f'  purchase_orders: {len(ref_to_id)} refs loaded')

existing_pol = supa_get_all(
    '/rest/v1/purchase_order_lines?select=order_id,description,expected_delivery'
)
existing_keys: set[tuple] = set()
for r in existing_pol:
    key = (
        r['order_id'],
        (r['description'] or '').strip(),
        str(r['expected_delivery'] or '')[:10],
    )
    existing_keys.add(key)
print(f'  existing purchase_order_lines: {len(existing_keys)} unique keys')

# ── Step 2: Walk CSV and collect new rows ──────────────────────────────────────

print('\nScanning CSV…')

skipped_existing = skipped_no_order = skipped_no_sku = skipped_null_sku = 0
new_rows: list[dict] = []

with open(CSV_PATH, encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        order_ref = (row.get('Líneas de la orden/Referencia de la orden') or '').strip()
        desc      = (row.get('Líneas de la orden/Descripción') or '').strip()
        exp_del   = (row.get('Líneas de la orden/Entrega esperada') or '')[:10]
        qty_str   = (row.get('Líneas de la orden/Cantidad') or '0').replace(',', '.')
        rcv_str   = (row.get('Líneas de la orden/Cantidad recibida') or '0').replace(',', '.')
        uom       = (row.get('Líneas de la orden/Unidad de medida') or '').strip()
        price_str = (row.get('Líneas de la orden/Precio unitario') or '0').replace(',', '.')

        # Resolve order
        order_id = ref_to_id.get(order_ref)
        if order_id is None:
            skipped_no_order += 1
            continue

        # Check existing
        key = (order_id, desc, exp_del)
        if key in existing_keys:
            skipped_existing += 1
            continue

        # Resolve product
        m = SKU_RE.match(desc)
        if not m:
            skipped_no_sku += 1
            continue
        sku = m.group(1)
        if sku == '0':
            skipped_null_sku += 1
            continue
        product_id = sku_to_pid.get(sku)
        if product_id is None:
            skipped_no_sku += 1
            continue

        try:
            qty = float(qty_str) if qty_str else 0.0
            rcv = float(rcv_str) if rcv_str else 0.0
            price = float(price_str) if price_str else 0.0
        except ValueError:
            skipped_no_sku += 1
            continue

        new_rows.append({
            'order_id':        order_id,
            'product_id':      product_id,
            'description':     desc,
            'quantity':        qty,
            'received_qty':    rcv,
            'uom':             uom,
            'unit_price':      price,
            'expected_delivery': exp_del if exp_del else None,
        })

print(f'  Skipped (already in Supabase): {skipped_existing}')
print(f'  Skipped (order not in Supabase): {skipped_no_order}')
print(f'  Skipped ([0] SKU — no internal code): {skipped_null_sku}')
print(f'  Skipped (barcode/unknown SKU): {skipped_no_sku}')
print(f'  NEW rows to insert: {len(new_rows)}')

if not new_rows:
    print('\nNothing to insert — table is up to date.')
    sys.exit(0)

# ── Step 3: Insert ─────────────────────────────────────────────────────────────

print(f'\nInserting {len(new_rows)} rows in batches of 200…')
t0 = time.time()
inserted = insert_batch('purchase_order_lines', new_rows)
elapsed = time.time() - t0
print(f'  Inserted {inserted} rows in {elapsed:.1f}s')

# ── Step 4: Verification ───────────────────────────────────────────────────────

print('\nVerification…')
req = urllib.request.Request(
    f'{SUPA}/rest/v1/purchase_order_lines?select=id',
    headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
             'Prefer': 'count=exact', 'Range': '0-0'},
    method='GET',
)
with urllib.request.urlopen(req) as r:
    cr = r.headers.get('Content-Range', '')
total_after = int(cr.split('/')[-1]) if '/' in cr else '?'
print(f'  purchase_order_lines total after insert: {total_after}')
print(f'  Expected: {len(existing_keys) + inserted}')
print('Done.')
