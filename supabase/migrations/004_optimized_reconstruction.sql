-- ============================================================================
-- Optimized Inventory Reconstruction
-- Set-based approach: pre-aggregate moves, then reverse cumulative sum
-- ============================================================================

CREATE OR REPLACE FUNCTION reconstruct_inventory_daily()
RETURNS TABLE(products_processed BIGINT, days_generated BIGINT, duration_ms INT) AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
  v_snapshot_date DATE := '2026-03-03';
  v_data_start DATE := '2024-10-01';
BEGIN
  TRUNCATE inventory_daily;

  -- Step 1: Pre-aggregate stock_moves into daily net movement per product-warehouse
  -- Net movement = qty arriving at warehouse - qty leaving warehouse on that day
  CREATE TEMP TABLE daily_net AS
  WITH incoming AS (
    SELECT sm.product_id, sl.warehouse_id, DATE(sm.move_date) AS d, SUM(sm.quantity) AS qty
    FROM stock_moves sm
    JOIN stock_locations sl ON sl.id = sm.to_location_id
    WHERE sm.state = 'done' AND sl.location_type = 'internal' AND sl.warehouse_id IS NOT NULL
    GROUP BY sm.product_id, sl.warehouse_id, DATE(sm.move_date)
  ),
  outgoing AS (
    SELECT sm.product_id, sl.warehouse_id, DATE(sm.move_date) AS d, SUM(sm.quantity) AS qty
    FROM stock_moves sm
    JOIN stock_locations sl ON sl.id = sm.from_location_id
    WHERE sm.state = 'done' AND sl.location_type = 'internal' AND sl.warehouse_id IS NOT NULL
    GROUP BY sm.product_id, sl.warehouse_id, DATE(sm.move_date)
  )
  SELECT
    COALESCE(i.product_id, o.product_id) AS product_id,
    COALESCE(i.warehouse_id, o.warehouse_id) AS warehouse_id,
    COALESCE(i.d, o.d) AS move_date,
    COALESCE(i.qty, 0) - COALESCE(o.qty, 0) AS net_qty
  FROM incoming i
  FULL OUTER JOIN outgoing o
    ON i.product_id = o.product_id
    AND i.warehouse_id = o.warehouse_id
    AND i.d = o.d;

  CREATE INDEX idx_dn_lookup ON daily_net(product_id, warehouse_id, move_date);

  RAISE NOTICE 'Step 1 done: daily_net aggregated in %s', clock_timestamp() - v_start;

  -- Step 2: Get snapshot quantities per product-warehouse
  CREATE TEMP TABLE snapshots AS
  SELECT
    sq.product_id,
    sl.warehouse_id,
    SUM(sq.quantity) AS snapshot_qty
  FROM stock_quants sq
  JOIN stock_locations sl ON sl.id = sq.location_id
  WHERE sq.product_id IS NOT NULL
    AND sl.warehouse_id IS NOT NULL
    AND sl.location_type = 'internal'
  GROUP BY sq.product_id, sl.warehouse_id;

  RAISE NOTICE 'Step 2 done: % product-warehouse snapshots', (SELECT COUNT(*) FROM snapshots);

  -- Step 3: Build inventory_daily
  -- For each product-warehouse and each date:
  --   inventory(date) = snapshot_qty - SUM(net movements on all days AFTER this date)
  --
  -- We compute this using a reverse cumulative sum:
  --   Order by date DESC, running sum of net_qty = total future movements
  --   inventory(date) = snapshot_qty - running_sum_excluding_current_day
  INSERT INTO inventory_daily (
    product_id, warehouse_id, snapshot_date,
    quantity_on_hand, unit_cost, inventory_value
  )
  SELECT
    s.product_id,
    s.warehouse_id,
    gs.d AS snapshot_date,
    s.snapshot_qty - COALESCE(
      SUM(dn.net_qty) OVER (
        PARTITION BY s.product_id, s.warehouse_id
        ORDER BY gs.d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS quantity_on_hand,
    p.cost,
    (s.snapshot_qty - COALESCE(
      SUM(dn.net_qty) OVER (
        PARTITION BY s.product_id, s.warehouse_id
        ORDER BY gs.d DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    )) * COALESCE(p.cost, 0) AS inventory_value
  FROM snapshots s
  CROSS JOIN generate_series(v_data_start, v_snapshot_date, '1 day'::INTERVAL) gs(d)
  JOIN products p ON p.id = s.product_id
  LEFT JOIN daily_net dn
    ON dn.product_id = s.product_id
    AND dn.warehouse_id = s.warehouse_id
    AND dn.move_date = gs.d::DATE;

  DROP TABLE IF EXISTS daily_net;
  DROP TABLE IF EXISTS snapshots;

  RAISE NOTICE 'Reconstruction complete in %s', clock_timestamp() - v_start;

  RETURN QUERY SELECT
    (SELECT COUNT(DISTINCT product_id) FROM inventory_daily),
    (SELECT COUNT(*) FROM inventory_daily),
    (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)::INT;
END;
$$ LANGUAGE plpgsql;
