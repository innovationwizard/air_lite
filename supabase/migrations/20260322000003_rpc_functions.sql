-- ============================================================================
-- AI Refill Lite — RPC Functions
-- Called by the ML service (savings calculations) and Next.js API routes
-- ============================================================================

-- ============================================================================
-- Product revenue ranking for backtest product selection
-- ============================================================================
CREATE OR REPLACE FUNCTION get_product_revenue_ranking(
  p_start_date DATE,
  p_end_date DATE,
  p_min_observations INT DEFAULT 30
)
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  category VARCHAR,
  total_revenue NUMERIC,
  non_censored_days BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    COALESCE(SUM(dd.revenue), 0) AS total_revenue,
    COUNT(dd.id) FILTER (WHERE dd.is_censored = false) AS non_censored_days
  FROM products p
  LEFT JOIN demand_daily dd
    ON dd.product_id = p.id
    AND dd.demand_date BETWEEN p_start_date AND p_end_date
  WHERE p.is_active = true
  GROUP BY p.id, p.name, p.sku, p.category
  HAVING COALESCE(SUM(dd.revenue), 0) > 0
  ORDER BY total_revenue DESC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- Average inventory value for storage cost calculation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_avg_inventory_value(
  p_product_ids INT[],
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  product_id INT,
  avg_quantity NUMERIC,
  unit_cost NUMERIC,
  lead_time_days INT,
  demand_std NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    id_agg.product_id,
    id_agg.avg_qty AS avg_quantity,
    id_agg.unit_cost,
    COALESCE(ps.lead_time_days, 30) AS lead_time_days,
    dd_std.demand_std
  FROM (
    SELECT
      id.product_id,
      AVG(id.quantity_on_hand) AS avg_qty,
      AVG(id.unit_cost) AS unit_cost
    FROM inventory_daily id
    WHERE id.product_id = ANY(p_product_ids)
      AND id.snapshot_date BETWEEN p_start_date AND p_end_date
    GROUP BY id.product_id
  ) id_agg
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days
    FROM product_suppliers ps2
    WHERE ps2.product_id = id_agg.product_id
    ORDER BY ps2.lead_time_days DESC
    LIMIT 1
  ) ps ON true
  LEFT JOIN LATERAL (
    SELECT STDDEV(dd.quantity_sold) AS demand_std
    FROM demand_daily dd
    WHERE dd.product_id = id_agg.product_id
      AND dd.is_censored = false
      AND dd.demand_date < p_start_date
  ) dd_std ON true;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- Purchase analysis for unnecessary purchases calculation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_purchase_analysis(
  p_product_ids INT[],
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  actual_purchased_qty NUMERIC,
  actual_purchased_value NUMERIC,
  avg_unit_cost NUMERIC,
  inventory_at_start NUMERIC,
  lead_time_days INT,
  demand_std NUMERIC,
  min_order_qty NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    pol_agg.product_id,
    p.name AS product_name,
    pol_agg.total_qty AS actual_purchased_qty,
    pol_agg.total_value AS actual_purchased_value,
    pol_agg.avg_cost AS avg_unit_cost,
    COALESCE(inv_start.qty_on_hand, 0) AS inventory_at_start,
    COALESCE(ps.lead_time_days, 30) AS lead_time_days,
    dd_std.demand_std,
    COALESCE(ps.min_order_qty, 1) AS min_order_qty
  FROM (
    SELECT
      pol.product_id,
      SUM(pol.quantity) AS total_qty,
      SUM(pol.quantity * pol.unit_price) AS total_value,
      AVG(pol.unit_price) AS avg_cost
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.order_id
    WHERE pol.product_id = ANY(p_product_ids)
      AND po.state IN ('purchase', 'done', 'locked')
      AND po.order_date BETWEEN p_start_date::TIMESTAMPTZ AND (p_end_date + 1)::TIMESTAMPTZ
    GROUP BY pol.product_id
  ) pol_agg
  JOIN products p ON p.id = pol_agg.product_id
  LEFT JOIN LATERAL (
    SELECT SUM(id.quantity_on_hand) AS qty_on_hand
    FROM inventory_daily id
    WHERE id.product_id = pol_agg.product_id
      AND id.snapshot_date = p_start_date
  ) inv_start ON true
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days, ps2.min_order_qty
    FROM product_suppliers ps2
    WHERE ps2.product_id = pol_agg.product_id
    ORDER BY ps2.lead_time_days DESC
    LIMIT 1
  ) ps ON true
  LEFT JOIN LATERAL (
    SELECT STDDEV(dd.quantity_sold) AS demand_std
    FROM demand_daily dd
    WHERE dd.product_id = pol_agg.product_id
      AND dd.is_censored = false
      AND dd.demand_date < p_start_date
  ) dd_std ON true;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- Stockout analysis for lost sales calculation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_stockout_analysis(
  p_product_ids INT[],
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  product_id INT,
  stockout_days BIGINT,
  avg_daily_demand_non_stockout NUMERIC,
  list_price NUMERIC,
  cost NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    id_so.product_id,
    id_so.stockout_days,
    dd_avg.avg_demand AS avg_daily_demand_non_stockout,
    p.list_price,
    p.cost
  FROM (
    -- Count days with zero or negative inventory
    SELECT
      id.product_id,
      COUNT(*) AS stockout_days
    FROM inventory_daily id
    WHERE id.product_id = ANY(p_product_ids)
      AND id.snapshot_date BETWEEN p_start_date AND p_end_date
    GROUP BY id.product_id
    HAVING SUM(id.quantity_on_hand) <= 0
  ) id_so
  JOIN products p ON p.id = id_so.product_id
  LEFT JOIN LATERAL (
    -- Average daily demand on non-stockout, non-censored days
    SELECT AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.product_id = id_so.product_id
      AND dd.is_censored = false
      AND dd.quantity_sold > 0
      AND dd.demand_date BETWEEN p_start_date AND p_end_date
  ) dd_avg ON true;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- Rotation metrics for inventory turnover calculation
-- ============================================================================
CREATE OR REPLACE FUNCTION get_rotation_metrics(
  p_run_id INT,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  total_cogs NUMERIC,
  actual_avg_inventory_value NUMERIC,
  optimized_avg_inventory_value NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH run_products AS (
    SELECT br.product_id
    FROM backtest_results br
    WHERE br.run_id = p_run_id
  )
  SELECT
    -- COGS: sum of (quantity_sold * product.cost) for the month
    COALESCE((
      SELECT SUM(dd.quantity_sold * p.cost)
      FROM demand_daily dd
      JOIN products p ON p.id = dd.product_id
      WHERE dd.product_id IN (SELECT product_id FROM run_products)
        AND dd.demand_date BETWEEN p_start_date AND p_end_date
        AND dd.is_censored = false
    ), 0) AS total_cogs,

    -- Actual average inventory value
    COALESCE((
      SELECT AVG(id.inventory_value)
      FROM inventory_daily id
      WHERE id.product_id IN (SELECT product_id FROM run_products)
        AND id.snapshot_date BETWEEN p_start_date AND p_end_date
    ), 0) AS actual_avg_inventory_value,

    -- Optimized: estimate as 60% of actual (conservative, based on typical
    -- AI-driven inventory reduction of 20-40%)
    COALESCE((
      SELECT AVG(id.inventory_value) * 0.65
      FROM inventory_daily id
      WHERE id.product_id IN (SELECT product_id FROM run_products)
        AND id.snapshot_date BETWEEN p_start_date AND p_end_date
    ), 0) AS optimized_avg_inventory_value;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- KPI: Stockout risk (products at risk of running out)
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_stockout_risks()
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  category VARCHAR,
  current_stock NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply NUMERIC,
  lead_time_days INT,
  risk_level VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    COALESCE(inv.current_qty, 0) AS current_stock,
    COALESCE(dem.avg_demand, 0) AS avg_daily_demand,
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
    END AS risk_level
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
    SELECT ps2.lead_time_days AS lt_days
    FROM product_suppliers ps2
    WHERE ps2.product_id = p.id
    ORDER BY ps2.lead_time_days DESC
    LIMIT 1
  ) ps ON true
  WHERE p.is_active = true
    AND COALESCE(dem.avg_demand, 0) > 0
  ORDER BY days_of_supply ASC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- KPI: ABC/XYZ Classification
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_abc_xyz_classification()
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  category VARCHAR,
  total_revenue NUMERIC,
  cumulative_revenue_pct NUMERIC,
  abc_class CHAR(1),
  demand_cv NUMERIC,
  xyz_class CHAR(1),
  observation_days BIGINT,
  statistical_confidence VARCHAR
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
    END::VARCHAR AS statistical_confidence
  FROM cumulative c
  LEFT JOIN demand_variability dv ON dv.product_id = c.product_id
  ORDER BY c.total_revenue DESC;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- KPI: Slow-moving / dead stock
-- ============================================================================
CREATE OR REPLACE FUNCTION rpc_slow_moving_items()
RETURNS TABLE(
  product_id INT,
  product_name VARCHAR,
  sku VARCHAR,
  category VARCHAR,
  current_stock NUMERIC,
  inventory_value NUMERIC,
  last_sale_date DATE,
  days_since_last_sale INT,
  avg_monthly_demand NUMERIC,
  classification VARCHAR
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id AS product_id,
    p.name AS product_name,
    p.sku,
    p.category,
    COALESCE(inv.current_qty, 0) AS current_stock,
    COALESCE(inv.current_qty, 0) * COALESCE(p.cost, 0) AS inventory_value,
    last_sale.last_date AS last_sale_date,
    COALESCE(CURRENT_DATE - last_sale.last_date, 9999) AS days_since_last_sale,
    COALESCE(monthly.avg_demand, 0) AS avg_monthly_demand,
    CASE
      WHEN COALESCE(CURRENT_DATE - last_sale.last_date, 9999) > 180 THEN 'Inventario muerto'
      WHEN COALESCE(CURRENT_DATE - last_sale.last_date, 9999) > 90 THEN 'Movimiento lento'
      WHEN COALESCE(CURRENT_DATE - last_sale.last_date, 9999) > 60 THEN 'Atención requerida'
      ELSE 'Normal'
    END AS classification
  FROM products p
  LEFT JOIN LATERAL (
    SELECT SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.product_id = p.id
      AND id.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_daily)
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT MAX(dd.demand_date) AS last_date
    FROM demand_daily dd
    WHERE dd.product_id = p.id AND dd.quantity_sold > 0
  ) last_sale ON true
  LEFT JOIN LATERAL (
    SELECT AVG(monthly_qty) AS avg_demand
    FROM (
      SELECT SUM(dd.quantity_sold) AS monthly_qty
      FROM demand_daily dd
      WHERE dd.product_id = p.id AND dd.is_censored = false
      GROUP BY DATE_TRUNC('month', dd.demand_date)
    ) monthly_agg
  ) monthly ON true
  WHERE p.is_active = true
    AND COALESCE(inv.current_qty, 0) > 0
  ORDER BY days_since_last_sale DESC;
END;
$$ LANGUAGE plpgsql;
