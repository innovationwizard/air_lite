-- ============================================================================
-- rpc_gerencia_validation — Per-SKU holdout backtest comparison for Gerencia
-- ============================================================================
-- Answers Luis (Gerente General)'s three questions from the 2026-04-22
-- meeting with David (see docs/april_jumpstart/_GERENTE_GENERAL_PLAN_APR22.md):
--
--   1. Per-SKU backtest: system-predicted demand vs comprador-purchased qty
--      vs actual sales (3 series + acierto % for system and compradores).
--   2. Monetary translation: cost, revenue, margin for both the system's plan
--      and reality.
--   3. Honest holdout framing: the training window is surfaced on every row.
--
-- Default scope is Carvajal + Reyma only (Jorge, 2026-04-22: "most pain,
-- should be enough for tomorrow"). Carvajal is aggregated across its 5 active
-- supplier entities (minus the "NO USAR" one). Reyma supplier (ID 1752) has
-- zero rows in product_suppliers, so Reyma SKUs are matched by name — this is
-- a documented data gap, not a silent hack.
--
-- Monetary math uses products.cost and products.list_price at their stored
-- units. The Supabase revenue pipeline's gross-vs-net-of-credit-notes state is
-- unverified (Q13 in the plan) — the page carries a footnote flagging that.
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_gerencia_validation(
  p_run_id INTEGER,
  p_carvajal_reyma_only BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (
  run_id                         INTEGER,
  training_start_date            DATE,
  training_end_date              DATE,
  prediction_month               DATE,
  product_id                     INTEGER,
  sku                            VARCHAR,
  product_name                   VARCHAR,
  supplier_label                 TEXT,
  predicted_demand               NUMERIC,
  comprador_purchase_qty         NUMERIC,
  actual_sales_qty               NUMERIC,
  predicted_reorder_point        NUMERIC,
  predicted_safety_stock         NUMERIC,
  acierto_system_pct             NUMERIC,
  acierto_comprador_pct          NUMERIC,
  unit_cost_gtq                  NUMERIC,
  unit_price_gtq                 NUMERIC,
  predicted_purchase_cost_gtq    NUMERIC,
  predicted_revenue_gtq          NUMERIC,
  predicted_margin_gtq           NUMERIC,
  comprador_purchase_cost_gtq    NUMERIC,
  actual_revenue_gtq             NUMERIC,
  actual_margin_gtq              NUMERIC,
  margin_uplift_gtq              NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH run AS (
    SELECT id, training_start_date, training_end_date, prediction_month
    FROM backtest_runs
    WHERE id = p_run_id
  ),
  -- Carvajal SKUs via product_suppliers → suppliers (name match, excluding the "NO USAR" entity).
  carvajal_sku_ids AS (
    SELECT DISTINCT ps.product_id
    FROM product_suppliers ps
    JOIN suppliers s ON s.id = ps.supplier_id
    WHERE s.name ILIKE '%carvajal%'
      AND s.name NOT ILIKE '%no usar%'
      AND s.is_active = TRUE
  ),
  -- Reyma SKUs via products.name ILIKE fallback. supplier_id 1752 exists but
  -- product_suppliers has zero rows for Reyma as of 2026-04-22. Flagged in UI.
  reyma_sku_ids AS (
    SELECT id AS product_id
    FROM products
    WHERE name ILIKE '%REYMA%'
      AND is_active = TRUE
  ),
  in_scope_skus AS (
    SELECT product_id FROM carvajal_sku_ids
    UNION
    SELECT product_id FROM reyma_sku_ids
  ),
  -- Comprador purchases aggregated per product over the prediction month.
  -- "quantity" = units ordered (what Luis meant by "qué compraron").
  -- states 'purchase' and 'done' = confirmed POs; drafts and cancellations are excluded.
  comprador_po AS (
    SELECT
      pol.product_id,
      SUM(pol.quantity) AS qty_ordered,
      SUM(pol.quantity * pol.unit_price) AS cost_total_gtq
    FROM purchase_order_lines pol
    JOIN purchase_orders po ON po.id = pol.order_id
    JOIN run ON TRUE
    WHERE po.order_date >= run.prediction_month
      AND po.order_date <  (run.prediction_month + INTERVAL '1 month')
      AND po.state IN ('purchase', 'done')
    GROUP BY pol.product_id
  ),
  -- Supplier label per product. A product linked to both Carvajal and Reyma
  -- (by name) is labeled "Carvajal + Reyma". A product that matches Carvajal
  -- only is labeled "Carvajal". Same for Reyma.
  labels AS (
    SELECT
      s.product_id,
      CASE
        WHEN s.in_carvajal AND s.in_reyma THEN 'Carvajal + Reyma'
        WHEN s.in_carvajal               THEN 'Carvajal'
        WHEN s.in_reyma                  THEN 'Reyma (por nombre)'
        ELSE NULL
      END AS supplier_label
    FROM (
      SELECT
        p.id AS product_id,
        EXISTS (SELECT 1 FROM carvajal_sku_ids c WHERE c.product_id = p.id) AS in_carvajal,
        EXISTS (SELECT 1 FROM reyma_sku_ids    r WHERE r.product_id = p.id) AS in_reyma
      FROM products p
    ) s
  )
  SELECT
    br.run_id,
    r.training_start_date,
    r.training_end_date,
    r.prediction_month,
    br.product_id,
    p.sku,
    p.name                                                      AS product_name,
    lbl.supplier_label,
    br.predicted_demand,
    cpo.qty_ordered                                             AS comprador_purchase_qty,
    br.actual_demand                                            AS actual_sales_qty,
    br.predicted_reorder_point,
    br.predicted_safety_stock,
    -- Acierto = 1 - relative error. Capped at 0 (a 3x overshoot reads as 0%, not -200%).
    CASE
      WHEN br.actual_demand IS NULL OR br.actual_demand = 0 THEN NULL
      ELSE GREATEST(
        0,
        1 - (ABS(br.predicted_demand - br.actual_demand) / br.actual_demand)
      )
    END                                                         AS acierto_system_pct,
    CASE
      WHEN br.actual_demand IS NULL OR br.actual_demand = 0 THEN NULL
      WHEN cpo.qty_ordered IS NULL                          THEN NULL
      ELSE GREATEST(
        0,
        1 - (ABS(cpo.qty_ordered - br.actual_demand) / br.actual_demand)
      )
    END                                                         AS acierto_comprador_pct,
    p.cost                                                      AS unit_cost_gtq,
    p.list_price                                                AS unit_price_gtq,
    -- Monetary — system's plan
    (br.predicted_demand * COALESCE(p.cost, 0))                 AS predicted_purchase_cost_gtq,
    (br.predicted_demand * COALESCE(p.list_price, 0))           AS predicted_revenue_gtq,
    (br.predicted_demand * (COALESCE(p.list_price, 0) - COALESCE(p.cost, 0))) AS predicted_margin_gtq,
    -- Monetary — compradores' actual plan (uses Odoo PO unit_price for cost, list_price for revenue)
    cpo.cost_total_gtq                                          AS comprador_purchase_cost_gtq,
    (COALESCE(br.actual_demand, 0) * COALESCE(p.list_price, 0)) AS actual_revenue_gtq,
    (COALESCE(br.actual_demand, 0) * (COALESCE(p.list_price, 0) - COALESCE(p.cost, 0))) AS actual_margin_gtq,
    -- Margin uplift = system's projected margin minus actual margin under compradores' plan.
    -- Positive value = the system's plan would have earned more than what actually happened.
    (
      (br.predicted_demand * (COALESCE(p.list_price, 0) - COALESCE(p.cost, 0)))
      -
      (COALESCE(br.actual_demand, 0) * (COALESCE(p.list_price, 0) - COALESCE(p.cost, 0)))
    )                                                           AS margin_uplift_gtq
  FROM backtest_results br
  JOIN run r ON TRUE
  JOIN products p    ON p.id = br.product_id
  LEFT JOIN comprador_po cpo ON cpo.product_id = br.product_id
  LEFT JOIN labels lbl       ON lbl.product_id = br.product_id
  WHERE br.run_id = p_run_id
    AND (
      NOT p_carvajal_reyma_only
      OR br.product_id IN (SELECT product_id FROM in_scope_skus)
    )
  ORDER BY ABS(
    COALESCE(
      (br.predicted_demand * (COALESCE(p.list_price, 0) - COALESCE(p.cost, 0)))
      -
      (COALESCE(br.actual_demand, 0) * (COALESCE(p.list_price, 0) - COALESCE(p.cost, 0))),
      0
    )
  ) DESC;
$$;

COMMENT ON FUNCTION rpc_gerencia_validation(INTEGER, BOOLEAN) IS
  'Per-SKU holdout backtest comparison for the Gerente General demo. Returns predicted demand vs comprador purchase qty vs actual sales for a single backtest run, with monetary translation and acierto %. Default scope: Carvajal + Reyma only. Reyma SKUs are matched by product name because product_suppliers has no Reyma linkage as of 2026-04-22.';

GRANT EXECUTE ON FUNCTION rpc_gerencia_validation(INTEGER, BOOLEAN) TO authenticated, anon, service_role;


-- ----------------------------------------------------------------------------
-- rpc_gerencia_validation_runs — List of available holdout cycles for the UI
-- ----------------------------------------------------------------------------
-- Small companion RPC so the page can populate its cycle selector without
-- exposing the full backtest_runs schema to the browser.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION rpc_gerencia_validation_runs()
RETURNS TABLE (
  run_id                INTEGER,
  training_start_date   DATE,
  training_end_date     DATE,
  prediction_month      DATE,
  products_modeled      INTEGER
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    id                    AS run_id,
    training_start_date,
    training_end_date,
    prediction_month,
    products_modeled
  FROM backtest_runs
  WHERE status = 'completed'
  ORDER BY prediction_month ASC;
$$;

COMMENT ON FUNCTION rpc_gerencia_validation_runs() IS
  'Completed backtest runs ordered by prediction month, used to populate the cycle selector on /gerencia/validacion.';

GRANT EXECUTE ON FUNCTION rpc_gerencia_validation_runs() TO authenticated, anon, service_role;
