"""
Reconciliation B — Production Supabase DB (plirrpkasyytpgzwwztl.supabase.co)
SKU: 77201046, Months: Nov 2024, Dec 2024

Queries sale_orders + sale_order_lines directly via PostgREST.
Compares to the 4 definitions and to the user-declared SSOT.
Also queries demand_daily (which aggregate_demand_daily() populates) and stock_moves.

Produces: recon_B_prod_supabase_results.json + printed summary.
"""
import os
import json
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

# Load env
def load_env():
    env = {}
    for f in ['/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env.local',
              '/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/.env']:
        p = Path(f)
        if not p.exists(): continue
        for line in p.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith('#'): continue
            if '=' in line:
                k, v = line.split('=', 1)
                env[k.strip()] = v.strip()
    return env

env = load_env()
URL = env['NEXT_PUBLIC_SUPABASE_URL']
KEY = env['SUPABASE_SERVICE_ROLE_KEY']

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/recon_B_prod_supabase_results.json')
SKU = '77201046'
SALE_DONE = ('sale', 'done')


def http_get(path, params=None):
    q = ('?' + urllib.parse.urlencode(params, doseq=True)) if params else ''
    req = urllib.request.Request(
        f"{URL}{path}{q}",
        headers={
            'apikey': KEY, 'Authorization': f'Bearer {KEY}',
            'Accept': 'application/json', 'Prefer': 'count=exact',
        })
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

def http_post_rpc(name, payload):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        f"{URL}/rest/v1/rpc/{name}",
        data=body,
        headers={
            'apikey': KEY, 'Authorization': f'Bearer {KEY}',
            'Content-Type': 'application/json', 'Accept': 'application/json',
        }, method='POST')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read().decode())

# Resolve product
print(f"Looking up product SKU={SKU}...")
products = http_get('/rest/v1/products', {'sku': f'eq.{SKU}', 'select': 'id,odoo_id,sku,name,stock_uom'})
assert len(products) == 1, f"Expected 1 product, got {len(products)}"
prod = products[0]
product_id = prod['id']
print(f"Product: id={product_id}, name={prod['name']}, stock_uom={prod['stock_uom']}, odoo_id={prod['odoo_id']}")

# Page through sale_order_lines for this product, joining orders for date + state
# PostgREST supports embedded resource; we'll use the `sale_orders(…)` join.
print(f"Fetching all sale_order_lines for product_id={product_id}...")
lines = []
offset = 0
page = 1000
while True:
    batch = http_get('/rest/v1/sale_order_lines', {
        'product_id': f'eq.{product_id}',
        'select': 'id,quantity,delivered_qty,invoiced_qty,uom,unit_price,subtotal,sale_orders(order_date,effective_date,state,order_ref)',
        'order': 'id.asc',
        'offset': str(offset),
        'limit': str(page),
    })
    if not batch: break
    lines.extend(batch)
    if len(batch) < page: break
    offset += page
print(f"Total lines: {len(lines)}")

# UoM ratios
uoms = http_get('/rest/v1/units_of_measure', {'select': 'name,ratio'})
uom_ratio = {u['name']: float(u['ratio']) for u in uoms if u.get('name')}

def to_c40(q, u):
    if u == 'CAJA40' or not u: return q
    ru = uom_ratio.get(u)
    rc = uom_ratio.get('CAJA40', 0.025)
    if not ru: return q
    return q * rc / ru

def mk(dt_str):
    return dt_str[:7] if dt_str else None

def calc(variant, month, normalize=False):
    t = 0.0
    for l in lines:
        o = l.get('sale_orders') or {}
        st = o.get('state')
        if st not in SALE_DONE: continue
        qty = float(l.get('quantity') or 0)
        dqty = float(l.get('delivered_qty') or 0)
        v = 0.0
        if variant == 'A' and mk(o.get('order_date')) == month: v = qty
        elif variant == 'A_prime' and mk(o.get('order_date')) == month: v = dqty
        elif variant == 'B' and dqty > 0 and mk(o.get('effective_date')) == month: v = dqty
        elif variant == 'B_prime' and dqty > 0 and mk(o.get('effective_date')) == month: v = qty
        if normalize: v = to_c40(v, l.get('uom', '') or '')
        t += v
    return round(t, 4)

# Query demand_daily for this product — this is what the backtest actually consumes
print("Querying demand_daily aggregation...")
dd = http_get('/rest/v1/demand_daily', {
    'product_id': f'eq.{product_id}',
    'select': 'demand_date,quantity_sold,revenue,is_censored,orders_count',
    'order': 'demand_date.asc',
})
print(f"demand_daily rows for product: {len(dd)}")

dd_by_month = {}
for r in dd:
    m = r['demand_date'][:7]
    dd_by_month.setdefault(m, {'qty': 0.0, 'revenue': 0.0, 'days': 0, 'censored_days': 0})
    dd_by_month[m]['qty'] += float(r['quantity_sold'] or 0)
    dd_by_month[m]['revenue'] += float(r['revenue'] or 0)
    dd_by_month[m]['days'] += 1
    if r['is_censored']:
        dd_by_month[m]['censored_days'] += 1

# Query stock_moves customer flow
print("Querying stock_moves customer flow Nov/Dec 2024...")
# We need location_type info; query separately
locs = http_get('/rest/v1/stock_locations', {'select': 'id,name,location_type,warehouse_id'})
loc_map = {l['id']: l for l in locs}

def mv_customer_flow(month_start, month_end):
    """Fetch done moves for product in date range, compute to/from customer."""
    mvs = []
    offset = 0
    while True:
        batch = http_get('/rest/v1/stock_moves', {
            'product_id': f'eq.{product_id}',
            'state': 'eq.done',
            'move_date': f'gte.{month_start}',
            'move_date': f'lt.{month_end}',
            'select': 'id,quantity,uom,from_location_id,to_location_id,move_date',
            'order': 'id.asc',
            'offset': str(offset),
            'limit': str(page),
        })
        if not batch: break
        mvs.extend(batch)
        if len(batch) < page: break
        offset += page
    return mvs

def month_range(month):
    y, m = map(int, month.split('-'))
    start = f"{y}-{m:02d}-01"
    ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
    end = f"{ny}-{nm:02d}-01"
    return start, end

sm_by_month = {}
for m in ['2024-11', '2024-12']:
    # Workaround: urllib encodes same key twice via doseq, so pass a ranged param differently
    start, end = month_range(m)
    # Build custom query string with dual move_date filters
    qs = urllib.parse.urlencode([
        ('product_id', f'eq.{product_id}'),
        ('state', 'eq.done'),
        ('move_date', f'gte.{start}'),
        ('move_date', f'lt.{end}'),
        ('select', 'id,quantity,uom,from_location_id,to_location_id,move_date'),
        ('order', 'id.asc'),
    ])
    mvs = []
    offset = 0
    while True:
        req = urllib.request.Request(
            f"{URL}/rest/v1/stock_moves?{qs}&offset={offset}&limit={page}",
            headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
        with urllib.request.urlopen(req) as r:
            batch = json.loads(r.read().decode())
        if not batch: break
        mvs.extend(batch)
        if len(batch) < page: break
        offset += page

    to_cust, from_cust = 0.0, 0.0
    for mv in mvs:
        frm = loc_map.get(mv['from_location_id'], {})
        to = loc_map.get(mv['to_location_id'], {})
        frm_type = frm.get('location_type')
        to_type = to.get('location_type')
        qn = to_c40(float(mv['quantity']), mv.get('uom', '') or '')
        if to_type == 'customer' and frm_type != 'customer':
            to_cust += qn
        if frm_type == 'customer' and to_type != 'customer':
            from_cust += qn
    sm_by_month[m] = {'moves': len(mvs), 'to_customer': round(to_cust, 4), 'from_customer': round(from_cust, 4),
                      'net': round(to_cust - from_cust, 4)}

# Build final result
result = {
    'source': f'Supabase prod DB ({URL})',
    'run_at': datetime.now().isoformat(),
    'sku': SKU,
    'product': prod,
    'total_sale_order_lines': len(lines),
    'uoms_used': sorted(set(l.get('uom') or '' for l in lines)),
    'by_month': {},
    'demand_daily_aggregated': dd_by_month,
    'stock_moves_customer_flow': sm_by_month,
    'user_declared_ssot': {'2024-11': 6466.25, '2024-12': 6496.50},
}

for m in ['2024-11', '2024-12', '2025-01', '2025-02']:
    result['by_month'][m] = {
        'sale_order_lines_raw': {
            'A_order_quantity': calc('A', m),
            'A_prime_order_delivered': calc('A_prime', m),
            'B_effective_delivered': calc('B', m),
            'B_prime_effective_quantity': calc('B_prime', m),
        },
        'sale_order_lines_uom_normalized_to_CAJA40': {
            'A_normalized': calc('A', m, True),
            'A_prime_normalized': calc('A_prime', m, True),
            'B_normalized': calc('B', m, True),
            'B_prime_normalized': calc('B_prime', m, True),
        },
    }

# Deltas
result['deltas_vs_declared_ssot'] = {}
for m in ['2024-11', '2024-12']:
    ssot = result['user_declared_ssot'][m]
    b = result['by_month'][m]['sale_order_lines_raw']['B_effective_delivered']
    b_norm = result['by_month'][m]['sale_order_lines_uom_normalized_to_CAJA40']['B_normalized']
    dd_qty = dd_by_month.get(m, {}).get('qty', 0)
    sm_net = sm_by_month.get(m, {}).get('net')
    result['deltas_vs_declared_ssot'][m] = {
        'ssot': ssot,
        'B_raw': b, 'delta_B_raw': round(ssot - b, 4),
        'B_norm': b_norm, 'delta_B_norm': round(ssot - b_norm, 4),
        'demand_daily': round(dd_qty, 4), 'delta_dd': round(ssot - dd_qty, 4),
        'stock_move_net': sm_net, 'delta_sm': round(ssot - sm_net, 4) if sm_net is not None else None,
    }

with open(OUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False, default=str)

# Print summary
print(f"\n=== Recon B — Supabase prod DB ===")
print(f"Product: {prod['name']}  (id={product_id}, stock_uom={prod['stock_uom']})")
print(f"sale_order_lines: {len(lines)}   UoMs used: {result['uoms_used']}")
for m in ['2024-11', '2024-12', '2025-01', '2025-02']:
    print(f"\n  {m}:")
    raw = result['by_month'][m]['sale_order_lines_raw']
    norm = result['by_month'][m]['sale_order_lines_uom_normalized_to_CAJA40']
    dd_m = dd_by_month.get(m, {})
    sm = sm_by_month.get(m, {})
    print(f"    raw sale_order_lines:  A={raw['A_order_quantity']:>10.2f}  A'={raw['A_prime_order_delivered']:>10.2f}  B={raw['B_effective_delivered']:>10.2f}  B'={raw['B_prime_effective_quantity']:>10.2f}")
    print(f"    UoM-norm sale lines:   A={norm['A_normalized']:>10.2f}  A'={norm['A_prime_normalized']:>10.2f}  B={norm['B_normalized']:>10.2f}  B'={norm['B_prime_normalized']:>10.2f}")
    print(f"    demand_daily agg:      qty={dd_m.get('qty', 0):>10.2f}  rev={dd_m.get('revenue', 0):>10.2f}  days={dd_m.get('days', 0)}  censored={dd_m.get('censored_days', 0)}")
    if sm:
        print(f"    stock_moves customer:  to={sm['to_customer']:>10.2f}  from={sm['from_customer']:>10.2f}  net={sm['net']:>10.2f}  ({sm['moves']} moves)")

print(f"\nDeltas vs SSOT:")
for m in ['2024-11', '2024-12']:
    d = result['deltas_vs_declared_ssot'][m]
    print(f"  {m}: SSOT={d['ssot']}  B_raw={d['B_raw']} (Δ={d['delta_B_raw']:+.2f})  B_norm={d['B_norm']} (Δ={d['delta_B_norm']:+.2f})  dd={d['demand_daily']} (Δ={d['delta_dd']:+.2f})  sm_net={d['stock_move_net']} (Δ={d['delta_sm']})")

print(f"\nSaved: {OUT}")
