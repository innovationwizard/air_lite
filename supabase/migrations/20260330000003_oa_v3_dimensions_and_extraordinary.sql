-- ============================================================================
-- OA Module v3 — Product dimensions, extraordinary order detection, unload tracking
-- ============================================================================

-- ============================================================================
-- 1. Product dimensions (from Odoo x_studio_alto/ancho/largo)
-- ============================================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS height_m NUMERIC(8,4);
ALTER TABLE products ADD COLUMN IF NOT EXISTS width_m NUMERIC(8,4);
ALTER TABLE products ADD COLUMN IF NOT EXISTS length_m NUMERIC(8,4);

CREATE INDEX IF NOT EXISTS idx_products_dimensions ON products(height_m, width_m, length_m)
  WHERE height_m IS NOT NULL;

-- ============================================================================
-- 2. RPC: Detect extraordinary order needs
-- Projects end-of-month inventory and flags when safety buffer won't be met
-- Formula: (Net Inventory + Pending OA) - Projected Sales to EOM
-- If result < 1 week buffer (25% of next month forecast) → extraordinary order
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_detect_extraordinary(
  p_supplier_ids INT[] DEFAULT NULL
)
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  supplier_id INT,
  supplier_name VARCHAR,
  current_net_inventory NUMERIC,
  pending_oa_qty NUMERIC,
  projected_monthly_demand NUMERIC,
  days_remaining_in_month INT,
  projected_demand_to_eom NUMERIC,
  projected_eom_inventory NUMERIC,
  safety_buffer_qty NUMERIC,
  shortfall_qty NUMERIC,
  reason VARCHAR,
  reason_detail TEXT,
  is_export BOOLEAN
) AS $$
DECLARE
  v_today DATE := CURRENT_DATE;
  v_eom DATE := (DATE_TRUNC('month', CURRENT_DATE) + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
  v_days_left INT := v_eom - CURRENT_DATE;
BEGIN
  RETURN QUERY
  WITH net_inv AS (
    SELECT
      ni.product_id, ni.product_name, ni.sku,
      ni.supplier_id, ni.supplier_name,
      ni.net_inventory, ni.avg_daily_demand,
      ni.is_export
    FROM rpc_oa_net_inventory(p_supplier_ids, NULL) ni
  ),
  pending_oa AS (
    -- Sum of planned but not yet dispatched quantities from active OAs
    SELECT
      dpw.product_id,
      SUM(GREATEST(0, dpw.planned_qty - dpw.dispatched_qty)) AS pending_qty
    FROM dispatch_plan_weeks dpw
    JOIN open_orders oo ON oo.id = dpw.open_order_id
    WHERE oo.status = 'active'
      AND dpw.week_end >= v_today
    GROUP BY dpw.product_id
  )
  SELECT
    ni.product_id,
    ni.product_name,
    ni.sku,
    ni.supplier_id,
    ni.supplier_name,
    ni.net_inventory AS current_net_inventory,
    COALESCE(po.pending_qty, 0) AS pending_oa_qty,
    -- Monthly demand projection (avg_daily * 30)
    (ni.avg_daily_demand * 30) AS projected_monthly_demand,
    v_days_left AS days_remaining_in_month,
    -- Projected demand until end of month
    (ni.avg_daily_demand * v_days_left) AS projected_demand_to_eom,
    -- Projected inventory at EOM
    (ni.net_inventory + COALESCE(po.pending_qty, 0) - (ni.avg_daily_demand * v_days_left)) AS projected_eom_inventory,
    -- Safety buffer = 1 week of demand (25% of monthly)
    (ni.avg_daily_demand * 7) AS safety_buffer_qty,
    -- Shortfall: how much we need to order to maintain buffer
    GREATEST(0,
      (ni.avg_daily_demand * 7) - (ni.net_inventory + COALESCE(po.pending_qty, 0) - (ni.avg_daily_demand * v_days_left))
    ) AS shortfall_qty,
    -- Reason classification
    CASE
      WHEN ni.avg_daily_demand * 30 > COALESCE(
        (SELECT SUM(ool.forecast_qty)
         FROM open_order_lines ool
         JOIN open_orders oo2 ON oo2.id = ool.open_order_id
         WHERE ool.product_id = ni.product_id AND oo2.status = 'active'), 0)
        THEN 'demand_exceeded_forecast'
      ELSE 'supplier_delay'
    END::VARCHAR AS reason,
    CASE
      WHEN ni.avg_daily_demand * 30 > COALESCE(
        (SELECT SUM(ool.forecast_qty)
         FROM open_order_lines ool
         JOIN open_orders oo2 ON oo2.id = ool.open_order_id
         WHERE ool.product_id = ni.product_id AND oo2.status = 'active'), 0)
        THEN 'Venta real excede el forecast del mes'
      ELSE 'Retraso de cumplimiento del proveedor'
    END AS reason_detail,
    ni.is_export
  FROM net_inv ni
  LEFT JOIN pending_oa po ON po.product_id = ni.product_id
  WHERE
    -- Only flag when projected EOM inventory < safety buffer
    (ni.net_inventory + COALESCE(po.pending_qty, 0) - (ni.avg_daily_demand * v_days_left))
      < (ni.avg_daily_demand * 7)
    AND ni.avg_daily_demand > 0
  ORDER BY
    -- Most urgent first (biggest shortfall)
    GREATEST(0,
      (ni.avg_daily_demand * 7) - (ni.net_inventory + COALESCE(po.pending_qty, 0) - (ni.avg_daily_demand * v_days_left))
    ) DESC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- 3. RPC: Auto-recalculate unloading times from completed receptions
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_oa_recalc_unload_times()
RETURNS TABLE(
  supplier_id INT,
  unit_type VARCHAR,
  avg_hours NUMERIC,
  sample_count BIGINT
) AS $$
BEGIN
  -- First, update unloading_times with calculated averages (only non-manual)
  UPDATE unloading_times ut
  SET calculated_hours = sub.avg_h,
      sample_count = sub.cnt::INT,
      updated_at = now()
  FROM (
    SELECT
      rs.supplier_id AS sid,
      rs.unit_type AS utype,
      ROUND(AVG(EXTRACT(EPOCH FROM (rs.completed_at - rs.started_at)) / 3600.0)::NUMERIC, 2) AS avg_h,
      COUNT(*) AS cnt
    FROM reception_schedule rs
    WHERE rs.status = 'completed'
      AND rs.started_at IS NOT NULL
      AND rs.completed_at IS NOT NULL
      AND rs.completed_at > rs.started_at
    GROUP BY rs.supplier_id, rs.unit_type
  ) sub
  WHERE ut.supplier_id = sub.sid
    AND ut.unit_type = sub.utype
    AND ut.is_manual_override = false;

  -- Return the calculated averages
  RETURN QUERY
  SELECT
    rs.supplier_id,
    rs.unit_type::VARCHAR,
    ROUND(AVG(EXTRACT(EPOCH FROM (rs.completed_at - rs.started_at)) / 3600.0)::NUMERIC, 2) AS avg_hours,
    COUNT(*) AS sample_count
  FROM reception_schedule rs
  WHERE rs.status = 'completed'
    AND rs.started_at IS NOT NULL
    AND rs.completed_at IS NOT NULL
    AND rs.completed_at > rs.started_at
  GROUP BY rs.supplier_id, rs.unit_type;
END;
$$ LANGUAGE plpgsql;
