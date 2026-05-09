-- ============================================================================
-- rpc_abc_xyz_classification — add inventory fields for GTQ inmovilizado
-- Needed for Hold List financial quantification (capital congelado) and
-- supplier filter in the demo.
-- Plan 005 / B3 — 2026-05-08
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
  -- new fields for financial quantification
  current_stock           NUMERIC,   -- sum across all warehouses at latest snapshot
  avg_daily_demand        NUMERIC,   -- 30-day average from demand_daily
  lead_time_days          INT,       -- shortest lead time across suppliers
  unit_cost               NUMERIC,   -- p.cost — purchase cost for capital calculation
  supplier_name           VARCHAR    -- primary supplier (shortest lead time)
) AS $$
BEGIN
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
  latest_snap AS (
    SELECT MAX(snapshot_date) AS d FROM inventory_daily
  ),
  current_inventory AS (
    SELECT
      id.product_id,
      SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    JOIN latest_snap ON id.snapshot_date = latest_snap.d
    GROUP BY id.product_id
  ),
  recent_demand AS (
    SELECT
      dd.product_id,
      AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.is_censored = false
      AND dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'
    GROUP BY dd.product_id
  )
  SELECT
    c.product_id,
    c.product_name,
    c.sku,
    c.category,
    c.total_revenue,
    ROUND(c.cum_pct, 2) AS cumulative_revenue_pct,
    CASE
      WHEN c.cum_pct <= 80 THEN 'A'
      WHEN c.cum_pct <= 95 THEN 'B'
      ELSE 'C'
    END::CHAR(1) AS abc_class,
    ROUND(COALESCE(dv.cv, 0), 4) AS demand_cv,
    CASE
      WHEN COALESCE(dv.cv, 0) < 0.5 THEN 'X'
      WHEN COALESCE(dv.cv, 0) < 1.0 THEN 'Y'
      ELSE 'Z'
    END::CHAR(1) AS xyz_class,
    COALESCE(dv.obs_days, 0) AS observation_days,
    CASE
      WHEN COALESCE(dv.obs_days, 0) >= 90 THEN 'Alta confianza'
      WHEN COALESCE(dv.obs_days, 0) >= 30 THEN 'Confianza media'
      ELSE 'Datos insuficientes'
    END::VARCHAR AS statistical_confidence,
    COALESCE(ci.current_qty, 0)                    AS current_stock,
    COALESCE(rd.avg_demand, 0)                     AS avg_daily_demand,
    COALESCE(ps.lt_days, 30)                       AS lead_time_days,
    COALESCE(p.cost, 0)                            AS unit_cost,
    ps.sup_name                                    AS supplier_name
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
