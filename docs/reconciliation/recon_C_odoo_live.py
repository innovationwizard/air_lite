"""
Reconciliation C — Live Odoo test environment (suplicentro-2801-27990914.dev.odoo.com)
SKU: 77201046, Months: Nov 2024, Dec 2024

Authenticates via XML-RPC and runs four queries equivalent to A/A'/B/B' from the snapshot:

  A : sum(product_uom_qty)  group by month(date_order)        where state in ('sale','done')
  A': sum(qty_delivered)    group by month(date_order)        where state in ('sale','done')
  B : sum(qty_delivered)    group by month(commitment_date)   where state in ('sale','done') and qty_delivered > 0
  B': sum(product_uom_qty)  group by month(commitment_date)   where state in ('sale','done') and qty_delivered > 0

Notes:
  - In Odoo 17, `effective_date` on sale.order is `effective_date` (delivery confirmation).
  - We also try `commitment_date` and the actual `effective_date` field, whichever is populated.
  - Quantities are read in the *line* UoM (sale.order.line.product_uom). To compare
    apples-to-apples with the app, we convert each line to the product's stock UoM
    using uom.uom factor.

Required env:
  ODOO_URL, ODOO_DB, ODOO_USERNAME, ODOO_API_KEY

Output:
  - recon_C_odoo_live_results.json
  - prints summary
"""
import os
import json
import xmlrpc.client
from collections import defaultdict
from datetime import datetime
from pathlib import Path

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/recon_C_odoo_live_results.json')
SKU = '77201046'

# Load .env / .env.local first so user can place ODOO_API_KEY there
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

URL = os.environ.get('ODOO_URL', 'https://suplicentro-2801-27990914.dev.odoo.com')
DB = os.environ.get('ODOO_DB', 'suplicentro-2801-27990914')
USER = os.environ.get('ODOO_USERNAME', 'integracion@piensom.com')
KEY = os.environ.get('ODOO_API_KEY', '')

if not KEY:
    raise SystemExit(
        "ODOO_API_KEY not set. Add to .env.local:\n"
        "  ODOO_API_KEY=<api-key-from-2026-03-26>\n"
        "Then re-run: python3 docs/reconciliation/recon_C_odoo_live.py"
    )

print(f"Auth → {URL} db={DB} user={USER}")
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(DB, USER, KEY, {})
if not uid:
    raise SystemExit("Auth failed — check ODOO_API_KEY")
print(f"Authenticated, uid={uid}")
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object', allow_none=True)

def call(method, model, *args, **kwargs):
    """Mirror of ml/odoo_explorer.py:call — args are positional args to the Odoo method,
    kwargs are kwargs to the Odoo method (e.g. fields=[...], limit=N)."""
    return models.execute_kw(DB, uid, KEY, model, method, list(args), kwargs)

# Resolve product
prods = call('search_read', 'product.product',
             [['default_code', '=', SKU]],
             fields=['id', 'name', 'default_code', 'uom_id', 'uom_po_id'])
assert len(prods) == 1, f"Expected 1 product for SKU {SKU}, got {len(prods)}"
prod = prods[0]
product_id = prod['id']
stock_uom_id = prod['uom_id'][0]
stock_uom_name = prod['uom_id'][1]
print(f"Product: id={product_id}, name={prod['name']}, stock_uom={stock_uom_name}")

# Load all UoMs in the same category for normalization
uom_recs = call('search_read', 'uom.uom', [], fields=['id', 'name', 'factor', 'category_id'])
uom_factor = {u['id']: float(u['factor']) for u in uom_recs}
uom_name = {u['id']: u['name'] for u in uom_recs}
stock_factor = uom_factor[stock_uom_id]

def to_stock_uom(qty, uom_id):
    """Odoo's uom.factor: how many of this UoM make 1 reference UoM (within category).
    qty_in_stock_uom = qty / factor_uom * factor_stock"""
    f = uom_factor.get(uom_id)
    if not f or uom_id == stock_uom_id:
        return qty
    return qty / f * stock_factor

# Pull all sale.order.line for this product, with order header info
print(f"Fetching sale.order.line for product_id={product_id}...")
fields_line = ['id', 'order_id', 'product_id', 'product_uom_qty', 'qty_delivered',
               'qty_invoiced', 'product_uom']
line_ids = call('search', 'sale.order.line', [['product_id', '=', product_id]])
print(f"Line IDs found: {len(line_ids)}")

# Read in chunks
all_lines = []
chunk = 1000
for i in range(0, len(line_ids), chunk):
    sub = call('read', 'sale.order.line', line_ids[i:i+chunk], fields=fields_line)
    all_lines.extend(sub)
print(f"Lines read: {len(all_lines)}")

# Get unique order_ids and read order headers
order_ids = sorted({l['order_id'][0] for l in all_lines if l.get('order_id')})
print(f"Unique sale.order ids: {len(order_ids)}")
fields_order = ['id', 'name', 'date_order', 'commitment_date', 'effective_date', 'state']
orders = {}
for i in range(0, len(order_ids), chunk):
    sub = call('read', 'sale.order', order_ids[i:i+chunk], fields=fields_order)
    for o in sub:
        orders[o['id']] = o
print(f"Orders read: {len(orders)}")

def mk(dt_str):
    return dt_str[:7] if dt_str else None

def calc(variant, month, normalize=True):
    """All quantities normalized to stock UoM (CAJA40) by default."""
    t = 0.0
    for l in all_lines:
        oid = l['order_id'][0] if l.get('order_id') else None
        o = orders.get(oid, {})
        st = o.get('state')
        if st not in ('sale', 'done'): continue
        qty = float(l.get('product_uom_qty') or 0)
        dqty = float(l.get('qty_delivered') or 0)
        u = l.get('product_uom')
        u_id = u[0] if u else None
        if normalize:
            qty = to_stock_uom(qty, u_id)
            dqty = to_stock_uom(dqty, u_id)
        v = 0.0
        if variant == 'A' and mk(o.get('date_order')) == month: v = qty
        elif variant == 'A_prime' and mk(o.get('date_order')) == month: v = dqty
        elif variant == 'B':
            ed = o.get('effective_date') or o.get('commitment_date')
            if dqty > 0 and mk(ed) == month: v = dqty
        elif variant == 'B_prime':
            ed = o.get('effective_date') or o.get('commitment_date')
            if dqty > 0 and mk(ed) == month: v = qty
        t += v
    return round(t, 4)

# Also try with commitment_date only (Odoo 17 distinction):
def calc_with_date_field(variant, month, date_field, normalize=True):
    t = 0.0
    for l in all_lines:
        oid = l['order_id'][0] if l.get('order_id') else None
        o = orders.get(oid, {})
        st = o.get('state')
        if st not in ('sale', 'done'): continue
        qty = float(l.get('product_uom_qty') or 0)
        dqty = float(l.get('qty_delivered') or 0)
        u = l.get('product_uom')
        u_id = u[0] if u else None
        if normalize:
            qty = to_stock_uom(qty, u_id)
            dqty = to_stock_uom(dqty, u_id)
        v = 0.0
        if variant == 'B' and dqty > 0 and mk(o.get(date_field)) == month: v = dqty
        elif variant == 'B_prime' and dqty > 0 and mk(o.get(date_field)) == month: v = qty
        t += v
    return round(t, 4)

# Build results
result = {
    'source': f'Odoo live ({URL})',
    'odoo_db': DB,
    'odoo_user': USER,
    'odoo_user_uid': uid,
    'run_at': datetime.now().isoformat(),
    'sku': SKU,
    'product': prod,
    'stock_uom': stock_uom_name,
    'stock_uom_id': stock_uom_id,
    'lines_count': len(all_lines),
    'orders_count': len(orders),
    'distinct_states': sorted({o.get('state') for o in orders.values()}),
    'by_month': {},
    'user_declared_ssot': {'2024-11': 6466.25, '2024-12': 6496.50},
}

for m in ['2024-11', '2024-12', '2025-01', '2025-02']:
    result['by_month'][m] = {
        'all_normalized_to_stock_uom': {
            'A_order_quantity': calc('A', m),
            'A_prime_order_delivered': calc('A_prime', m),
            'B_effective_or_commitment_delivered': calc('B', m),
            'B_prime_effective_or_commitment_quantity': calc('B_prime', m),
            'B_using_commitment_date_only': calc_with_date_field('B', m, 'commitment_date'),
            'B_using_effective_date_only': calc_with_date_field('B', m, 'effective_date'),
        },
    }

# Deltas
result['deltas_vs_declared_ssot'] = {}
for m in ['2024-11', '2024-12']:
    ssot = result['user_declared_ssot'][m]
    bm = result['by_month'][m]['all_normalized_to_stock_uom']
    result['deltas_vs_declared_ssot'][m] = {
        'ssot': ssot,
        'B_combined_eff_or_commit': bm['B_effective_or_commitment_delivered'],
        'delta_B_combined': round(ssot - bm['B_effective_or_commitment_delivered'], 4),
        'B_commitment_only': bm['B_using_commitment_date_only'],
        'delta_B_commitment': round(ssot - bm['B_using_commitment_date_only'], 4),
        'B_effective_only': bm['B_using_effective_date_only'],
        'delta_B_effective': round(ssot - bm['B_using_effective_date_only'], 4),
    }

with open(OUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False, default=str)

print(f"\n=== Recon C — Odoo live ===")
print(f"Lines: {len(all_lines)}  Orders: {len(orders)}  States: {result['distinct_states']}")
for m in ['2024-11', '2024-12', '2025-01', '2025-02']:
    bm = result['by_month'][m]['all_normalized_to_stock_uom']
    print(f"\n  {m} (all stock_uom-normalized):")
    print(f"    A={bm['A_order_quantity']:>10.2f}  A'={bm['A_prime_order_delivered']:>10.2f}  B(combined)={bm['B_effective_or_commitment_delivered']:>10.2f}  B'={bm['B_prime_effective_or_commitment_quantity']:>10.2f}")
    print(f"    B(commitment_date)={bm['B_using_commitment_date_only']:>10.2f}   B(effective_date)={bm['B_using_effective_date_only']:>10.2f}")

print(f"\nDeltas vs SSOT:")
for m in ['2024-11', '2024-12']:
    d = result['deltas_vs_declared_ssot'][m]
    print(f"  {m}: SSOT={d['ssot']}  B_combo={d['B_combined_eff_or_commit']} (Δ={d['delta_B_combined']:+.2f})  B_commit={d['B_commitment_only']} (Δ={d['delta_B_commitment']:+.2f})  B_eff={d['B_effective_only']} (Δ={d['delta_B_effective']:+.2f})")

print(f"\nSaved: {OUT}")
