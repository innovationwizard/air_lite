"""
Step 06b — Resume replacement at Phase D (stock_moves), E (stock_quants), F (products UPDATE).

Phases A-C of replace_06_replace_prod_data.py succeeded:
  A — deletes (6157 sale_order_lines, 8147 stock_moves, 12 stock_quants, 101 PO lines, 423 dd, 3114 inv)
  B — upserts (5712 sale_orders, 88 purchase_orders)
  C — inserts (5741 sale_order_lines, 91 purchase_order_lines)

Phase D failed mid-batch on VARCHAR(100) overflow. This script resumes from
D with the truncation fix applied.

Note: stock_moves is empty for product_id=33 right now (Phase A deleted them
and Phase D failed on first batch with 0 successful inserts). Safe to re-insert.
"""
import os
import json
import time
import urllib.request
import urllib.error
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
EXTRACT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_77201046_latest.json')

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

def delete_where(table, query):
    req = urllib.request.Request(
        f"{SUPA}/rest/v1/{table}?{query}",
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Prefer': 'return=representation'},
        method='DELETE')
    with urllib.request.urlopen(req) as r:
        body = json.loads(r.read().decode())
    return len(body) if isinstance(body, list) else 0

def upsert_batched(table, rows, conflict_col):
    if not rows: return 0
    upserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        body = json.dumps(batch).encode()
        req = urllib.request.Request(
            f"{SUPA}/rest/v1/{table}?on_conflict={conflict_col}",
            data=body,
            headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                     'Content-Type': 'application/json',
                     'Prefer': 'resolution=merge-duplicates,return=minimal'},
            method='POST')
        try:
            with urllib.request.urlopen(req) as r:
                r.read()
            upserted += len(batch)
        except urllib.error.HTTPError as e:
            print(f"   ERROR upsert batch {i//500}: {e.code} — {e.read().decode()[:500]}")
            raise
    return upserted

def patch_one(table, query, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{SUPA}/rest/v1/{table}?{query}",
        data=body,
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                 'Content-Type': 'application/json',
                 'Prefer': 'return=minimal'},
        method='PATCH')
    with urllib.request.urlopen(req) as r:
        return r.read()

def odoo_str(v):
    return v if (v not in (False, '', None)) else None
def odoo_num(v):
    return v if v not in (False, None) else 0

extract = json.loads(EXTRACT.read_text())
print(f"Loaded extract: {EXTRACT.name}")

supa_locations = get('/rest/v1/stock_locations?select=id,odoo_id')
loc_oid_to_id = {str(l['odoo_id']): l['id'] for l in supa_locations if l.get('odoo_id')}
print(f"Locations: {len(loc_oid_to_id)}")

MOVE_STATE_MAP = {'done': 'done', 'cancel': 'cancel', 'confirmed': 'confirmed',
                  'assigned': 'assigned', 'waiting': 'waiting', 'draft': 'draft',
                  'partially_available': 'assigned'}

# Ensure stock_moves and stock_quants for product_id=33 are empty before re-insert
print(f"\nClearing any partial stock_moves/quants for product_id={PRODUCT_ID}...")
n = delete_where('stock_moves', f'product_id=eq.{PRODUCT_ID}')
print(f"  Deleted {n} stock_moves (should be 0 if Phase D failed cleanly on batch 1)")
n = delete_where('stock_quants', f'product_id=eq.{PRODUCT_ID}')
print(f"  Deleted {n} stock_quants")

# === Phase D: stock_moves ===
print("\n=== Phase D: INSERT stock_moves (with truncation fix) ===")
sm_rows = []
sm_skipped_no_loc = 0
for m in extract['stock_move']:
    from_loc_id = loc_oid_to_id.get(str(m['location_id'][0])) if m.get('location_id') else None
    to_loc_id = loc_oid_to_id.get(str(m['location_dest_id'][0])) if m.get('location_dest_id') else None
    if from_loc_id is None and to_loc_id is None:
        sm_skipped_no_loc += 1
        continue
    state = MOVE_STATE_MAP.get(m.get('state'), m.get('state'))
    uom_label = (m['product_uom'][1] if m.get('product_uom') else None)
    if uom_label and len(uom_label) > 50: uom_label = uom_label[:50]
    origin = odoo_str(m.get('origin'))
    if origin and len(origin) > 255: origin = origin[:255]
    picking_ref = odoo_str(m.get('reference'))
    if picking_ref and len(picking_ref) > 100: picking_ref = picking_ref[:100]
    sm_rows.append({
        'odoo_id': str(m['id']),
        'product_id': PRODUCT_ID,
        'quantity': odoo_num(m.get('quantity')) or odoo_num(m.get('product_uom_qty')),
        'uom': uom_label,
        'from_location_id': from_loc_id,
        'to_location_id': to_loc_id,
        'move_date': odoo_str(m.get('date')),
        'state': (state or 'draft')[:20],
        'origin': origin,
        'picking_ref': picking_ref,
    })
print(f"  Inserting {len(sm_rows)} stock_moves (skipped {sm_skipped_no_loc} no-location)...")
n_sm = upsert_batched('stock_moves', sm_rows, 'odoo_id')
print(f"    Upserted: {n_sm}")

# === Phase E: stock_quants ===
print("\n=== Phase E: INSERT stock_quants ===")
sq_rows = []
for q in extract['stock_quant']:
    loc_id = loc_oid_to_id.get(str(q['location_id'][0])) if q.get('location_id') else None
    if not loc_id: continue
    sq_rows.append({
        'odoo_id': str(q['id']),
        'product_id': PRODUCT_ID,
        'location_id': loc_id,
        'quantity': odoo_num(q.get('quantity')),
        'reserved_qty': odoo_num(q.get('reserved_quantity')),
        'entry_date': odoo_str(q.get('in_date')),
        'uom': (q['product_uom_id'][1] if q.get('product_uom_id') else None),
        'snapshot_date': datetime.now().date().isoformat(),
    })
print(f"  Inserting {len(sq_rows)} stock_quants...")
n_sq = upsert_batched('stock_quants', sq_rows, 'odoo_id')
print(f"    Upserted: {n_sq}")

# === Phase F: products UPDATE ===
print("\n=== Phase F: UPDATE products row ===")
active = next((p for p in extract['product_product'] if p['active']), None)
if active:
    payload = {
        'name': active['name'],
        'cost': odoo_num(active.get('standard_price')),
        'list_price': odoo_num(active.get('list_price')),
        'stock_uom': active['uom_id'][1] if active.get('uom_id') else None,
        'is_active': True,
    }
    print(f"  PATCH products[id={PRODUCT_ID}]: {payload}")
    patch_one('products', f'id=eq.{PRODUCT_ID}', payload)
    print("  OK")
print("\nDONE.")
