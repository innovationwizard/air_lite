-- ============================================================================
-- products_acid_test_active — add po_history_real_months
-- ============================================================================
-- Records the count of calendar months in the 16-month training window
-- (2024-10 through 2026-01) that have at least one confirmed purchase order
-- (state IN ('purchase','locked','done')) for each demo SKU.
--
-- Source of truth: revenue_daily_for_ml, metric = 'purchases_ordered',
-- SSOT label = 'pol_confirmed_date_planned_product_qty_c40'.
-- Synthetic fallback data (find_16) does NOT count — only real Odoo PO data.
--
-- Tier thresholds applied in the UI (frontend only — not stored):
--   GREEN  = 16  (all 16 months have real confirmed PO data)
--   AMBER  = 3–15 (partial history; accuracy vs Acid Test 2 TBD)
--   RED    = 0–2  (insufficient real history; ratio forecast unreliable)
--
-- Amber/red boundary of 3 months is a provisional proxy. To be recalibrated
-- after Acid Test 2 scoring confirms which SKUs achieve ≥90% accuracy.
--
-- Backfill values verified 2026-05-05 by direct query of
-- revenue_daily_for_ml (computed_at 2026-04-29, SSOT pol_confirmed_*).
-- ============================================================================

ALTER TABLE products_acid_test_active
  ADD COLUMN IF NOT EXISTS po_history_real_months SMALLINT
    CHECK (po_history_real_months BETWEEN 0 AND 16);

COMMENT ON COLUMN products_acid_test_active.po_history_real_months IS
  'Months in the 16-month training window (2024-10 to 2026-01) that have at
   least one confirmed PO (state in purchase/locked/done) in
   revenue_daily_for_ml. NULL = not yet computed. 0–2 = RED (insufficient),
   3–15 = AMBER (partial), 16 = GREEN (complete). Synthetic fallback data
   does not count toward this value.';
