-- ============================================================================
-- Fix: Calculate incoming_m3 per warehouse using stock_moves instead of
-- purchase_order_lines. stock_moves have to_location_id which maps to a
-- specific warehouse via stock_locations.warehouse_id.
--
-- Before: incoming_m3 was the GLOBAL total of all pending POs, assigned
-- to every warehouse equally — causing false "rojo" alerts.
--
-- After: incoming_m3 is per-warehouse, calculated from stock_moves in
-- state 'assigned' or 'waiting' (confirmed but not yet received),
-- joined to stock_locations to determine destination warehouse.
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_oa_warehouse_space(
  p_warehouse_id INT DEFAULT NULL
)
RETURNS TABLE(
  warehouse_id INT,
  warehouse_name VARCHAR,
  max_capacity_m3 NUMERIC,
  occupied_m3 NUMERIC,
  incoming_m3 NUMERIC,
  available_m3 NUMERIC,
  post_arrival_m3 NUMERIC,
  saturation_pct NUMERIC,
  products_without_volume BIGINT,
  alert_level VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id AS warehouse_id,
    w.name::VARCHAR AS warehouse_name,
    COALESCE(wc.max_capacity_m3, 0) AS max_capacity_m3,
    COALESCE(occ.total_m3, 0) AS occupied_m3,
    COALESCE(inc.total_m3, 0) AS incoming_m3,
    COALESCE(wc.max_capacity_m3, 0) - COALESCE(occ.total_m3, 0) AS available_m3,
    COALESCE(wc.max_capacity_m3, 0) - COALESCE(occ.total_m3, 0) - COALESCE(inc.total_m3, 0) AS post_arrival_m3,
    CASE
      WHEN COALESCE(wc.max_capacity_m3, 0) > 0
      THEN ROUND((COALESCE(occ.total_m3, 0) / wc.max_capacity_m3) * 100, 1)
      ELSE 0
    END AS saturation_pct,
    COALESCE(no_vol.cnt, 0) AS products_without_volume,
    (CASE
      WHEN COALESCE(wc.max_capacity_m3, 0) = 0 THEN 'sin_configurar'
      WHEN (COALESCE(occ.total_m3, 0) + COALESCE(inc.total_m3, 0)) > wc.max_capacity_m3 THEN 'rojo'
      WHEN COALESCE(occ.total_m3, 0) / NULLIF(wc.max_capacity_m3, 0) > 0.95 THEN 'rojo'
      WHEN COALESCE(occ.total_m3, 0) / NULLIF(wc.max_capacity_m3, 0) > 0.80 THEN 'amarillo'
      ELSE 'verde'
    END)::VARCHAR AS alert_level
  FROM warehouses w
  LEFT JOIN warehouse_config wc ON wc.warehouse_id = w.id

  -- Occupied: current inventory * product volume (per warehouse)
  LEFT JOIN LATERAL (
    SELECT SUM(id.quantity_on_hand * p.volume_m3) AS total_m3
    FROM inventory_daily id
    JOIN products p ON p.id = id.product_id
    WHERE id.warehouse_id = w.id
      AND id.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_daily)
      AND p.volume_m3 IS NOT NULL AND p.volume_m3 > 0
  ) occ ON true

  -- Incoming: stock_moves in transit TO this warehouse (not yet received)
  -- Uses stock_moves.to_location_id → stock_locations.warehouse_id
  -- States: 'assigned' (reserved), 'waiting' (waiting availability)
  LEFT JOIN LATERAL (
    SELECT SUM(sm.quantity * COALESCE(p.volume_m3, 0)) AS total_m3
    FROM stock_moves sm
    JOIN products p ON p.id = sm.product_id
    JOIN stock_locations sl ON sl.id = sm.to_location_id
    WHERE sl.warehouse_id = w.id
      AND sm.state IN ('assigned', 'waiting')
      AND p.volume_m3 IS NOT NULL AND p.volume_m3 > 0
  ) inc ON true

  -- Products without volume data in this warehouse
  LEFT JOIN LATERAL (
    SELECT COUNT(DISTINCT id.product_id) AS cnt
    FROM inventory_daily id
    JOIN products p ON p.id = id.product_id
    WHERE id.warehouse_id = w.id
      AND id.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_daily)
      AND id.quantity_on_hand > 0
      AND (p.volume_m3 IS NULL OR p.volume_m3 = 0)
  ) no_vol ON true

  WHERE w.is_active = true
    AND w.id IN (1, 2, 3, 4)
    AND (p_warehouse_id IS NULL OR w.id = p_warehouse_id)
  ORDER BY w.id;
END;
$$ LANGUAGE plpgsql;
