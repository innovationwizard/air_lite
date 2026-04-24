"""
Pre-flight scope check for customers and warehouses odoo_id semantics.

For each Supabase row, verify that odoo_id matches a res.partner.id (customers)
or stock.warehouse.id (warehouses) in Odoo live. Report mismatches.

This is needed before the SKU 77201046 replacement because sale_orders we insert
will FK-reference customers.id and warehouses.id — those must resolve correctly.
"""
import os
import json
import urllib.request
import urllib.parse
import xmlrpc.client
from datetime import datetime
from pathlib import Path

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/replace_01_scope_check_results.json')

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
OURL = os.environ['ODOO_URL']
ODB = os.environ['ODOO_DB']
OUSER = os.environ['ODOO_USERNAME']
OKEY = os.environ['ODOO_API_KEY']

def supa_get(path):
    out = []
    offset = 0
    while True:
        qs = f"{path}{'&' if '?' in path else '?'}offset={offset}&limit=1000"
        req = urllib.request.Request(f"{SUPA}{qs}",
                                     headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
        with urllib.request.urlopen(req) as r:
            batch = json.loads(r.read().decode())
        if not batch: break
        out.extend(batch)
        if len(batch) < 1000: break
        offset += 1000
    return out

# Odoo auth
common = xmlrpc.client.ServerProxy(f'{OURL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(ODB, OUSER, OKEY, {})
models = xmlrpc.client.ServerProxy(f'{OURL}/xmlrpc/2/object', allow_none=True)
def ocall(method, model, *args, **kwargs):
    return models.execute_kw(ODB, uid, OKEY, model, method, list(args), kwargs)

# Customers
supa_customers = supa_get('/rest/v1/customers?select=id,odoo_id,name')
print(f"Supabase customers: {len(supa_customers)}")

# Pull all res.partner ids (active + archived)
partner_ids = ocall('search', 'res.partner', ['|', ['active', '=', True], ['active', '=', False]])
partner_id_set = set(partner_ids)
print(f"Odoo res.partner ids: {len(partner_id_set)}")

cust_resolved = 0
cust_unresolved = []
for c in supa_customers:
    try:
        oid = int(c['odoo_id']) if c.get('odoo_id') else None
    except (ValueError, TypeError):
        oid = None
    if oid and oid in partner_id_set:
        cust_resolved += 1
    else:
        cust_unresolved.append({'supabase_id': c['id'], 'odoo_id': c.get('odoo_id'), 'name': c.get('name')})

print(f"Customers: resolved={cust_resolved}, unresolved={len(cust_unresolved)}")

# Warehouses
supa_wh = supa_get('/rest/v1/warehouses?select=id,odoo_id,name,code')
print(f"\nSupabase warehouses: {len(supa_wh)}")

wh_recs = ocall('search_read', 'stock.warehouse', [], fields=['id', 'name', 'code'])
wh_id_set = {w['id'] for w in wh_recs}
wh_by_id = {w['id']: w for w in wh_recs}
print(f"Odoo stock.warehouse records: {len(wh_id_set)}")

wh_resolved = 0
wh_unresolved = []
for w in supa_wh:
    try:
        oid = int(w['odoo_id']) if w.get('odoo_id') else None
    except (ValueError, TypeError):
        oid = None
    if oid and oid in wh_id_set:
        wh_resolved += 1
    else:
        wh_unresolved.append({'supabase_id': w['id'], 'odoo_id': w.get('odoo_id'), 'name': w.get('name'), 'code': w.get('code')})

print(f"Warehouses: resolved={wh_resolved}, unresolved={len(wh_unresolved)}")

result = {
    'run_at': datetime.now().isoformat(),
    'customers': {
        'supabase_total': len(supa_customers),
        'resolved_to_odoo_partner': cust_resolved,
        'unresolved': len(cust_unresolved),
        'unresolved_samples': cust_unresolved[:10],
    },
    'warehouses': {
        'supabase_total': len(supa_wh),
        'resolved_to_odoo_warehouse': wh_resolved,
        'unresolved': len(wh_unresolved),
        'unresolved_samples': wh_unresolved,
        'odoo_warehouses': wh_recs,
    },
}
with open(OUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False, default=str)
print(f"\nSaved: {OUT}")
