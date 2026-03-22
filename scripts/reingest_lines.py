"""
Re-ingest sale_order_lines, purchase_order_lines, and stock_moves
with the paginated lookup fix.
"""
import os
import sys
sys.path.insert(0, os.path.dirname(__file__))

from supabase import create_client
from ingest import (
    select_all, build_sku_to_product_id,
    load_sale_order_lines, load_purchase_order_lines,
    load_stock_moves, logger,
)


def main():
    url = os.environ.get('NEXT_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not url or not key:
        print('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
        sys.exit(1)

    supabase = create_client(url, key)

    # Build paginated lookups
    logger.info('Building paginated lookups...')

    sku_map = build_sku_to_product_id(supabase)
    logger.info(f'  sku_map: {len(sku_map)} entries')

    so_rows = select_all(supabase, 'sale_orders', 'id, order_ref')
    order_ref_map = {r['order_ref']: r['id'] for r in so_rows}
    logger.info(f'  order_ref_map: {len(order_ref_map)} entries')

    loc_rows = select_all(supabase, 'stock_locations', 'id, name')
    loc_name_map = {r['name']: r['id'] for r in loc_rows}
    logger.info(f'  location_name_map: {len(loc_name_map)} entries')

    # Re-ingest
    load_sale_order_lines(supabase, order_ref_map, sku_map)
    load_purchase_order_lines(supabase, sku_map)
    load_stock_moves(supabase, sku_map, loc_name_map)

    logger.info('Re-ingestion complete.')


if __name__ == '__main__':
    main()
