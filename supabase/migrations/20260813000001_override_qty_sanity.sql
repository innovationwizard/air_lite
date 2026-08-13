-- Manual-override correction path + quantity sanity cap.
--
-- INCIDENT 2026-08-12 (docs/error-reports/20260812/, root cause 2026-08-13):
-- boundary tests from the compras account saved pendiente = 1,000,000,000 on
-- product 2 / San Jose VN — NUMERIC(15,4) holds up to ~1e11, so it SAVED and
-- exist. neta showed ≈ −1e9 on the live page; the next larger entry
-- overflowed the column and surfaced as an opaque 500. Two gaps fixed here:
--
-- (a) Sanity cap, defense-in-depth: CHECK qty ≤ 1,000,000 (mirrors
--     MAX_MANUAL_QTY in frontend/src/lib/compras/qty.ts, where the rationale
--     lives). NOT VALID so the poisoned historical rows stay readable as the
--     append-only audit trail; every NEW write is validated.
-- (b) Correction path: overrides stay append-only, and a CLEAR is a new row
--     with qty NULL = "quitar la captura manual" — pendiente reverts to
--     unknown (¿?), tránsito reverts to the synced value. Requires DROP NOT
--     NULL; DEFAULT 0 is dropped too (an omitted qty must be an explicit
--     choice, never a silent zero).
--
-- comercial_forecast gets the same cap; no NULL semantics there (quantity 0
-- already zeroes the adicional).
--
-- Applied via `supabase db push`; this file is the source-of-truth record.
-- Idempotent.

ALTER TABLE pending_reserve_overrides ALTER COLUMN qty DROP NOT NULL;
ALTER TABLE pending_reserve_overrides ALTER COLUMN qty DROP DEFAULT;
ALTER TABLE transito_overrides ALTER COLUMN qty DROP NOT NULL;
ALTER TABLE transito_overrides ALTER COLUMN qty DROP DEFAULT;

ALTER TABLE pending_reserve_overrides
  DROP CONSTRAINT IF EXISTS pending_reserve_overrides_qty_sane;
ALTER TABLE pending_reserve_overrides
  ADD CONSTRAINT pending_reserve_overrides_qty_sane
  CHECK (qty IS NULL OR (qty >= 0 AND qty <= 1000000)) NOT VALID;

ALTER TABLE transito_overrides
  DROP CONSTRAINT IF EXISTS transito_overrides_qty_sane;
ALTER TABLE transito_overrides
  ADD CONSTRAINT transito_overrides_qty_sane
  CHECK (qty IS NULL OR (qty >= 0 AND qty <= 1000000)) NOT VALID;

ALTER TABLE comercial_forecast
  DROP CONSTRAINT IF EXISTS comercial_forecast_quantity_sane;
ALTER TABLE comercial_forecast
  ADD CONSTRAINT comercial_forecast_quantity_sane
  CHECK (quantity >= 0 AND quantity <= 1000000) NOT VALID;

COMMENT ON COLUMN pending_reserve_overrides.qty IS
  'NULL = captura quitada (vuelve a sin dato ¿?); 0 = explícitamente nada '
  'pendiente; cap 1,000,000 (qty_sane, NOT VALID por la fila histórica 1e9 '
  'del incidente 2026-08-12).';
COMMENT ON COLUMN transito_overrides.qty IS
  'NULL = captura quitada (vuelve al tránsito sincronizado); cap 1,000,000 '
  '(qty_sane, NOT VALID por las filas de prueba del incidente 2026-08-12).';
