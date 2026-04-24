"""
Step 1 — Extract account.move.line / account.move / account.account data
         for SKU 77201046 (3 product.product variants) from Odoo live.

Adds the missing financial-side data to our existing extract so the SSOT finder
in Step 2 can try invoice-level filters.

Variants: 7090 (active), 1541 (archived), 2371 (archived)
"""
import os
import json
import xmlrpc.client
from datetime import datetime
from pathlib import Path

TS = datetime.now().strftime('%Y%m%d_%H%M%S')
OUT = Path(f'/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_77201046_invoices_{TS}.json')
LATEST = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_77201046_invoices_latest.json')
VARIANT_IDS = [7090, 1541, 2371]

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

def search_read_in_chunks(model, ids, fields, chunk=500):
    """Read by id-batched search_read (works around ACL on read())."""
    out = []
    ids = list(ids)
    for i in range(0, len(ids), chunk):
        sub = call('search_read', model, [['id', 'in', ids[i:i+chunk]]], fields=fields)
        out.extend(sub)
    return out

extract = {
    'run_at': datetime.now().isoformat(),
    'odoo_url': URL,
    'variant_ids': VARIANT_IDS,
}

# 1. account.move.line for these product variants
print("\n1. Fetching account.move.line for 3 variants...")
aml_fields = ['id', 'move_id', 'product_id', 'product_uom_id', 'quantity',
              'price_unit', 'price_subtotal', 'price_total', 'discount',
              'account_id', 'date', 'date_maturity', 'partner_id',
              'parent_state', 'display_type', 'is_refund',
              'debit', 'credit', 'balance', 'currency_id', 'amount_currency']
aml_ids = call('search', 'account.move.line', [['product_id', 'in', VARIANT_IDS]])
print(f"   aml IDs: {len(aml_ids)}")
amls = search_read_in_chunks('account.move.line', aml_ids, aml_fields, chunk=500)
print(f"   account.move.line records: {len(amls)}")
extract['account_move_line'] = amls

# 2. account.move (parents)
print("\n2. Fetching account.move (parents)...")
move_ids = sorted({l['move_id'][0] for l in amls if l.get('move_id')})
print(f"   Unique move IDs: {len(move_ids)}")
move_fields = ['id', 'name', 'date', 'invoice_date', 'invoice_date_due',
               'state', 'move_type', 'partner_id', 'currency_id',
               'amount_total', 'amount_total_signed', 'amount_untaxed',
               'amount_untaxed_signed', 'amount_residual',
               'journal_id', 'payment_state', 'reversed_entry_id',
               'reversal_move_id', 'company_id']
moves = search_read_in_chunks('account.move', move_ids, move_fields, chunk=500)
print(f"   account.move records: {len(moves)}")
extract['account_move'] = moves

# 3. account.account (chart) — fetch all relevant accounts
print("\n3. Fetching account.account (chart)...")
account_ids = sorted({l['account_id'][0] for l in amls if l.get('account_id')})
print(f"   Unique account IDs: {len(account_ids)}")
account_fields = ['id', 'name', 'code', 'account_type', 'reconcile',
                  'deprecated', 'currency_id', 'company_id']
accounts = search_read_in_chunks('account.account', account_ids, account_fields, chunk=500)
print(f"   account.account records: {len(accounts)}")
extract['account_account'] = accounts

# Summary
print("\n=== Extraction summary ===")
print(f"   account.move.line: {len(amls)}")
print(f"   account.move:      {len(moves)}")
print(f"   account.account:   {len(accounts)}")

# Quick view: per move_type
from collections import Counter
move_types = Counter(m.get('move_type') for m in moves)
states = Counter(m.get('state') for m in moves)
account_types = Counter()
acc_by_id = {a['id']: a for a in accounts}
for l in amls:
    if l.get('account_id'):
        a = acc_by_id.get(l['account_id'][0])
        if a: account_types[a.get('account_type')] += 1

print(f"\n   move_type distribution: {dict(move_types)}")
print(f"   state distribution:     {dict(states)}")
print(f"   account_type distribution (by aml count): {dict(account_types)}")

with open(OUT, 'w') as f:
    json.dump(extract, f, indent=2, ensure_ascii=False, default=str)
if LATEST.exists() or LATEST.is_symlink():
    LATEST.unlink()
LATEST.symlink_to(OUT.name)

print(f"\nSaved: {OUT}")
print(f"Latest pointer: {LATEST}")
print(f"Size: {OUT.stat().st_size / 1024 / 1024:.1f} MB")
