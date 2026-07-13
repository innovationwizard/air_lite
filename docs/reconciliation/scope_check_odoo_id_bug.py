"""
Scope check for the products.odoo_id mismatch bug.

Quantifies:
  Q1: How many products in Supabase prod DB have odoo_id that does NOT exist
      as a product.product.id in Odoo live (i.e., odoo_id is template id, not variant id)?
  Q2: How many SKUs in Odoo live have multiple product.product records (any state)?
  Q3: How many SKUs in Odoo live have multiple ACTIVE product.product records
      (the truly dangerous case for SKU-based matching)?
  Q4: How many products in Supabase prod DB cannot be resolved to ANY product.product
      in Odoo live by SKU?
  Q5: For products where Supabase odoo_id == an Odoo template_id, do those templates
      have exactly 1 variant or multiple variants?

Output: scope_check_odoo_id_bug_results.json + printed summary.
"""
import os
import json
import urllib.request
import urllib.parse
import xmlrpc.client
from collections import defaultdict
from datetime import datetime
from pathlib import Path

OUT = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/scope_check_odoo_id_bug_results.json')

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

SUPA_URL = os.environ['NEXT_PUBLIC_SUPABASE_URL']
SUPA_KEY = os.environ['SUPABASE_SECRET_KEY']
ODOO_URL = os.environ['ODOO_URL']
ODOO_DB = os.environ['ODOO_DB']
ODOO_USER = os.environ['ODOO_USERNAME']
ODOO_KEY = os.environ['ODOO_API_KEY']

# --- Supabase: pull all products ---
print("Fetching Supabase products...")
all_supa = []
offset = 0
while True:
    qs = urllib.parse.urlencode([('select', 'id,sku,odoo_id,name,is_active'), ('order', 'id.asc'),
                                  ('offset', str(offset)), ('limit', '1000')])
    req = urllib.request.Request(f"{SUPA_URL}/rest/v1/products?{qs}",
                                  headers={'apikey': SUPA_KEY, 'Authorization': f'Bearer {SUPA_KEY}'})
    with urllib.request.urlopen(req) as r:
        batch = json.loads(r.read().decode())
    if not batch: break
    all_supa.extend(batch)
    if len(batch) < 1000: break
    offset += 1000
print(f"Supabase products: {len(all_supa)}")
supa_by_sku = defaultdict(list)
for p in all_supa:
    if p.get('sku'):
        supa_by_sku[p['sku']].append(p)
print(f"Distinct SKUs in Supabase: {len(supa_by_sku)}")
multi_sku_supa = {sku: ps for sku, ps in supa_by_sku.items() if len(ps) > 1}
print(f"SKUs with >1 row in Supabase: {len(multi_sku_supa)}")

# --- Odoo live auth ---
print(f"\nAuth → Odoo live")
common = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/common', allow_none=True)
uid = common.authenticate(ODOO_DB, ODOO_USER, ODOO_KEY, {})
print(f"uid={uid}")
models = xmlrpc.client.ServerProxy(f'{ODOO_URL}/xmlrpc/2/object', allow_none=True)
def call(method, model, *args, **kwargs):
    return models.execute_kw(ODOO_DB, uid, ODOO_KEY, model, method, list(args), kwargs)

# --- Odoo: pull ALL product.product (active + archived) ---
print("Fetching ALL product.product from Odoo (active + archived)...")
all_pp = call('search_read', 'product.product',
              ['|', ['active', '=', True], ['active', '=', False]],
              fields=['id', 'default_code', 'name', 'active', 'product_tmpl_id'])
print(f"Odoo product.product: {len(all_pp)}")

# Index by id, by sku
pp_by_id = {p['id']: p for p in all_pp}
pp_by_sku = defaultdict(list)
for p in all_pp:
    sku = (p.get('default_code') or '').strip()
    if sku:
        pp_by_sku[sku].append(p)

# --- Odoo: pull ALL product.template ---
print("Fetching ALL product.template from Odoo (active + archived)...")
all_pt = call('search_read', 'product.template',
              ['|', ['active', '=', True], ['active', '=', False]],
              fields=['id', 'default_code', 'name', 'active', 'product_variant_count'])
print(f"Odoo product.template: {len(all_pt)}")
pt_by_id = {t['id']: t for t in all_pt}

# --- Q1: Supabase odoo_id NOT matching product.product.id ---
not_in_pp = []
in_pp_active = []
in_pp_archived = []
for p in all_supa:
    try:
        oid = int(p['odoo_id']) if p.get('odoo_id') is not None else None
    except (ValueError, TypeError):
        oid = None
    if oid is None: continue
    if oid in pp_by_id:
        if pp_by_id[oid]['active']:
            in_pp_active.append((p, pp_by_id[oid]))
        else:
            in_pp_archived.append((p, pp_by_id[oid]))
    else:
        not_in_pp.append(p)

print(f"\n=== Q1: Supabase odoo_id vs Odoo product.product.id ===")
print(f"  Total Supabase products with odoo_id: {sum(1 for p in all_supa if p.get('odoo_id') is not None)}")
print(f"  odoo_id matches active product.product.id:    {len(in_pp_active)}")
print(f"  odoo_id matches archived product.product.id:  {len(in_pp_archived)}")
print(f"  odoo_id does NOT match any product.product.id: {len(not_in_pp)}  ← LIKELY TEMPLATE IDs")

# Q5: of not_in_pp, how many match a product.template.id?
matches_template = []
matches_template_singletvariant = 0
matches_template_multivariant = 0
matches_nothing = []
for p in not_in_pp:
    oid = int(p['odoo_id'])
    if oid in pt_by_id:
        t = pt_by_id[oid]
        matches_template.append((p, t))
        vc = t.get('product_variant_count') or 0
        if vc <= 1:
            matches_template_singletvariant += 1
        else:
            matches_template_multivariant += 1
    else:
        matches_nothing.append(p)

print(f"\n=== Q5: Of those that don't match product.product.id, what do they match? ===")
print(f"  Match product.template.id: {len(matches_template)}")
print(f"    of which template has 1 variant (safe):     {matches_template_singletvariant}")
print(f"    of which template has >1 variants (broken): {matches_template_multivariant}")
print(f"  Match nothing in Odoo live (orphan):           {len(matches_nothing)}")

# --- Q2 & Q3: SKU multiplicity in Odoo live ---
multi_sku = {sku: ps for sku, ps in pp_by_sku.items() if len(ps) > 1}
multi_sku_active = {sku: [p for p in ps if p['active']] for sku, ps in multi_sku.items()}
multi_sku_active_only = {sku: ps for sku, ps in multi_sku_active.items() if len(ps) > 1}

print(f"\n=== Q2 & Q3: SKU multiplicity in Odoo live product.product ===")
print(f"  Distinct SKUs in Odoo live: {len(pp_by_sku)}")
print(f"  SKUs with >1 product.product (any state): {len(multi_sku)}")
print(f"  SKUs with >1 ACTIVE product.product:      {len(multi_sku_active_only)}  ← truly dangerous")

# --- Q4: Supabase products with no SKU match in Odoo live ---
unmatched_by_sku = [p for p in all_supa if p.get('sku') and p['sku'] not in pp_by_sku]
no_sku = [p for p in all_supa if not p.get('sku')]
print(f"\n=== Q4: Supabase products unresolvable by SKU in Odoo live ===")
print(f"  No SKU in Supabase: {len(no_sku)}")
print(f"  SKU not in Odoo live product.product: {len(unmatched_by_sku)}")

# --- Build summary ---
result = {
    'run_at': datetime.now().isoformat(),
    'odoo_url': ODOO_URL,
    'supabase_url': SUPA_URL,
    'counts': {
        'supabase_products_total': len(all_supa),
        'supabase_distinct_skus': len(supa_by_sku),
        'supabase_skus_with_dupes': len(multi_sku_supa),
        'supabase_products_no_sku': len(no_sku),
        'odoo_product_product_total_active_and_archived': len(all_pp),
        'odoo_distinct_skus': len(pp_by_sku),
        'odoo_template_total': len(all_pt),
    },
    'Q1_supabase_odoo_id_resolution': {
        'matches_active_pp': len(in_pp_active),
        'matches_archived_pp': len(in_pp_archived),
        'does_not_match_any_pp': len(not_in_pp),
    },
    'Q5_of_unmatched_what_do_they_match': {
        'match_product_template': len(matches_template),
        'match_template_with_1_variant_safe': matches_template_singletvariant,
        'match_template_with_multi_variants_broken': matches_template_multivariant,
        'match_nothing_orphan': len(matches_nothing),
    },
    'Q2_skus_with_multiple_pp_in_odoo': len(multi_sku),
    'Q3_skus_with_multiple_active_pp_in_odoo': len(multi_sku_active_only),
    'Q4_supabase_skus_not_in_odoo_live': len(unmatched_by_sku),
    'samples': {
        'multi_sku_active_in_odoo': dict(list(multi_sku_active_only.items())[:10]),
        'orphan_supabase_products': matches_nothing[:10],
        'broken_multivariant_template_matches': [
            {'supabase': sp, 'odoo_template': ot}
            for sp, ot in [(sp, ot) for sp, ot in matches_template if (ot.get('product_variant_count') or 0) > 1][:10]
        ],
    },
}

with open(OUT, 'w') as f:
    json.dump(result, f, indent=2, ensure_ascii=False, default=str)
print(f"\nSaved: {OUT}")
