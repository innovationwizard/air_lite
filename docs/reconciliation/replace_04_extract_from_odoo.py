"""
Step 04 — Extract ALL Odoo live data for SKU 77201046 (3 product.product variants).

Variants:
  - id=7090 active   (template 9764)
  - id=1541 archived (template 1568)
  - id=2371 archived (template 1568 likely — confirm)

Extracts and persists to JSON:
  - product.product (3 records)
  - uom.uom (all, for ratio normalization)
  - sale.order.line WHERE product_id IN (...)
  - sale.order (parents of those lines)
  - res.partner (distinct partner_ids referenced)
  - stock.warehouse (distinct warehouse_ids referenced)
  - purchase.order.line WHERE product_id IN (...)
  - purchase.order (parents)
  - stock.move WHERE product_id IN (...)
  - stock.quant WHERE product_id IN (...)
  - stock.location (distinct locations referenced by moves/quants)
"""
import os
import json
import xmlrpc.client
from datetime import datetime
from pathlib import Path

TS = datetime.now().strftime('%Y%m%d_%H%M%S')
OUT = Path(f'/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_77201046_{TS}.json')
LATEST = Path('/Users/jorgeluiscontrerasherrera/Documents/_git/air_lite/docs/reconciliation/odoo_extract_77201046_latest.json')
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

def read_chunked(model, ids, fields, chunk=500):
    """Read records by id using search_read with ('id','in',...) domain.
    We use search_read rather than read() because Odoo ACLs in this tenant
    allow search_read but reject direct read() on res.partner (observed 2026-04-23)."""
    out = []
    ids = list(ids)
    for i in range(0, len(ids), chunk):
        sub = call('search_read', model, [['id', 'in', ids[i:i+chunk]]], fields=fields)
        out.extend(sub)
    return out

def search_all(model, domain, fields, chunk=500):
    """search_read by domain in chunks via id-range pagination."""
    all_ids = call('search', model, domain)
    return read_chunked(model, all_ids, fields, chunk=chunk)

extract = {
    'run_at': datetime.now().isoformat(),
    'odoo_url': URL,
    'variant_ids': VARIANT_IDS,
}

# 1. product.product
print("\n1. Fetching product.product records...")
product_fields = ['id', 'default_code', 'name', 'active', 'product_tmpl_id',
                  'uom_id', 'uom_po_id', 'categ_id', 'standard_price', 'list_price',
                  'barcode', 'volume', 'weight', 'x_studio_alto', 'x_studio_ancho', 'x_studio_largo']
products = call('search_read', 'product.product',
                [['id', 'in', VARIANT_IDS], '|', ['active', '=', True], ['active', '=', False]],
                fields=product_fields)
print(f"   Products: {len(products)}")
for p in products:
    print(f"     id={p['id']} active={p['active']} name={p['name']!r} tmpl={p['product_tmpl_id']}")
extract['product_product'] = products

# 2. uom.uom (all UoMs in the product's category)
print("\n2. Fetching uom.uom (all)...")
uoms = call('search_read', 'uom.uom', [], fields=['id', 'name', 'factor', 'category_id', 'uom_type'])
print(f"   UoMs: {len(uoms)}")
extract['uom_uom'] = uoms

# 3. sale.order.line
print("\n3. Fetching sale.order.line WHERE product_id in variants...")
sol_fields = ['id', 'order_id', 'product_id', 'product_uom', 'product_uom_qty',
              'qty_delivered', 'qty_invoiced', 'price_unit', 'price_subtotal',
              'price_total', 'discount', 'state']
sols = search_all('sale.order.line', [['product_id', 'in', VARIANT_IDS]], sol_fields)
print(f"   Lines: {len(sols)}")
extract['sale_order_line'] = sols

# 4. sale.order (parents)
print("\n4. Fetching sale.order (parents)...")
so_fields = ['id', 'name', 'partner_id', 'partner_shipping_id', 'date_order',
             'commitment_date', 'effective_date', 'state', 'warehouse_id',
             'amount_total', 'amount_untaxed', 'user_id', 'team_id', 'pricelist_id',
             'company_id']
so_ids = sorted({l['order_id'][0] for l in sols if l.get('order_id')})
print(f"   Unique order IDs: {len(so_ids)}")
sos = read_chunked('sale.order', so_ids, so_fields) if so_ids else []
print(f"   Orders: {len(sos)}")
extract['sale_order'] = sos

# 5. res.partner (distinct partners on these orders)
print("\n5. Fetching res.partner for those orders...")
partner_ids = sorted({o['partner_id'][0] for o in sos if o.get('partner_id')})
print(f"   Unique partner IDs: {len(partner_ids)}")
partner_fields = ['id', 'name', 'email', 'city', 'country_id', 'state_id',
                  'customer_rank', 'active']
partners = read_chunked('res.partner', partner_ids, partner_fields) if partner_ids else []
print(f"   Partners: {len(partners)}")
extract['res_partner_customers'] = partners

# 6. stock.warehouse (distinct)
print("\n6. Fetching stock.warehouse referenced...")
wh_ids = sorted({o['warehouse_id'][0] for o in sos if o.get('warehouse_id')})
print(f"   Unique warehouse IDs: {len(wh_ids)}")
wh_fields = ['id', 'name', 'code', 'company_id', 'active']
whs = read_chunked('stock.warehouse', wh_ids, wh_fields) if wh_ids else []
print(f"   Warehouses: {len(whs)}")
extract['stock_warehouse'] = whs

# 7. purchase.order.line
print("\n7. Fetching purchase.order.line WHERE product_id in variants...")
pol_fields = ['id', 'order_id', 'product_id', 'product_uom', 'product_qty',
              'qty_received', 'qty_invoiced', 'price_unit', 'price_subtotal',
              'date_planned', 'state']
pols = search_all('purchase.order.line', [['product_id', 'in', VARIANT_IDS]], pol_fields)
print(f"   PO lines: {len(pols)}")
extract['purchase_order_line'] = pols

# 8. purchase.order parents
print("\n8. Fetching purchase.order (parents)...")
po_fields = ['id', 'name', 'partner_id', 'date_order', 'date_approve',
             'date_planned', 'effective_date', 'state', 'amount_total',
             'amount_untaxed', 'user_id', 'company_id']
po_ids = sorted({l['order_id'][0] for l in pols if l.get('order_id')})
print(f"   Unique PO IDs: {len(po_ids)}")
pos = read_chunked('purchase.order', po_ids, po_fields) if po_ids else []
print(f"   Purchase orders: {len(pos)}")
extract['purchase_order'] = pos

# 9. res.partner for suppliers
print("\n9. Fetching res.partner suppliers...")
sup_ids = sorted({o['partner_id'][0] for o in pos if o.get('partner_id')})
print(f"   Unique supplier IDs: {len(sup_ids)}")
suppliers = read_chunked('res.partner', sup_ids,
                         ['id', 'name', 'supplier_rank', 'active']) if sup_ids else []
print(f"   Suppliers: {len(suppliers)}")
extract['res_partner_suppliers'] = suppliers

# 10. stock.move
print("\n10. Fetching stock.move WHERE product_id in variants...")
sm_fields = ['id', 'product_id', 'product_uom', 'product_uom_qty', 'quantity',
             'state', 'location_id', 'location_dest_id', 'date',
             'date_deadline', 'origin', 'reference', 'picking_id',
             'purchase_line_id', 'sale_line_id', 'company_id']
sms = search_all('stock.move', [['product_id', 'in', VARIANT_IDS]], sm_fields, chunk=1000)
print(f"   Stock moves: {len(sms)}")
extract['stock_move'] = sms

# 11. stock.quant (current inventory)
print("\n11. Fetching stock.quant WHERE product_id in variants...")
sq_fields = ['id', 'product_id', 'location_id', 'quantity', 'reserved_quantity',
             'in_date', 'product_uom_id', 'company_id']
sqs = call('search_read', 'stock.quant', [['product_id', 'in', VARIANT_IDS]], fields=sq_fields)
print(f"   Stock quants: {len(sqs)}")
extract['stock_quant'] = sqs

# 12. stock.location (distinct)
print("\n12. Fetching stock.location (referenced by moves + quants)...")
loc_ids = set()
for m in sms:
    if m.get('location_id'): loc_ids.add(m['location_id'][0])
    if m.get('location_dest_id'): loc_ids.add(m['location_dest_id'][0])
for q in sqs:
    if q.get('location_id'): loc_ids.add(q['location_id'][0])
loc_ids = sorted(loc_ids)
print(f"   Unique location IDs: {len(loc_ids)}")
loc_fields = ['id', 'name', 'complete_name', 'usage', 'warehouse_id', 'active']
locs = read_chunked('stock.location', loc_ids, loc_fields) if loc_ids else []
print(f"   Locations: {len(locs)}")
extract['stock_location'] = locs

# Sizing summary
summary = {k: len(v) if isinstance(v, list) else 1
           for k, v in extract.items() if k not in ('run_at', 'odoo_url', 'variant_ids')}
extract['_summary_counts'] = summary
print(f"\n=== Extraction summary ===")
for k, v in summary.items():
    print(f"   {k}: {v}")

with open(OUT, 'w') as f:
    json.dump(extract, f, indent=2, ensure_ascii=False, default=str)
# symlink-like copy for easy reference
if LATEST.exists() or LATEST.is_symlink():
    LATEST.unlink()
LATEST.symlink_to(OUT.name)

print(f"\nSaved: {OUT}")
print(f"Latest pointer: {LATEST}")
print(f"Size: {OUT.stat().st_size / 1024 / 1024:.1f} MB")
