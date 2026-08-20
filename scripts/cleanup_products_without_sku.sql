-- ============================================================================
-- CLEANUP — junk rows in `products` (Odoo products with no default_code)
-- ============================================================================
-- Deliberately NOT a migration: it lives in scripts/ so `supabase db push`
-- never runs it on its own. Run it by hand in the SQL editor, and ONLY AFTER
-- the sync fix is deployed (ml/odoo_sync_reabastecimiento.py::plan_catalog_rows).
-- Run it before that and the hourly cron just recreates 50 rows per hour.
--
-- ORIGIN (measured in production, 2026-08-20):
--   Matching became SKU-ONLY on 2026-08-06 (odoo_id drifts on every build). An
--   Odoo product with no `default_code` can never be re-matched, so it fell
--   into the "genuinely new" branch on EVERY run. With the hourly cron live
--   since 08-13: 50 inserts/hour, ~1,200/day.
--   products = 13,806 rows for 1,595 real Odoo products.
--   Two code-less rows reached Wilmer's table with sales velocity:
--   'Descuento ' (p3=24, p6=37.8 at San Jose) and '88001005' (1 unit).
--
-- WHAT IT DELETES: `products` rows with sku IS NULL that nothing else
-- references, plus the product_suppliers links pointing at them.
-- WHAT IT KEEPS: any code-less row that historical data still hangs off
-- (inventory_daily, stock_moves, sale_order_lines, demand_daily, ...). Those
-- 48 rows (id <= 1653) came from the March load and stay.
-- ============================================================================


-- ── STEP 0 · PREVIEW (read-only — run this first and read the numbers) ──────
WITH no_sku AS (SELECT id FROM products WHERE sku IS NULL),
     referenced AS (
       SELECT s.id FROM no_sku s WHERE EXISTS (
         SELECT 1 FROM reabastecimiento_inputs t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM inventory_daily          t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM demand_daily             t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM stock_moves              t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM stock_quants             t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM sale_order_lines         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM purchase_order_lines     t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM revenue_daily            t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM revenue_daily_for_ml     t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM forecast_results         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM backtest_results         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM open_order_lines         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM dispatch_plan_weeks      t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM extraordinary_order_lines t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM weekly_audits            t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM comercial_forecast       t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM transito_overrides       t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM pending_reserve_overrides t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM sync_issues              t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM products_acid_test_active t WHERE t.products_id = s.id))
SELECT
  (SELECT count(*) FROM products)                                     AS products_today,
  (SELECT count(*) FROM products WHERE sku IS NOT NULL)               AS with_sku,
  (SELECT count(*) FROM no_sku)                                       AS without_sku,
  (SELECT count(*) FROM referenced)                                   AS without_sku_referenced_kept,
  (SELECT count(*) FROM no_sku) - (SELECT count(*) FROM referenced)   AS to_delete,
  (SELECT count(*) FROM product_suppliers ps
     WHERE ps.product_id IN (SELECT id FROM no_sku))                  AS supplier_links_to_delete;
-- Baseline 2026-08-20 20:30 UTC: products 13,956 · with_sku 1,668 · without_sku
-- 12,288 · referenced ~48 · to_delete ~12,240 · links ~746. (without_sku keeps
-- growing by 50/hour until the fix is deployed.)


-- ── STEP 1 · CLEANUP (transactional — all or nothing) ───────────────────────
BEGIN;

-- Freeze the set once. product_suppliers is deliberately NOT in the guard list:
-- links pointing at junk products are themselves junk and go in the same step.
CREATE TEMP TABLE junk ON COMMIT DROP AS
SELECT p.id FROM products p
WHERE p.sku IS NULL
  AND NOT EXISTS (SELECT 1 FROM reabastecimiento_inputs   t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM inventory_daily           t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM demand_daily              t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM stock_moves               t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM stock_quants              t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM sale_order_lines          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_order_lines      t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM revenue_daily             t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM revenue_daily_for_ml      t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM forecast_results          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM backtest_results          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM open_order_lines          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM dispatch_plan_weeks       t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM extraordinary_order_lines t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM weekly_audits             t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM comercial_forecast        t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM transito_overrides        t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM pending_reserve_overrides t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM sync_issues               t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM products_acid_test_active t WHERE t.products_id = p.id);

SELECT count(*) AS rows_to_delete FROM junk;

DELETE FROM product_suppliers WHERE product_id IN (SELECT id FROM junk);
DELETE FROM products          WHERE id         IN (SELECT id FROM junk);

-- Read both counts BEFORE committing. If they don't match the preview: ROLLBACK.
SELECT count(*) AS products_after,
       count(*) FILTER (WHERE sku IS NULL) AS without_sku_remaining
FROM products;

COMMIT;   -- ← or ROLLBACK; if anything looks off


-- ── STEP 2 · VERIFY (after the next hourly run) ─────────────────────────────
-- products_inserted must be 0 on every run once the fix is deployed.
-- SELECT started_at, counts->>'products_inserted' AS inserted,
--        counts->>'input_rows' AS rows
-- FROM sync_runs WHERE kind = 'reabastecimiento'
-- ORDER BY started_at DESC LIMIT 5;


-- ── STEP 3 · OPTIONAL · lock so it cannot happen again ──────────────────────
-- The fixed sync is the only code that inserts into `products` (verified
-- 2026-08-20: the frontend only reads; odoo_sync_oa_v2 only PATCHes by sku; the
-- Reyma sync never writes this table). NOT VALID leaves the 48 surviving
-- historical rows untouched and only blocks new NULL-sku inserts.
-- If adopted, ship it as supabase/migrations/20260820000001_products_sku_present.sql
--
-- ALTER TABLE products
--   ADD CONSTRAINT products_sku_present CHECK (sku IS NOT NULL) NOT VALID;
