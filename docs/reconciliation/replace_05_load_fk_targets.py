"""
Step 05 — Auto-create missing Supabase FK targets referenced by the Odoo extract.

Reads docs/reconciliation/odoo_extract_77201046_latest.json and ensures every
res.partner, stock.warehouse, and stock.location referenced by the extract
has a matching row in Supabase (by odoo_id). Missing rows are INSERTed with
minimal fields.

Idempotent: safe to re-run. UPSERT-by-odoo_id semantics.
"""
import os
import json
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
KEY = os.environ['SUPABASE_SECRET_KEY']

EXTRACT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_77201046_latest.json')
OUT = Path(f'/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/replace_05_load_fk_targets_output.json')

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

def upsert(table, rows, conflict_col):
    """Batched upsert via PostgREST with Prefer: resolution=merge-duplicates."""
    if not rows: return 0
    inserted = 0
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
            inserted += len(batch)
        except urllib.error.HTTPError as e:
            print(f"  ERROR on batch {i//500}: {e.code} — {e.read().decode()[:300]}")
            raise
    return inserted

extract = json.loads(EXTRACT.read_text())
print(f"Loaded extract from {EXTRACT}")

result = {'run_at': datetime.now().isoformat()}

# --- 1. Customers ---
# Map Odoo res.partner.id → Supabase customer row. INSERT if missing.
print("\n1. Customers...")
odoo_customers = extract['res_partner_customers']
print(f"   Odoo partners in extract: {len(odoo_customers)}")
supa_customers = get('/rest/v1/customers?select=id,odoo_id')
supa_cust_ids = {str(c['odoo_id']) for c in supa_customers}
print(f"   Supabase existing customers: {len(supa_cust_ids)}")

to_upsert = []
for p in odoo_customers:
    oid = str(p['id'])
    row = {
        'odoo_id': oid,
        'name': (p.get('name') or f'Customer {oid}')[:200],
        'email': (p.get('email') or None) if p.get('email') else None,
        'city': (p.get('city') or None),
        'department': None,
        'customer_rank': p.get('customer_rank') or 1,
    }
    to_upsert.append(row)

cnt = upsert('customers', to_upsert, 'odoo_id')
print(f"   Upserted: {cnt}")
result['customers'] = {'odoo_count': len(odoo_customers), 'supabase_before': len(supa_cust_ids), 'upserted': cnt}

# --- 2. Suppliers (if any) ---
print("\n2. Suppliers...")
odoo_suppliers = extract.get('res_partner_suppliers', [])
if odoo_suppliers:
    supa_suppliers = get('/rest/v1/suppliers?select=id,odoo_id')
    supa_sup_ids = {str(s['odoo_id']) for s in supa_suppliers}
    to_upsert_sup = []
    for s in odoo_suppliers:
        oid = str(s['id'])
        to_upsert_sup.append({
            'odoo_id': oid,
            'name': (s.get('name') or f'Supplier {oid}')[:200],
            'lead_time_days': 30,
            'is_active': s.get('active', True),
        })
    cnt = upsert('suppliers', to_upsert_sup, 'odoo_id')
    print(f"   Supabase existing: {len(supa_sup_ids)}, upserted: {cnt}")
    result['suppliers'] = {'odoo_count': len(odoo_suppliers), 'supabase_before': len(supa_sup_ids), 'upserted': cnt}
else:
    print("   None.")
    result['suppliers'] = None

# --- 3. Warehouses ---
print("\n3. Warehouses...")
odoo_warehouses = extract['stock_warehouse']
supa_wh = get('/rest/v1/warehouses?select=id,odoo_id')
supa_wh_ids = {str(w['odoo_id']) for w in supa_wh}
print(f"   Odoo warehouses in extract: {len(odoo_warehouses)}")
print(f"   Supabase existing: {len(supa_wh_ids)}")

to_upsert_wh = []
for w in odoo_warehouses:
    oid = str(w['id'])
    to_upsert_wh.append({
        'odoo_id': oid,
        'name': (w.get('name') or f'Warehouse {oid}')[:200],
        'code': (w.get('code') or None),
    })
cnt = upsert('warehouses', to_upsert_wh, 'odoo_id')
print(f"   Upserted: {cnt}")
result['warehouses'] = {'odoo_count': len(odoo_warehouses), 'supabase_before': len(supa_wh_ids), 'upserted': cnt}

# --- 4. Stock locations ---
print("\n4. Stock locations...")
odoo_locs = extract['stock_location']
supa_locs = get('/rest/v1/stock_locations?select=id,odoo_id,warehouse_id')
supa_loc_ids = {str(l['odoo_id']) for l in supa_locs if l.get('odoo_id')}
print(f"   Odoo locations in extract: {len(odoo_locs)}")
print(f"   Supabase existing: {len(supa_loc_ids)}")

# Need to map Odoo warehouse_id → Supabase warehouses.id for FK
supa_wh_after = get('/rest/v1/warehouses?select=id,odoo_id')
wh_odoo_to_sup = {str(w['odoo_id']): w['id'] for w in supa_wh_after}

# Usage (Odoo) → location_type (Supabase)
USAGE_MAP = {
    'internal': 'internal', 'view': 'view', 'transit': 'transit',
    'production': 'production', 'inventory': 'inventory',
    'supplier': 'supplier', 'customer': 'customer',
}

to_upsert_loc = []
for l in odoo_locs:
    oid = str(l['id'])
    wh_id = None
    if l.get('warehouse_id'):
        wh_id = wh_odoo_to_sup.get(str(l['warehouse_id'][0]))
    to_upsert_loc.append({
        'odoo_id': oid,
        'name': (l.get('complete_name') or l.get('name') or f'Location {oid}')[:200],
        'warehouse_id': wh_id,
        'location_type': USAGE_MAP.get(l.get('usage'), l.get('usage')),
        'is_active': l.get('active', True),
    })
cnt = upsert('stock_locations', to_upsert_loc, 'odoo_id')
print(f"   Upserted: {cnt}")
result['stock_locations'] = {'odoo_count': len(odoo_locs), 'supabase_before': len(supa_loc_ids), 'upserted': cnt}

with open(OUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False, default=str)
print(f"\nSaved: {OUT}")
