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
