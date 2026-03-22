"""
AI Refill Lite — Data Ingestion Pipeline
Loads CSV data from real_data/ into Supabase PostgreSQL.

Usage:
    python scripts/ingest.py --supabase-url <URL> --supabase-key <SERVICE_ROLE_KEY>

Or set environment variables:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_KEY=your-service-role-key
"""

import csv
import os
import re
import sys
import argparse
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional

from supabase import create_client, Client

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
)
logger = logging.getLogger(__name__)

REAL_DATA_DIR = Path(__file__).resolve().parent.parent / 'real_data'
BATCH_SIZE = 500
SELECT_PAGE_SIZE = 1000


def select_all(supabase: Client, table: str, columns: str) -> list[dict]:
    """
    Select ALL rows from a table, paginating to avoid PostgREST row limits.
    Supabase/PostgREST defaults to max 1000 rows per request.
    """
    all_rows = []
    offset = 0
    while True:
        result = supabase.table(table).select(columns).range(offset, offset + SELECT_PAGE_SIZE - 1).execute()
        if not result.data:
            break
        all_rows.extend(result.data)
        if len(result.data) < SELECT_PAGE_SIZE:
            break
        offset += SELECT_PAGE_SIZE
    return all_rows

# State mapping: Spanish Odoo states -> normalized English
SALE_STATE_MAP = {
    'Cotización': 'draft',
    'Esperando Aprobación': 'draft',
    'Orden de venta': 'sale',
    'Pedido de venta': 'sale',
    'Cancelado': 'cancel',
    'Bloqueado': 'done',
}

PURCHASE_STATE_MAP = {
    'Borrador': 'draft',
    'Solicitud de presupuesto': 'draft',
    'Solicitud de presupuesto enviada': 'sent',
    'Orden de compra': 'purchase',
    'Cancelado': 'cancel',
    'Bloqueado': 'locked',
    'Hecho': 'done',
}

MOVE_STATE_MAP = {
    'done': 'done',
    'Hecho': 'done',
    'Cancelado': 'cancel',
    'cancel': 'cancel',
    'confirmed': 'confirmed',
    'assigned': 'assigned',
    'waiting': 'waiting',
    'draft': 'draft',
}


def parse_bool(val: str) -> bool:
    return val.strip().lower() in ('true', '1', 'yes', 'sí')


def parse_decimal(val: str) -> Optional[float]:
    val = val.strip()
    if not val:
        return None
    try:
        return float(val)
    except ValueError:
        return None


def parse_int(val: str) -> Optional[int]:
    val = val.strip()
    if not val:
        return None
    try:
        return int(float(val))
    except ValueError:
        return None


def parse_datetime(val: str) -> Optional[str]:
    """Parse datetime string to ISO format for Supabase."""
    val = val.strip()
    if not val:
        return None
    try:
        dt = datetime.strptime(val, '%Y-%m-%d %H:%M:%S')
        return dt.isoformat()
    except ValueError:
        try:
            dt = datetime.strptime(val, '%Y-%m-%d')
            return dt.isoformat()
        except ValueError:
            return None


def extract_sku(product_str: str) -> Optional[str]:
    """Extract SKU from Odoo product string like '[77201063] TAPA P/ENV...'"""
    match = re.match(r'\[(\w+)\]', product_str.strip())
    return match.group(1) if match else None


def read_csv(filename: str) -> list[dict]:
    """Read a CSV file from real_data/ and return list of dicts."""
    filepath = REAL_DATA_DIR / filename
    if not filepath.exists():
        logger.warning(f'File not found: {filepath}')
        return []

    rows = []
    with open(filepath, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows


def batch_upsert(supabase: Client, table: str, records: list[dict], conflict_col: str = None) -> int:
    """Insert records in batches. Returns count of inserted records."""
    if not records:
        return 0

    inserted = 0
    for i in range(0, len(records), BATCH_SIZE):
        batch = records[i:i + BATCH_SIZE]
        try:
            if conflict_col:
                supabase.table(table).upsert(batch, on_conflict=conflict_col).execute()
            else:
                supabase.table(table).insert(batch).execute()
            inserted += len(batch)
        except Exception as e:
            logger.error(f'Error inserting batch {i//BATCH_SIZE} into {table}: {e}')
            # Try one-by-one to identify the bad record
            for record in batch:
                try:
                    if conflict_col:
                        supabase.table(table).upsert(record, on_conflict=conflict_col).execute()
                    else:
                        supabase.table(table).insert(record).execute()
                    inserted += 1
                except Exception as e2:
                    logger.error(f'Failed record in {table}: {e2} — data: {record.get("odoo_id", "?")}')
    return inserted


# ============================================================================
# ENTITY LOADERS
# ============================================================================

def load_units_of_measure(supabase: Client) -> dict[str, int]:
    """Load UoM and return mapping of name -> id."""
    logger.info('Loading units_of_measure...')
    rows = read_csv('uom.uom_20260303.csv')
    records = []
    for row in rows:
        odoo_id = parse_int(row['ID'])
        if odoo_id is None:
            continue
        records.append({
            'odoo_id': odoo_id,
            'name': row['Unidad de medida'].strip(),
            'category': row['Categoría'].strip() if row.get('Categoría') else None,
            'ratio': parse_decimal(row.get('Proporción', '1.0')) or 1.0,
        })

    count = batch_upsert(supabase, 'units_of_measure', records, 'odoo_id')
    logger.info(f'  Loaded {count} units of measure')

    # Build lookup
    rows = select_all(supabase, 'units_of_measure', 'id, name')
    return {r['name']: r['id'] for r in rows}


def load_products(supabase: Client) -> dict[str, int]:
    """Load products and return mapping of odoo_id -> id."""
    logger.info('Loading products...')
    rows = read_csv('product.product_20260303.csv')
    records = []
    for row in rows:
        odoo_id = row['ID'].strip()
        if not odoo_id:
            continue
        records.append({
            'odoo_id': odoo_id,
            'sku': row.get('Referencia interna', '').strip() or None,
            'name': row['Nombre'].strip(),
            'category': row.get('Categoría del producto', '').strip() or None,
            'subcategory': row.get('Sub Categoría', '').strip() or None,
            'cost': parse_decimal(row.get('Costo', '')),
            'list_price': parse_decimal(row.get('Precio de venta', '')),
            'stock_uom': row.get('Unidad de medida', '').strip() or None,
            'is_active': parse_bool(row.get('Activo', 'True')),
        })

    count = batch_upsert(supabase, 'products', records, 'odoo_id')
    logger.info(f'  Loaded {count} products')

    # Build lookups: odoo_id -> db id, and sku -> db id
    rows = select_all(supabase, 'products', 'id, odoo_id, sku')
    odoo_map = {r['odoo_id']: r['id'] for r in rows}
    return odoo_map


def build_sku_to_product_id(supabase: Client) -> dict[str, int]:
    """Build SKU -> product DB id lookup."""
    rows = select_all(supabase, 'products', 'id, sku')
    return {r['sku']: r['id'] for r in rows if r['sku']}


def load_customers(supabase: Client) -> dict[str, int]:
    """Load customers (res.partner with customer_rank > 0)."""
    logger.info('Loading customers...')
    rows = read_csv('res.partner_20260303.csv')
    records = []
    for row in rows:
        odoo_id = row['ID'].strip()
        if not odoo_id:
            continue
        customer_rank = parse_int(row.get('Rango del cliente', '0')) or 0
        if customer_rank <= 0:
            continue
        records.append({
            'odoo_id': odoo_id,
            'name': row['Nombre'].strip(),
            'email': row.get('Correo electrónico', '').strip() or None,
            'city': row.get('Ciudad', '').strip() or None,
            'department': row.get('Departamento', '').strip() or None,
            'customer_rank': customer_rank,
        })

    count = batch_upsert(supabase, 'customers', records, 'odoo_id')
    logger.info(f'  Loaded {count} customers')

    rows = select_all(supabase, 'customers', 'id, odoo_id, name')
    # Build name -> id lookup (for joining with sale_orders which use customer name)
    name_map = {r['name']: r['id'] for r in rows}
    odoo_map = {r['odoo_id']: r['id'] for r in rows}
    return name_map, odoo_map


def load_suppliers(supabase: Client) -> dict[str, int]:
    """Load suppliers (res.partner with supplier_rank > 0)."""
    logger.info('Loading suppliers...')
    rows = read_csv('res.partner_20260303.csv')
    records = []
    seen = set()
    for row in rows:
        odoo_id = row['ID'].strip()
        if not odoo_id or odoo_id in seen:
            continue
        supplier_rank = parse_int(row.get('Rango de proveedor', '0')) or 0
        if supplier_rank <= 0:
            continue
        seen.add(odoo_id)
        records.append({
            'odoo_id': odoo_id,
            'name': row['Nombre'].strip(),
            'lead_time_days': 30,  # Default; will be updated from product.supplierinfo
            'is_active': parse_bool(row.get('Activo', 'True')),
        })

    count = batch_upsert(supabase, 'suppliers', records, 'odoo_id')
    logger.info(f'  Loaded {count} suppliers')

    rows = select_all(supabase, 'suppliers', 'id, odoo_id, name')
    name_map = {r['name']: r['id'] for r in rows}
    odoo_map = {r['odoo_id']: r['id'] for r in rows}
    return name_map, odoo_map


def load_product_suppliers(supabase: Client, product_odoo_map: dict, supplier_name_map: dict) -> int:
    """Load product-supplier relationships from product.supplierinfo."""
    logger.info('Loading product_suppliers...')
    rows = read_csv('product.supplierinfo_20260303.csv')
    records = []
    seen = set()

    for row in rows:
        supplier_name = row.get('Proveedor', '').strip()
        product_template = row.get('Plantilla del producto', '').strip()
        if not supplier_name or not product_template:
            continue

        supplier_id = supplier_name_map.get(supplier_name)
        if not supplier_id:
            continue

        sku = extract_sku(product_template)
        if not sku:
            continue

        # Find product by SKU via odoo_id won't work — need to lookup by SKU
        # We'll do a secondary lookup
        product_id = None
        for odoo_id, pid in product_odoo_map.items():
            # This is slow but works for ~2K records
            pass

        # Better: use a pre-built SKU lookup (we'll pass it in)
        # For now, skip and handle after
        key = (sku, supplier_name)
        if key in seen:
            continue
        seen.add(key)

        records.append({
            '_sku': sku,
            '_supplier_name': supplier_name,
            'supplier_price': parse_decimal(row.get('Precio', '0')),
            'lead_time_days': parse_int(row.get('Plazo de entrega', '0')) or 0,
            'currency': row.get('Divisa', 'GTQ').strip(),
            'min_order_qty': parse_decimal(row.get('Cantidad', '1')) or 1,
        })

    # Resolve IDs using SKU lookup
    sku_map = build_sku_to_product_id(supabase)
    final_records = []
    for rec in records:
        product_id = sku_map.get(rec['_sku'])
        supplier_id = supplier_name_map.get(rec['_supplier_name'])
        if not product_id or not supplier_id:
            continue
        del rec['_sku']
        del rec['_supplier_name']
        rec['product_id'] = product_id
        rec['supplier_id'] = supplier_id
        final_records.append(rec)

    count = batch_upsert(supabase, 'product_suppliers', final_records, 'product_id,supplier_id')
    logger.info(f'  Loaded {count} product-supplier relationships')
    return count


def load_warehouses(supabase: Client) -> dict[str, int]:
    """Load warehouses."""
    logger.info('Loading warehouses...')
    rows = read_csv('stock.warehouse_20260303.csv')
    records = []
    for row in rows:
        odoo_id = row['ID'].strip()
        if not odoo_id:
            continue
        records.append({
            'odoo_id': odoo_id,
            'name': row['Almacén'].strip(),
            'code': row.get('Nombre corto', '').strip() or None,
        })

    count = batch_upsert(supabase, 'warehouses', records, 'odoo_id')
    logger.info(f'  Loaded {count} warehouses')

    rows = select_all(supabase, 'warehouses', 'id, odoo_id, name, code')
    name_map = {r['name']: r['id'] for r in rows}
    code_map = {r['code']: r['id'] for r in rows if r['code']}
    odoo_map = {r['odoo_id']: r['id'] for r in rows}
    return name_map, code_map, odoo_map


def load_stock_locations(supabase: Client, warehouse_name_map: dict) -> dict[str, int]:
    """Load stock locations."""
    logger.info('Loading stock_locations...')
    rows = read_csv('stock.location_20260303.csv')
    records = []

    # Map Spanish location types to English
    type_map = {
        'Ubicación interna': 'internal',
        'Vista': 'view',
        'Ubicación de tránsito': 'transit',
        'Producción': 'production',
        'Ajuste de inventario': 'inventory',
        'Ubicación del proveedor': 'supplier',
        'Ubicación de cliente': 'customer',
    }

    for row in rows:
        odoo_id = row['ID'].strip()
        if not odoo_id:
            continue

        wh_name = row.get('Almacén', '').strip()
        warehouse_id = warehouse_name_map.get(wh_name)

        loc_type_spanish = row.get('Tipo de ubicación', '').strip()
        loc_type = type_map.get(loc_type_spanish, loc_type_spanish.lower() if loc_type_spanish else None)

        records.append({
            'odoo_id': odoo_id,
            'name': row.get('Nombre completo de la ubicación', '').strip() or row.get('Nombre de ubicación', '').strip(),
            'warehouse_id': warehouse_id,
            'location_type': loc_type,
            'is_active': parse_bool(row.get('Activo', 'True')),
        })

    count = batch_upsert(supabase, 'stock_locations', records, 'odoo_id')
    logger.info(f'  Loaded {count} stock locations')

    rows = select_all(supabase, 'stock_locations', 'id, odoo_id, name')
    name_map = {r['name']: r['id'] for r in rows}
    odoo_map = {r['odoo_id']: r['id'] for r in rows}
    return name_map, odoo_map


def load_sale_orders(supabase: Client, customer_name_map: dict, wh_name_map: dict) -> dict[str, int]:
    """Load sale orders."""
    logger.info('Loading sale_orders...')
    rows = read_csv('sale.order_20260303.csv')
    records = []

    for row in rows:
        odoo_id = row['ID'].strip()
        if not odoo_id:
            continue

        state_spanish = row.get('Estado', '').strip()
        state = SALE_STATE_MAP.get(state_spanish, state_spanish.lower())

        customer_name = row.get('Cliente', '').strip()
        customer_id = customer_name_map.get(customer_name)

        wh_name = row.get('Almacén', '').strip()
        warehouse_id = wh_name_map.get(wh_name)

        records.append({
            'odoo_id': odoo_id,
            'order_ref': row.get('Referencia de la orden', '').strip(),
            'customer_id': customer_id,
            'order_date': parse_datetime(row.get('Fecha de la orden', '')),
            'delivery_date': parse_datetime(row.get('Fecha de entrega', '')),
            'effective_date': parse_datetime(row.get('Fecha efectiva', '')),
            'state': state,
            'warehouse_id': warehouse_id,
            'total': parse_decimal(row.get('Total', '')),
            'subtotal': parse_decimal(row.get('Subtotal', '')),
            'salesperson': row.get('Vendedor', '').strip() or None,
            'sales_team': row.get('Equipo de ventas', '').strip() or None,
            'pricelist': row.get('Lista de precios', '').strip() or None,
        })

    count = batch_upsert(supabase, 'sale_orders', records, 'odoo_id')
    logger.info(f'  Loaded {count} sale orders')

    # Build order_ref -> id lookup
    rows = select_all(supabase, 'sale_orders', 'id, order_ref')
    logger.info(f'  Built order_ref lookup: {len(rows)} entries')
    return {r['order_ref']: r['id'] for r in rows}


def load_sale_order_lines(supabase: Client, order_ref_map: dict, sku_map: dict) -> int:
    """
    Load sale order lines. Handles hierarchical CSV format where
    ID and order_ref appear only on the first row of each order group.
    """
    logger.info('Loading sale_order_lines...')
    rows = read_csv('sale.order.line_20260303.csv')
    records = []
    current_order_ref = None
    line_count = 0

    for row in rows:
        row_id = row.get('ID', '').strip()
        order_ref = row.get('Referencia de la orden', '').strip()

        # If ID is present, this is a new order group
        if row_id:
            current_order_ref = order_ref

        if not current_order_ref:
            continue

        order_id = order_ref_map.get(current_order_ref)
        if not order_id:
            continue

        # Extract product SKU from the product template column
        product_template = row.get('Líneas de la orden/Plantilla del producto', '').strip()
        sku = extract_sku(product_template)
        if not sku:
            continue

        product_id = sku_map.get(sku)
        if not product_id:
            continue

        qty = parse_decimal(row.get('Líneas de la orden/Cantidad', ''))
        unit_price = parse_decimal(row.get('Líneas de la orden/Precio unitario', ''))
        if qty is None or unit_price is None:
            continue

        records.append({
            'order_id': order_id,
            'product_id': product_id,
            'quantity': qty,
            'delivered_qty': parse_decimal(row.get('Líneas de la orden/Cantidad de entrega', '')) or 0,
            'invoiced_qty': parse_decimal(row.get('Líneas de la orden/Cantidad a facturar', '')) or 0,
            'uom': row.get('Líneas de la orden/Unidad de medida', '').strip() or None,
            'unit_price': unit_price,
            'subtotal': parse_decimal(row.get('Líneas de la orden/Subtotal', '')),
            'discount_pct': parse_decimal(row.get('Líneas de la orden/Descuento (%)', '')) or 0,
        })
        line_count += 1

        # Batch insert periodically to manage memory
        if len(records) >= BATCH_SIZE:
            batch_upsert(supabase, 'sale_order_lines', records)
            records = []

    # Final batch
    if records:
        batch_upsert(supabase, 'sale_order_lines', records)

    logger.info(f'  Loaded {line_count} sale order lines')
    return line_count


def load_purchase_orders(supabase: Client, supplier_name_map: dict) -> dict[str, int]:
    """Load purchase orders."""
    logger.info('Loading purchase_orders...')
    rows = read_csv('purchase.order_20260303.csv')
    records = []

    for row in rows:
        odoo_id = row['ID'].strip()
        if not odoo_id:
            continue

        state_spanish = row.get('Estado', '').strip()
        state = PURCHASE_STATE_MAP.get(state_spanish, state_spanish.lower())

        supplier_name = row.get('Proveedor', '').strip()
        supplier_id = supplier_name_map.get(supplier_name)

        records.append({
            'odoo_id': odoo_id,
            'order_ref': row.get('Referencia de la orden', '').strip(),
            'supplier_id': supplier_id,
            'order_date': parse_datetime(row.get('Fecha límite de la orden', '')),
            'confirmation_date': parse_datetime(row.get('Fecha de confirmación', '')),
            'expected_delivery': parse_datetime(row.get('Entrega esperada', '')),
            'state': state,
            'total': parse_decimal(row.get('Total', '')),
            'currency': row.get('Divisa', 'GTQ').strip(),
            'exchange_rate': parse_decimal(row.get('Tasa de cambio', '')),
            'buyer': row.get('Comprador', '').strip() or None,
        })

    count = batch_upsert(supabase, 'purchase_orders', records, 'odoo_id')
    logger.info(f'  Loaded {count} purchase orders')

    result = supabase.table('purchase_orders').select('id, order_ref').execute()
    return {r['order_ref']: r['id'] for r in result.data}


def load_purchase_order_lines(supabase: Client, sku_map: dict) -> int:
    """
    Load purchase order lines. Hierarchical format — ID only on first row per order.
    Note: PO lines reference order by description, not by a clean ref field.
    """
    logger.info('Loading purchase_order_lines...')
    rows = read_csv('purchase.order.line_20260303.csv')
    records = []

    # Build PO ref -> id from the description field (extract PO ref from it)
    po_rows = select_all(supabase, 'purchase_orders', 'id, order_ref')
    po_ref_map = {r['order_ref']: r['id'] for r in po_rows}

    current_po_id = None
    line_count = 0

    for row in rows:
        row_id = row.get('ID', '').strip()
        description_field = row.get('Líneas de la orden/Referencia de la orden', '').strip()

        # Extract PO reference from description (e.g., "PO-PZ-0088 (PEDIDO NO. 02...)")
        if row_id:
            po_ref_match = re.match(r'(PO-\w+-\d+)', description_field)
            if po_ref_match:
                po_ref = po_ref_match.group(1)
                current_po_id = po_ref_map.get(po_ref)

        if not current_po_id:
            continue

        # Extract SKU from description — PO lines use [0] prefix, not real SKU
        # We'll match by product name instead
        desc = row.get('Líneas de la orden/Descripción', '').strip()
        sku_from_desc = extract_sku(desc)

        product_id = sku_map.get(sku_from_desc) if sku_from_desc else None

        qty = parse_decimal(row.get('Líneas de la orden/Cantidad', ''))
        unit_price = parse_decimal(row.get('Líneas de la orden/Precio unitario', ''))
        if qty is None or unit_price is None:
            continue

        records.append({
            'order_id': current_po_id,
            'product_id': product_id,
            'description': desc,
            'quantity': qty,
            'received_qty': parse_decimal(row.get('Líneas de la orden/Cantidad recibida', '')) or 0,
            'uom': row.get('Líneas de la orden/Unidad de medida', '').strip() or None,
            'unit_price': unit_price,
            'expected_delivery': parse_datetime(row.get('Líneas de la orden/Entrega esperada', '')),
        })
        line_count += 1

        if len(records) >= BATCH_SIZE:
            batch_upsert(supabase, 'purchase_order_lines', records)
            records = []

    if records:
        batch_upsert(supabase, 'purchase_order_lines', records)

    logger.info(f'  Loaded {line_count} purchase order lines')
    return line_count


def load_stock_moves(supabase: Client, sku_map: dict, location_name_map: dict) -> int:
    """
    Load stock moves from multiple quarterly CSV files.
    ~967K rows total.
    """
    logger.info('Loading stock_moves...')

    move_files = [
        'stock.move_2024.csv',
        'stock.move_1erTrimestre_2025.csv',
        'stock.move_2doTrimestre_2025.csv',
        'stock.move_3erTrimestre_2025.csv',
        'stock.move_4toTrimestre_2025.csv',
        'stock.move_2026.csv',
    ]

    total_count = 0

    for filename in move_files:
        filepath = REAL_DATA_DIR / filename
        if not filepath.exists():
            logger.warning(f'  File not found: {filename}')
            continue

        logger.info(f'  Processing {filename}...')
        records = []
        file_count = 0

        with open(filepath, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                odoo_id = row.get('ID', '').strip()
                if not odoo_id:
                    continue

                # Extract SKU from product field: "[77201063] TAPA P/ENV..."
                product_str = row.get('Producto', '').strip()
                sku = extract_sku(product_str)
                product_id = sku_map.get(sku) if sku else None

                if not product_id:
                    continue

                # Resolve locations by name
                from_loc_name = row.get('Desde', '').strip()
                to_loc_name = row.get('A', '').strip()
                from_location_id = location_name_map.get(from_loc_name)
                to_location_id = location_name_map.get(to_loc_name)

                state_raw = row.get('Estado', '').strip()
                state = MOVE_STATE_MAP.get(state_raw, state_raw.lower())

                qty = parse_decimal(row.get('Cantidad', ''))
                if qty is None:
                    continue

                records.append({
                    'odoo_id': odoo_id,
                    'product_id': product_id,
                    'quantity': qty,
                    'uom': row.get('Unidad de medida', '').strip() or None,
                    'from_location_id': from_location_id,
                    'to_location_id': to_location_id,
                    'move_date': parse_datetime(row.get('Fecha', '')),
                    'state': state,
                    'origin': row.get('Origen', '').strip() or None,
                    'picking_ref': row.get('Referencia', '').strip() or None,
                })
                file_count += 1

                if len(records) >= BATCH_SIZE:
                    batch_upsert(supabase, 'stock_moves', records, 'odoo_id')
                    records = []

        if records:
            batch_upsert(supabase, 'stock_moves', records, 'odoo_id')

        total_count += file_count
        logger.info(f'    {filename}: {file_count} moves loaded')

    logger.info(f'  Total stock moves loaded: {total_count}')
    return total_count


def load_stock_quants(supabase: Client, sku_map: dict, location_name_map: dict) -> int:
    """Load stock quants (point-in-time inventory snapshot)."""
    logger.info('Loading stock_quants...')
    rows = read_csv('stock.quant1_20260303.csv')
    records = []

    for row in rows:
        odoo_id = row.get('ID', '').strip()
        if not odoo_id:
            continue

        product_str = row.get('Producto', '').strip()
        sku = extract_sku(product_str)
        product_id = sku_map.get(sku) if sku else None

        loc_name = row.get('Ubicación', '').strip()
        location_id = location_name_map.get(loc_name)

        records.append({
            'odoo_id': odoo_id,
            'product_id': product_id,
            'location_id': location_id,
            'quantity': parse_decimal(row.get('Cantidad', '')) or 0,
            'reserved_qty': parse_decimal(row.get('Cantidad reservada', '')) or 0,
            'entry_date': parse_datetime(row.get('Fecha de entrada', '')),
            'uom': row.get('Unidad de medida', '').strip() or None,
            'snapshot_date': '2026-03-03',  # Date the export was taken
        })

    count = batch_upsert(supabase, 'stock_quants', records, 'odoo_id')
    logger.info(f'  Loaded {count} stock quants')
    return count


def load_exchange_rates(supabase: Client) -> int:
    """Load exchange rates from res.currency CSV."""
    logger.info('Loading exchange_rates...')
    rows = read_csv('res.currency_20260303.csv')
    records = []
    current_currency = None

    for row in rows:
        currency = row.get('Divisa', '').strip()
        rate_str = row.get('Tasa actual', '').strip()
        date_str = row.get('Tasas', '').strip()

        if currency:
            current_currency = currency

        if not date_str or not current_currency:
            continue

        # We only need USD rates (GTQ is base currency with rate 1.0)
        if current_currency != 'USD':
            continue

        rate = parse_decimal(rate_str) if rate_str else None
        if not rate and current_currency == 'USD':
            # For rows without rate, the rate from the first row applies
            continue

        records.append({
            'currency_from': 'USD',
            'currency_to': 'GTQ',
            'rate': 1.0 / rate if rate and rate > 0 else None,  # Convert to GTQ per USD
            'rate_date': date_str,
        })

    # Filter out records with None rate
    records = [r for r in records if r['rate'] is not None]

    count = batch_upsert(supabase, 'exchange_rates', records, 'currency_from,currency_to,rate_date')
    logger.info(f'  Loaded {count} exchange rates')
    return count


# ============================================================================
# MAIN ORCHESTRATION
# ============================================================================

def run_ingestion(supabase: Client) -> None:
    """Run the full data ingestion pipeline in dependency order."""
    start_time = datetime.now()
    logger.info('=' * 60)
    logger.info('AI Refill Lite — Data Ingestion Pipeline')
    logger.info('=' * 60)

    # 1. Reference data (no dependencies)
    uom_map = load_units_of_measure(supabase)

    # 2. Products (no dependencies)
    product_odoo_map = load_products(supabase)
    sku_map = build_sku_to_product_id(supabase)

    # 3. Partners → customers + suppliers
    customer_name_map, customer_odoo_map = load_customers(supabase)
    supplier_name_map, supplier_odoo_map = load_suppliers(supabase)

    # 4. Product-supplier relationships (depends on products + suppliers)
    load_product_suppliers(supabase, product_odoo_map, supplier_name_map)

    # 5. Warehouses + locations
    wh_name_map, wh_code_map, wh_odoo_map = load_warehouses(supabase)
    loc_name_map, loc_odoo_map = load_stock_locations(supabase, wh_name_map)

    # 6. Sales (depends on customers + warehouses)
    order_ref_map = load_sale_orders(supabase, customer_name_map, wh_name_map)

    # 7. Sale order lines (depends on sale_orders + products)
    load_sale_order_lines(supabase, order_ref_map, sku_map)

    # 8. Purchases (depends on suppliers)
    load_purchase_orders(supabase, supplier_name_map)

    # 9. Purchase order lines (depends on purchase_orders + products)
    load_purchase_order_lines(supabase, sku_map)

    # 10. Stock moves (depends on products + locations) — ~967K rows
    load_stock_moves(supabase, sku_map, loc_name_map)

    # 11. Stock quants (depends on products + locations)
    load_stock_quants(supabase, sku_map, loc_name_map)

    # 12. Exchange rates
    load_exchange_rates(supabase)

    elapsed = datetime.now() - start_time
    logger.info('=' * 60)
    logger.info(f'Ingestion complete in {elapsed}')
    logger.info('=' * 60)
    logger.info('')
    logger.info('Next steps:')
    logger.info('  1. Run inventory reconstruction:')
    logger.info('     SELECT reconstruct_inventory_daily();')
    logger.info('  2. Run demand aggregation with Census Filter:')
    logger.info('     SELECT aggregate_demand_daily();')


def main():
    parser = argparse.ArgumentParser(description='AI Refill Lite — Data Ingestion')
    parser.add_argument('--supabase-url', default=os.environ.get('SUPABASE_URL'))
    parser.add_argument('--supabase-key', default=os.environ.get('SUPABASE_SERVICE_KEY'))
    args = parser.parse_args()

    if not args.supabase_url or not args.supabase_key:
        print('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set')
        print('  Either pass --supabase-url and --supabase-key')
        print('  Or set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables')
        sys.exit(1)

    supabase = create_client(args.supabase_url, args.supabase_key)
    run_ingestion(supabase)


if __name__ == '__main__':
    main()
