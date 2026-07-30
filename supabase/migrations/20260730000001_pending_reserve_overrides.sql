-- pending_reserve_overrides — manual "pendiente de tomar reserva" entry.
--
-- DECISION (Jorge, 2026-07-30): "pendiente de tomar reserva" is NOT stored in
-- any system (SAI, ISC, Odoo — confirmed through the July sessions; David's
-- earlier field regressed and has no reliable source). Resolution: Wilmer gets
-- an INLINE INPUT on the live reabastecimiento page to key it manually per
-- product x bodega when it exists. This table is the authoritative store for
-- those entries — append-only, authored, latest-per-(product,bodega) applies.
--
-- The sync deliberately leaves reabastecimiento_inputs.pending_reserve = NULL
-- (unknown); the API merges the latest manual entry from this table instead.
-- Net available = existencias − reserved − pending_reserve(manual) [+ patio].
--
-- Pattern mirrors transito_overrides (20260724000002). UUIDv7 PK per
-- _THE_RULES. RLS matches the 2026-04-23 backfill pattern. Applied via the
-- Supabase SQL editor; this file is the source-of-truth record. Idempotent.

CREATE TABLE IF NOT EXISTS pending_reserve_overrides (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   UUID REFERENCES tenants(id),
  product_id  INT NOT NULL REFERENCES products(id),
  bodega      VARCHAR(40) NOT NULL,
  qty         NUMERIC(15,4) NOT NULL DEFAULT 0,   -- 0 = explicitly "none pending"
  note        TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE pending_reserve_overrides IS
  'Manual "pendiente de tomar reserva" per product x bodega (no system source exists — Jorge 2026-07-30). Append-only; latest entry applies. qty=0 means explicitly none.';
CREATE INDEX IF NOT EXISTS idx_pending_reserve_overrides_prod
  ON pending_reserve_overrides(product_id, bodega);

-- RLS: read = any authenticated profile; write = service_role (server routes).
ALTER TABLE pending_reserve_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pending_reserve_overrides_read ON pending_reserve_overrides;
CREATE POLICY pending_reserve_overrides_read ON pending_reserve_overrides
  FOR SELECT USING (auth_role() IS NOT NULL);
DROP POLICY IF EXISTS pending_reserve_overrides_service_write ON pending_reserve_overrides;
CREATE POLICY pending_reserve_overrides_service_write ON pending_reserve_overrides
  FOR ALL USING (auth.role() = 'service_role');

-- Route permission for the write-back endpoint (superuser bypasses; exact
-- paths required — '/*' globs do not match the bare path).
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('compras',  '/api/compras/reabastecimiento/pendiente', '{POST}',
   'Manual pendiente-de-tomar-reserva entry (no system source)'),
  ('gerencia', '/api/compras/reabastecimiento/pendiente', '{POST}',
   'Manual pendiente-de-tomar-reserva entry (no system source)'),
  ('admin',    '/api/compras/reabastecimiento/pendiente', '{POST}',
   'Manual pendiente-de-tomar-reserva entry (no system source)')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods     = EXCLUDED.methods,
  description = EXCLUDED.description;
