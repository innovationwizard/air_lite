-- ============================================================================
-- rpc_stockout_risks — add unit_price and supplier_name
-- Needed for Hot List financial quantification (GTQ en riesgo) and
-- supplier filter in the demo.
-- Plan 005 / B2 — 2026-05-08
-- ============================================================================
DROP FUNCTION IF EXISTS rpc_stockout_risks();
CREATE OR REPLACE FUNCTION rpc_stockout_risks()
RETURNS TABLE(
  product_id    INT,
  product_name  VARCHAR,
  sku           VARCHAR,
  category      VARCHAR,
  current_stock NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply   NUMERIC,
  lead_time_days   INT,
  risk_level       VARCHAR,
  unit_price       NUMERIC,   -- p.list_price — used to compute GTQ en riesgo client-side
  supplier_name    VARCHAR    -- primary supplier (shortest lead time)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    COALESCE(inv.current_qty, 0)   AS current_stock,
    COALESCE(dem.avg_demand, 0)    AS avg_daily_demand,
    CASE
      WHEN COALESCE(dem.avg_demand, 0) > 0
      THEN COALESCE(inv.current_qty, 0) / dem.avg_demand
      ELSE 9999
    END AS days_of_supply,
    COALESCE(ps.lt_days, 30) AS lead_time_days,
    CASE
      WHEN COALESCE(inv.current_qty, 0) <= 0 THEN 'critico'
      WHEN COALESCE(dem.avg_demand, 0) > 0
        AND (COALESCE(inv.current_qty, 0) / dem.avg_demand) < COALESCE(ps.lt_days, 30)
        THEN 'alto'
      WHEN COALESCE(dem.avg_demand, 0) > 0
        AND (COALESCE(inv.current_qty, 0) / dem.avg_demand) < COALESCE(ps.lt_days, 30) * 1.5
        THEN 'medio'
      ELSE 'bajo'
    END AS risk_level,
    COALESCE(p.list_price, 0)      AS unit_price,
    ps.sup_name                    AS supplier_name
  FROM products p
  LEFT JOIN LATERAL (
    SELECT SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.product_id = p.id
      AND id.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_daily)
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.product_id = p.id
      AND dd.is_censored = false
      AND dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'
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
