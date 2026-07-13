"""
Step 6.5 — Extend acid-test scope from top 20 to top 23 (additive only).

Per user direction: "Change by addition only. Do not drop."

Actions:
  A) UPDATE products_acid_test_active for all 182 rows:
     - movement_rank_within_class ← complete-data rank
     - net_sales_quantity ← complete-data total
     (revenue not refetched here; preserve existing values)
  B) SET is_top_10_in_class = TRUE for 3 newly-promoted SKUs:
     77201019, 77201038, 77205035
     (existing top-10 flags stay TRUE; nothing is dropped)
  C) Pull Odoo live data for the 3 new SKUs (sale.order.line, purchase.order.line,
     account.move.line + parents + uoms)
  D) Populate revenue_daily for those 3 with all 3 winning SSOT formulas
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

NEWLY_ADDED_SKUS = ['77201019', '77201038', '77205035']
RERANK_RESULTS = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/find_13_rerank_results.json')
EXTRACT_TOP20 = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_top20_latest.json')
OUT_NEW_EXTRACT = Path(f'/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_3newSKUs_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')

SSOT_SALES = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'
SSOT_PO_ORD = 'pol_all_states_date_planned_product_qty_c40'
SSOT_PO_RCV = 'pol_purchase_done_date_planned_qty_received_c40'

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
SUPA_KEY = os.environ['SUPABASE_SECRET_KEY']

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

# ─── A) UPDATE rankings for all 182 active rows ────────────────────────
print("\n=== A) Updating products_acid_test_active rankings ===")
rerank = json.loads(RERANK_RESULTS.read_text())
new_rankings = rerank['new_rankings']

# Build update map: template_id → (new_rank, new_qty)
update_map = {}
for cls in ('REYMA', 'CARVAJAL', 'BOTH'):
    for new_rank, r in enumerate(new_rankings.get(cls, []), 1):
        update_map[r['product_template_id']] = {
            'movement_rank_within_class': new_rank,
            'net_sales_quantity': r['new_net_sales_qty'],
        }
print(f"  {len(update_map)} templates to update.")

updates_done = 0
for tid, payload in update_map.items():
    s, b = supa('PATCH',
                 f'/rest/v1/products_acid_test_active?product_template_id=eq.{tid}',
                 body=payload, prefer='return=minimal')
    if s >= 400:
        print(f"  ERROR pid={tid}: HTTP {s}: {b[:200] if isinstance(b, str) else b}")
    else:
        updates_done += 1
print(f"  PATCH updates: {updates_done}/{len(update_map)}")

# ─── B) Flag 3 new SKUs as top_10 (additive) ───────────────────────────
print("\n=== B) Setting is_top_10_in_class=TRUE for 3 newly-promoted SKUs ===")
for sku in NEWLY_ADDED_SKUS:
    s, b = supa('PATCH',
                 f'/rest/v1/products_acid_test_active?default_code=eq.{sku}',
                 body={'is_top_10_in_class': True}, prefer='return=representation')
    if s >= 400:
        print(f"  ERROR {sku}: HTTP {s}: {b[:200] if isinstance(b, str) else b}")
    else:
        print(f"  {sku}: flagged. Affected rows: {len(b) if isinstance(b, list) else 0}")

# Verify total scope
s, b = supa('GET', '/rest/v1/products_acid_test_active?is_top_10_in_class=eq.true&select=default_code,supplier_class,movement_rank_within_class,representative_name&order=supplier_class.asc,movement_rank_within_class.asc')
print(f"\n  Acid-test scope after additive update: {len(b)} SKUs")
for r in b:
    print(f"    cls={r['supplier_class']:<8} rank={r['movement_rank_within_class']:>3} sku={r['default_code']:<10} {r['representative_name'][:55]!r}")

# ─── C) Pull Odoo data for the 3 new SKUs ──────────────────────────────
print(f"\n=== C) Pulling Odoo data for new SKUs: {NEWLY_ADDED_SKUS} ===")

# Resolve product.product IDs
pp = call('search_read', 'product.product',
           ['|', ['active', '=', True], ['active', '=', False],
            ['default_code', 'in', NEWLY_ADDED_SKUS]],
           fields=['id', 'name', 'default_code', 'active', 'product_tmpl_id', 'uom_id'])
print(f"  product.product matches: {len(pp)}")
for p in pp:
    print(f"    pid={p['id']:>5}  active={p['active']}  sku={p['default_code']!r}  name={p['name'][:50]!r}")
new_pp_ids = sorted({p['id'] for p in pp})

# UoM master
uoms = call('search_read', 'uom.uom', [], fields=['id', 'name', 'factor'])
uom_by_id = {u['id']: u for u in uoms}
def factor_to_target(src_uom_id, target_uom_id):
    if not src_uom_id or src_uom_id == target_uom_id: return 1.0
    f_src = uom_by_id.get(src_uom_id, {}).get('factor', 1.0)
    f_tgt = uom_by_id.get(target_uom_id, {}).get('factor', 1.0)
    if not f_src or f_src == 0: return 1.0
    return f_tgt / f_src

product_stock_uom = {p['id']: (p['uom_id'][0] if p.get('uom_id') else None) for p in pp}

# sale.order.line + parents
print("\n  Pulling sale.order.line for new SKUs...")
sol_fields = ['id', 'order_id', 'product_id', 'product_uom', 'product_uom_qty',
              'qty_delivered', 'qty_invoiced', 'price_unit', 'price_subtotal',
              'discount', 'state']
sol_ids = call('search', 'sale.order.line', [['product_id', 'in', new_pp_ids]])
print(f"    sol ids: {len(sol_ids)}")
sols = []
for i in range(0, len(sol_ids), 500):
    sols.extend(call('read', 'sale.order.line', sol_ids[i:i+500], fields=sol_fields))
print(f"    fetched: {len(sols)}")

so_ids = sorted({l['order_id'][0] for l in sols if l.get('order_id')})
so_fields = ['id', 'name', 'date_order', 'commitment_date', 'effective_date',
             'state', 'partner_id', 'warehouse_id']
sos = []
for i in range(0, len(so_ids), 500):
    sub = call('search_read', 'sale.order',
                [['id', 'in', so_ids[i:i+500]]], fields=so_fields)
    sos.extend(sub)
print(f"    parent orders: {len(sos)}")

# purchase.order.line + parents
print("\n  Pulling purchase.order.line for new SKUs...")
pol_fields = ['id', 'order_id', 'product_id', 'product_uom', 'product_qty',
              'qty_received', 'qty_invoiced', 'price_unit', 'state']
pol_ids = call('search', 'purchase.order.line', [['product_id', 'in', new_pp_ids]])
print(f"    pol ids: {len(pol_ids)}")
pols = []
for i in range(0, len(pol_ids), 500):
    pols.extend(call('read', 'purchase.order.line', pol_ids[i:i+500], fields=pol_fields))
print(f"    fetched: {len(pols)}")

po_ids = sorted({l['order_id'][0] for l in pols if l.get('order_id')})
po_fields = ['id', 'name', 'date_order', 'date_planned', 'date_approve',
             'effective_date', 'state', 'partner_id']
pos = []
for i in range(0, len(po_ids), 500):
    sub = call('search_read', 'purchase.order',
                [['id', 'in', po_ids[i:i+500]]], fields=po_fields)
    pos.extend(sub)
print(f"    parent POs: {len(pos)}")

# account.move.line per-product
print("\n  Pulling account.move.line per product...")
aml_fields = ['id', 'move_id', 'product_id', 'quantity', 'price_subtotal',
              'product_uom_id', 'date', 'account_id', 'parent_state']
sales_amls = []
sales_move_ids = set()
for pid in new_pp_ids:
    ids = call('search', 'account.move.line',
                [['product_id', '=', pid],
                 ['parent_state', '=', 'posted'],
                 ['move_id.move_type', 'in', ['out_invoice', 'out_refund']]])
    for i in range(0, len(ids), 5000):
        sub = call('read', 'account.move.line', ids[i:i+5000], fields=aml_fields)
        sales_amls.extend(sub)
        for l in sub:
            if l.get('move_id'): sales_move_ids.add(l['move_id'][0])
    print(f"    pid={pid}: cum sales aml = {len(sales_amls)}")

# Parent moves
print(f"\n  Pulling {len(sales_move_ids)} account.move parents...")
move_fields = ['id', 'date', 'invoice_date', 'state', 'move_type']
moves = []
move_ids_list = sorted(sales_move_ids)
for i in range(0, len(move_ids_list), 1000):
    moves.extend(call('read', 'account.move', move_ids_list[i:i+1000], fields=move_fields))
print(f"    {len(moves)}")

# Account chart for income filtering
all_acct_ids = sorted({l['account_id'][0] for l in sales_amls if l.get('account_id')})
accounts = []
for i in range(0, len(all_acct_ids), 200):
    accounts.extend(call('search_read', 'account.account',
                          [['id', 'in', all_acct_ids[i:i+200]]],
                          fields=['id', 'account_type', 'name', 'code']))
income_acct_ids = {a['id'] for a in accounts if a.get('account_type') == 'income'}
print(f"  income account IDs: {len(income_acct_ids)}")

extract_3 = {
    'run_at': datetime.now().isoformat(),
    'skus': NEWLY_ADDED_SKUS,
    'product_product': pp,
    'uom_uom': uoms,
    'sale_order_line': sols, 'sale_order': sos,
    'purchase_order_line': pols, 'purchase_order': pos,
    'account_move_line_sales': sales_amls,
    'account_move': moves,
    'account_account': accounts,
}
OUT_NEW_EXTRACT.write_text(json.dumps(extract_3, indent=1, default=str))
print(f"  Saved extract: {OUT_NEW_EXTRACT}")

# ─── D) Map new SKUs to Supabase products ────────────────────────────
print("\n=== D) Resolving / creating Supabase product rows for new SKUs ===")
codes_csv = ','.join(f'"{c}"' for c in NEWLY_ADDED_SKUS)
s, b = supa('GET', f'/rest/v1/products?sku=in.({codes_csv})&select=id,sku')
existing = {r['sku']: r['id'] for r in b}
print(f"  Existing in prod: {existing}")

# Create any missing
for sku in NEWLY_ADDED_SKUS:
    if sku in existing: continue
    p = next((x for x in pp if x.get('default_code') == sku), None)
    if not p:
        print(f"  {sku}: no Odoo match??")
        continue
    tmpl_id = p['product_tmpl_id'][0] if p.get('product_tmpl_id') else None
    new_row = {
        'odoo_id': str(tmpl_id),
        'sku': sku,
        'name': (p['name'] or f'Product {sku}')[:200],
        'stock_uom': p['uom_id'][1] if p.get('uom_id') else None,
        'is_active': p.get('active', True),
    }
    s, b = supa('POST', '/rest/v1/products?on_conflict=odoo_id', body=[new_row],
                prefer='resolution=merge-duplicates,return=minimal')
    print(f"  {sku}: created (HTTP {s})")

s, b = supa('GET', f'/rest/v1/products?sku=in.({codes_csv})&select=id,sku')
supa_pid_by_sku = {r['sku']: r['id'] for r in b}
print(f"  Final mapping: {supa_pid_by_sku}")

# ─── E) Populate revenue_daily for the 3 new SKUs ──────────────────────
print("\n=== E) Populating revenue_daily for new SKUs ===")
move_by_id = {m['id']: m for m in moves}

# SALES aggregation
sales_agg = defaultdict(lambda: {'qty': 0.0, 'rev': 0.0, 'docs': set()})
for l in sales_amls:
    pid = l['product_id'][0] if l.get('product_id') else None
    spid = supa_pid_by_sku.get(next((p['default_code'] for p in pp if p['id'] == pid), None))
    if not spid: continue
    aid = l['account_id'][0] if l.get('account_id') else None
    if aid not in income_acct_ids: continue
    mid = l['move_id'][0] if l.get('move_id') else None
    m = move_by_id.get(mid) if mid else None
    if not m or m.get('state') != 'posted': continue
    mtype = m.get('move_type')
    if mtype not in ('out_invoice', 'out_refund'): continue
    day = m.get('invoice_date') or m.get('date')
    if not day: continue
    day = day[:10]
    qty = float(l.get('quantity') or 0)
    rev = float(l.get('price_subtotal') or 0)
    src_uom = l['product_uom_id'][0] if l.get('product_uom_id') else None
    tgt_uom = product_stock_uom.get(pid)
    qty *= factor_to_target(src_uom, tgt_uom)
    if mtype == 'out_refund':
        qty = -qty; rev = -rev
    sales_agg[(spid, day)]['qty'] += qty
    sales_agg[(spid, day)]['rev'] += rev
    sales_agg[(spid, day)]['docs'].add(mid)

# Purchase aggregations
po_by_id = {o['id']: o for o in pos}
po_ord = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
po_rcv = defaultdict(lambda: {'qty': 0.0, 'docs': set()})
for l in pols:
    pid = l['product_id'][0] if l.get('product_id') else None
    spid = supa_pid_by_sku.get(next((p['default_code'] for p in pp if p['id'] == pid), None))
    if not spid: continue
    o = po_by_id.get(l['order_id'][0]) if l.get('order_id') else None
    if not o: continue
    day = o.get('date_planned')
    if not day: continue
    day = day[:10]
    src_uom = l['product_uom'][0] if l.get('product_uom') else None
    tgt_uom = product_stock_uom.get(pid)
    factor = factor_to_target(src_uom, tgt_uom)
    qord = float(l.get('product_qty') or 0) * factor
    po_ord[(spid, day)]['qty'] += qord
    po_ord[(spid, day)]['docs'].add(o['id'])
    if o.get('state') in ('purchase', 'done'):
        qrcv = float(l.get('qty_received') or 0) * factor
        po_rcv[(spid, day)]['qty'] += qrcv
        po_rcv[(spid, day)]['docs'].add(o['id'])

rows = []
for (spid, day), v in sales_agg.items():
    rows.append({'product_id': spid, 'ssot_label': SSOT_SALES, 'metric': 'sales',
                 'observation_date': day, 'quantity': round(v['qty'], 4),
                 'revenue_gtq': round(v['rev'], 4), 'source_doc_count': len(v['docs'])})
for (spid, day), v in po_ord.items():
    rows.append({'product_id': spid, 'ssot_label': SSOT_PO_ORD, 'metric': 'purchases_ordered',
                 'observation_date': day, 'quantity': round(v['qty'], 4),
                 'revenue_gtq': None, 'source_doc_count': len(v['docs'])})
for (spid, day), v in po_rcv.items():
    if v['qty'] == 0: continue
    rows.append({'product_id': spid, 'ssot_label': SSOT_PO_RCV, 'metric': 'purchases_received',
                 'observation_date': day, 'quantity': round(v['qty'], 4),
                 'revenue_gtq': None, 'source_doc_count': len(v['docs'])})
print(f"  Rows to insert: {len(rows)}")

# Wipe existing rows for these 3 SKUs only
target_supa_pids = sorted(set(supa_pid_by_sku.values()))
pid_csv = ','.join(str(p) for p in target_supa_pids)
for label in (SSOT_SALES, SSOT_PO_ORD, SSOT_PO_RCV):
    s, b = supa('DELETE',
                 f'/rest/v1/revenue_daily?product_id=in.({pid_csv})&ssot_label=eq.{label}',
                 prefer='return=representation')
    n = len(b) if isinstance(b, list) else 0
    print(f"  Deleted {n} for ssot_label={label}")

inserted = 0
for i in range(0, len(rows), 500):
    batch = rows[i:i+500]
    s, b = supa('POST', '/rest/v1/revenue_daily', body=batch, prefer='return=minimal')
    if s >= 400:
        print(f"  ERROR batch {i//500}: HTTP {s}: {b[:300] if isinstance(b, str) else b}")
        raise SystemExit(1)
    inserted += len(batch)
print(f"  Inserted {inserted}")

# Per-SKU monthly summary for the 3 new SKUs
print("\n  Per-SKU monthly sales summary:")
for sku in NEWLY_ADDED_SKUS:
    spid = supa_pid_by_sku.get(sku)
    if not spid: continue
    monthly = defaultdict(float)
    for (s2, day), v in sales_agg.items():
        if s2 == spid:
            monthly[day[:7]] += v['qty']
    total = sum(monthly.values())
    print(f"    sku={sku}  total_sales={total:>10,.2f}  months={len(monthly)}")

print("\nDONE.")
