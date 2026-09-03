-- PROOF OF STATUS — frozen snapshots of Wilmer's live replenishment view, for
-- posterior audits. Plan: docs/compras/PROOF_OF_STATUS_IMPLEMENTATION_PLAN_2026-09-03.md
--
-- WHY THIS EXISTS: Wilmer needs to be able to say, later, "this is exactly
-- what the system showed me on this date" for an audit. A client-side PDF
-- alone can't answer that if anyone ever asks "how do we know this wasn't
-- edited, or that it reflects what the system actually had at that moment" —
-- this table is the independent record that answers it, without needing any
-- hashing or signature scheme (D-6 in the plan: no tamper-proofing, it's
-- overkill for the actual problem — a durable, attributable record is
-- overkill's cheaper, sufficient cousin).
--
-- SERVER-AUTHORITATIVE, NOT CLIENT-TRUSTED (unlike the sibling
-- export_plan_emitido, whose `lineas` are Wilmer's own hand-typed numbers and
-- so are correctly client-authoritative there): the API route that inserts
-- here recomputes `filas`/`kpis`/etc. itself from the same source functions
-- the live page uses (buildRows + vista), from client-supplied VIEWING
-- PARAMETERS only (bodega, filtros, orden) — never from a client-supplied row
-- array. See frontend/src/app/api/compras/reabastecimiento/snapshot/route.ts.
--
-- user_id (not just a display string) is what makes "a user can only browse
-- their own snapshots, plus superuser sees all" (D-7) an exact equality
-- check instead of a fuzzy match on a formatted name.
--
-- IMMUTABLE, same posture as export_plan_emitido (20260821000005): a trigger
-- blocks UPDATE. DELETE stays allowed for retention/cleanup — deleting leaves
-- a visible gap, editing would falsify the record.
--
-- NO PDF BYTES STORED (D-5): this row IS the proof; the PDF is a disposable
-- client-side rendering of it, regenerated identically on every re-download.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS reabastecimiento_status_snapshots (
  id              UUID PRIMARY KEY DEFAULT uuidv7(),
  user_id         UUID         NOT NULL REFERENCES user_profiles(id),
  autor           VARCHAR(500) NOT NULL,   -- display name + email, for the printed footer
  bodega          VARCHAR(120) NOT NULL,
  -- {texto, proveedor, soloConSugerido, soloCriticos, soloEnAlza, soloComprables, rangos, orden}
  filtros         JSONB        NOT NULL,
  -- {asOf, month, coberturaDias, lastSync}
  meta            JSONB        NOT NULL,
  -- {total, need, totSug, crit}
  kpis            JSONB        NOT NULL,
  -- {creciente, noEvaluable, total}
  alza            JSONB        NOT NULL,
  -- [{p, sug, crit}, ...] — topProv.arr
  top_proveedores JSONB        NOT NULL,
  -- {porTienda, total, productos}
  tiendas         JSONB        NOT NULL,
  -- the frozen, filtered+sorted row set exactly as displayed — full ApiRow[]
  filas           JSONB        NOT NULL,
  total_filas     INTEGER      NOT NULL CHECK (total_filas >= 0),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT reabastecimiento_status_snapshots_filas_array CHECK (jsonb_typeof(filas) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_reabastecimiento_status_snapshots_user
  ON reabastecimiento_status_snapshots (user_id, created_at DESC);

ALTER TABLE reabastecimiento_status_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reabastecimiento_status_snapshots_service" ON reabastecimiento_status_snapshots;
CREATE POLICY "reabastecimiento_status_snapshots_service" ON reabastecimiento_status_snapshots
  FOR ALL USING (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION reabastecimiento_status_snapshots_no_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'reabastecimiento_status_snapshots es inmutable: no se puede modificar un snapshot (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS reabastecimiento_status_snapshots_inmutable ON reabastecimiento_status_snapshots;
CREATE TRIGGER reabastecimiento_status_snapshots_inmutable
  BEFORE UPDATE ON reabastecimiento_status_snapshots
  FOR EACH ROW EXECUTE FUNCTION reabastecimiento_status_snapshots_no_update();

COMMENT ON TABLE reabastecimiento_status_snapshots IS
  'Immutable proof-of-status record for /compras/reabastecimiento-vivo: one row '
  'per "Emitir prueba de estado" click. Server-authoritative (recomputed from '
  'buildRows+vista server-side, never trusted from the client). UPDATE blocked '
  'by trigger. No PDF bytes stored — the PDF is regenerated from this row.';

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, v.pattern, v.methods, v.description
FROM (VALUES
  ('compras',   '/api/compras/reabastecimiento/snapshot',   ARRAY['GET', 'POST'], 'Freeze and list proof-of-status snapshots of the live replenishment view'),
  ('superuser', '/api/compras/reabastecimiento/snapshot',   ARRAY['GET', 'POST'], 'Freeze and list proof-of-status snapshots of the live replenishment view'),
  ('compras',   '/api/compras/reabastecimiento/snapshot/*', ARRAY['GET'],         'Fetch a single frozen proof-of-status snapshot for re-download'),
  ('superuser', '/api/compras/reabastecimiento/snapshot/*', ARRAY['GET'],         'Fetch a single frozen proof-of-status snapshot for re-download')
) AS v(role, pattern, methods, description)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role AND rp.route_pattern = v.pattern
);
