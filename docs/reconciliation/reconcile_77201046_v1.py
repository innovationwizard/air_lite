"""
Reconciliation for SKU 77201046 (VASO DUROPORT No. 10 REYMA 40-25) — Nov/Dec 2024.
SSOT claimed by user: Nov 2024 = 6466.25, Dec 2024 = 6496.50.
App shows: A=6851/6653, A'=6706/6296, B=6361/6301, B'=6360/6384 (integer rounded).
Goal: reproduce numbers and find what filter yields SSOT values.
"""
import csv
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/real_data')
SKU_TARGET = '77201046'

# Load sale_orders into dict: order_ref -> dict(order_date, effective_date, state, delivery_state)
orders = {}
with open(ROOT / 'sale.order_20260303.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        ref = row['Referencia de la orden'].strip()
        if not ref:
            continue
        orders[ref] = {
            'order_date': row['Fecha de la orden'].strip(),
            'effective_date': row['Fecha efectiva'].strip(),
            'state': row['Estado'].strip(),
            'delivery_state': row.get('Estado de entrega', '').strip(),
            'total': row.get('Total', '').strip(),
        }

print(f"Loaded {len(orders)} sale_orders")
print(f"Distinct states: {sorted(set(o['state'] for o in orders.values()))}")
print(f"Distinct delivery_states: {sorted(set(o['delivery_state'] for o in orders.values()))}")

# Iterate sale_order_lines and collect those for SKU_TARGET
def extract_sku(s):
    m = re.match(r'\[(\w+)\]', s.strip())
    return m.group(1) if m else None

def parse_dec(s):
    s = s.strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def month_key(date_str):
    """Return YYYY-MM or None if unparseable."""
    if not date_str:
        return None
    try:
        return date_str[:7]
    except Exception:
        return None

# Lines CSV: hierarchical (ID only on first row of each order)
target_lines = []
current_ref = None
with open(ROOT / 'sale.order.line_20260303.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        row_id = row.get('ID', '').strip()
        ref = row.get('Referencia de la orden', '').strip()
        if row_id:
            current_ref = ref

        prod = row.get('Líneas de la orden/Plantilla del producto', '').strip()
        sku = extract_sku(prod)
        if sku != SKU_TARGET:
            continue

        qty = parse_dec(row.get('Líneas de la orden/Cantidad', ''))
        dqty = parse_dec(row.get('Líneas de la orden/Cantidad de entrega', ''))
        iqty = parse_dec(row.get('Líneas de la orden/Cantidad a facturar', ''))
        subtotal = parse_dec(row.get('Líneas de la orden/Subtotal', ''))
        unit_price = parse_dec(row.get('Líneas de la orden/Precio unitario', ''))
        uom = row.get('Líneas de la orden/Unidad de medida', '').strip()

        if current_ref not in orders:
            continue
        o = orders[current_ref]
        target_lines.append({
            'order_ref': current_ref,
            'order_date': o['order_date'],
            'effective_date': o['effective_date'],
            'state': o['state'],
            'delivery_state': o['delivery_state'],
            'quantity': qty,
            'delivered_qty': dqty,
            'invoiced_qty': iqty,
            'subtotal': subtotal,
            'unit_price': unit_price,
            'uom': uom,
        })

print(f"\nLoaded {len(target_lines)} lines for SKU {SKU_TARGET}")

# What distinct UOMs appear for this SKU?
from collections import Counter
print(f"UOM distribution: {Counter(l['uom'] for l in target_lines).most_common()}")

# Check any fractional qty / delivered_qty
frac_qty = [l for l in target_lines if (l['quantity'] % 1 != 0) or (l['delivered_qty'] % 1 != 0)]
print(f"Lines with fractional qty/delivered_qty: {len(frac_qty)}")
for fl in frac_qty[:15]:
    print(f"  {fl['order_ref']} order={fl['order_date'][:10]} eff={fl['effective_date'][:10]} qty={fl['quantity']} deliv={fl['delivered_qty']} state={fl['state']} delstate={fl['delivery_state']} uom={fl['uom']}")

# Sale states mapping (Odoo Spanish UI → standard):
# "Orden de venta" / "Pedido de venta" → sale
# "Bloqueado" → done
# "Cancelado" → cancel
# "Cotización" / "Esperando Aprobación" → draft
STATE_SALE_DONE = {'Orden de venta', 'Pedido de venta', 'Bloqueado'}

def in_sale_done(state):
    return state in STATE_SALE_DONE

MONTHS = ['2024-11', '2024-12', '2025-01', '2025-02']

def calc(variant, month, filter_fn=None):
    """
    variant in {'A', 'A_prime', 'B', 'B_prime'}
    A: order_date + quantity, state IN sale/done
    A': order_date + delivered_qty, state IN sale/done
    B: effective_date + delivered_qty, state IN sale/done AND delivered_qty > 0
    B': effective_date + quantity, state IN sale/done AND delivered_qty > 0
    """
    total = 0.0
    for l in target_lines:
        if filter_fn and not filter_fn(l):
            continue
        if not in_sale_done(l['state']):
            continue
        if variant == 'A':
            if month_key(l['order_date']) == month:
                total += l['quantity']
        elif variant == 'A_prime':
            if month_key(l['order_date']) == month:
                total += l['delivered_qty']
        elif variant == 'B':
            if l['delivered_qty'] > 0 and month_key(l['effective_date']) == month:
                total += l['delivered_qty']
        elif variant == 'B_prime':
            if l['delivered_qty'] > 0 and month_key(l['effective_date']) == month:
                total += l['quantity']
    return total

print("\n=== App's four definitions (should match app display) ===")
print(f"{'Month':<10}{'A':>12}{'A_prime':>12}{'B':>12}{'B_prime':>12}")
for m in MONTHS:
    a = calc('A', m)
    ap = calc('A_prime', m)
    b = calc('B', m)
    bp = calc('B_prime', m)
    print(f"{m:<10}{a:>12.2f}{ap:>12.2f}{b:>12.2f}{bp:>12.2f}")

# Try the exact filter used by Análisis de Ventas — sometimes it uses 'all states' or 'non-cancelled'
def not_cancelled(l):
    return l['state'] != 'Cancelado'

print("\n=== Variant: state != Cancelado (all states except cancel, effective_date + delivered_qty>0 + delivered_qty) ===")
for m in MONTHS:
    total = 0.0
    for l in target_lines:
        if l['state'] == 'Cancelado':
            continue
        if l['delivered_qty'] > 0 and month_key(l['effective_date']) == m:
            total += l['delivered_qty']
    print(f"{m}: {total:.2f}")

print("\n=== Variant: effective_date + quantity (not delivered_qty), delivered_qty>0, sale/done ===")
for m in MONTHS:
    total = 0.0
    for l in target_lines:
        if not in_sale_done(l['state']):
            continue
        if l['delivered_qty'] > 0 and month_key(l['effective_date']) == m:
            total += l['quantity']
    print(f"{m}: {total:.2f}")

print("\n=== Variant: effective_date + delivered_qty, NO delivered_qty>0 filter, sale/done ===")
for m in MONTHS:
    total = 0.0
    for l in target_lines:
        if not in_sale_done(l['state']):
            continue
        if month_key(l['effective_date']) == m:
            total += l['delivered_qty']
    print(f"{m}: {total:.2f}")

print("\n=== Variant: effective_date + invoiced_qty, sale/done ===")
for m in MONTHS:
    total = 0.0
    for l in target_lines:
        if not in_sale_done(l['state']):
            continue
        if month_key(l['effective_date']) == m:
            total += l['invoiced_qty']
    print(f"{m}: {total:.2f}")

print("\n=== Variant: order_date + invoiced_qty, sale/done ===")
for m in MONTHS:
    total = 0.0
    for l in target_lines:
        if not in_sale_done(l['state']):
            continue
        if month_key(l['order_date']) == m:
            total += l['invoiced_qty']
    print(f"{m}: {total:.2f}")

# Avg of A' and B (order-date-delivered vs effective-delivered)
print("\n=== Avg of A' and B (effective+delivered centered) ===")
for m in MONTHS:
    a = calc('A_prime', m)
    b = calc('B', m)
    print(f"{m}: avg={(a+b)/2:.2f}")

# Net of returns? If some lines have negative delivered_qty (returns)
neg_lines = [l for l in target_lines if l['delivered_qty'] < 0 or l['quantity'] < 0]
print(f"\nLines with negative qty/delivered: {len(neg_lines)}")

# Try: B + (A' - B')/2 etc. — explore combos
print("\n=== All combos exhaustive — Nov 2024 target 6466.25 ===")
target_nov = 6466.25
target_dec = 6496.50
# Probe by varying: date basis × qty column × state set × delivered>0 filter × include/exclude draft
DATES = ['order_date', 'effective_date', 'delivery_date']
QTY_COLS = ['quantity', 'delivered_qty', 'invoiced_qty']
STATE_SETS = {
    'sale_done': {'Orden de venta', 'Pedido de venta', 'Bloqueado'},
    'sale_only': {'Orden de venta', 'Pedido de venta'},
    'done_only': {'Bloqueado'},
    'not_cancel': {'Orden de venta', 'Pedido de venta', 'Bloqueado', 'Cotización', 'Esperando Aprobación'},
    'all': set(l['state'] for l in target_lines),
}
DEL_FILTERS = {'no_filter': lambda l: True, 'del_gt_0': lambda l: l['delivered_qty'] > 0}

def val(l, qty_col):
    if qty_col == 'quantity':
        return l['quantity']
    elif qty_col == 'delivered_qty':
        return l['delivered_qty']
    elif qty_col == 'invoiced_qty':
        return l['invoiced_qty']
    return 0

def date_of(l, date_basis):
    if date_basis == 'order_date':
        return l['order_date']
    elif date_basis == 'effective_date':
        return l['effective_date']
    return ''

results = []
for date_basis in ['order_date', 'effective_date']:
    for qty_col in QTY_COLS:
        for sname, sset in STATE_SETS.items():
            for dname, dfilt in DEL_FILTERS.items():
                nov_total = 0.0
                dec_total = 0.0
                for l in target_lines:
                    if l['state'] not in sset:
                        continue
                    if not dfilt(l):
                        continue
                    mk = month_key(date_of(l, date_basis))
                    if mk == '2024-11':
                        nov_total += val(l, qty_col)
                    elif mk == '2024-12':
                        dec_total += val(l, qty_col)
                # Close to target?
                nov_diff = abs(nov_total - target_nov)
                dec_diff = abs(dec_total - target_dec)
                results.append({
                    'date_basis': date_basis, 'qty_col': qty_col, 'states': sname, 'del_filter': dname,
                    'nov': nov_total, 'dec': dec_total,
                    'nov_diff': nov_diff, 'dec_diff': dec_diff,
                    'combined_diff': nov_diff + dec_diff,
                })

# Sort by combined_diff
results.sort(key=lambda r: r['combined_diff'])
print(f"{'date':<15}{'qty':<15}{'states':<14}{'del':<10}{'Nov':>10}{'Dec':>10}{'ΔNov':>10}{'ΔDec':>10}")
for r in results[:30]:
    print(f"{r['date_basis']:<15}{r['qty_col']:<15}{r['states']:<14}{r['del_filter']:<10}{r['nov']:>10.2f}{r['dec']:>10.2f}{r['nov_diff']:>10.2f}{r['dec_diff']:>10.2f}")

# Also show exact matches
print("\nExact matches (within 0.01):")
for r in results:
    if r['nov_diff'] < 0.01 and r['dec_diff'] < 0.01:
        print(f"  {r}")
