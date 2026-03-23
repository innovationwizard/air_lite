-- ============================================================================
-- Fix demand_daily to match Odoo SSOT
-- ============================================================================
-- SSOT Validation (2026-03-23) revealed:
--   - Odoo's "Análisis de Ventas" uses effective_date (delivery confirmation),
--     NOT order_date
--   - Odoo uses delivered_qty, NOT quantity (ordered)
--   - Odoo's "Venta Neta" uses the stored line subtotal (price_subtotal),
--     filtered to lines with delivered_qty > 0
--
-- This migration corrects aggregate_demand_daily() to match.
-- All downstream RPC functions (ABC/XYZ, stockout risk, slow-moving,
-- backtest product ranking, rotation metrics) read from demand_daily
-- and are automatically corrected.
-- ============================================================================

DROP FUNCTION IF EXISTS aggregate_demand_daily();

CREATE OR REPLACE FUNCTION aggregate_demand_daily()
RETURNS TABLE(products_processed BIGINT, days_generated BIGINT, censored_days BIGINT, duration_ms INT) AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
  v_products BIGINT;
  v_days BIGINT;
  v_censored BIGINT;
BEGIN
  TRUNCATE demand_daily;

  -- Step 1: Aggregate DELIVERED sales by product-day
  -- Uses effective_date (delivery confirmation) for date attribution
  -- Uses delivered_qty (not ordered quantity) for demand signal
  -- Uses proportional subtotal for revenue (matches Odoo's price_subtotal)
  INSERT INTO demand_daily (product_id, demand_date, quantity_sold, revenue, orders_count)
  SELECT
    sol.product_id,
    DATE(so.effective_date) AS demand_date,
    SUM(sol.delivered_qty) AS quantity_sold,
    COALESCE(SUM(sol.subtotal), 0) AS revenue,
    COUNT(DISTINCT so.id) AS orders_count
  FROM sale_order_lines sol
  JOIN sale_orders so ON so.id = sol.order_id
  WHERE so.state IN ('sale', 'done')
    AND sol.product_id IS NOT NULL
    AND sol.delivered_qty > 0
    AND so.effective_date IS NOT NULL
  GROUP BY sol.product_id, DATE(so.effective_date)
  ON CONFLICT (product_id, demand_date) DO UPDATE
    SET quantity_sold = EXCLUDED.quantity_sold,
        revenue = EXCLUDED.revenue,
        orders_count = EXCLUDED.orders_count;

  -- Step 2: Insert censored days (stockout + zero sales = suppressed demand)
  -- Census Filter: when inventory <= 0 AND no deliveries happened,
  -- this is NOT true zero demand — it's a censored observation.
  INSERT INTO demand_daily (product_id, demand_date, quantity_sold, revenue, is_censored, orders_count)
  SELECT
    id_inv.product_id,
    id_inv.snapshot_date,
    0, 0, true, 0
  FROM (
    SELECT product_id, snapshot_date
    FROM inventory_daily
    GROUP BY product_id, snapshot_date
    HAVING SUM(quantity_on_hand) <= 0
  ) id_inv
  WHERE NOT EXISTS (
    SELECT 1 FROM demand_daily dd
    WHERE dd.product_id = id_inv.product_id
      AND dd.demand_date = id_inv.snapshot_date
  )
  ON CONFLICT (product_id, demand_date) DO NOTHING;

  -- Step 3: Mark existing zero-sales days as censored if inventory was <= 0
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

  SELECT COUNT(DISTINCT product_id) INTO v_products FROM demand_daily;
  SELECT COUNT(*) INTO v_days FROM demand_daily;
  SELECT COUNT(*) INTO v_censored FROM demand_daily WHERE is_censored = true;

  RETURN QUERY SELECT v_products, v_days, v_censored,
    (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)::INT;
END;
$$ LANGUAGE plpgsql;
