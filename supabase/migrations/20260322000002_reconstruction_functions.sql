-- ============================================================================
-- AI Refill Lite — Inventory Reconstruction & Demand Aggregation
-- ============================================================================
-- These functions build the two critical derived tables:
--   1. inventory_daily — reconstructed historical inventory positions
--   2. demand_daily — daily demand with Census Filter applied
-- ============================================================================

-- ============================================================================
-- FUNCTION: reconstruct_inventory_daily
-- ============================================================================
-- Reconstructs historical daily inventory levels by working BACKWARDS
-- from the stock.quant snapshot (2026-03-03) through all stock moves.
--
-- Algorithm:
--   For each (product, warehouse):
--     Start with snapshot quantity on 2026-03-03
--     For each day going backwards:
--       Reverse the day's moves: add outgoing, subtract incoming
--       Store the resulting quantity for that day
-- ============================================================================

CREATE OR REPLACE FUNCTION reconstruct_inventory_daily()
RETURNS TABLE(products_processed INT, days_generated INT, duration_ms INT) AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
  v_products_processed INT := 0;
  v_days_generated INT := 0;
  v_snapshot_date DATE := '2026-03-03';
  v_data_start DATE := '2024-10-01';
  rec RECORD;
BEGIN
  -- Clear existing data
  TRUNCATE inventory_daily;

  -- For each product-warehouse combination that has a snapshot
  FOR rec IN
    SELECT
      sq.product_id,
      sl.warehouse_id,
      SUM(sq.quantity) AS snapshot_qty,
      p.cost AS unit_cost
    FROM stock_quants sq
    JOIN stock_locations sl ON sl.id = sq.location_id
    JOIN products p ON p.id = sq.product_id
    WHERE sq.product_id IS NOT NULL
      AND sl.warehouse_id IS NOT NULL
      AND sl.location_type = 'internal'
    GROUP BY sq.product_id, sl.warehouse_id, p.cost
  LOOP
    -- Generate daily records by working backwards from snapshot
    INSERT INTO inventory_daily (
      product_id, warehouse_id, snapshot_date,
      quantity_on_hand, unit_cost, inventory_value
    )
    WITH RECURSIVE daily_inventory AS (
      -- Base case: snapshot date
      SELECT
        v_snapshot_date AS day,
        rec.snapshot_qty AS qty_on_hand

      UNION ALL

      -- Recursive: go one day backwards
      SELECT
        di.day - 1,
        di.qty_on_hand
          -- Reverse: items that LEFT this warehouse on 'di.day' means
          -- the day BEFORE had MORE inventory
          + COALESCE((
            SELECT SUM(sm.quantity)
            FROM stock_moves sm
            JOIN stock_locations sl_from ON sl_from.id = sm.from_location_id
            WHERE sm.product_id = rec.product_id
              AND sl_from.warehouse_id = rec.warehouse_id
              AND sl_from.location_type = 'internal'
              AND sm.state = 'done'
              AND DATE(sm.move_date) = di.day
          ), 0)
          -- Reverse: items that ENTERED this warehouse on 'di.day' means
          -- the day BEFORE had LESS inventory
          - COALESCE((
            SELECT SUM(sm.quantity)
            FROM stock_moves sm
            JOIN stock_locations sl_to ON sl_to.id = sm.to_location_id
            WHERE sm.product_id = rec.product_id
              AND sl_to.warehouse_id = rec.warehouse_id
              AND sl_to.location_type = 'internal'
              AND sm.state = 'done'
              AND DATE(sm.move_date) = di.day
          ), 0)
      FROM daily_inventory di
      WHERE di.day > v_data_start
    )
    SELECT
      rec.product_id,
      rec.warehouse_id,
      di.day,
      di.qty_on_hand,
      rec.unit_cost,
      di.qty_on_hand * COALESCE(rec.unit_cost, 0)
    FROM daily_inventory di
    ON CONFLICT (product_id, warehouse_id, snapshot_date) DO UPDATE
      SET quantity_on_hand = EXCLUDED.quantity_on_hand,
          unit_cost = EXCLUDED.unit_cost,
          inventory_value = EXCLUDED.inventory_value;

    v_products_processed := v_products_processed + 1;

    -- Log progress every 100 products
    IF v_products_processed % 100 = 0 THEN
      RAISE NOTICE 'Processed % products...', v_products_processed;
    END IF;
  END LOOP;

  -- Count total records
  SELECT COUNT(*) INTO v_days_generated FROM inventory_daily;

  RETURN QUERY SELECT
    v_products_processed,
    v_days_generated,
    (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)::INT;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- FUNCTION: aggregate_demand_daily
-- ============================================================================
-- Aggregates sale_order_lines into daily demand per product.
-- Applies the Census Filter: marks days as censored where
-- inventory was <= 0 AND sales = 0 (stockout suppressed demand).
--
-- Census Filter rationale:
--   When a product is out of stock and records zero sales, this is NOT
--   true zero demand — it's a censored observation. Prophet should NOT
--   train on these as if demand was zero. Instead, we mark them as
--   censored so they can be excluded from training (Prophet interpolates
--   through the gaps and widens confidence intervals).
-- ============================================================================

CREATE OR REPLACE FUNCTION aggregate_demand_daily()
RETURNS TABLE(products_processed INT, days_generated INT, censored_days INT, duration_ms INT) AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
  v_products INT;
  v_days INT;
  v_censored INT;
BEGIN
  -- Clear existing data
  TRUNCATE demand_daily;

  -- Step 1: Aggregate confirmed sales by product-day
  INSERT INTO demand_daily (product_id, demand_date, quantity_sold, revenue, orders_count)
  SELECT
    sol.product_id,
    DATE(so.order_date) AS demand_date,
    SUM(sol.quantity) AS quantity_sold,
    SUM(sol.subtotal) AS revenue,
    COUNT(DISTINCT so.id) AS orders_count
  FROM sale_order_lines sol
  JOIN sale_orders so ON so.id = sol.order_id
  WHERE so.state IN ('sale', 'done')  -- Only confirmed/completed orders
    AND sol.product_id IS NOT NULL
  GROUP BY sol.product_id, DATE(so.order_date)
  ON CONFLICT (product_id, demand_date) DO UPDATE
    SET quantity_sold = EXCLUDED.quantity_sold,
        revenue = EXCLUDED.revenue,
        orders_count = EXCLUDED.orders_count;

  -- Step 2: Apply Census Filter
  -- For each product-day where inventory was <= 0 AND no sales occurred,
  -- mark as censored (stockout suppressed demand)
  --
  -- We need to check: are there product-days with NO demand record
  -- but where inventory was at zero? These need to be inserted as censored.

  -- First: find all product-days where inventory was <= 0 (across all warehouses)
  -- and no sales exist
  INSERT INTO demand_daily (product_id, demand_date, quantity_sold, revenue, is_censored, orders_count)
  SELECT
    id_inv.product_id,
    id_inv.snapshot_date,
    0,  -- zero sales (censored)
    0,
    true,  -- CENSORED
    0
  FROM (
    -- Products with zero or negative total inventory on a given day
    SELECT product_id, snapshot_date
    FROM inventory_daily
    GROUP BY product_id, snapshot_date
    HAVING SUM(quantity_on_hand) <= 0
  ) id_inv
  WHERE NOT EXISTS (
    -- No demand record exists for this product-day
    SELECT 1 FROM demand_daily dd
    WHERE dd.product_id = id_inv.product_id
      AND dd.demand_date = id_inv.snapshot_date
  )
  ON CONFLICT (product_id, demand_date) DO NOTHING;

  -- Also mark existing zero-demand days as censored if inventory was zero
  UPDATE demand_daily dd
  SET is_censored = true
  WHERE dd.quantity_sold = 0
    AND EXISTS (
      SELECT 1
      FROM inventory_daily id_inv
      WHERE id_inv.product_id = dd.product_id
        AND id_inv.snapshot_date = dd.demand_date
      GROUP BY id_inv.product_id, id_inv.snapshot_date
      HAVING SUM(id_inv.quantity_on_hand) <= 0
    );

  -- Counts
  SELECT COUNT(DISTINCT product_id) INTO v_products FROM demand_daily;
  SELECT COUNT(*) INTO v_days FROM demand_daily;
  SELECT COUNT(*) INTO v_censored FROM demand_daily WHERE is_censored = true;

  RAISE NOTICE 'Demand aggregation complete: % products, % days, % censored',
    v_products, v_days, v_censored;

  RETURN QUERY SELECT
    v_products,
    v_days,
    v_censored,
    (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)::INT;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- FUNCTION: validate_reconstruction
-- ============================================================================
-- Compares reconstructed inventory_daily values on the snapshot date (2026-03-03)
-- against actual stock_quants. Returns discrepancies.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_reconstruction()
RETURNS TABLE(
  product_id INT,
  warehouse_id INT,
  snapshot_qty NUMERIC,
  reconstructed_qty NUMERIC,
  difference NUMERIC,
  pct_diff NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sq_agg.product_id,
    sq_agg.warehouse_id,
    sq_agg.total_qty AS snapshot_qty,
    COALESCE(id.quantity_on_hand, 0) AS reconstructed_qty,
    sq_agg.total_qty - COALESCE(id.quantity_on_hand, 0) AS difference,
    CASE
      WHEN sq_agg.total_qty = 0 THEN 0
      ELSE ((sq_agg.total_qty - COALESCE(id.quantity_on_hand, 0)) / sq_agg.total_qty * 100)
    END AS pct_diff
  FROM (
    SELECT
      sq.product_id,
      sl.warehouse_id,
      SUM(sq.quantity) AS total_qty
    FROM stock_quants sq
    JOIN stock_locations sl ON sl.id = sq.location_id
    WHERE sq.product_id IS NOT NULL
      AND sl.warehouse_id IS NOT NULL
      AND sl.location_type = 'internal'
    GROUP BY sq.product_id, sl.warehouse_id
  ) sq_agg
  LEFT JOIN inventory_daily id
    ON id.product_id = sq_agg.product_id
    AND id.warehouse_id = sq_agg.warehouse_id
    AND id.snapshot_date = '2026-03-03'
  WHERE ABS(sq_agg.total_qty - COALESCE(id.quantity_on_hand, 0)) > 0.01
  ORDER BY ABS(sq_agg.total_qty - COALESCE(id.quantity_on_hand, 0)) DESC;
END;
$$ LANGUAGE plpgsql;
