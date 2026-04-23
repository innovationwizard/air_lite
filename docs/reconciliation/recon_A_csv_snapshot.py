"""
Reconciliation A — CSV snapshot (real_data/*_20260303.csv)
SKU: 77201046, Months: Nov 2024, Dec 2024
Produces: recon_A_csv_snapshot_results.json + printed summary.

This is the frozen Odoo export at 2026-03-03. It is the input to scripts/ingest.py.
"""
import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from datetime import datetime

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/real_data')
OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/recon_A_csv_snapshot_results.json')
SKU = '77201046'
MONTHS = ['2024-11', '2024-12', '2025-01', '2025-02']
SALE_DONE_ES = {'Orden de venta', 'Pedido de venta', 'Bloqueado'}

def extract_sku(s):
    m = re.match(r'\[(\w+)\]', s.strip())
    return m.group(1) if m else None

def pd_(s):
    s = (s or '').strip()
    try: return float(s) if s else 0.0
    except: return 0.0

def mk(d): return d[:7] if d else None

# Load UOM ratios
uom = {}
with open(ROOT / 'uom.uom_20260303.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        n = r.get('Unidad de medida', '').strip()
        if n: uom[n] = pd_(r.get('Proporción', '1.0'))

def to_c40(q, u):
    if u == 'CAJA40' or not u: return q
    ru = uom.get(u); rc = uom.get('CAJA40', 0.025)
    if not ru: return q
    return q * rc / ru

# Load orders
orders = {}
with open(ROOT / 'sale.order_20260303.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        ref = r['Referencia de la orden'].strip()
        if ref:
            orders[ref] = {
                'od': r['Fecha de la orden'].strip(),
                'ed': r['Fecha efectiva'].strip(),
                'state': r['Estado'].strip(),
            }

# Load lines
lines = []
cur = None
with open(ROOT / 'sale.order.line_20260303.csv', 'r', encoding='utf-8') as f:
    for r in csv.DictReader(f):
        rid = r.get('ID', '').strip()
        ref = r.get('Referencia de la orden', '').strip()
        if rid: cur = ref
        if extract_sku(r.get('Líneas de la orden/Plantilla del producto', '').strip()) != SKU:
            continue
        if cur not in orders: continue
        o = orders[cur]
        lines.append({
            'ref': cur, 'od': o['od'], 'ed': o['ed'], 'state': o['state'],
            'qty': pd_(r.get('Líneas de la orden/Cantidad', '')),
            'dqty': pd_(r.get('Líneas de la orden/Cantidad de entrega', '')),
            'uom': r.get('Líneas de la orden/Unidad de medida', '').strip(),
        })

def calc(variant, month, normalize=False):
    t = 0.0
    for l in lines:
        if l['state'] not in SALE_DONE_ES: continue
        v = 0.0
        if variant == 'A' and mk(l['od']) == month: v = l['qty']
        elif variant == 'A_prime' and mk(l['od']) == month: v = l['dqty']
        elif variant == 'B' and l['dqty'] > 0 and mk(l['ed']) == month: v = l['dqty']
        elif variant == 'B_prime' and l['dqty'] > 0 and mk(l['ed']) == month: v = l['qty']
        if normalize: v = to_c40(v, l['uom'])
        t += v
    return round(t, 4)

# stock.move analysis
def stock_move_flows(month):
    to_cust, from_cust = 0.0, 0.0
    with open(ROOT / 'stock.move_2024.csv', 'r', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            if extract_sku(r.get('Producto', '').strip()) != SKU: continue
            if r.get('Estado', '').strip() not in ('Hecho', 'done'): continue
            if mk(r.get('Fecha', '').strip()) != month: continue
            q = to_c40(pd_(r.get('Cantidad', '')), r.get('Unidad de medida', '').strip())
            frm = r.get('Desde', '').strip()
            to = r.get('A', '').strip()
            if 'Partners/Customers' in to and 'Partners/Customers' not in frm:
                to_cust += q
            if 'Partners/Customers' in frm and 'Partners/Customers' not in to:
                from_cust += q
    return round(to_cust, 4), round(from_cust, 4)

results = {
    'source': 'CSV snapshot (real_data/*_20260303.csv)',
    'snapshot_date': '2026-03-03',
    'sku': SKU,
    'product_name': 'VASO DUROPORT No. 10 REYMA 40-25',
    'sales_uom': 'CAJA40',
    'uom_ratio_PAQ_CJ_to_CAJA40': 0.025,
    'run_at': datetime.now().isoformat(),
    'total_lines_for_sku': len(lines),
    'lines_by_uom': dict(defaultdict(int, ((u, sum(1 for l in lines if l['uom'] == u)) for u in set(l['uom'] for l in lines)))),
    'by_month': {},
}

for m in MONTHS:
    to_c, from_c = stock_move_flows(m) if m.startswith('2024') else (None, None)
    results['by_month'][m] = {
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
        'stock_move_customer_flow_CAJA40_normalized': {
            'to_customer_shipments': to_c,
            'from_customer_returns': from_c,
            'net_to_customer': round((to_c - from_c), 4) if to_c is not None else None,
        } if to_c is not None else None,
    }

# User's claimed SSOT
results['user_declared_ssot'] = {
    '2024-11': 6466.25,
    '2024-12': 6496.50,
}

# Deltas
results['deltas_vs_declared_ssot'] = {}
for m in ['2024-11', '2024-12']:
    ssot = results['user_declared_ssot'][m]
    b = results['by_month'][m]['sale_order_lines_raw']['B_effective_delivered']
    b_norm = results['by_month'][m]['sale_order_lines_uom_normalized_to_CAJA40']['B_normalized']
    sm_net = results['by_month'][m]['stock_move_customer_flow_CAJA40_normalized']['net_to_customer']
    results['deltas_vs_declared_ssot'][m] = {
        'ssot': ssot,
        'B_raw': b, 'delta_B_raw': round(ssot - b, 4),
        'B_normalized': b_norm, 'delta_B_norm': round(ssot - b_norm, 4),
        'stock_move_net': sm_net, 'delta_sm_net': round(ssot - sm_net, 4),
    }

with open(OUT, 'w') as f:
    json.dump(results, f, indent=2, ensure_ascii=False)

print(f"Recon A — CSV snapshot — SKU {SKU}")
print(f"Lines: {len(lines)}, UoMs: {results['lines_by_uom']}")
print(f"\nSSOT declared: Nov={results['user_declared_ssot']['2024-11']}, Dec={results['user_declared_ssot']['2024-12']}")
print(f"\nMonth-by-month:")
for m in MONTHS:
    print(f"\n  {m}:")
    raw = results['by_month'][m]['sale_order_lines_raw']
    norm = results['by_month'][m]['sale_order_lines_uom_normalized_to_CAJA40']
    print(f"    sale.order.line raw:        A={raw['A_order_quantity']:>10.2f}  A'={raw['A_prime_order_delivered']:>10.2f}  B={raw['B_effective_delivered']:>10.2f}  B'={raw['B_prime_effective_quantity']:>10.2f}")
    print(f"    sale.order.line UoM-norm:   A={norm['A_normalized']:>10.2f}  A'={norm['A_prime_normalized']:>10.2f}  B={norm['B_normalized']:>10.2f}  B'={norm['B_prime_normalized']:>10.2f}")
    if results['by_month'][m]['stock_move_customer_flow_CAJA40_normalized']:
        sm = results['by_month'][m]['stock_move_customer_flow_CAJA40_normalized']
        print(f"    stock.move customer:        to={sm['to_customer_shipments']:>10.2f}  from={sm['from_customer_returns']:>10.2f}  net={sm['net_to_customer']:>10.2f}")

print(f"\nDeltas vs SSOT declared:")
for m in ['2024-11', '2024-12']:
    d = results['deltas_vs_declared_ssot'][m]
    print(f"  {m}: SSOT={d['ssot']}  |  B_raw={d['B_raw']} (Δ={d['delta_B_raw']:+.2f})  |  B_norm={d['B_normalized']} (Δ={d['delta_B_norm']:+.2f})  |  sm_net={d['stock_move_net']} (Δ={d['delta_sm_net']:+.2f})")

print(f"\nSaved: {OUT}")
