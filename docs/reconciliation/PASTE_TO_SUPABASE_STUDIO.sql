-- ============================================================================
-- Apply both 2026-04-23 migrations in one paste
-- 20260423000001 — aggregate_demand_daily_for_product(p_product_id INT)
-- 20260423000002 — revenue_daily table
-- ============================================================================

-- ============================================================================
-- Per-product variant of aggregate_demand_daily()
-- ============================================================================
-- Context: the original aggregate_demand_daily() TRUNCATEs and rebuilds the
-- entire demand_daily table. That's correct for a full refresh but wasteful
-- when we only want to refresh a single product (e.g. after replacing its
-- sale_order_lines with live Odoo data).
--
-- This function does the same logic as aggregate_demand_daily() but scoped
-- to a single product_id. Same SSOT contract (effective_date + delivered_qty,
-- state IN ('sale','done'), delivered_qty > 0). Same census-filter semantics.
--
-- Called after replacing a single product's rows, per the 2026-04-23 SKU
-- 77201046 replacement plan (docs/reconciliation/PLAN_FIX_PRODUCTS_ODOO_ID.md
-- adjacency and the replacement operation log).
-- ============================================================================

CREATE OR REPLACE FUNCTION aggregate_demand_daily_for_product(p_product_id INT)
RETURNS TABLE(days_generated BIGINT, censored_days BIGINT, duration_ms INT) AS $$
DECLARE
  v_start TIMESTAMPTZ := clock_timestamp();
  v_days BIGINT;
  v_censored BIGINT;
BEGIN
  -- Clear existing rows for this product only
  DELETE FROM demand_daily WHERE product_id = p_product_id;

  -- Step 1: Aggregate DELIVERED sales by day for this product
  INSERT INTO demand_daily (product_id, demand_date, quantity_sold, revenue, orders_count)
  SELECT
    sol.product_id,
    DATE(so.effective_date) AS demand_date,
    SUM(sol.delivered_qty) AS quantity_sold,
    COALESCE(SUM(sol.subtotal), 0) AS revenue,
    COUNT(DISTINCT so.id) AS orders_count
  FROM sale_order_lines sol
  JOIN sale_orders so ON so.id = sol.order_id
  WHERE so.state IN ('sale', 'done')
    AND sol.product_id = p_product_id
    AND sol.delivered_qty > 0
    AND so.effective_date IS NOT NULL
  GROUP BY sol.product_id, DATE(so.effective_date)
  ON CONFLICT (product_id, demand_date) DO UPDATE
    SET quantity_sold = EXCLUDED.quantity_sold,
        revenue = EXCLUDED.revenue,
        orders_count = EXCLUDED.orders_count;

  -- Step 2: Insert censored days for this product (stockout + zero sales)
  INSERT INTO demand_daily (product_id, demand_date, quantity_sold, revenue, is_censored, orders_count)
  SELECT
    id_inv.product_id,
    id_inv.snapshot_date,
    0, 0, true, 0
  FROM (
    SELECT product_id, snapshot_date
    FROM inventory_daily
    WHERE product_id = p_product_id
    GROUP BY product_id, snapshot_date
    HAVING SUM(quantity_on_hand) <= 0
  ) id_inv
  WHERE NOT EXISTS (
    SELECT 1 FROM demand_daily dd
    WHERE dd.product_id = id_inv.product_id
      AND dd.demand_date = id_inv.snapshot_date
  )
  ON CONFLICT (product_id, demand_date) DO NOTHING;

  -- Step 3: Mark zero-sales days as censored if inventory was <= 0
  UPDATE demand_daily dd
  SET is_censored = true
  WHERE dd.product_id = p_product_id
    AND dd.quantity_sold = 0
    AND EXISTS (
      SELECT 1
      FROM inventory_daily id_inv
      WHERE id_inv.product_id = dd.product_id
        AND id_inv.snapshot_date = dd.demand_date
      GROUP BY id_inv.product_id, id_inv.snapshot_date
      HAVING SUM(id_inv.quantity_on_hand) <= 0
    );

  SELECT COUNT(*) INTO v_days FROM demand_daily WHERE product_id = p_product_id;
  SELECT COUNT(*) INTO v_censored FROM demand_daily WHERE product_id = p_product_id AND is_censored = true;

  RETURN QUERY SELECT v_days, v_censored,
    (EXTRACT(EPOCH FROM (clock_timestamp() - v_start)) * 1000)::INT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION aggregate_demand_daily_for_product(INT) IS
  'Per-product variant of aggregate_demand_daily(). Same SSOT rules, scoped to one product_id. Added 2026-04-23 for the SKU 77201046 replacement operation.';

-- ============================================================================
-- ============================================================================
-- revenue_daily — coexists with demand_daily, persists multiple SSOT formulas
-- ============================================================================
-- Context: SSOT discovery (2026-04-23) found that the CEO's dashboard uses
-- different filter math than our existing demand_daily.
--
-- demand_daily implements the OPERATIONAL view (sale.order.line, effective_date,
-- delivered_qty, state IN sale/done, delivered_qty > 0) per SSOT_VALIDATION.md.
--
-- revenue_daily implements the FINANCIAL view (account.move.line, income
-- account, posted invoices, refunds as negative, invoice_date) — which matches
-- the CEO's dashboard exactly for SKU 77201046 (verified Nov + Dec 2024 to
-- 0.00 unit gap).
--
-- The table also holds purchase_ordered and purchase_received metrics derived
-- from purchase.order.line (date_planned, all states for ordered; purchase+done
-- for received) — also verified to 0.00 unit gap for SKU 77201046 Nov 2024.
--
-- Schema is intentionally generic so additional SSOT formulas can be added
-- side-by-side (different ssot_label values) for comparison without breaking
-- existing data.
--
-- Reference:
--   docs/reconciliation/PLAN_ACID_TEST_SSOT_DISCOVERY.md
--   docs/reconciliation/find_07_ssot_finder_results.md
--   docs/reconciliation/SSOT_WINNING_FORMULAS.md (post-migration)
-- ============================================================================

CREATE TABLE IF NOT EXISTS revenue_daily (
  id BIGSERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  ssot_label VARCHAR(100) NOT NULL,
  metric VARCHAR(30) NOT NULL,
  observation_date DATE NOT NULL,
  quantity NUMERIC(15,4) NOT NULL,
  revenue_gtq NUMERIC(15,4),
  source_doc_count INT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, ssot_label, metric, observation_date)
);

CREATE INDEX IF NOT EXISTS idx_rd_product_metric_date
  ON revenue_daily(product_id, metric, observation_date);

CREATE INDEX IF NOT EXISTS idx_rd_ssot_label
  ON revenue_daily(ssot_label);

CREATE INDEX IF NOT EXISTS idx_rd_date
  ON revenue_daily(observation_date);

COMMENT ON TABLE revenue_daily IS
  'Per-product per-day metrics under multiple SSOT definitions. Coexists with demand_daily. Each (product_id, ssot_label, metric, observation_date) is unique. Multiple ssot_labels can hold competing definitions for comparison. Added 2026-04-23 for the SSOT acid-test work.';

COMMENT ON COLUMN revenue_daily.ssot_label IS
  'Human-readable formula identifier, e.g. "aml_income_posted_invoice_refund_neg_invoice_date_c40". Matches a row in docs/reconciliation/SSOT_WINNING_FORMULAS.md.';

COMMENT ON COLUMN revenue_daily.metric IS
  'One of: sales | purchases_ordered | purchases_received. Other metrics may be added.';

COMMENT ON COLUMN revenue_daily.quantity IS
  'Aggregate quantity for the (product, ssot_label, metric, day). Always normalized to the product''s stock UoM (CAJA40 for the test SKU 77201046).';

COMMENT ON COLUMN revenue_daily.revenue_gtq IS
  'For metric=sales: the GTQ revenue (sum of price_subtotal). NULL for purchase metrics unless cost is tracked.';

COMMENT ON COLUMN revenue_daily.source_doc_count IS
  'How many distinct source documents (invoices, POs) contributed to this aggregate. Useful for sanity checks.';
