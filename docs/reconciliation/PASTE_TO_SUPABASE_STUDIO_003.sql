-- ============================================================================
-- rpc_acid_gap_report — pivoted (SKU × month) view of revenue_daily metrics
-- ============================================================================
-- Backs the /gerencia/gap-report page. Returns one row per (SKU × month)
-- with all 3 winning-formula metrics side by side, plus scope flags so the
-- UI can render colour/highlight indicators.
--
-- Filters:
--   p_sku_filter      — exact SKU match, NULL = no filter
--   p_from_month      — 'YYYY-MM', inclusive (default '2024-09', earliest data)
--   p_to_month        — 'YYYY-MM', inclusive, NULL = up to latest
--   p_scope           — 'top'  → only is_top_10_in_class=true (23 SKUs)
--                       'all'  → all 182 active templates in the universe
--   p_supplier_class  — 'REYMA' | 'CARVAJAL' | 'BOTH' | NULL (no filter)
--
-- Columns:
--   sku, product_name, supplier_class, source_indicator
--   movement_rank_within_class, is_top_10_in_class
--   observation_month         ('YYYY-MM')
--   sales_qty, sales_revenue_gtq, sales_doc_count
--   purchases_ordered_qty, purchases_received_qty
--
-- Always returns a row for every (SKU × month) cell in the requested range,
-- even if the qty is 0 — so the UI can show gaps.
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_acid_gap_report(
  p_sku_filter TEXT DEFAULT NULL,
  p_from_month TEXT DEFAULT '2024-09',
  p_to_month TEXT DEFAULT NULL,
  p_scope TEXT DEFAULT 'top',
  p_supplier_class TEXT DEFAULT NULL
)
RETURNS TABLE(
  sku VARCHAR,
  product_name TEXT,
  supplier_class VARCHAR,
  source_indicator VARCHAR,
  movement_rank_within_class INT,
  is_top_10_in_class BOOLEAN,
  observation_month TEXT,
  sales_qty NUMERIC,
  sales_revenue_gtq NUMERIC,
  sales_doc_count BIGINT,
  purchases_ordered_qty NUMERIC,
  purchases_received_qty NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  WITH scope AS (
    SELECT
      pat.default_code AS sku,
      p.id AS product_id,
      pat.representative_name AS product_name,
      pat.supplier_class,
      pat.source_indicator,
      pat.movement_rank_within_class,
      pat.is_top_10_in_class
    FROM products_acid_test_active pat
    JOIN products p ON p.sku = pat.default_code
    WHERE
      (p_scope = 'all' OR pat.is_top_10_in_class = TRUE)
      AND (p_sku_filter IS NULL OR pat.default_code = p_sku_filter)
      AND (p_supplier_class IS NULL OR pat.supplier_class = p_supplier_class)
  ),
  available_months AS (
    SELECT DISTINCT TO_CHAR(observation_date, 'YYYY-MM') AS month
    FROM revenue_daily
    WHERE TO_CHAR(observation_date, 'YYYY-MM') >= p_from_month
      AND (p_to_month IS NULL OR TO_CHAR(observation_date, 'YYYY-MM') <= p_to_month)
  ),
  cells AS (
    SELECT s.sku, s.product_id, s.product_name, s.supplier_class,
           s.source_indicator, s.movement_rank_within_class, s.is_top_10_in_class,
           m.month
    FROM scope s
    CROSS JOIN available_months m
  ),
  agg_sales AS (
    SELECT rd.product_id,
           TO_CHAR(rd.observation_date, 'YYYY-MM') AS month,
           SUM(rd.quantity)        AS qty,
           SUM(rd.revenue_gtq)     AS rev,
           SUM(rd.source_doc_count) AS docs
    FROM revenue_daily rd
    WHERE rd.metric = 'sales'
      AND rd.ssot_label = 'aml_income_posted_invoice_refund_neg_invoice_date_c40'
      AND TO_CHAR(rd.observation_date, 'YYYY-MM') >= p_from_month
      AND (p_to_month IS NULL OR TO_CHAR(rd.observation_date, 'YYYY-MM') <= p_to_month)
    GROUP BY rd.product_id, TO_CHAR(rd.observation_date, 'YYYY-MM')
  ),
  agg_ord AS (
    SELECT rd.product_id,
           TO_CHAR(rd.observation_date, 'YYYY-MM') AS month,
           SUM(rd.quantity) AS qty
    FROM revenue_daily rd
    WHERE rd.metric = 'purchases_ordered'
      AND rd.ssot_label = 'pol_all_states_date_planned_product_qty_c40'
      AND TO_CHAR(rd.observation_date, 'YYYY-MM') >= p_from_month
      AND (p_to_month IS NULL OR TO_CHAR(rd.observation_date, 'YYYY-MM') <= p_to_month)
    GROUP BY rd.product_id, TO_CHAR(rd.observation_date, 'YYYY-MM')
  ),
  agg_rcv AS (
    SELECT rd.product_id,
           TO_CHAR(rd.observation_date, 'YYYY-MM') AS month,
           SUM(rd.quantity) AS qty
    FROM revenue_daily rd
    WHERE rd.metric = 'purchases_received'
      AND rd.ssot_label = 'pol_purchase_done_date_planned_qty_received_c40'
      AND TO_CHAR(rd.observation_date, 'YYYY-MM') >= p_from_month
      AND (p_to_month IS NULL OR TO_CHAR(rd.observation_date, 'YYYY-MM') <= p_to_month)
    GROUP BY rd.product_id, TO_CHAR(rd.observation_date, 'YYYY-MM')
  )
  SELECT
    c.sku::VARCHAR,
    c.product_name::TEXT,
    c.supplier_class::VARCHAR,
    c.source_indicator::VARCHAR,
    c.movement_rank_within_class::INT,
    c.is_top_10_in_class::BOOLEAN,
    c.month::TEXT,
    COALESCE(s.qty, 0)::NUMERIC AS sales_qty,
    COALESCE(s.rev, 0)::NUMERIC AS sales_revenue_gtq,
    COALESCE(s.docs, 0)::BIGINT AS sales_doc_count,
    COALESCE(o.qty, 0)::NUMERIC AS purchases_ordered_qty,
    COALESCE(r.qty, 0)::NUMERIC AS purchases_received_qty
  FROM cells c
  LEFT JOIN agg_sales s ON s.product_id = c.product_id AND s.month = c.month
  LEFT JOIN agg_ord o ON o.product_id = c.product_id AND o.month = c.month
  LEFT JOIN agg_rcv r ON r.product_id = c.product_id AND r.month = c.month
  ORDER BY c.supplier_class, c.movement_rank_within_class, c.month;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION rpc_acid_gap_report(TEXT, TEXT, TEXT, TEXT, TEXT) IS
  'Pivoted (SKU × month) view of revenue_daily under the winning SSOT formulas. Backs /gerencia/gap-report. Returns sales qty/revenue, purchases ordered, purchases received per (SKU, month). Always emits a cell per requested (SKU × month) even when value is 0.';

-- Also expose the SKU list (for the dropdown) as a quick RPC
CREATE OR REPLACE FUNCTION rpc_acid_gap_report_skus(
  p_scope TEXT DEFAULT 'top'
)
RETURNS TABLE(
  sku VARCHAR,
  product_name TEXT,
  supplier_class VARCHAR,
  source_indicator VARCHAR,
  movement_rank_within_class INT,
  is_top_10_in_class BOOLEAN,
  net_sales_quantity NUMERIC
) AS $$
  SELECT
    pat.default_code::VARCHAR,
    pat.representative_name::TEXT,
    pat.supplier_class::VARCHAR,
    pat.source_indicator::VARCHAR,
    pat.movement_rank_within_class::INT,
    pat.is_top_10_in_class::BOOLEAN,
    pat.net_sales_quantity::NUMERIC
  FROM products_acid_test_active pat
  WHERE p_scope = 'all' OR pat.is_top_10_in_class = TRUE
  ORDER BY pat.supplier_class, pat.movement_rank_within_class;
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION rpc_acid_gap_report_skus(TEXT) IS
  'Returns the in-scope SKU list for the gap-report page''s SKU dropdown. p_scope=top → 23 SKUs flagged in_top_10. p_scope=all → all 182 universe templates.';
