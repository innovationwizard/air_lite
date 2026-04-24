-- ============================================================================
-- products_acid_test_active and products_acid_test_archived
-- ============================================================================
-- Per-template universe of REYMA + CARVAJAL products for the acid-test work.
-- Split into two tables per user direction (2026-04-23):
--   - active:   templates with at least one active product.product variant
--   - archived: templates with all variants archived
--
-- For each row:
--   default_code is the variant's default_code (may be NULL)
--   product_product_ids = all variants under this template
--   supplier_class is REYMA, CARVAJAL, or BOTH (rare)
--   source_indicator tells how this template entered the universe:
--     NAME           — product.product.name contains the term
--     SUPPLIER_LINK  — only via product.supplierinfo to a Carvajal-family supplier
--                      (with NO term in the name) — visual flag for Luis/David
--     BOTH           — both rules match
--
-- Net Sales numbers come from the WINNING formula
-- (aml_income_posted_invoice_refund_neg_invoice_date_c40), normalized to the
-- product's stock UoM.
--
-- Ranking is descending net_sales_quantity within each supplier_class.
-- is_top_10_in_class flags the top 10 of each class (the acid-test scope).
--
-- Reference:
--   docs/reconciliation/PLAN_ACID_TEST_SSOT_DISCOVERY.md
--   docs/reconciliation/SSOT_WINNING_FORMULAS.md
-- ============================================================================

CREATE TABLE IF NOT EXISTS products_acid_test_active (
  id BIGSERIAL PRIMARY KEY,
  default_code VARCHAR(50),
  representative_name TEXT NOT NULL,
  product_template_id INT NOT NULL,
  product_product_ids INT[] NOT NULL,
  supplier_class VARCHAR(20) NOT NULL,
  source_indicator VARCHAR(30) NOT NULL,
  net_sales_quantity NUMERIC(15,4) NOT NULL DEFAULT 0,
  net_sales_revenue_gtq NUMERIC(15,4) NOT NULL DEFAULT 0,
  movement_rank_within_class INT,
  is_top_10_in_class BOOLEAN NOT NULL DEFAULT FALSE,
  in_run58_36_list BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_template_id)
);

CREATE INDEX IF NOT EXISTS idx_pat_active_class ON products_acid_test_active(supplier_class);
CREATE INDEX IF NOT EXISTS idx_pat_active_rank ON products_acid_test_active(supplier_class, movement_rank_within_class);
CREATE INDEX IF NOT EXISTS idx_pat_active_top10 ON products_acid_test_active(is_top_10_in_class) WHERE is_top_10_in_class;
CREATE INDEX IF NOT EXISTS idx_pat_active_default_code ON products_acid_test_active(default_code);

CREATE TABLE IF NOT EXISTS products_acid_test_archived (
  id BIGSERIAL PRIMARY KEY,
  default_code VARCHAR(50),
  representative_name TEXT NOT NULL,
  product_template_id INT NOT NULL,
  product_product_ids INT[] NOT NULL,
  supplier_class VARCHAR(20) NOT NULL,
  source_indicator VARCHAR(30) NOT NULL,
  has_recent_activity_12mo BOOLEAN NOT NULL DEFAULT FALSE,
  net_sales_quantity_last_12mo NUMERIC(15,4) NOT NULL DEFAULT 0,
  net_sales_revenue_gtq_last_12mo NUMERIC(15,4) NOT NULL DEFAULT 0,
  net_sales_quantity_all_time NUMERIC(15,4) NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_template_id)
);

CREATE INDEX IF NOT EXISTS idx_pat_archived_class ON products_acid_test_archived(supplier_class);
CREATE INDEX IF NOT EXISTS idx_pat_archived_recent ON products_acid_test_archived(has_recent_activity_12mo) WHERE has_recent_activity_12mo;
CREATE INDEX IF NOT EXISTS idx_pat_archived_default_code ON products_acid_test_archived(default_code);

COMMENT ON TABLE products_acid_test_active IS
  'REYMA + CARVAJAL product templates with at least one active variant. Universe for acid test 1 + acid test 2 forecasting. Top 10 by net_sales_quantity in each class (REYMA, CARVAJAL) is the test scope.';

COMMENT ON TABLE products_acid_test_archived IS
  'REYMA + CARVAJAL product templates whose variants are ALL archived. Flagged with has_recent_activity_12mo if they had sales in the last 12 months despite being archived.';

COMMENT ON COLUMN products_acid_test_active.source_indicator IS
  'NAME = matched by REYMA/CARVAJAL in product.product.name. SUPPLIER_LINK = matched only via product.supplierinfo (no term in name) — visual flag for Carvajal sub-brands (Viva, Convermex, Bioform, etc.). BOTH = matched both rules.';

COMMENT ON COLUMN products_acid_test_active.in_run58_36_list IS
  'TRUE if this default_code appears in the 36-SKU Carvajal+Reyma list of backtest run 58 (set during populator pass).';
