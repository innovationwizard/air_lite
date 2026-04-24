"""
Recon C2 — Diagnose the Nov gap and the live-vs-snapshot mismatches.

Findings from Recon C:
  - Odoo live product.product for default_code='77201046' has id=7090, name='Vaso Blanco 10oz Duroport ¨40/25 Reyma'
  - Snapshot CSV product odoo_id=9764, name='VASO DUROPORT No. 10 REYMA 40-25'
  - Live has 5741 sale.order.line for product 7090; snapshot has 6157 lines (linked to odoo_id 9764)
  - Dic 2024 B_combo live = 6496.75 ≈ SSOT 6496.50 (Δ=-0.25)
  - Nov 2024 B_combo live = 6366.80 vs SSOT 6466.25 (Δ=+99.45)

Hypotheses to verify:
  H_a) There is a SECOND product.product in live with the same default_code='77201046' or related (e.g., 'Vaso Blanco 10oz' variants, or odoo_id 9764 still exists with a different name).
  H_b) Some Nov 2024 sales lines have moved between products (e.g., merged variants).
  H_c) Odoo live has POS-only orders not in sale.order — would not be visible from sale.order.line model.

This script:
  1. Searches product.product / product.template for ALL records mentioning '77201046' or 'Vaso Blanco 10oz' or 'VASO DUROPORT No. 10 REYMA'.
  2. Looks up live id 9764 (was the snapshot odoo_id) to see if it still exists.
  3. Reports per-product per-month totals.
"""
import os
import json
import xmlrpc.client
from collections import defaultdict
from datetime import datetime
from pathlib import Path

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/recon_C2_odoo_live_diagnose_results.json')

# Load env
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

URL = os.environ['ODOO_URL']
DB = os.environ['ODOO_DB']
USER = os.environ['ODOO_USERNAME']
KEY = os.environ['ODOO_API_KEY']

print(f"Auth → {URL}")
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(DB, USER, KEY, {})
print(f"uid={uid}")
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object', allow_none=True)

def call(method, model, *args, **kwargs):
    return models.execute_kw(DB, uid, KEY, model, method, list(args), kwargs)

# --- 1. Find all product.product mentioning default_code or relevant names ---
print("\n=== 1. product.product candidates ===")

# By default_code
cands_by_code = call('search_read', 'product.product',
                     [['default_code', '=', '77201046']],
                     fields=['id', 'name', 'default_code', 'active', 'uom_id', 'uom_po_id', 'product_tmpl_id'])
print(f"By default_code='77201046': {len(cands_by_code)}")
for c in cands_by_code:
    print(f"  id={c['id']}  active={c['active']}  uom={c['uom_id']}  tmpl={c['product_tmpl_id']}  name={c['name']!r}")

# Including inactive
cands_inactive = call('search_read', 'product.product',
                      [['default_code', '=', '77201046'], ['active', 'in', [True, False]]],
                      fields=['id', 'name', 'default_code', 'active', 'product_tmpl_id'])
print(f"\nIncluding inactive (default_code='77201046'): {len(cands_inactive)}")
for c in cands_inactive:
    print(f"  id={c['id']}  active={c['active']}  name={c['name']!r}  tmpl={c['product_tmpl_id']}")

# By name patterns
print("\n=== 2. By name patterns ===")
patterns = ['Vaso Blanco 10oz Duroport', 'VASO DUROPORT No. 10 REYMA', 'VASO DUROPORT NO. 10', 'Reyma 40']
for pat in patterns:
    res = call('search_read', 'product.product',
               [['name', 'ilike', pat], ['active', 'in', [True, False]]],
               fields=['id', 'name', 'default_code', 'active'])
    print(f"  Pattern {pat!r}: {len(res)} products")
    for r in res[:10]:
        print(f"    id={r['id']}  active={r['active']}  default_code={r.get('default_code')!r}  name={r['name']!r}")

# --- 3. Look up id 9764 directly (was the snapshot odoo_id) ---
print("\n=== 3. Direct lookup id=9764 (snapshot odoo_id) ===")
try:
    r = call('read', 'product.product', [9764],
             fields=['id', 'name', 'default_code', 'active', 'product_tmpl_id', 'uom_id'])
    print(f"  Found: {r}")
except Exception as e:
    print(f"  Lookup failed: {e}")

# --- 4. For each candidate product, count Nov/Dec 2024 lines ---
print("\n=== 4. Nov/Dec 2024 line counts per candidate product ===")
all_pids = sorted({c['id'] for c in cands_inactive})
for pid in all_pids:
    line_ids = call('search', 'sale.order.line', [['product_id', '=', pid]])
    print(f"\n  product_id={pid}: {len(line_ids)} total sale.order.line records")
    if not line_ids:
        continue
    # Get all lines + their orders
    chunk = 1000
    lines = []
    for i in range(0, len(line_ids), chunk):
        sub = call('read', 'sale.order.line', line_ids[i:i+chunk],
                   fields=['id', 'order_id', 'product_uom_qty', 'qty_delivered', 'product_uom'])
        lines.extend(sub)
    order_ids = sorted({l['order_id'][0] for l in lines if l.get('order_id')})
    orders = {}
    for i in range(0, len(order_ids), chunk):
        sub = call('read', 'sale.order', order_ids[i:i+chunk],
                   fields=['id', 'date_order', 'commitment_date', 'effective_date', 'state'])
        for o in sub:
            orders[o['id']] = o

    for m in ['2024-11', '2024-12']:
        nov_total_eff = 0.0
        nov_total_commit = 0.0
        nov_total_combined = 0.0
        for l in lines:
            o = orders.get(l['order_id'][0], {})
            if o.get('state') not in ('sale', 'done'): continue
            dq = float(l['qty_delivered'] or 0)
            if dq <= 0: continue
            ed = (o.get('effective_date') or '')[:7]
            cd = (o.get('commitment_date') or '')[:7]
            combo = (o.get('effective_date') or o.get('commitment_date') or '')[:7]
            if ed == m: nov_total_eff += dq
            if cd == m: nov_total_commit += dq
            if combo == m: nov_total_combined += dq
        print(f"    {m}: B(eff_date)={nov_total_eff:.2f}  B(commitment_date)={nov_total_commit:.2f}  B(combined)={nov_total_combined:.2f}")

# --- 5. Save snapshot of findings ---
result = {
    'run_at': datetime.now().isoformat(),
    'sku_search': '77201046',
    'snapshot_odoo_id_was': 9764,
    'live_product_id_for_default_code_77201046': cands_by_code[0]['id'] if cands_by_code else None,
    'candidates_by_default_code_active_only': cands_by_code,
    'candidates_by_default_code_including_inactive': cands_inactive,
}
with open(OUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False, default=str)
print(f"\nSaved: {OUT}")
