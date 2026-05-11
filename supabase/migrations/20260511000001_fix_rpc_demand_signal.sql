-- ============================================================================
-- Fix demand signal in three RPCs — Plan 009 — 2026-05-11
--
-- Root cause: all three RPCs used CURRENT_DATE - INTERVAL '30 days' as the
-- demand window. The inventory snapshot is 2026-03-03. As of 2026-05-11 that
-- window (April 11 – May 11) has zero rows in demand_daily, so:
--   • rpc_stockout_risks / rpc_stockout_risks_by_warehouse: WHERE avg_demand > 0
--     filters out every product → 0 rows → all Hot List KPIs show 0/—.
--   • rpc_abc_xyz_classification: avg_daily_demand = 0 for all 980 rows →
--     GTQ inmovilizado formula collapses to current_stock × unit_cost (all
--     stock classified as excess over policy).
--
-- Fix: replace CURRENT_DATE-relative window with a snapshot-anchored 90-day
-- window derived from MAX(snapshot_date) FROM inventory_daily.
--   • Anchoring to MAX(snapshot_date) means the functions self-adapt if a newer
--     snapshot is ever loaded — no hardcoded dates.
--   • 90 days is consistent with the order-plan route (DEMAND_WINDOW_DAYS = 90)
--     and produces a more statistically stable demand estimate than 30 days.
--
-- Verified before writing this migration (2026-05-11):
--   • demand_daily date range: 2024-10-01 to 2026-03-03.
--   • 17,072 rows with is_censored = false exist in the target window
--     (2025-12-03 to 2026-03-03). The fix will produce non-zero demand values.
--   • No return type changes — all three functions keep their current column
--     signatures. No TypeScript changes required.
-- ============================================================================


-- ============================================================================
-- 1. rpc_stockout_risks
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
      ELSE 9999
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
    END                                                       AS risk_level,
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
-- 2. rpc_abc_xyz_classification
-- Only the recent_demand CTE changes. Revenue ranking and XYZ classification
-- are correct and unchanged.
-- ============================================================================
DROP FUNCTION IF EXISTS rpc_abc_xyz_classification();
CREATE OR REPLACE FUNCTION rpc_abc_xyz_classification()
RETURNS TABLE(
  product_id              INT,
  product_name            VARCHAR,
  sku                     VARCHAR,
  category                VARCHAR,
  total_revenue           NUMERIC,
  cumulative_revenue_pct  NUMERIC,
  abc_class               CHAR(1),
  demand_cv               NUMERIC,
  xyz_class               CHAR(1),
  observation_days        BIGINT,
  statistical_confidence  VARCHAR,
  current_stock           NUMERIC,
  avg_daily_demand        NUMERIC,
  lead_time_days          INT,
  unit_cost               NUMERIC,
  supplier_name           VARCHAR
) AS $$
DECLARE
  v_snapshot_date DATE;
  v_demand_from   DATE;
BEGIN
  SELECT MAX(id2.snapshot_date) INTO v_snapshot_date FROM inventory_daily id2;
  v_demand_from := v_snapshot_date - INTERVAL '90 days';

  RETURN QUERY
  WITH revenue_ranked AS (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      COALESCE(SUM(dd.revenue), 0) AS total_revenue
    FROM products p
    LEFT JOIN demand_daily dd ON dd.product_id = p.id AND dd.is_censored = false
    WHERE p.is_active = true
    GROUP BY p.id, p.name, p.sku, p.category
    HAVING COALESCE(SUM(dd.revenue), 0) > 0
    ORDER BY total_revenue DESC
  ),
  cumulative AS (
    SELECT
      rr.*,
      SUM(rr.total_revenue) OVER (ORDER BY rr.total_revenue DESC) /
        SUM(rr.total_revenue) OVER () * 100 AS cum_pct
    FROM revenue_ranked rr
  ),
  demand_variability AS (
    SELECT
      dd.product_id,
      CASE
        WHEN AVG(dd.quantity_sold) > 0
        THEN STDDEV(dd.quantity_sold) / AVG(dd.quantity_sold)
        ELSE 0
      END AS cv,
      COUNT(*) AS obs_days
    FROM demand_daily dd
    WHERE dd.is_censored = false
    GROUP BY dd.product_id
  ),
  current_inventory AS (
    SELECT
      id.product_id,
      SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.snapshot_date = v_snapshot_date
    GROUP BY id.product_id
  ),
  -- FIX: was CURRENT_DATE - INTERVAL '30 days'; now snapshot-anchored 90-day window
  recent_demand AS (
    SELECT
      dd.product_id,
      AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.is_censored = false
      AND dd.demand_date BETWEEN v_demand_from AND v_snapshot_date
    GROUP BY dd.product_id
  )
  SELECT
    c.product_id,
    c.product_name,
    c.sku,
    c.category,
    c.total_revenue,
    ROUND(c.cum_pct, 2)                                       AS cumulative_revenue_pct,
    CASE
      WHEN c.cum_pct <= 80 THEN 'A'
      WHEN c.cum_pct <= 95 THEN 'B'
      ELSE 'C'
    END::CHAR(1)                                              AS abc_class,
    ROUND(COALESCE(dv.cv, 0), 4)                              AS demand_cv,
    CASE
      WHEN COALESCE(dv.cv, 0) < 0.5 THEN 'X'
      WHEN COALESCE(dv.cv, 0) < 1.0 THEN 'Y'
      ELSE 'Z'
    END::CHAR(1)                                              AS xyz_class,
    COALESCE(dv.obs_days, 0)                                  AS observation_days,
    CASE
      WHEN COALESCE(dv.obs_days, 0) >= 90 THEN 'Alta confianza'
      WHEN COALESCE(dv.obs_days, 0) >= 30 THEN 'Confianza media'
      ELSE 'Datos insuficientes'
    END::VARCHAR                                              AS statistical_confidence,
    COALESCE(ci.current_qty, 0)                               AS current_stock,
    COALESCE(rd.avg_demand, 0)                                AS avg_daily_demand,
    COALESCE(ps.lt_days, 30)                                  AS lead_time_days,
    COALESCE(p.cost, 0)                                       AS unit_cost,
    ps.sup_name                                               AS supplier_name
  FROM cumulative c
  JOIN products p ON p.id = c.product_id
  LEFT JOIN demand_variability dv  ON dv.product_id = c.product_id
  LEFT JOIN current_inventory ci   ON ci.product_id = c.product_id
  LEFT JOIN recent_demand rd       ON rd.product_id = c.product_id
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days AS lt_days, s.name AS sup_name
    FROM product_suppliers ps2
    JOIN suppliers s ON s.id = ps2.supplier_id
    WHERE ps2.product_id = c.product_id
    ORDER BY ps2.lead_time_days ASC
    LIMIT 1
  ) ps ON true
  ORDER BY c.total_revenue DESC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rpc_abc_xyz_classification() TO authenticated, anon, service_role;


-- ============================================================================
-- 3. rpc_stockout_risks_by_warehouse
-- Only the demand_30d CTE (renamed to demand_90d) changes.
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
  -- FIX: was demand_30d with CURRENT_DATE - INTERVAL '30 days'; now snapshot-anchored
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
      ELSE 9999
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
    END                                                        AS risk_level,
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
