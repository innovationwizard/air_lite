-- ============================================================================
-- rpc_stockout_risks_by_warehouse — per (product × warehouse) stockout risk
-- Returns one row per product × warehouse combination where quantity > 0.
-- days_of_supply  = warehouse_stock / company_avg_daily_demand
--   Demand is product-level (not split by warehouse) — standard interpretation.
-- risk_level uses the same lead-time-based thresholds as rpc_stockout_risks():
--   critico : stock <= 0
--   alto    : days_of_supply < lead_time_days
--   medio   : days_of_supply < lead_time_days × 1.5
--   bajo    : days_of_supply >= lead_time_days × 1.5
-- Plan 006 — 2026-05-08
-- ============================================================================
DROP FUNCTION IF EXISTS rpc_stockout_risks_by_warehouse();
CREATE OR REPLACE FUNCTION rpc_stockout_risks_by_warehouse()
RETURNS TABLE(
  product_id       INT,
  product_name     VARCHAR,
  sku              VARCHAR,
  category         VARCHAR,
  warehouse_id     INT,
  warehouse_name   VARCHAR,
  warehouse_code   VARCHAR,
  current_stock    NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply   NUMERIC,
  lead_time_days   INT,
  risk_level       VARCHAR,
  unit_price       NUMERIC,
  supplier_name    VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  WITH latest_snap AS (
    SELECT MAX(snapshot_date) AS d FROM inventory_daily
  ),
  per_warehouse AS (
    SELECT
      id.product_id,
      id.warehouse_id,
      SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    JOIN latest_snap ON id.snapshot_date = latest_snap.d
    GROUP BY id.product_id, id.warehouse_id
    HAVING SUM(id.quantity_on_hand) > 0
  ),
  demand_30d AS (
    SELECT
      dd.product_id,
      AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.is_censored = false
      AND dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY dd.product_id
  )
  SELECT
    p.id                                                       AS product_id,
    p.name                                                     AS product_name,
    p.sku,
    p.category,
    pw.warehouse_id,
    w.name                                                     AS warehouse_name,
    w.code                                                     AS warehouse_code,
    pw.current_qty                                             AS current_stock,
    COALESCE(d.avg_demand, 0)                                  AS avg_daily_demand,
    CASE
      WHEN COALESCE(d.avg_demand, 0) > 0
      THEN pw.current_qty / d.avg_demand
      ELSE 9999
    END                                                        AS days_of_supply,
    COALESCE(ps.lt_days, 30)                                   AS lead_time_days,
    CASE
      WHEN pw.current_qty <= 0 THEN 'critico'
      WHEN COALESCE(d.avg_demand, 0) > 0
        AND (pw.current_qty / d.avg_demand) < COALESCE(ps.lt_days, 30)
        THEN 'alto'
      WHEN COALESCE(d.avg_demand, 0) > 0
        AND (pw.current_qty / d.avg_demand) < COALESCE(ps.lt_days, 30) * 1.5
        THEN 'medio'
      ELSE 'bajo'
    END                                                        AS risk_level,
    COALESCE(p.list_price, 0)                                  AS unit_price,
    ps.sup_name                                                AS supplier_name
  FROM per_warehouse pw
  JOIN products p     ON p.id  = pw.product_id
  JOIN warehouses w   ON w.id  = pw.warehouse_id
  LEFT JOIN demand_30d d ON d.product_id = pw.product_id
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days AS lt_days, s.name AS sup_name
    FROM product_suppliers ps2
    JOIN suppliers s ON s.id = ps2.supplier_id
    WHERE ps2.product_id = pw.product_id
    ORDER BY ps2.lead_time_days ASC
    LIMIT 1
  ) ps ON true
  WHERE p.is_active = true
    AND COALESCE(d.avg_demand, 0) > 0
  ORDER BY
    CASE
      WHEN COALESCE(d.avg_demand, 0) > 0 THEN pw.current_qty / d.avg_demand
      ELSE 9999
    END ASC,
    p.name ASC,
    w.name ASC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rpc_stockout_risks_by_warehouse() TO authenticated, anon, service_role;
