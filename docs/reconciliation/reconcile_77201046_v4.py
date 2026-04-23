"""
v4: account.move.line invoice/credit-note check + stock.move customer-flow detail.
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
        if n: uom_ratio[n] = r

def to_caja40(qty, uom):
    if uom == 'CAJA40' or not uom: return qty
    r_uom = uom_ratio.get(uom)
    r_c40 = uom_ratio.get('CAJA40', 0.025)
    if not r_uom: return qty
    return qty * r_c40 / r_uom

# ---------- 1. account.move.line for SKU 77201046 in Nov/Dec 2024 ----------
print("=== account.move.line — SKU 77201046 Nov/Dec 2024 ===")

# Try to inspect file structure first
inv_files = ['account.move.line_2024.csv']
for fn in inv_files:
    fp = ROOT / fn
    if not fp.exists():
        print(f"  Not found: {fn}")
        continue
    with open(fp, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        print(f"  Headers: {reader.fieldnames}")
        rows = list(reader)
        print(f"  Total rows: {len(rows)}")

# Now scan for our SKU
inv_lines = []
for fn in inv_files:
    fp = ROOT / fn
    if not fp.exists():
        continue
    with open(fp, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        cur_id = None
        cur_meta = {}
        for row in reader:
            rid = row.get('ID', '').strip()
            if rid:
                cur_id = rid
                cur_meta = {k: row.get(k, '').strip() for k in reader.fieldnames}
            # match SKU in any column
            cells = [str(v) for v in row.values() if v]
            if not any('77201046' in c for c in cells):
                continue
            inv_lines.append({**cur_meta, **{k: v for k, v in row.items() if v}})

print(f"  Lines mentioning 77201046: {len(inv_lines)}")
if inv_lines:
    print("  Sample row keys:", list(inv_lines[0].keys()))
    print("  First 5 rows:")
    for r in inv_lines[:5]:
        # Print compact form
        print(f"    {r}")

# ---------- 2. stock.move customer flows: detailed Nov/Dec ----------
print("\n=== stock.move detailed customer flows Nov/Dec 2024 ===")
fp = ROOT / 'stock.move_2024.csv'
to_cust_rows = []
from_cust_rows = []
with open(fp, 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        prod = row.get('Producto', '').strip()
        if extract_sku(prod) != SKU: continue
        if row.get('Estado', '').strip() not in ('Hecho', 'done'): continue
        date = row.get('Fecha', '').strip()
        mk = mkey(date)
        if mk not in ('2024-11', '2024-12'): continue
        frm = row.get('Desde', '').strip()
        to = row.get('A', '').strip()
        qty = parse_dec(row.get('Cantidad', ''))
        uom = row.get('Unidad de medida', '').strip()
        qn = to_caja40(qty, uom)
        if 'Partners/Customers' in to and 'Partners/Customers' not in frm:
            to_cust_rows.append({'date': date[:10], 'mk': mk, 'frm': frm, 'qty': qty, 'qn': qn, 'origin': row.get('Origen','').strip()})
        if 'Partners/Customers' in frm and 'Partners/Customers' not in to:
            from_cust_rows.append({'date': date[:10], 'mk': mk, 'to': to, 'qty': qty, 'qn': qn, 'origin': row.get('Origen','').strip()})

# By month, by source warehouse, totals
print(f"\n  TO customer (shipments) — total moves: {len(to_cust_rows)}")
for m in ['2024-11', '2024-12']:
    sub = [r for r in to_cust_rows if r['mk'] == m]
    by_src = defaultdict(float)
    for r in sub:
        by_src[r['frm']] += r['qn']
    total = sum(by_src.values())
    print(f"  {m} TOTAL: {total:.4f}  ({len(sub)} moves)")
    for src, t in sorted(by_src.items(), key=lambda x: -x[1]):
        print(f"    {src}: {t:.4f}")

print(f"\n  FROM customer (returns) — total moves: {len(from_cust_rows)}")
for m in ['2024-11', '2024-12']:
    sub = [r for r in from_cust_rows if r['mk'] == m]
    by_dest = defaultdict(float)
    for r in sub:
        by_dest[r['to']] += r['qn']
    total = sum(by_dest.values())
    print(f"  {m} TOTAL returns: {total:.4f}  ({len(sub)} moves)")
    for dest, t in sorted(by_dest.items(), key=lambda x: -x[1]):
        print(f"    {dest}: {t:.4f}")

# Net to customer
print("\n  NET to customer (shipments - returns):")
for m in ['2024-11', '2024-12']:
    out = sum(r['qn'] for r in to_cust_rows if r['mk'] == m)
    ret = sum(r['qn'] for r in from_cust_rows if r['mk'] == m)
    print(f"    {m}: {out:.4f} - {ret:.4f} = {out - ret:.4f}")

# Show all to-customer move dates with sums (to see if SSOT 6466.25 emerges from a slice)
# Maybe SSOT is shipments excluding inter-company / consignment customers?
print(f"\n  Distinct customer-bound origins (codes):")
origins = sorted(set(r['origin'] for r in to_cust_rows))
print(f"    Total distinct: {len(origins)}")
print(f"    First 20: {origins[:20]}")
