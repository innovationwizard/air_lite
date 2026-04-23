"""
v3: UOM-aware totals + stock.move (actual warehouse movements) analysis.
The SSOT decimals (.25, .50) match PAQ CJ → CAJA40 conversion (ratio 0.025).
Also check stock_moves state=done customer-bound for same month/SKU.
"""
import csv
import re
from collections import defaultdict
from pathlib import Path

ROOT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/real_data')
SKU = '77201046'

def extract_sku(s):
    m = re.match(r'\[(\w+)\]', s.strip())
    return m.group(1) if m else None

def parse_dec(s):
    s = (s or '').strip()
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0

def mkey(d):
    return d[:7] if d else None

# UOM ratios
uom_ratio = {}
with open(ROOT / 'uom.uom_20260303.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        n = row.get('Unidad de medida', '').strip()
        r = parse_dec(row.get('Proporción', '1.0'))
        if n:
            uom_ratio[n] = r

# In Odoo: `ratio` stores how many of THIS unit fit in 1 reference unit.
# For Caja category, reference appears to be CAJA (ratio=1.0) or PAQ CJ (ratio=1.0).
# CAJA40 ratio=0.025 means 1 reference = 0.025 CAJA40 → 1 CAJA40 = 40 reference
# PAQ CJ ratio=1.0 means PAQ CJ = reference.
# So: 1 CAJA40 = 40 PAQ CJ. To convert PAQ CJ to CAJA40: qty_paq / 40 = qty_paq * 0.025

# Convert any qty from UoM X to CAJA40:
# qty_in_reference = qty_X / ratio_X   (since ratio_X = how many X per 1 reference)
# NO — Odoo formula: qty_ref = qty_uom / factor_uom. `factor` (ratio) means "how many X in 1 ref"
# So qty_ref = qty_uom / factor; qty_CAJA40 = qty_ref / factor_CAJA40 * ...
# Actually the simplest rule: if X and Y are same category:
#   qty_X * ratio_Y / ratio_X  = qty_Y  (cross-ratio)
# For PAQ CJ (ratio 1.0) to CAJA40 (ratio 0.025): qty_CAJA40 = qty_PAQ * 0.025 / 1.0 = qty_PAQ * 0.025
# That's correct: 40 PAQ CJ * 0.025 = 1 CAJA40. ✓

def to_caja40(qty, uom):
    if uom == 'CAJA40' or not uom:
        return qty
    r_uom = uom_ratio.get(uom)
    r_caja40 = uom_ratio.get('CAJA40', 0.025)
    if r_uom is None or r_uom == 0:
        return qty  # unknown → leave as-is
    return qty * r_caja40 / r_uom

# Load orders
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
        }

# Load lines
lines = []
cur = None
with open(ROOT / 'sale.order.line_20260303.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        rid = row.get('ID', '').strip()
        ref = row.get('Referencia de la orden', '').strip()
        if rid:
            cur = ref
        prod = row.get('Líneas de la orden/Plantilla del producto', '').strip()
        if extract_sku(prod) != SKU:
            continue
        if cur not in orders:
            continue
        o = orders[cur]
        lines.append({
            'ref': cur,
            'od': o['order_date'], 'ed': o['effective_date'], 'state': o['state'],
            'qty': parse_dec(row.get('Líneas de la orden/Cantidad', '')),
            'dqty': parse_dec(row.get('Líneas de la orden/Cantidad de entrega', '')),
            'iqty': parse_dec(row.get('Líneas de la orden/Cantidad a facturar', '')),
            'uom': row.get('Líneas de la orden/Unidad de medida', '').strip(),
        })

SALE_DONE = {'Orden de venta', 'Pedido de venta', 'Bloqueado'}

TARGET_NOV = 6466.25
TARGET_DEC = 6496.50

print(f"Target SSOT: Nov={TARGET_NOV}, Dec={TARGET_DEC}")
print(f"Total {SKU} lines loaded: {len(lines)}")

# Compute UOM-normalized totals for each of the 4 definitions
def sum_var(variant, month, uom_normalize):
    tot = 0.0
    for l in lines:
        if l['state'] not in SALE_DONE:
            continue
        v = 0.0
        if variant == 'A':  # order_date + quantity
            if mkey(l['od']) != month: continue
            v = l['qty']
        elif variant == 'A_prime':  # order_date + delivered_qty
            if mkey(l['od']) != month: continue
            v = l['dqty']
        elif variant == 'B':  # eff_date + delivered_qty, del>0
            if l['dqty'] <= 0 or mkey(l['ed']) != month: continue
            v = l['dqty']
        elif variant == 'B_prime':  # eff_date + quantity, del>0
            if l['dqty'] <= 0 or mkey(l['ed']) != month: continue
            v = l['qty']
        if uom_normalize:
            v = to_caja40(v, l['uom'])
        tot += v
    return tot

print("\n=== UOM-normalized to CAJA40 (PAQ CJ × 0.025) ===")
print(f"{'Month':<10}{'A (norm)':>12}{'A_prime':>12}{'B':>12}{'B_prime':>12}")
for m in ['2024-11', '2024-12', '2025-01', '2025-02']:
    a = sum_var('A', m, True)
    ap = sum_var('A_prime', m, True)
    b = sum_var('B', m, True)
    bp = sum_var('B_prime', m, True)
    print(f"{m:<10}{a:>12.4f}{ap:>12.4f}{b:>12.4f}{bp:>12.4f}")

# Print all PAQ CJ / non-CAJA40 lines for context
print("\n=== All non-CAJA40 lines for SKU 77201046 ===")
for l in lines:
    if l['uom'] != 'CAJA40':
        norm = to_caja40(l['qty'], l['uom'])
        normd = to_caja40(l['dqty'], l['uom'])
        print(f"  {l['ref']:<14} od={l['od'][:10] if l['od'] else '—':<10} ed={l['ed'][:10] if l['ed'] else '—':<10} "
              f"state={l['state']:<25} qty={l['qty']:>10.3f} deliv={l['dqty']:>10.3f} uom={l['uom']:<10} "
              f"qty→C40={norm:>7.3f} deliv→C40={normd:>7.3f}")

# ---------- Stock moves analysis ----------
print(f"\n=== stock.move — SKU {SKU} — Nov/Dec 2024 customer-bound done moves ===")
move_files = ['stock.move_2024.csv']

for fn in move_files:
    fp = ROOT / fn
    if not fp.exists():
        continue
    with open(fp, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        print(f"  Headers: {reader.fieldnames}")
        break

move_totals = defaultdict(lambda: defaultdict(float))  # month -> (from→to) -> qty
move_to_customer = defaultdict(float)
move_from_customer = defaultdict(float)  # returns
all_relevant = []
for fn in move_files:
    fp = ROOT / fn
    if not fp.exists():
        continue
    with open(fp, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            prod = row.get('Producto', '').strip()
            if extract_sku(prod) != SKU:
                continue
            state = row.get('Estado', '').strip()
            if state != 'Hecho' and state != 'done':
                continue
            frm = row.get('Desde', '').strip()
            to = row.get('A', '').strip()
            date = row.get('Fecha', '').strip()
            qty = parse_dec(row.get('Cantidad', ''))
            uom = row.get('Unidad de medida', '').strip()
            mk = mkey(date)
            if mk not in ('2024-11', '2024-12'):
                continue
            q_norm = to_caja40(qty, uom)
            all_relevant.append({
                'date': date[:10], 'from': frm, 'to': to, 'qty': qty, 'uom': uom, 'qty_c40': q_norm,
                'state': state, 'origin': row.get('Origen', '').strip(),
            })
            # Categorize by destination type
            is_customer = 'Partners/Customers' in to or 'Customer' in to or 'Cliente' in to
            is_from_customer = 'Partners/Customers' in frm or 'Customer' in frm or 'Cliente' in frm
            if is_customer and not is_from_customer:
                move_to_customer[mk] += q_norm
            if is_from_customer and not is_customer:
                move_from_customer[mk] += q_norm  # returns

print(f"  Matching stock.move rows in Nov/Dec 2024: {len(all_relevant)}")
print(f"  To customer (shipments, CAJA40 normalized):")
for m, t in sorted(move_to_customer.items()):
    print(f"    {m}: {t}")
print(f"  From customer (returns, CAJA40 normalized):")
for m, t in sorted(move_from_customer.items()):
    print(f"    {m}: {t}")
# Show first 15 movements for forensic clarity
print(f"  First 15 relevant moves:")
for r in all_relevant[:15]:
    print(f"    {r['date']} {r['from'][:40]:<40} → {r['to'][:40]:<40} qty={r['qty']:>7.2f} uom={r['uom']} norm={r['qty_c40']:>7.3f} origin={r['origin']}")

# Unique destination locations to understand naming
print(f"\n  Unique destination locations (to):")
locs_to = sorted(set(r['to'] for r in all_relevant))
for l in locs_to:
    tot = sum(r['qty_c40'] for r in all_relevant if r['to'] == l)
    print(f"    {l}: {tot:.4f}")
print(f"\n  Unique source locations (from):")
locs_from = sorted(set(r['from'] for r in all_relevant))
for l in locs_from:
    tot = sum(r['qty_c40'] for r in all_relevant if r['from'] == l)
    print(f"    {l}: {tot:.4f}")
