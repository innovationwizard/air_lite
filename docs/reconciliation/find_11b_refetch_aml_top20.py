"""
Step 5b — Refetch account.move.line for the top 20 products WITHOUT a limit cap.

The find_11 first pass capped at 20K rows per response; per-product some had
35K+ AML rows, causing silent truncation. This script re-pulls AML per-product
(one query per product variant) so each call returns at most ~10-40K rows
which Odoo handles without 502.

Loads existing extract, replaces the account_move_line_sales /
account_move_line_purchases keys with complete data, re-saves.
"""
import os
import json
import time as _time
import xmlrpc.client
from datetime import datetime
from pathlib import Path

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

extract = json.loads(LATEST.resolve().read_text())
all_pp_ids = extract['product_product_ids']
print(f"Loaded extract. {len(all_pp_ids)} product variants.")
print(f"  Previously: sales_aml={len(extract['account_move_line_sales'])}, "
      f"purch_aml={len(extract['account_move_line_purchases'])}")

aml_fields = ['id', 'move_id', 'product_id', 'quantity', 'price_unit',
              'price_subtotal', 'product_uom_id', 'date', 'account_id',
              'parent_state']

# ─── Per-product fetch with id-paginated chunks ─────────────────────────
def fetch_aml_for_product(pid, side):
    """Fetch ALL aml rows for a single product, paginated by id."""
    if side == 'sales':
        type_filter = ['out_invoice', 'out_refund']
    else:
        type_filter = ['in_invoice', 'in_refund']

    # First search all matching IDs (no limit on search itself)
    ids = call('search', 'account.move.line',
               [['product_id', '=', pid],
                ['parent_state', '=', 'posted'],
                ['move_id.move_type', 'in', type_filter]])
    if not ids:
        return []
    # Then read in id-batched chunks
    out = []
    chunk = 5000
    for i in range(0, len(ids), chunk):
        sub = call('read', 'account.move.line', ids[i:i+chunk], fields=aml_fields)
        out.extend(sub)
    return out

print("\n=== Refetch SALES AML per product ===")
sales_amls = []
sales_move_ids = set()
for idx, pid in enumerate(all_pp_ids, 1):
    rows = fetch_aml_for_product(pid, 'sales')
    sales_amls.extend(rows)
    for l in rows:
        if l.get('move_id'):
            sales_move_ids.add(l['move_id'][0])
    print(f"  {idx:>2}/20  pid={pid:<5}  rows={len(rows):>6}  cum={len(sales_amls):>7}")

print(f"\n  TOTAL sales aml: {len(sales_amls)}, distinct moves: {len(sales_move_ids)}")

print("\n=== Refetch PURCHASES AML per product ===")
purch_amls = []
purch_move_ids = set()
for idx, pid in enumerate(all_pp_ids, 1):
    rows = fetch_aml_for_product(pid, 'purchases')
    purch_amls.extend(rows)
    for l in rows:
        if l.get('move_id'):
            purch_move_ids.add(l['move_id'][0])
    print(f"  {idx:>2}/20  pid={pid:<5}  rows={len(rows):>6}  cum={len(purch_amls):>7}")

print(f"\n  TOTAL purch aml: {len(purch_amls)}, distinct moves: {len(purch_move_ids)}")

# ─── Refetch parent moves (now we have complete move id sets) ──────────
print("\n=== Refetch account.move parents ===")
all_move_ids = sorted(sales_move_ids | purch_move_ids)
print(f"  All moves to fetch: {len(all_move_ids)}")
move_fields = ['id', 'name', 'date', 'invoice_date', 'state', 'move_type',
               'partner_id', 'amount_total', 'amount_untaxed']
moves = []
for i in range(0, len(all_move_ids), 1000):
    sub = call('read', 'account.move', all_move_ids[i:i+1000], fields=move_fields)
    moves.extend(sub)
    if (i // 1000) % 5 == 0:
        print(f"    ...{i + len(sub)}/{len(all_move_ids)}")
print(f"  Total: {len(moves)}")

# Update extract
extract['account_move_line_sales'] = sales_amls
extract['account_move_line_purchases'] = purch_amls
extract['account_move'] = moves
extract['refetched_at'] = datetime.now().isoformat()

# Persist
with open(LATEST.resolve(), 'w') as f:
    json.dump(extract, f, indent=1, ensure_ascii=False, default=str)

print(f"\n=== Updated {LATEST.resolve().name} ===")
print(f"  sales_aml: {len(sales_amls)} (was {20000 if len(sales_amls) >= 20000 else 'less'})")
print(f"  purch_aml: {len(purch_amls)}")
print(f"  moves: {len(moves)}")
print(f"  Size: {LATEST.resolve().stat().st_size / 1024 / 1024:.1f} MB")
