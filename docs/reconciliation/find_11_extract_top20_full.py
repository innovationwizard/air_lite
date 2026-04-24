"""
Step 5 — Probe + extract ALL Odoo live data for the top 20 SKUs.

Reads top 20 (by is_top_10_in_class) from products_acid_test_active in prod.
For each, gets all variant product.product IDs.
Probes Odoo for the full date range available across:
  - sale.order.line + sale.order (all date fields)
  - purchase.order.line + purchase.order (all date fields)
  - account.move.line + account.move (invoice_date, date)

Then pulls everything within the discovered ranges and persists to JSON.
This is input for find_12_populate_revenue_daily_top20.py.

Defensive against:
  - Odoo 502 on large requests (small chunks + retry)
  - res.partner read() ACL (uses search_read by id)
  - False-as-null Odoo quirks
"""
import os
import json
import time as _time
import xmlrpc.client
import urllib.request
import urllib.error
from collections import defaultdict
from datetime import datetime
from pathlib import Path

TS = datetime.now().strftime('%Y%m%d_%H%M%S')
OUT = Path(f'/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_top20_{TS}.json')
LATEST = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_top20_latest.json')

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
SUPA = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SERVICE_ROLE_KEY']

print(f"Auth → {URL}")
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(DB, USER, KEY, {})
print(f"uid={uid}")
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object', allow_none=True)

def call(method, model, *args, **kwargs):
    last_exc = None
    for attempt in range(5):
        try:
            return models.execute_kw(DB, uid, KEY, model, method, list(args), kwargs)
        except (xmlrpc.client.ProtocolError, ConnectionError, TimeoutError) as e:
            last_exc = e
            wait = min(60, 2 ** attempt)
            print(f"      retry {attempt + 1}/5 after {wait}s — {type(e).__name__}: {str(e)[:140]}")
            _time.sleep(wait)
    raise last_exc

def supa(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'}
    if data is not None: headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(f"{SUPA}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def search_read_in_chunks(model, ids, fields, chunk=200):
    out = []
    ids = list(ids)
    for i in range(0, len(ids), chunk):
        sub = call('search_read', model, [['id', 'in', ids[i:i+chunk]]], fields=fields)
        out.extend(sub)
    return out

# ─── 1. Load top 20 from prod ────────────────────────────────────────────
print("\n=== 1. Loading top 20 from products_acid_test_active ===")
s, b = supa('GET', '/rest/v1/products_acid_test_active?is_top_10_in_class=eq.true&select=*&order=supplier_class.asc,movement_rank_within_class.asc')
assert s == 200, f"HTTP {s}: {b}"
top20 = b
assert len(top20) == 20, f"Expected 20, got {len(top20)}"
print(f"  Loaded {len(top20)} top SKUs")
all_pp_ids = sorted({pid for r in top20 for pid in r['product_product_ids']})
print(f"  Total product.product IDs across all 20 SKUs: {len(all_pp_ids)}")
template_ids = sorted({r['product_template_id'] for r in top20})
print(f"  Template IDs: {template_ids}")

# Print scope summary
for r in top20:
    print(f"  cls={r['supplier_class']:<8} rank={r['movement_rank_within_class']:>2} sku={r['default_code']:<10} variants={r['product_product_ids']} {r['representative_name'][:50]!r}")

# ─── 2. Probe data ranges (per source) ───────────────────────────────────
print("\n=== 2. Probing Odoo data ranges per source ===")

def first_last(model, domain, date_fields, label):
    """Find min/max of one date field by querying first ASC + last DESC."""
    print(f"  {label}: querying...")
    range_results = {}
    for df in date_fields:
        try:
            first = call('search_read', model, domain,
                          fields=['id', df], limit=1, order=f'{df} asc')
            last = call('search_read', model, domain,
                         fields=['id', df], limit=1, order=f'{df} desc')
            f_d = first[0].get(df) if first else None
            l_d = last[0].get(df) if last else None
            range_results[df] = (f_d, l_d)
            print(f"    {df}: first={f_d!r}, last={l_d!r}")
        except Exception as e:
            print(f"    {df}: ERROR {e}")
            range_results[df] = (None, None)
    return range_results

ranges = {}
ranges['sale.order.line'] = first_last('sale.order', [['order_line.product_id', 'in', all_pp_ids]],
                                         ['date_order', 'commitment_date', 'effective_date'],
                                         'sale.order (parent of lines for these products)')
ranges['purchase.order'] = first_last('purchase.order', [['order_line.product_id', 'in', all_pp_ids]],
                                       ['date_order', 'date_planned', 'date_approve', 'effective_date'],
                                       'purchase.order (parent)')
ranges['account.move'] = first_last('account.move',
                                      [['line_ids.product_id', 'in', all_pp_ids],
                                       ['state', '=', 'posted'],
                                       ['move_type', 'in', ['out_invoice', 'out_refund', 'in_invoice', 'in_refund']]],
                                      ['invoice_date', 'date'],
                                      'account.move (posted invoices/bills)')

# ─── 3. Pull data ───────────────────────────────────────────────────────
print("\n=== 3. Pulling raw data ===")

# 3a. UoM master
print("  uom.uom (all)...")
uoms = call('search_read', 'uom.uom', [], fields=['id', 'name', 'factor', 'category_id'])
print(f"    {len(uoms)} uoms")

# 3b. product.product details for the variants
print("  product.product (top 20 variants)...")
pp_fields = ['id', 'name', 'default_code', 'active', 'product_tmpl_id', 'uom_id']
products = call('search_read', 'product.product',
                 ['|', ['active', '=', True], ['active', '=', False],
                  ['id', 'in', all_pp_ids]],
                 fields=pp_fields)
print(f"    {len(products)}")

# 3c. sale.order.line for all variants
print("  sale.order.line (all-time, for these variants)...")
sol_fields = ['id', 'order_id', 'product_id', 'product_uom', 'product_uom_qty',
              'qty_delivered', 'qty_invoiced', 'price_unit', 'price_subtotal',
              'discount', 'state']
sol_ids = call('search', 'sale.order.line', [['product_id', 'in', all_pp_ids]])
print(f"    line ids: {len(sol_ids)}")
sols = []
chunk = 500
for i in range(0, len(sol_ids), chunk):
    sub = call('read', 'sale.order.line', sol_ids[i:i+chunk], fields=sol_fields)
    sols.extend(sub)
    if (i // chunk) % 4 == 0:
        print(f"      ...{i + len(sub)}/{len(sol_ids)}")
print(f"    total: {len(sols)}")

# 3d. sale.order parents
print("  sale.order parents...")
so_ids = sorted({l['order_id'][0] for l in sols if l.get('order_id')})
so_fields = ['id', 'name', 'partner_id', 'date_order', 'commitment_date',
             'effective_date', 'state', 'warehouse_id', 'amount_total',
             'amount_untaxed', 'user_id', 'team_id', 'pricelist_id']
sos = search_read_in_chunks('sale.order', so_ids, so_fields, chunk=500)
print(f"    {len(sos)}")

# 3e. purchase.order.line
print("  purchase.order.line (all-time)...")
pol_fields = ['id', 'order_id', 'product_id', 'product_uom', 'product_qty',
              'qty_received', 'qty_invoiced', 'price_unit', 'price_subtotal',
              'date_planned', 'state']
pol_ids = call('search', 'purchase.order.line', [['product_id', 'in', all_pp_ids]])
print(f"    line ids: {len(pol_ids)}")
pols = search_read_in_chunks('purchase.order.line', pol_ids, pol_fields, chunk=500)
print(f"    {len(pols)}")

# 3f. purchase.order parents
print("  purchase.order parents...")
po_ids = sorted({l['order_id'][0] for l in pols if l.get('order_id')})
po_fields = ['id', 'name', 'partner_id', 'date_order', 'date_approve',
             'date_planned', 'effective_date', 'state', 'amount_total',
             'amount_untaxed', 'user_id']
pos = search_read_in_chunks('purchase.order', po_ids, po_fields, chunk=500)
print(f"    {len(pos)}")

# 3g. account.move.line (sales side: out_invoice + out_refund + posted)
# Already have data for ALL 267 templates from find_10. But find_10 didn't persist
# the AML rows — just totals. So re-fetch here for the 20 SKUs only (much smaller subset).
print("  account.move.line (SALES side: out_invoice/out_refund + posted)...")
aml_fields = ['id', 'move_id', 'product_id', 'quantity', 'price_unit',
              'price_subtotal', 'product_uom_id', 'date', 'account_id',
              'parent_state']
sales_amls = []
sales_move_ids = set()
chunk_aml = 25  # very small to avoid 502
for i in range(0, len(all_pp_ids), chunk_aml):
    batch = all_pp_ids[i:i+chunk_aml]
    sub = call('search_read', 'account.move.line',
                [['product_id', 'in', batch],
                 ['parent_state', '=', 'posted'],
                 ['move_id.move_type', 'in', ['out_invoice', 'out_refund']]],
                fields=aml_fields, limit=20000)
    sales_amls.extend(sub)
    for l in sub:
        if l.get('move_id'):
            sales_move_ids.add(l['move_id'][0])
    if (i // chunk_aml) % 2 == 0:
        print(f"    ...{i + len(batch)}/{len(all_pp_ids)} products, {len(sales_amls)} sales-aml so far")
print(f"    sales aml: {len(sales_amls)}, distinct moves: {len(sales_move_ids)}")

# 3h. account.move.line (purchases side: in_invoice + in_refund + posted)
# For completeness; future use if we add an aml-based purchase metric.
print("  account.move.line (PURCHASES side: in_invoice/in_refund + posted)...")
purch_amls = []
purch_move_ids = set()
for i in range(0, len(all_pp_ids), chunk_aml):
    batch = all_pp_ids[i:i+chunk_aml]
    sub = call('search_read', 'account.move.line',
                [['product_id', 'in', batch],
                 ['parent_state', '=', 'posted'],
                 ['move_id.move_type', 'in', ['in_invoice', 'in_refund']]],
                fields=aml_fields, limit=20000)
    purch_amls.extend(sub)
    for l in sub:
        if l.get('move_id'):
            purch_move_ids.add(l['move_id'][0])
print(f"    purchase aml: {len(purch_amls)}, distinct moves: {len(purch_move_ids)}")

# 3i. account.move parents
print("  account.move parents (both sides)...")
all_move_ids = sorted(sales_move_ids | purch_move_ids)
move_fields = ['id', 'name', 'date', 'invoice_date', 'state', 'move_type',
               'partner_id', 'amount_total', 'amount_untaxed']
moves = []
for i in range(0, len(all_move_ids), 500):
    sub = call('read', 'account.move', all_move_ids[i:i+500], fields=move_fields)
    moves.extend(sub)
print(f"    {len(moves)}")

# 3j. account.account chart
print("  account.account chart...")
all_acct_ids = sorted({l['account_id'][0] for l in (sales_amls + purch_amls) if l.get('account_id')})
acct_fields = ['id', 'name', 'code', 'account_type']
accounts = search_read_in_chunks('account.account', all_acct_ids, acct_fields)
print(f"    {len(accounts)}")

# 3k. partners (customers + suppliers)
print("  res.partner (customers + suppliers referenced)...")
partner_ids = sorted(({o['partner_id'][0] for o in sos if o.get('partner_id')} |
                      {o['partner_id'][0] for o in pos if o.get('partner_id')} |
                      {m['partner_id'][0] for m in moves if m.get('partner_id')}))
print(f"    distinct partner ids: {len(partner_ids)}")
partner_fields = ['id', 'name', 'email', 'city', 'country_id',
                  'customer_rank', 'supplier_rank', 'active']
partners = search_read_in_chunks('res.partner', partner_ids, partner_fields, chunk=200)
print(f"    {len(partners)}")

# 3l. warehouses
print("  stock.warehouse (referenced)...")
wh_ids = sorted({o['warehouse_id'][0] for o in sos if o.get('warehouse_id')})
warehouses = search_read_in_chunks('stock.warehouse', wh_ids,
                                    ['id', 'name', 'code', 'active'], chunk=100)
print(f"    {len(warehouses)}")

# ─── 4. Persist ─────────────────────────────────────────────────────────
extract = {
    'run_at': datetime.now().isoformat(),
    'odoo_url': URL,
    'top20_sku_meta': top20,
    'product_product_ids': all_pp_ids,
    'product_template_ids': template_ids,
    'data_ranges_probed': ranges,
    'uom_uom': uoms,
    'product_product': products,
    'sale_order_line': sols,
    'sale_order': sos,
    'purchase_order_line': pols,
    'purchase_order': pos,
    'account_move_line_sales': sales_amls,
    'account_move_line_purchases': purch_amls,
    'account_move': moves,
    'account_account': accounts,
    'res_partner': partners,
    'stock_warehouse': warehouses,
}

print(f"\n=== 4. Persisting to JSON ===")
with open(OUT, 'w') as f:
    json.dump(extract, f, indent=1, ensure_ascii=False, default=str)
if LATEST.exists() or LATEST.is_symlink():
    LATEST.unlink()
LATEST.symlink_to(OUT.name)
print(f"  Saved: {OUT}")
print(f"  Latest pointer: {LATEST}")
print(f"  Size: {OUT.stat().st_size / 1024 / 1024:.1f} MB")

# Summary table
print("\n=== Summary ===")
counts = {k: len(v) if isinstance(v, list) else 'n/a'
          for k, v in extract.items()
          if k not in ('run_at', 'odoo_url', 'data_ranges_probed', 'top20_sku_meta')}
for k, v in counts.items():
    print(f"  {k}: {v}")
