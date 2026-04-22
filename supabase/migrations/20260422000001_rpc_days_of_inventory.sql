-- ============================================================================
-- rpc_days_of_inventory — Mario's "Días de Inventario" per SKU × warehouse
-- ============================================================================
-- Answers Roberto's daily question "¿cuántos días de inventario tengo?" per
-- product per bodega. Honest about the snapshot date (the latest inventory_daily
-- row) so Mario can defend the number.
--
-- Inputs: none (always against the latest snapshot).
-- Per-warehouse demand uses sale_orders.warehouse_id × sale_order_lines,
-- because demand_daily has no warehouse dimension. Window = 30 days ending on
-- the latest inventory snapshot.
--
-- Status thresholds:
--   hot       : days_of_supply < lead_time_days (or < 7 if lead time unknown)
--   ok        : between lead_time and 3× lead_time
--   hold      : > 3× lead_time (over-buffer)
--   no_demand : avg_daily_demand = 0 (static stock)
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_days_of_inventory()
RETURNS TABLE (
  snapshot_date       DATE,
  product_id          INTEGER,
  sku                 VARCHAR,
  product_name        VARCHAR,
  category            VARCHAR,
  warehouse_id        INTEGER,
  warehouse_code      VARCHAR,
  warehouse_name      VARCHAR,
  current_stock       NUMERIC,
  inventory_value_gtq NUMERIC,
  avg_daily_demand    NUMERIC,
  days_of_supply      NUMERIC,
  lead_time_days      INTEGER,
  status              TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT MAX(snapshot_date) AS d FROM inventory_daily
  ),
  latest_inv AS (
    SELECT
      inv.product_id,
      inv.warehouse_id,
      inv.quantity_on_hand,
      inv.inventory_value
    FROM inventory_daily inv
    JOIN latest ON inv.snapshot_date = latest.d
    WHERE inv.quantity_on_hand > 0
  ),
  warehouse_demand AS (
    SELECT
      sol.product_id,
      so.warehouse_id,
      SUM(sol.quantity)::NUMERIC / 30.0 AS avg_daily_demand
    FROM sale_order_lines sol
    JOIN sale_orders so ON so.id = sol.order_id
    JOIN latest ON TRUE
    WHERE so.order_date >= (latest.d - INTERVAL '30 days')
      AND so.order_date <  (latest.d + INTERVAL '1 day')
      AND so.state = 'sale'
    GROUP BY sol.product_id, so.warehouse_id
  ),
  shortest_lead AS (
    SELECT
      ps.product_id,
      MIN(NULLIF(ps.lead_time_days, 0)) AS lead_time_days
    FROM product_suppliers ps
    GROUP BY ps.product_id
  )
  SELECT
    (SELECT d FROM latest)                        AS snapshot_date,
    li.product_id,
    p.sku,
    p.name                                         AS product_name,
    p.category,
    li.warehouse_id,
    w.code                                         AS warehouse_code,
    w.name                                         AS warehouse_name,
    li.quantity_on_hand                            AS current_stock,
    li.inventory_value                             AS inventory_value_gtq,
    COALESCE(wd.avg_daily_demand, 0)               AS avg_daily_demand,
    CASE
      WHEN COALESCE(wd.avg_daily_demand, 0) = 0 THEN NULL
      ELSE ROUND(li.quantity_on_hand / wd.avg_daily_demand, 1)
    END                                            AS days_of_supply,
    sl.lead_time_days,
    CASE
      WHEN COALESCE(wd.avg_daily_demand, 0) = 0 THEN 'no_demand'
      WHEN li.quantity_on_hand / wd.avg_daily_demand < COALESCE(sl.lead_time_days, 7)      THEN 'hot'
      WHEN li.quantity_on_hand / wd.avg_daily_demand > COALESCE(sl.lead_time_days, 7) * 3  THEN 'hold'
      ELSE 'ok'
    END                                            AS status
  FROM latest_inv li
  JOIN products p    ON p.id = li.product_id AND p.is_active = TRUE
  JOIN warehouses w  ON w.id = li.warehouse_id AND w.is_active = TRUE
  LEFT JOIN warehouse_demand wd
    ON wd.product_id = li.product_id
   AND wd.warehouse_id = li.warehouse_id
  LEFT JOIN shortest_lead sl
    ON sl.product_id = li.product_id;
$$;

COMMENT ON FUNCTION rpc_days_of_inventory() IS
  'Per-SKU × warehouse days of inventory as of the latest inventory_daily snapshot. Demand window = 30 days ending on the snapshot; only sale_orders in state = sale are counted.';

GRANT EXECUTE ON FUNCTION rpc_days_of_inventory() TO authenticated, anon, service_role;
