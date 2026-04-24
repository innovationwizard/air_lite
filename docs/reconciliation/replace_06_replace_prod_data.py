"""
Step 06 — DESTRUCTIVE — Replace prod rows for SKU 77201046 with Odoo live data.

Tables affected (all filtered by product_id=33 = Supabase's id for SKU 77201046):

  DELETED then INSERTed (children scoped to this product):
    sale_order_lines
    purchase_order_lines
    stock_moves
    stock_quants
    inventory_daily         (will be re-derived later)
    demand_daily            (will be re-derived later)

  UPSERTED (parents — preserve other-product lines on shared orders):
    sale_orders             (by odoo_id)
    purchase_orders         (by odoo_id)

  UPDATED in place:
    products[id=33]         (refresh fields from Odoo active variant 7090)

Ordering matters: we must DELETE child rows before deleting/upserting parents
because of FK constraints. We do not delete parents — we upsert them so
other-SKU lines on the same order remain valid.

Inputs:
  docs/reconciliation/odoo_extract_77201046_latest.json
"""
import os
import json
import time
import urllib.request
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
OUT = Path(f'/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/replace_06_output.json')


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
        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                 'Prefer': 'return=representation,count=exact'},
        method='DELETE')
    with urllib.request.urlopen(req) as r:
        body = json.loads(r.read().decode())
    return len(body) if isinstance(body, list) else 0


def insert_batched(table, rows, prefer='return=minimal'):
    if not rows: return 0
    inserted = 0
    for i in range(0, len(rows), 500):
        batch = rows[i:i+500]
        body = json.dumps(batch).encode()
        req = urllib.request.Request(
            f"{SUPA}/rest/v1/{table}",
            data=body,
            headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                     'Content-Type': 'application/json', 'Prefer': prefer},
            method='POST')
        try:
            with urllib.request.urlopen(req) as r:
                r.read()
            inserted += len(batch)
        except urllib.error.HTTPError as e:
            print(f"   ERROR batch {i//500}: {e.code} — {e.read().decode()[:500]}")
            raise
    return inserted


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


extract = json.loads(EXTRACT.read_text())
print(f"Loaded extract: {EXTRACT.name}")


def odoo_str(v):
    """Odoo returns False for null string/date fields. Convert to None."""
    return v if (v not in (False, '', None)) else None


def odoo_num(v):
    """Odoo returns False for unset numeric fields. Convert to 0."""
    return v if v not in (False, None) else 0


def odoo_bool(v, default=True):
    return bool(v) if v is not None else default

ts0 = time.time()
result = {'started_at': datetime.now().isoformat(), 'phases': []}

# ─── Build lookup maps from current Supabase state ────────────────────────
print("\nBuilding Supabase lookup maps...")
supa_customers = get('/rest/v1/customers?select=id,odoo_id')
cust_oid_to_id = {str(c['odoo_id']): c['id'] for c in supa_customers}
print(f"  customers: {len(cust_oid_to_id)}")

supa_suppliers = get('/rest/v1/suppliers?select=id,odoo_id')
sup_oid_to_id = {str(s['odoo_id']): s['id'] for s in supa_suppliers}
print(f"  suppliers: {len(sup_oid_to_id)}")

supa_warehouses = get('/rest/v1/warehouses?select=id,odoo_id')
wh_oid_to_id = {str(w['odoo_id']): w['id'] for w in supa_warehouses}
print(f"  warehouses: {len(wh_oid_to_id)}")

supa_locations = get('/rest/v1/stock_locations?select=id,odoo_id')
loc_oid_to_id = {str(l['odoo_id']): l['id'] for l in supa_locations if l.get('odoo_id')}
print(f"  stock_locations: {len(loc_oid_to_id)}")

# State mappings (Odoo English → Supabase normalized)
SO_STATE_MAP = {'sale': 'sale', 'done': 'done', 'cancel': 'cancel',
                'draft': 'draft', 'sent': 'draft', 'waiting_for_approval': 'draft'}
PO_STATE_MAP = {'draft': 'draft', 'sent': 'sent', 'to approve': 'draft',
                'purchase': 'purchase', 'done': 'done', 'cancel': 'cancel',
                'waiting_for_approval': 'draft'}
MOVE_STATE_MAP = {'done': 'done', 'cancel': 'cancel', 'confirmed': 'confirmed',
                  'assigned': 'assigned', 'waiting': 'waiting', 'draft': 'draft',
                  'partially_available': 'assigned'}

# ─── Phase A: DELETE child rows for product_id=33 ────────────────────────
print("\n=== Phase A: DELETE existing rows for product_id=33 ===")

deletions = {}
print(f"  DELETE demand_daily WHERE product_id={PRODUCT_ID}...")
deletions['demand_daily'] = delete_where('demand_daily', f'product_id=eq.{PRODUCT_ID}')
print(f"    Deleted {deletions['demand_daily']} rows")

print(f"  DELETE inventory_daily WHERE product_id={PRODUCT_ID}...")
deletions['inventory_daily'] = delete_where('inventory_daily', f'product_id=eq.{PRODUCT_ID}')
print(f"    Deleted {deletions['inventory_daily']} rows")

print(f"  DELETE stock_quants WHERE product_id={PRODUCT_ID}...")
deletions['stock_quants'] = delete_where('stock_quants', f'product_id=eq.{PRODUCT_ID}')
print(f"    Deleted {deletions['stock_quants']} rows")

print(f"  DELETE stock_moves WHERE product_id={PRODUCT_ID}...")
deletions['stock_moves'] = delete_where('stock_moves', f'product_id=eq.{PRODUCT_ID}')
print(f"    Deleted {deletions['stock_moves']} rows")

print(f"  DELETE purchase_order_lines WHERE product_id={PRODUCT_ID}...")
deletions['purchase_order_lines'] = delete_where('purchase_order_lines', f'product_id=eq.{PRODUCT_ID}')
print(f"    Deleted {deletions['purchase_order_lines']} rows")

print(f"  DELETE sale_order_lines WHERE product_id={PRODUCT_ID}...")
deletions['sale_order_lines'] = delete_where('sale_order_lines', f'product_id=eq.{PRODUCT_ID}')
print(f"    Deleted {deletions['sale_order_lines']} rows")

result['phases'].append({'phase': 'A_delete', 'counts': deletions})

# ─── Phase B: UPSERT parents (sale_orders, purchase_orders) ──────────────
print("\n=== Phase B: UPSERT parent orders ===")

# B.1 sale_orders
print("  Building sale_orders rows...")
so_rows = []
for o in extract['sale_order']:
    cust_id = None
    if o.get('partner_id'):
        cust_id = cust_oid_to_id.get(str(o['partner_id'][0]))
    wh_id = None
    if o.get('warehouse_id'):
        wh_id = wh_oid_to_id.get(str(o['warehouse_id'][0]))
    state = SO_STATE_MAP.get(o.get('state'), o.get('state'))
    so_rows.append({
        'odoo_id': str(o['id']),
        'order_ref': (odoo_str(o.get('name')) or '')[:50],
        'customer_id': cust_id,
        'order_date': odoo_str(o.get('date_order')),
        'delivery_date': odoo_str(o.get('commitment_date')),
        'effective_date': odoo_str(o.get('effective_date')),
        'state': state,
        'warehouse_id': wh_id,
        'total': odoo_num(o.get('amount_total')),
        'subtotal': odoo_num(o.get('amount_untaxed')),
        'salesperson': (str(o['user_id'][1])[:100] if o.get('user_id') else None),
        'sales_team': (str(o['team_id'][1])[:100] if o.get('team_id') else None),
        'pricelist': (str(o['pricelist_id'][1])[:50] if o.get('pricelist_id') else None),
    })
print(f"  Upserting {len(so_rows)} sale_orders...")
n = upsert_batched('sale_orders', so_rows, 'odoo_id')
print(f"    Upserted: {n}")

# B.2 purchase_orders
print("  Building purchase_orders rows...")
po_rows = []
for o in extract['purchase_order']:
    sup_id = None
    if o.get('partner_id'):
        sup_id = sup_oid_to_id.get(str(o['partner_id'][0]))
    state = PO_STATE_MAP.get(o.get('state'), o.get('state'))
    po_rows.append({
        'odoo_id': str(o['id']),
        'order_ref': (odoo_str(o.get('name')) or '')[:50],
        'supplier_id': sup_id,
        'order_date': odoo_str(o.get('date_order')),
        'confirmation_date': odoo_str(o.get('date_approve')),
        'expected_delivery': odoo_str(o.get('date_planned')),
        'state': state,
        'total': odoo_num(o.get('amount_total')),
        'currency': 'GTQ',
        'buyer': (str(o['user_id'][1])[:100] if o.get('user_id') else None),
    })
print(f"  Upserting {len(po_rows)} purchase_orders...")
m = upsert_batched('purchase_orders', po_rows, 'odoo_id')
print(f"    Upserted: {m}")

result['phases'].append({'phase': 'B_upsert_parents',
                          'sale_orders_upserted': n, 'purchase_orders_upserted': m})

# ─── Phase C: INSERT child lines (sale + purchase) ──────────────────────
print("\n=== Phase C: INSERT child lines ===")

# Refresh order id maps after upsert
supa_so = get('/rest/v1/sale_orders?select=id,odoo_id')
so_oid_to_id = {str(o['odoo_id']): o['id'] for o in supa_so}
print(f"  sale_orders lookup size: {len(so_oid_to_id)}")

supa_po = get('/rest/v1/purchase_orders?select=id,odoo_id')
po_oid_to_id = {str(o['odoo_id']): o['id'] for o in supa_po}
print(f"  purchase_orders lookup size: {len(po_oid_to_id)}")

# C.1 sale_order_lines
print("  Building sale_order_lines rows...")
sol_rows = []
for l in extract['sale_order_line']:
    so_id = so_oid_to_id.get(str(l['order_id'][0])) if l.get('order_id') else None
    if not so_id:
        continue
    sol_rows.append({
        'order_id': so_id,
        'product_id': PRODUCT_ID,
        'quantity': odoo_num(l.get('product_uom_qty')),
        'delivered_qty': odoo_num(l.get('qty_delivered')),
        'invoiced_qty': odoo_num(l.get('qty_invoiced')),
        'uom': (l['product_uom'][1] if l.get('product_uom') else None),
        'unit_price': odoo_num(l.get('price_unit')),
        'subtotal': odoo_num(l.get('price_subtotal')),
        'discount_pct': odoo_num(l.get('discount')),
    })
print(f"  Inserting {len(sol_rows)} sale_order_lines...")
n_sol = insert_batched('sale_order_lines', sol_rows)
print(f"    Inserted: {n_sol}")

# C.2 purchase_order_lines
print("  Building purchase_order_lines rows...")
pol_rows = []
for l in extract['purchase_order_line']:
    po_id = po_oid_to_id.get(str(l['order_id'][0])) if l.get('order_id') else None
    if not po_id:
        continue
    pol_rows.append({
        'order_id': po_id,
        'product_id': PRODUCT_ID,
        'description': None,
        'quantity': odoo_num(l.get('product_qty')),
        'received_qty': odoo_num(l.get('qty_received')),
        'uom': (l['product_uom'][1] if l.get('product_uom') else None),
        'unit_price': odoo_num(l.get('price_unit')),
        'expected_delivery': odoo_str(l.get('date_planned')),
    })
print(f"  Inserting {len(pol_rows)} purchase_order_lines...")
n_pol = insert_batched('purchase_order_lines', pol_rows)
print(f"    Inserted: {n_pol}")

result['phases'].append({'phase': 'C_insert_lines',
                          'sale_order_lines_inserted': n_sol,
                          'purchase_order_lines_inserted': n_pol})

# ─── Phase D: INSERT stock_moves ────────────────────────────────────────
print("\n=== Phase D: INSERT stock_moves ===")
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
    if uom_label and len(uom_label) > 50:
        uom_label = uom_label[:50]
    origin = odoo_str(m.get('origin'))
    if origin and len(origin) > 255:
        origin = origin[:255]
    picking_ref = odoo_str(m.get('reference'))
    if picking_ref and len(picking_ref) > 100:
        picking_ref = picking_ref[:100]
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
print(f"  Inserting {len(sm_rows)} stock_moves (skipped {sm_skipped_no_loc} with no resolvable location)...")
n_sm = upsert_batched('stock_moves', sm_rows, 'odoo_id')
print(f"    Upserted: {n_sm}")

result['phases'].append({'phase': 'D_stock_moves',
                          'inserted': n_sm, 'skipped_no_location': sm_skipped_no_loc})

# ─── Phase E: INSERT stock_quants ───────────────────────────────────────
print("\n=== Phase E: INSERT stock_quants ===")
sq_rows = []
for q in extract['stock_quant']:
    loc_id = loc_oid_to_id.get(str(q['location_id'][0])) if q.get('location_id') else None
    if not loc_id:
        continue
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

result['phases'].append({'phase': 'E_stock_quants', 'inserted': n_sq})

# ─── Phase F: UPDATE products row ───────────────────────────────────────
print("\n=== Phase F: UPDATE products row ===")
active = next((p for p in extract['product_product'] if p['active']), None)
if active:
    payload = {
        'name': active['name'],
        'cost': active.get('standard_price'),
        'list_price': active.get('list_price'),
        'stock_uom': active['uom_id'][1] if active.get('uom_id') else None,
        'is_active': True,
    }
    print(f"  PATCH products[id={PRODUCT_ID}] payload={payload}")
    patch_one('products', f'id=eq.{PRODUCT_ID}', payload)
    print("    OK")
    result['phases'].append({'phase': 'F_products_update', 'payload': payload})

duration = time.time() - ts0
result['ended_at'] = datetime.now().isoformat()
result['duration_seconds'] = round(duration, 2)
print(f"\n=== DONE in {duration:.1f}s ===")

with open(OUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False, default=str)
print(f"Saved: {OUT}")
