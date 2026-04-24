"""
Probe Odoo live for data-quality issues around Reyma / Carvajal supplier names
and product naming. Goal: decide between Option A (supplier link) vs Option B
(product name) vs Option C (cheat sheet list) for SKU identification.

Outputs:
  1. All res.partner whose name contains 'reyma' or 'carvajal' (case-insensitive)
     — supplier_rank, customer_rank, active, possible duplicates
  2. All product.supplierinfo rows where partner is one of the above
     — product mapping
  3. All product.product whose name OR default_code contains the relevant terms
  4. Cross-reference matrix:
     A) Products with Reyma in name AND Reyma supplier link
     B) Products with Reyma in name BUT NO Reyma supplier link  ← gap
     C) Products with Reyma supplier link BUT NO "REYMA" in name ← weird placement
  5. Spelling variants / typos
"""
import os
import json
import xmlrpc.client
from collections import defaultdict
from datetime import datetime
from pathlib import Path

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/find_09_supplier_probe_results.json')

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

# ─── 1. Search res.partner for Reyma / Carvajal variants ────────────────
print("\n=== 1. res.partner candidates (name OR ref contains the term, any case) ===")

# ilike is case-insensitive in Odoo
partner_fields = ['id', 'name', 'ref', 'supplier_rank', 'customer_rank',
                  'active', 'parent_id', 'is_company', 'company_type', 'vat']

reyma_partners = call('search_read', 'res.partner',
                       ['|', ['active', '=', True], ['active', '=', False],
                        '|', ['name', 'ilike', 'reyma'], ['ref', 'ilike', 'reyma']],
                       fields=partner_fields)
print(f"   'reyma' partners: {len(reyma_partners)}")
for p in reyma_partners[:30]:
    print(f"     id={p['id']:>6}  active={p['active']}  s_rank={p.get('supplier_rank',0):>2}  c_rank={p.get('customer_rank',0):>2}  name={p['name']!r}  ref={p.get('ref')!r}")

carvajal_partners = call('search_read', 'res.partner',
                          ['|', ['active', '=', True], ['active', '=', False],
                           '|', ['name', 'ilike', 'carvajal'], ['ref', 'ilike', 'carvajal']],
                          fields=partner_fields)
print(f"\n   'carvajal' partners: {len(carvajal_partners)}")
for p in carvajal_partners[:30]:
    print(f"     id={p['id']:>6}  active={p['active']}  s_rank={p.get('supplier_rank',0):>2}  c_rank={p.get('customer_rank',0):>2}  name={p['name']!r}  ref={p.get('ref')!r}")

# Probable spelling variants to also probe
print("\n=== 1b. Spelling variants probe ===")
variant_terms = ['reima', 'reymak', 'reymax', 'reymen', 'rayma',  # reyma variants
                 'carbajal', 'caravajal', 'carbahal', 'kabajal',  # carvajal variants
                 'duroport', 'plasticentro', 'foam',               # product/parent indicators
                 'biopack', 'grupo phoenix', 'fox']                # known competitors / co-brands
for term in variant_terms:
    res = call('search_read', 'res.partner',
                ['|', ['active', '=', True], ['active', '=', False],
                 '|', ['name', 'ilike', term], ['ref', 'ilike', term]],
                fields=['id', 'name', 'supplier_rank', 'customer_rank', 'active'])
    if res:
        print(f"   '{term}': {len(res)} partners")
        for p in res[:5]:
            print(f"     id={p['id']:>6} active={p['active']} s={p.get('supplier_rank',0)} c={p.get('customer_rank',0)} name={p['name']!r}")

# ─── 2. product.supplierinfo for those partners ────────────────────────
print("\n=== 2. product.supplierinfo links ===")
all_target_partner_ids = sorted({p['id'] for p in reyma_partners + carvajal_partners})
print(f"   Probing supplierinfo for {len(all_target_partner_ids)} partner IDs...")

if all_target_partner_ids:
    supinfo_fields = ['id', 'partner_id', 'product_id', 'product_tmpl_id',
                      'product_code', 'product_name', 'min_qty', 'price', 'delay']
    supinfos = call('search_read', 'product.supplierinfo',
                     [['partner_id', 'in', all_target_partner_ids]],
                     fields=supinfo_fields)
    print(f"   product.supplierinfo rows: {len(supinfos)}")
    by_partner = defaultdict(list)
    for s in supinfos:
        by_partner[s['partner_id'][1] if s.get('partner_id') else 'NONE'].append(s)
    for pname, items in sorted(by_partner.items(), key=lambda x: -len(x[1])):
        print(f"     {pname}: {len(items)} products linked")
else:
    supinfos = []

# ─── 3. product.product by name pattern ────────────────────────────────
print("\n=== 3. product.product by name pattern ===")
product_fields = ['id', 'name', 'default_code', 'active', 'product_tmpl_id', 'uom_id']

reyma_products = call('search_read', 'product.product',
                       ['|', ['active', '=', True], ['active', '=', False],
                        ['name', 'ilike', 'reyma']],
                       fields=product_fields)
print(f"   Products with 'REYMA' in name (any case, active+archived): {len(reyma_products)}")
print(f"     active: {sum(1 for p in reyma_products if p['active'])}, archived: {sum(1 for p in reyma_products if not p['active'])}")

carvajal_products = call('search_read', 'product.product',
                          ['|', ['active', '=', True], ['active', '=', False],
                           ['name', 'ilike', 'carvajal']],
                          fields=product_fields)
print(f"   Products with 'CARVAJAL' in name (any case, active+archived): {len(carvajal_products)}")
print(f"     active: {sum(1 for p in carvajal_products if p['active'])}, archived: {sum(1 for p in carvajal_products if not p['active'])}")

# ─── 4. Cross-reference matrix ─────────────────────────────────────────
print("\n=== 4. Cross-reference matrix ===")
# Build sets
reyma_partner_ids = {p['id'] for p in reyma_partners}
carvajal_partner_ids = {p['id'] for p in carvajal_partners}

reyma_prod_ids_by_name = {p['id'] for p in reyma_products}
carvajal_prod_ids_by_name = {p['id'] for p in carvajal_products}

# Products linked to Reyma supplier
reyma_prod_ids_by_supplier = set()
carvajal_prod_ids_by_supplier = set()
template_to_partner = defaultdict(set)
for s in supinfos:
    pid = s.get('partner_id', [None])[0] if s.get('partner_id') else None
    if not pid: continue
    if s.get('product_id'):
        prod_id = s['product_id'][0]
        if pid in reyma_partner_ids: reyma_prod_ids_by_supplier.add(prod_id)
        if pid in carvajal_partner_ids: carvajal_prod_ids_by_supplier.add(prod_id)
    elif s.get('product_tmpl_id'):
        # supplier links can be at template level
        tmpl_id = s['product_tmpl_id'][0]
        if pid in reyma_partner_ids: template_to_partner[tmpl_id].add(('reyma', pid))
        if pid in carvajal_partner_ids: template_to_partner[tmpl_id].add(('carvajal', pid))

print(f"   product.supplierinfo direct product links: reyma={len(reyma_prod_ids_by_supplier)}, carvajal={len(carvajal_prod_ids_by_supplier)}")
print(f"   product.supplierinfo template-level links: {len(template_to_partner)} templates")

# Resolve template-level to product-level
if template_to_partner:
    tmpl_ids = list(template_to_partner.keys())
    tmpl_products = call('search_read', 'product.product',
                          ['|', ['active', '=', True], ['active', '=', False],
                           ['product_tmpl_id', 'in', tmpl_ids]],
                          fields=['id', 'product_tmpl_id'])
    for tp in tmpl_products:
        tid = tp['product_tmpl_id'][0]
        labels = template_to_partner.get(tid, set())
        if any(l[0] == 'reyma' for l in labels):
            reyma_prod_ids_by_supplier.add(tp['id'])
        if any(l[0] == 'carvajal' for l in labels):
            carvajal_prod_ids_by_supplier.add(tp['id'])
print(f"   After template-resolution: reyma={len(reyma_prod_ids_by_supplier)}, carvajal={len(carvajal_prod_ids_by_supplier)}")

# 4a. Products with name match BUT no supplier link
reyma_name_only = reyma_prod_ids_by_name - reyma_prod_ids_by_supplier
reyma_supplier_only = reyma_prod_ids_by_supplier - reyma_prod_ids_by_name
reyma_both = reyma_prod_ids_by_name & reyma_prod_ids_by_supplier

carvajal_name_only = carvajal_prod_ids_by_name - carvajal_prod_ids_by_supplier
carvajal_supplier_only = carvajal_prod_ids_by_supplier - carvajal_prod_ids_by_name
carvajal_both = carvajal_prod_ids_by_name & carvajal_prod_ids_by_supplier

print(f"\n   REYMA — name AND supplier link: {len(reyma_both)}")
print(f"   REYMA — name match BUT NO supplier link: {len(reyma_name_only)}  ← visible to name-rule, missed by supplier-rule")
print(f"   REYMA — supplier link BUT NO 'REYMA' in name: {len(reyma_supplier_only)}  ← visible to supplier-rule, missed by name-rule")

print(f"\n   CARVAJAL — name AND supplier link: {len(carvajal_both)}")
print(f"   CARVAJAL — name match BUT NO supplier link: {len(carvajal_name_only)}")
print(f"   CARVAJAL — supplier link BUT NO 'CARVAJAL' in name: {len(carvajal_supplier_only)}")

# Sample the gaps
def fetch_samples(ids, n=10):
    if not ids: return []
    sample_ids = list(ids)[:n]
    return call('search_read', 'product.product',
                 ['|', ['active', '=', True], ['active', '=', False],
                  ['id', 'in', sample_ids]],
                 fields=['id', 'name', 'default_code', 'active'])

print(f"\n   Sample REYMA name-only (no supplier link):")
for s in fetch_samples(reyma_name_only, 15):
    print(f"     id={s['id']:>5} active={s['active']} sku={s.get('default_code')!r} name={s['name']!r}")

print(f"\n   Sample REYMA supplier-only (no 'REYMA' in name):")
for s in fetch_samples(reyma_supplier_only, 15):
    print(f"     id={s['id']:>5} active={s['active']} sku={s.get('default_code')!r} name={s['name']!r}")

print(f"\n   Sample CARVAJAL name-only (no supplier link):")
for s in fetch_samples(carvajal_name_only, 15):
    print(f"     id={s['id']:>5} active={s['active']} sku={s.get('default_code')!r} name={s['name']!r}")

print(f"\n   Sample CARVAJAL supplier-only (no 'CARVAJAL' in name):")
for s in fetch_samples(carvajal_supplier_only, 15):
    print(f"     id={s['id']:>5} active={s['active']} sku={s.get('default_code')!r} name={s['name']!r}")

# Persist
result = {
    'run_at': datetime.now().isoformat(),
    'reyma_partners': reyma_partners,
    'carvajal_partners': carvajal_partners,
    'product_supplierinfo_count': len(supinfos),
    'counts': {
        'reyma_products_by_name': len(reyma_prod_ids_by_name),
        'reyma_products_by_supplier_link': len(reyma_prod_ids_by_supplier),
        'reyma_overlap': len(reyma_both),
        'reyma_name_only': len(reyma_name_only),
        'reyma_supplier_only': len(reyma_supplier_only),
        'carvajal_products_by_name': len(carvajal_prod_ids_by_name),
        'carvajal_products_by_supplier_link': len(carvajal_prod_ids_by_supplier),
        'carvajal_overlap': len(carvajal_both),
        'carvajal_name_only': len(carvajal_name_only),
        'carvajal_supplier_only': len(carvajal_supplier_only),
    },
    'name_only_samples': {
        'reyma': fetch_samples(reyma_name_only, 30),
        'carvajal': fetch_samples(carvajal_name_only, 30),
    },
    'supplier_only_samples': {
        'reyma': fetch_samples(reyma_supplier_only, 30),
        'carvajal': fetch_samples(carvajal_supplier_only, 30),
    },
}
OUT.write_text(json.dumps(result, indent=2, ensure_ascii=False, default=str))
print(f"\nSaved: {OUT}")
