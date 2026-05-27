-- ============================================================================
-- Fix: rpc_oa_warehouse_space incoming_m3 inflation
-- ============================================================================
--
-- Diagnosed 2026-05-27 via direct stock_moves query for warehouse_id=1
-- (Bodega Central). Two compounding bugs in the previous incoming_m3
-- calculation produced 30,138 m³ "incoming" against an 18,785 m³ capacity,
-- triggering a false "rojo" alert and a -17,355 m³ post-arrival figure.
--
-- BUG 1 — assigned/waiting state duplication
--   Every PO line generates two parallel stock_moves rows in Odoo:
--   one with state='waiting' (waiting on source availability) and one with
--   state='assigned' (reserved at source). When BOTH rows have the same
--   (product, destination, date, quantity), they are the same logical line
--   counted twice. Example from the diagnostic: SKU 77201046 on 2026-02-03
--   showed qty=8,491 CAJA40 in BOTH 'waiting' AND 'assigned' state, each
--   contributing 1,349.90 m³ — counted as 2,700 m³.
--
-- BUG 2 — no date filter on move_date
--   The previous RPC counted moves regardless of age. The diagnostic showed
--   moves with move_date 9-11 months old still summing in. These are
--   abandoned/cancelled POs whose paperwork was never reconciled in Odoo.
--   They are NOT real incoming inventory.
--
-- FIX
--   1) DISTINCT ON (product_id, to_location_id, DATE(move_date), quantity)
--      with ORDER BY state ASC — collapses 'assigned'+'waiting' duplicates
--      to a single row, preferring 'assigned' (alphabetically first; also
--      the more "committed" Odoo state).
--   2) move_date > NOW() - INTERVAL '90 days' — drops zombies. 90 days
--      covers normal long-lead-time international imports (CARVAJAL); rows
--      older than that are confidently stale.
--
-- ALL OTHER LOGIC unchanged from 20260331000002_fix_incoming_per_warehouse.sql.
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

  -- Incoming: stock_moves in transit TO this warehouse, deduplicated and
  -- filtered to recent moves only. See header comment for full rationale.
  LEFT JOIN LATERAL (
    SELECT SUM(d.quantity * d.volume_m3) AS total_m3
    FROM (
      SELECT DISTINCT ON (sm.product_id, sm.to_location_id, DATE(sm.move_date), sm.quantity)
        sm.quantity,
        p.volume_m3
      FROM stock_moves sm
      JOIN products p ON p.id = sm.product_id
      JOIN stock_locations sl ON sl.id = sm.to_location_id
      WHERE sl.warehouse_id = w.id
        AND sm.state IN ('assigned', 'waiting')
        AND sm.move_date > NOW() - INTERVAL '90 days'
        AND p.volume_m3 IS NOT NULL AND p.volume_m3 > 0
      ORDER BY sm.product_id, sm.to_location_id, DATE(sm.move_date), sm.quantity, sm.state ASC
    ) d
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
