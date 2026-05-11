-- ============================================================================
-- Fix type cast in rpc_stockout_risks and rpc_stockout_risks_by_warehouse
-- Plan 009 follow-up — 2026-05-11
--
-- Migration 20260511000001 introduced a PostgreSQL type mismatch:
-- the risk_level CASE expression returns inferred type 'text' but the
-- RETURNS TABLE declares 'character varying' (VARCHAR). PostgreSQL error:
--   "Returned type text does not match expected type character varying in column 9"
--
-- Fix: add ::VARCHAR cast to the risk_level CASE expression in both functions.
-- rpc_abc_xyz_classification is unaffected — it already uses ::CHAR(1) and
-- ::VARCHAR casts on all its CASE expressions.
-- ============================================================================


-- ============================================================================
-- 1. rpc_stockout_risks — add ::VARCHAR to risk_level CASE
-- ============================================================================
DROP FUNCTION IF EXISTS rpc_stockout_risks();
CREATE OR REPLACE FUNCTION rpc_stockout_risks()
RETURNS TABLE(
  product_id       INT,
  product_name     VARCHAR,
  sku              VARCHAR,
  category         VARCHAR,
  current_stock    NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply   NUMERIC,
  lead_time_days   INT,
  risk_level       VARCHAR,
  unit_price       NUMERIC,
  supplier_name    VARCHAR
) AS $$
DECLARE
  v_snapshot_date DATE;
  v_demand_from   DATE;
BEGIN
  SELECT MAX(id2.snapshot_date) INTO v_snapshot_date FROM inventory_daily id2;
  v_demand_from := v_snapshot_date - INTERVAL '90 days';

  RETURN QUERY
  SELECT
    p.id                                                      AS product_id,
    p.name                                                    AS product_name,
    p.sku,
    p.category,
    COALESCE(inv.current_qty, 0)                              AS current_stock,
    COALESCE(dem.avg_demand, 0)                               AS avg_daily_demand,
    CASE
      WHEN COALESCE(dem.avg_demand, 0) > 0
      THEN COALESCE(inv.current_qty, 0) / dem.avg_demand
      ELSE 9999::NUMERIC
    END                                                       AS days_of_supply,
    COALESCE(ps.lt_days, 30)                                  AS lead_time_days,
    CASE
      WHEN COALESCE(inv.current_qty, 0) <= 0                 THEN 'critico'
      WHEN COALESCE(dem.avg_demand, 0) > 0
        AND (COALESCE(inv.current_qty, 0) / dem.avg_demand)
              < COALESCE(ps.lt_days, 30)                     THEN 'alto'
      WHEN COALESCE(dem.avg_demand, 0) > 0
        AND (COALESCE(inv.current_qty, 0) / dem.avg_demand)
              < COALESCE(ps.lt_days, 30) * 1.5               THEN 'medio'
      ELSE 'bajo'
    END::VARCHAR                                              AS risk_level,
    COALESCE(p.list_price, 0)                                 AS unit_price,
    ps.sup_name                                               AS supplier_name
  FROM products p
  LEFT JOIN LATERAL (
    SELECT SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.product_id = p.id
      AND id.snapshot_date = v_snapshot_date
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.product_id = p.id
      AND dd.is_censored = false
      AND dd.demand_date BETWEEN v_demand_from AND v_snapshot_date
  ) dem ON true
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days AS lt_days, s.name AS sup_name
    FROM product_suppliers ps2
    JOIN suppliers s ON s.id = ps2.supplier_id
    WHERE ps2.product_id = p.id
    ORDER BY ps2.lead_time_days ASC
    LIMIT 1
  ) ps ON true
  WHERE p.is_active = true
    AND COALESCE(dem.avg_demand, 0) > 0
  ORDER BY days_of_supply ASC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rpc_stockout_risks() TO authenticated, anon, service_role;


-- ============================================================================
-- 2. rpc_stockout_risks_by_warehouse — add ::VARCHAR to risk_level CASE
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
DECLARE
  v_snapshot_date DATE;
  v_demand_from   DATE;
BEGIN
  SELECT MAX(id2.snapshot_date) INTO v_snapshot_date FROM inventory_daily id2;
  v_demand_from := v_snapshot_date - INTERVAL '90 days';

  RETURN QUERY
  WITH per_warehouse AS (
    SELECT
      id.product_id,
      id.warehouse_id,
      SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.snapshot_date = v_snapshot_date
    GROUP BY id.product_id, id.warehouse_id
    HAVING SUM(id.quantity_on_hand) > 0
  ),
  demand_90d AS (
    SELECT
      dd.product_id,
      AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.is_censored = false
      AND dd.demand_date BETWEEN v_demand_from AND v_snapshot_date
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
      ELSE 9999::NUMERIC
    END                                                        AS days_of_supply,
    COALESCE(ps.lt_days, 30)                                   AS lead_time_days,
    CASE
      WHEN pw.current_qty <= 0                                 THEN 'critico'
      WHEN COALESCE(d.avg_demand, 0) > 0
        AND (pw.current_qty / d.avg_demand)
              < COALESCE(ps.lt_days, 30)                      THEN 'alto'
      WHEN COALESCE(d.avg_demand, 0) > 0
        AND (pw.current_qty / d.avg_demand)
              < COALESCE(ps.lt_days, 30) * 1.5                THEN 'medio'
      ELSE 'bajo'
    END::VARCHAR                                               AS risk_level,
    COALESCE(p.list_price, 0)                                  AS unit_price,
    ps.sup_name                                                AS supplier_name
  FROM per_warehouse pw
  JOIN products p     ON p.id  = pw.product_id
  JOIN warehouses w   ON w.id  = pw.warehouse_id
  LEFT JOIN demand_90d d ON d.product_id = pw.product_id
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
