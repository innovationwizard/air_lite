-- FORECAST COMERCIAL — «Bloquear cambios»: a frozen, attributable record of a
-- channel's forecast for a month, and a hard lock on further edits.
--
-- WHY (PM, 2026-09-11): channel leaders have sent an official request, then
-- later sent a different one with changes and argued that the second was
-- what they had sent in the first place. The lock ends that argument the
-- way export_plan_emitido and reabastecimiento_status_snapshots end it for
-- Wilmer: a row that says exactly what was sent, by whom, when, with a
-- content hash — and, unlike those two, a lock that stops later edits.
--
-- DECISIONS (Jorge, 2026-09-11):
--   * hard lock — PUT/DELETE on comercial_forecast for that area+month are
--     refused while a lock is active; only sales_manager/admin/superuser
--     unlock, and the unlock is recorded on the same row (who, when);
--   * the record holds the forecast rows AND the facts shown beside them
--     (recommendation, range, label, 3-month history, prior years,
--     customers, Forecast Compras), recomputed SERVER-SIDE at lock time —
--     never a client-supplied array;
--   * the leader locks their own area (from the profile); admin/superuser
--     may lock on behalf; a later re-lock after an unlock is a new version.
--
-- IMMUTABLE: a trigger allows exactly one transition — activo true -> false
-- with the unlock fields filled — and refuses any other UPDATE. DELETE stays
-- allowed for retention (a gap is visible; an edit would be a forgery).
--
-- Apply by hand in the SQL editor (project convention). Idempotent.
--
-- ROLLBACK (exact):
--   DROP TABLE IF EXISTS comercial_forecast_bloqueos;
--   DROP FUNCTION IF EXISTS comercial_forecast_bloqueos_solo_desbloqueo();
--   DELETE FROM route_permissions WHERE route_pattern = '/api/comercial/bloqueo';

BEGIN;

CREATE TABLE IF NOT EXISTS comercial_forecast_bloqueos (
  id                  UUID PRIMARY KEY DEFAULT uuidv7(),
  area                VARCHAR(40) NOT NULL REFERENCES comercial_areas(slug),
  month               DATE NOT NULL,                       -- first day of the forecast month
  version             INT NOT NULL CHECK (version >= 1),   -- 1, 2, 3… per (area, month); a re-lock after an unlock
  user_id             UUID NOT NULL REFERENCES user_profiles(id),
  autor               VARCHAR(500) NOT NULL,               -- display name + email, for the printed record
  -- [{productId, sku, nombre, quantity, motivo, contexto:{…}}] — every saved
  -- row for the area and month, with what the leader was looking at
  filas               JSONB NOT NULL,
  total_filas         INT NOT NULL CHECK (total_filas >= 1),
  hash                CHAR(64) NOT NULL,                   -- sha256 of the canonical JSON of `filas`
  activo              BOOLEAN NOT NULL DEFAULT true,
  desbloqueado_por    UUID REFERENCES user_profiles(id),
  desbloqueado_autor  VARCHAR(500),
  desbloqueado_at     TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comercial_forecast_bloqueos_filas_array CHECK (jsonb_typeof(filas) = 'array'),
  CONSTRAINT comercial_forecast_bloqueos_desbloqueo_completo CHECK (
    (activo AND desbloqueado_por IS NULL AND desbloqueado_at IS NULL)
    OR (NOT activo AND desbloqueado_por IS NOT NULL AND desbloqueado_at IS NOT NULL)
  ),
  UNIQUE (area, month, version)
);

-- One ACTIVE lock per area and month.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_forecast_bloqueos_activo
  ON comercial_forecast_bloqueos (area, month) WHERE activo;
CREATE INDEX IF NOT EXISTS idx_comercial_forecast_bloqueos_area_mes
  ON comercial_forecast_bloqueos (area, month, created_at DESC);

CREATE OR REPLACE FUNCTION comercial_forecast_bloqueos_solo_desbloqueo()
RETURNS TRIGGER AS $$
BEGIN
  -- The only legal change: unlocking. Everything that was frozen stays frozen.
  IF OLD.activo AND NOT NEW.activo
     AND NEW.desbloqueado_por IS NOT NULL AND NEW.desbloqueado_at IS NOT NULL
     AND NEW.area = OLD.area AND NEW.month = OLD.month AND NEW.version = OLD.version
     AND NEW.user_id = OLD.user_id AND NEW.autor = OLD.autor
     AND NEW.filas = OLD.filas AND NEW.total_filas = OLD.total_filas AND NEW.hash = OLD.hash
     AND NEW.created_at = OLD.created_at THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'comercial_forecast_bloqueos es inmutable: sólo se puede desbloquear (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS comercial_forecast_bloqueos_inmutable ON comercial_forecast_bloqueos;
CREATE TRIGGER comercial_forecast_bloqueos_inmutable
  BEFORE UPDATE ON comercial_forecast_bloqueos
  FOR EACH ROW EXECUTE FUNCTION comercial_forecast_bloqueos_solo_desbloqueo();

ALTER TABLE comercial_forecast_bloqueos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comercial_forecast_bloqueos_read ON comercial_forecast_bloqueos;
CREATE POLICY comercial_forecast_bloqueos_read ON comercial_forecast_bloqueos
  FOR SELECT USING (auth_role() IS NOT NULL);
DROP POLICY IF EXISTS comercial_forecast_bloqueos_service_write ON comercial_forecast_bloqueos;
CREATE POLICY comercial_forecast_bloqueos_service_write ON comercial_forecast_bloqueos
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE comercial_forecast_bloqueos IS
  'Frozen record of a channel''s forecast for a month («Bloquear cambios»): the '
  'saved rows plus the facts shown beside them, recomputed server-side at lock '
  'time, sha256-hashed and attributed. While activo, comercial_forecast for that '
  'area+month refuses writes. Only the unlock transition is allowed (trigger).';

-- Route permissions. ventas locks its own area; admin locks on behalf;
-- sales_manager (and admin) unlock; everyone who reads the forecast reads
-- lock state. superuser bypasses the matrix.
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('ventas',        '/api/comercial/bloqueo', '{GET,POST}',        'Bloquear el forecast del area propia'),
  ('admin',         '/api/comercial/bloqueo', '{GET,POST,DELETE}', 'Bloquear / desbloquear forecast comercial'),
  ('sales_manager', '/api/comercial/bloqueo', '{GET,DELETE}',      'Desbloquear forecast comercial'),
  ('compras',       '/api/comercial/bloqueo', '{GET}',             'Estado de bloqueo del forecast comercial'),
  ('gerencia',      '/api/comercial/bloqueo', '{GET}',             'Estado de bloqueo del forecast comercial'),
  ('ceo',           '/api/comercial/bloqueo', '{GET}',             'Estado de bloqueo del forecast comercial'),
  ('operaciones',   '/api/comercial/bloqueo', '{GET}',             'Estado de bloqueo del forecast comercial')
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;

DO $$
DECLARE n_perm INT;
BEGIN
  SELECT count(*) INTO n_perm FROM route_permissions WHERE route_pattern = '/api/comercial/bloqueo';
  IF n_perm <> 7 THEN
    RAISE EXCEPTION 'route_permissions for /api/comercial/bloqueo: expected 7, found %', n_perm;
  END IF;
END $$;

COMMIT;
