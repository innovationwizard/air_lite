"""
Step 02 — Backup all prod rows that will be modified for SKU 77201046 (product_id=33).

Dumps each affected table's rows into a single JSON file. Reversibility:
restore script can re-insert from this dump if the replacement goes wrong.

Tables backed up:
  - products (1 row: id=33)
  - sale_order_lines (where product_id=33)
  - sale_orders (parents of those lines — full header row)
  - stock_moves (where product_id=33)
  - stock_quants (where product_id=33)
  - purchase_order_lines (where product_id=33)
  - purchase_orders (parents)
  - demand_daily (where product_id=33)
  - inventory_daily (where product_id=33)
  - backtest_results (where product_id=33, any run)
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
KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']
PRODUCT_ID = 33
TS = datetime.now().strftime('%Y%m%d_%H%M%S')
OUT = Path(f'/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/backup_77201046_product33_{TS}.json')

def get(path):
    """Page through PostgREST."""
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

backup = {
    'captured_at': datetime.now().isoformat(),
    'product_id': PRODUCT_ID,
    'sku': '77201046',
    'tables': {},
}

# Products
print("Backing up products (id=33)...")
backup['tables']['products'] = get(f'/rest/v1/products?id=eq.{PRODUCT_ID}&select=*')
print(f"  {len(backup['tables']['products'])} rows")

# Sale order lines
print("Backing up sale_order_lines...")
sol = get(f'/rest/v1/sale_order_lines?product_id=eq.{PRODUCT_ID}&select=*')
backup['tables']['sale_order_lines'] = sol
print(f"  {len(sol)} rows")
so_parent_ids = sorted({l['order_id'] for l in sol})

# Sale orders (parents)
if so_parent_ids:
    print(f"Backing up sale_orders (parents, {len(so_parent_ids)} ids)...")
    # PostgREST in.() for batched lookups
    so_rows = []
    batch_size = 500
    for i in range(0, len(so_parent_ids), batch_size):
        batch = so_parent_ids[i:i+batch_size]
        id_list = ','.join(str(x) for x in batch)
        so_rows.extend(get(f'/rest/v1/sale_orders?id=in.({id_list})&select=*'))
    backup['tables']['sale_orders'] = so_rows
    print(f"  {len(so_rows)} rows")
else:
    backup['tables']['sale_orders'] = []

# Stock moves
print("Backing up stock_moves...")
sm = get(f'/rest/v1/stock_moves?product_id=eq.{PRODUCT_ID}&select=*')
backup['tables']['stock_moves'] = sm
print(f"  {len(sm)} rows")

# Stock quants
print("Backing up stock_quants...")
sq = get(f'/rest/v1/stock_quants?product_id=eq.{PRODUCT_ID}&select=*')
backup['tables']['stock_quants'] = sq
print(f"  {len(sq)} rows")

# Purchase order lines
print("Backing up purchase_order_lines...")
pol = get(f'/rest/v1/purchase_order_lines?product_id=eq.{PRODUCT_ID}&select=*')
backup['tables']['purchase_order_lines'] = pol
print(f"  {len(pol)} rows")
po_parent_ids = sorted({l['order_id'] for l in pol if l.get('order_id')})

# Purchase orders (parents)
if po_parent_ids:
    print(f"Backing up purchase_orders (parents, {len(po_parent_ids)} ids)...")
    po_rows = []
    for i in range(0, len(po_parent_ids), batch_size):
        batch = po_parent_ids[i:i+batch_size]
        id_list = ','.join(str(x) for x in batch)
        po_rows.extend(get(f'/rest/v1/purchase_orders?id=in.({id_list})&select=*'))
    backup['tables']['purchase_orders'] = po_rows
    print(f"  {len(po_rows)} rows")
else:
    backup['tables']['purchase_orders'] = []

# demand_daily
print("Backing up demand_daily...")
dd = get(f'/rest/v1/demand_daily?product_id=eq.{PRODUCT_ID}&select=*')
backup['tables']['demand_daily'] = dd
print(f"  {len(dd)} rows")

# inventory_daily
print("Backing up inventory_daily...")
inv = get(f'/rest/v1/inventory_daily?product_id=eq.{PRODUCT_ID}&select=*')
backup['tables']['inventory_daily'] = inv
print(f"  {len(inv)} rows")

# backtest_results
print("Backing up backtest_results...")
br = get(f'/rest/v1/backtest_results?product_id=eq.{PRODUCT_ID}&select=*')
backup['tables']['backtest_results'] = br
print(f"  {len(br)} rows")

with open(OUT, 'w') as f:
    json.dump(backup, f, indent=2, ensure_ascii=False, default=str)

sizes = {k: len(v) for k, v in backup['tables'].items()}
total = sum(sizes.values())
print(f"\nBackup summary: {sizes}")
print(f"Total rows backed up: {total}")
print(f"Saved: {OUT}")
print(f"Size: {OUT.stat().st_size / 1024:.1f} KB")
