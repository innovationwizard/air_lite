-- ============================================================================
-- "Compara la venta del mes vs el promedio" — Wilmer, 2026-08-20
-- ============================================================================
-- His diagnostic when a Sugerido looks wrong. p6/p3 are backward-looking
-- monthly averages; on a product whose demand is moving they lag, and there was
-- no way to see the current month next to them. Both bugs he reported on
-- 2026-08-20 would have been visible at a glance with this column.
--
-- mtd      = ordered quantity so far this month, in the product's STOCK UoM
--            (same conversion as p6/p3 — see fold_uom_groups).
-- mtd_dias = calendar days elapsed in the month at sync time, so a partial
--            month can never be read as a full one. Display only: neither
--            column feeds the engine.
-- ============================================================================

ALTER TABLE reabastecimiento_inputs
  ADD COLUMN IF NOT EXISTS mtd      NUMERIC(15,4),
  ADD COLUMN IF NOT EXISTS mtd_dias SMALLINT;

COMMENT ON COLUMN reabastecimiento_inputs.mtd IS
  'Ordered month-to-date in the product stock UoM. NULL = not computed yet. Display only.';
COMMENT ON COLUMN reabastecimiento_inputs.mtd_dias IS
  'Calendar days elapsed this month when the sync ran — a partial month must never read as a full one.';
