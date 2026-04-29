-- ============================================================================
-- products_acid_test_active — add products_id FK column
-- ============================================================================
-- products_acid_test_active.id is a BIGSERIAL auto-increment with no relation
-- to products.id. Any script that needs to write to revenue_daily,
-- revenue_daily_for_ml, or forecast_results (all of which carry
-- product_id INT REFERENCES products(id)) must use products.id — never
-- products_acid_test_active.id.
--
-- This migration adds products_id as an explicit FK column so scripts can
-- select it directly without a separate runtime lookup.
--
-- Backfill: resolves each row's default_code to products.sku → products.id.
-- Rows whose default_code has no match in products remain NULL (out-of-scope
-- product templates not tracked in the Supabase products table).
--
-- Reference:
--   docs/reconciliation/FIX_PLAN_PRODUCTS_ID_MISMATCH_2026-04-28.md
-- ============================================================================

ALTER TABLE products_acid_test_active
  ADD COLUMN IF NOT EXISTS products_id INT REFERENCES products(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pat_active_products_id
  ON products_acid_test_active(products_id)
  WHERE products_id IS NOT NULL;

UPDATE products_acid_test_active pat
SET    products_id = p.id
FROM   products p
WHERE  p.sku = pat.default_code
  AND  pat.products_id IS NULL;

COMMENT ON COLUMN products_acid_test_active.products_id IS
  'FK to products(id), resolved by matching default_code to products.sku. NULL when the
   SKU is absent from the products table. Use this column — never
   products_acid_test_active.id — when referencing revenue_daily,
   revenue_daily_for_ml, or forecast_results.';
