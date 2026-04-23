"""
Deeper reconciliation: UOM-by-UOM breakdown, credit notes, invoice view.
"""
import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/real_data')
SKU_TARGET = '77201046'

def extract_sku(s):
    m = re.match(r'\[(\w+)\]', s.strip())
    return m.group(1) if m else None

def parse_dec(s):
    s = (s or '').strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0

def month_key(d):
    return d[:7] if d else None

# ---------- 1. UOM ratios ----------
uom_ratio = {}
with open(ROOT / 'uom.uom_20260303.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        name = row.get('Unidad de medida', '').strip()
        ratio = parse_dec(row.get('Proporción', '1.0'))
        category = row.get('Categoría', '').strip()
        if name:
            uom_ratio[name] = (ratio, category)

# Print relevant UOMs
for k in ['CAJA40', 'PAQ CJ', 'Unidad CJ', 'Unidad', 'Unidades']:
    if k in uom_ratio:
        print(f"UOM {k}: ratio={uom_ratio[k][0]}, category={uom_ratio[k][1]}")

# ---------- 2. Load sale_orders ----------
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
        }

# ---------- 3. Load all 77201046 lines ----------
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
            'order_date': o['order_date'], 'effective_date': o['effective_date'],
            'state': o['state'], 'delivery_state': o['delivery_state'],
            'quantity': qty, 'delivered_qty': dqty, 'invoiced_qty': iqty,
            'subtotal': subtotal, 'unit_price': unit_price, 'uom': uom,
        })

# ---------- 4. Nov/Dec breakdown per UOM ----------
print("\n=== Nov/Dec 2024 lines per UOM (order_date basis, delivered + ordered) ===")
for m in ['2024-11', '2024-12']:
    print(f"\n-- {m} --")
    by_uom = defaultdict(lambda: {'quantity': 0, 'delivered_qty': 0, 'count': 0})
    by_uom_eff = defaultdict(lambda: {'quantity': 0, 'delivered_qty': 0, 'count': 0})
    for l in target_lines:
        if month_key(l['order_date']) == m:
            k = l['uom'] or 'NONE'
            by_uom[k]['quantity'] += l['quantity']
            by_uom[k]['delivered_qty'] += l['delivered_qty']
            by_uom[k]['count'] += 1
        if month_key(l['effective_date']) == m:
            k = l['uom'] or 'NONE'
            by_uom_eff[k]['quantity'] += l['quantity']
            by_uom_eff[k]['delivered_qty'] += l['delivered_qty']
            by_uom_eff[k]['count'] += 1
    print("  ORDER_DATE basis:")
    for k, v in by_uom.items():
        print(f"    {k}: {v['count']} lines, qty={v['quantity']}, deliv={v['delivered_qty']}")
    print("  EFFECTIVE_DATE basis:")
    for k, v in by_uom_eff.items():
        print(f"    {k}: {v['count']} lines, qty={v['quantity']}, deliv={v['delivered_qty']}")

# ---------- 5. UOM conversion: normalize to CAJA40 (the product stock UOM) ----------
# Odoo 'Análisis de Ventas' normalizes to the product's stock UOM.
# CAJA40 is the stock UOM. So PAQ CJ and Unidad CJ must be converted.
# Need UOM ratios. Let me print all CJ-related UOMs.
print("\n=== All UOMs containing 'CJ' or related ===")
for name, (ratio, cat) in sorted(uom_ratio.items()):
    if 'CJ' in name or 'CAJA' in name or cat.lower().find('unidad') >= 0 or name in ('PAQ CJ', 'Unidad CJ', 'CAJA40'):
        print(f"  {name!r}: ratio={ratio}, category={cat!r}")

# Try a conversion: if CAJA40 = 40 units, then 1 CAJA40 = 40 Unidad. The ratios depend on Odoo's definition.
# If PAQ CJ is the base unit (ratio=1) and CAJA40 has ratio 40 (i.e. 40 PAQ CJ per CAJA40)... we don't know without inspection.

# ---------- 6. Raw Nov/Dec lines dump for forensic review ----------
print("\n=== Every Nov 2024 line for 77201046 (order_date in Nov) ===")
for l in target_lines:
    if month_key(l['order_date']) == '2024-11':
        print(f"  {l['order_ref']:<14} order={l['order_date'][:10]} eff={l['effective_date'][:10] if l['effective_date'] else '—':<10} "
              f"state={l['state']:<20} delstate={l['delivery_state']:<25} "
              f"qty={l['quantity']:>7.3f} deliv={l['delivered_qty']:>7.3f} inv={l['invoiced_qty']:>7.3f} "
              f"uom={l['uom']}")

print("\n=== Every Dec 2024 line for 77201046 (order_date in Dec) ===")
for l in target_lines:
    if month_key(l['order_date']) == '2024-12':
        print(f"  {l['order_ref']:<14} order={l['order_date'][:10]} eff={l['effective_date'][:10] if l['effective_date'] else '—':<10} "
              f"state={l['state']:<20} delstate={l['delivery_state']:<25} "
              f"qty={l['quantity']:>7.3f} deliv={l['delivered_qty']:>7.3f} inv={l['invoiced_qty']:>7.3f} "
              f"uom={l['uom']}")

# ---------- 7. account.move (invoices) — credit note check ----------
# The 2024 file contains invoices; look for 77201046 invoice/refund lines
print("\n=== account.move.line 2024 — lines containing 77201046 ===")
invoice_file = ROOT / 'account.move.line_2024.csv'
if invoice_file.exists():
    with open(invoice_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        cols = reader.fieldnames
        print(f"  Columns: {cols}")
        inv_lines = []
        for row in reader:
            row_str = ','.join(str(v) for v in row.values() if v)
            if '77201046' in row_str:
                inv_lines.append(row)
        print(f"  Lines: {len(inv_lines)}")
        if inv_lines:
            # Show first few
            for r in inv_lines[:3]:
                print(f"    {r}")
