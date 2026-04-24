"""
Re-rank ALL 267 templates with COMPLETE sales totals (not truncated).

Method: Odoo's read_group aggregates server-side. One query per class returns
sum(quantity) per product_id under the income/posted/out_invoice|out_refund
filter. We separately query out_refund and subtract.

If the new rankings change which SKUs are in the top 10 of each class, we'll
flag and re-discuss with user before proceeding to forecast.
"""
import os
import json
import xmlrpc.client
import urllib.request
import urllib.error
import time as _time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/find_13_rerank_results.json')

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

print("Auth Odoo...")
common = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(DB, USER, KEY, {})
models = xmlrpc.client.ServerProxy(f'{URL}/xmlrpc/2/object', allow_none=True)

def call(method, model, *args, **kwargs):
    last_exc = None
    for attempt in range(5):
        try:
            return models.execute_kw(DB, uid, KEY, model, method, list(args), kwargs)
        except (xmlrpc.client.ProtocolError, ConnectionError, TimeoutError) as e:
            last_exc = e
            wait = min(60, 2 ** attempt)
            print(f"      retry {attempt + 1}/5 after {wait}s — {str(e)[:120]}")
            _time.sleep(wait)
    raise last_exc

def supa(method, path, body=None, prefer=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'}
    if data is not None: headers['Content-Type'] = 'application/json'
    if prefer: headers['Prefer'] = prefer
    req = urllib.request.Request(f"{SUPA}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read().decode()
            return r.status, json.loads(txt) if txt else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

# Load full universe from prod
print("Loading universe from products_acid_test_active...")
s, b = supa('GET', '/rest/v1/products_acid_test_active?select=*&order=supplier_class.asc,movement_rank_within_class.asc')
assert s == 200, f"HTTP {s}: {b}"
universe = b
print(f"  {len(universe)} templates in universe")
all_pp_ids = sorted({pid for r in universe for pid in r['product_product_ids']})
print(f"  {len(all_pp_ids)} variants total")

# UoM map (need for normalization)
uoms = call('search_read', 'uom.uom', [], fields=['id', 'name', 'factor'])
uom_by_id = {u['id']: u for u in uoms}

# Per-product stock UoM
products = call('search_read', 'product.product',
                 ['|', ['active', '=', True], ['active', '=', False],
                  ['id', 'in', all_pp_ids]],
                 fields=['id', 'uom_id'])
product_stock_uom = {p['id']: (p['uom_id'][0] if p.get('uom_id') else None) for p in products}

def factor_to_target(src_uom_id, target_uom_id):
    if not src_uom_id or src_uom_id == target_uom_id: return 1.0
    f_src = uom_by_id.get(src_uom_id, {}).get('factor', 1.0)
    f_tgt = uom_by_id.get(target_uom_id, {}).get('factor', 1.0)
    if not f_src or f_src == 0: return 1.0
    return f_tgt / f_src

# read_group aggregates server-side, much faster than fetching individual lines
# Need TWO queries: one for invoice, one for refund (refund subtracted)
print("\nrun read_group for OUT_INVOICE...")

# Per-product chunked aggregation. read_group has its own quirks.
def aggregate_by_product(pp_ids, move_types):
    """Returns {product_id: total_qty_in_native_uom}."""
    totals = defaultdict(float)
    chunk = 50
    for i in range(0, len(pp_ids), chunk):
        batch = pp_ids[i:i+chunk]
        # read_group with groupby=product_id sums quantity per product
        res = call('read_group', 'account.move.line',
                    [['product_id', 'in', batch],
                     ['parent_state', '=', 'posted'],
                     ['move_id.move_type', 'in', move_types],
                     ['account_id.account_type', '=', 'income']],
                    ['product_id', 'quantity'],
                    ['product_id'],
                    lazy=False)
        for r in res:
            pid = r['product_id'][0] if r.get('product_id') else None
            if pid is not None:
                totals[pid] = r.get('quantity', 0.0) or 0.0
        if (i // chunk) % 4 == 0:
            print(f"    ...{i + len(batch)}/{len(pp_ids)}")
    return totals

inv_totals = aggregate_by_product(all_pp_ids, ['out_invoice'])
print(f"  out_invoice: {len(inv_totals)} products with sales")

print("\nrun read_group for OUT_REFUND...")
ref_totals = aggregate_by_product(all_pp_ids, ['out_refund'])
print(f"  out_refund: {len(ref_totals)} products with refunds")

# Combine: net = invoice - refund (because refund counted negative per winning formula)
# Both are in the line's UoM; we'll normalize after.
# But read_group gives a sum across all uoms — we lose granularity. So we need a
# UoM-uniformity check: if all lines for a product are in the same UoM, the sum is
# fine. Otherwise we need per-uom breakdown.
print("\nProbing per-product UoM uniformity...")

# Check: for each product, what UoMs appear?
uom_per_product = {}
chunk = 50
for i in range(0, len(all_pp_ids), chunk):
    batch = all_pp_ids[i:i+chunk]
    res = call('read_group', 'account.move.line',
                [['product_id', 'in', batch],
                 ['parent_state', '=', 'posted'],
                 ['move_id.move_type', 'in', ['out_invoice', 'out_refund']],
                 ['account_id.account_type', '=', 'income']],
                ['product_id', 'product_uom_id', 'quantity'],
                ['product_id', 'product_uom_id'],
                lazy=False)
    for r in res:
        pid = r['product_id'][0] if r.get('product_id') else None
        uid_l = r['product_uom_id'][0] if r.get('product_uom_id') else None
        if pid is None: continue
        uom_per_product.setdefault(pid, {})[uid_l] = r.get('quantity', 0.0) or 0.0
    if (i // chunk) % 4 == 0:
        print(f"    ...{i + len(batch)}/{len(all_pp_ids)}")

# Now we have per-(pid, uom_id) totals (combined inv + refund — but read_group can't
# discriminate inv vs refund here). Let's redo the per-uom split with separate queries.
print("\nrun per-uom read_group for OUT_INVOICE...")
inv_by_pid_uom = {}
for i in range(0, len(all_pp_ids), chunk):
    batch = all_pp_ids[i:i+chunk]
    res = call('read_group', 'account.move.line',
                [['product_id', 'in', batch],
                 ['parent_state', '=', 'posted'],
                 ['move_id.move_type', '=', 'out_invoice'],
                 ['account_id.account_type', '=', 'income']],
                ['product_id', 'product_uom_id', 'quantity'],
                ['product_id', 'product_uom_id'],
                lazy=False)
    for r in res:
        pid = r['product_id'][0] if r.get('product_id') else None
        uid_l = r['product_uom_id'][0] if r.get('product_uom_id') else None
        if pid is None: continue
        inv_by_pid_uom.setdefault(pid, {})[uid_l] = r.get('quantity', 0.0) or 0.0

print("\nrun per-uom read_group for OUT_REFUND...")
ref_by_pid_uom = {}
for i in range(0, len(all_pp_ids), chunk):
    batch = all_pp_ids[i:i+chunk]
    res = call('read_group', 'account.move.line',
                [['product_id', 'in', batch],
                 ['parent_state', '=', 'posted'],
                 ['move_id.move_type', '=', 'out_refund'],
                 ['account_id.account_type', '=', 'income']],
                ['product_id', 'product_uom_id', 'quantity'],
                ['product_id', 'product_uom_id'],
                lazy=False)
    for r in res:
        pid = r['product_id'][0] if r.get('product_id') else None
        uid_l = r['product_uom_id'][0] if r.get('product_uom_id') else None
        if pid is None: continue
        ref_by_pid_uom.setdefault(pid, {})[uid_l] = r.get('quantity', 0.0) or 0.0

# Compute net qty per product, normalized to its stock UoM
print("\nComputing net qty per product, normalized...")
net_qty_by_pid = {}
for pid in all_pp_ids:
    target_uom = product_stock_uom.get(pid)
    net = 0.0
    for uid_l, q in inv_by_pid_uom.get(pid, {}).items():
        net += q * factor_to_target(uid_l, target_uom)
    for uid_l, q in ref_by_pid_uom.get(pid, {}).items():
        net -= q * factor_to_target(uid_l, target_uom)
    net_qty_by_pid[pid] = round(net, 4)

# Aggregate to template level
template_total = defaultdict(float)
for r in universe:
    for pid in r['product_product_ids']:
        template_total[r['product_template_id']] += net_qty_by_pid.get(pid, 0.0)

# Re-rank within class
print("\n=== Re-ranking within each class with COMPLETE data ===\n")
new_rankings = {}
for cls in ('REYMA', 'CARVAJAL', 'BOTH'):
    sub = [r for r in universe if r['supplier_class'] == cls]
    enriched = [{**r, 'new_net_sales_qty': round(template_total[r['product_template_id']], 4)} for r in sub]
    enriched.sort(key=lambda r: -r['new_net_sales_qty'])
    new_rankings[cls] = enriched

# Compare old vs new
def show_class(cls, top=15):
    print(f"\n--- {cls} top {top} (NEW vs OLD ranking) ---")
    print(f"  {'NEW':>4}  {'sku':<12}  {'OLD':>4}  {'old_qty':>14}  {'new_qty':>14}  Δ%   name")
    for new_rank, r in enumerate(new_rankings[cls][:top], 1):
        old_rank = r['movement_rank_within_class']
        old_q = r['net_sales_quantity']
        new_q = r['new_net_sales_qty']
        delta_pct = ((new_q - old_q) / old_q * 100) if old_q else 0
        marker = '★' if new_rank != old_rank else ' '
        print(f"  #{new_rank:>2}{marker}  {r['default_code']:<12}  #{old_rank:>2}  "
              f"{old_q:>14,.2f}  {new_q:>14,.2f}  {delta_pct:>+5.0f}%  {r['representative_name'][:50]!r}")

show_class('REYMA', 15)
show_class('CARVAJAL', 15)
show_class('BOTH', 15)

# Did the top-10 SKU SET change?
print("\n=== TOP-10 SKU SET changes ===")
for cls in ('REYMA', 'CARVAJAL', 'BOTH'):
    old_top10 = {r['default_code'] for r in [x for x in universe if x['supplier_class'] == cls and x['is_top_10_in_class']]}
    new_top10 = {r['default_code'] for r in new_rankings[cls][:10]}
    only_in_old = old_top10 - new_top10
    only_in_new = new_top10 - old_top10
    if only_in_new or only_in_old:
        print(f"  {cls}: SET CHANGED")
        print(f"    Dropped from top 10: {only_in_old}")
        print(f"    Newly in top 10:     {only_in_new}")
    else:
        print(f"  {cls}: SAME 10 SKUs (only internal order may have shifted)")

# Persist
out = {
    'run_at': datetime.now().isoformat(),
    'method': 'read_group server-side, per-uom split, refund subtracted, normalized to stock uom',
    'new_rankings': new_rankings,
    'template_totals': dict(template_total),
}
OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False, default=str))
print(f"\nSaved: {OUT}")
