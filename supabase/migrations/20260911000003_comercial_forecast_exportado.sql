-- FORECAST COMERCIAL — «Exportar a Excel»: the record of every file emitted.
--
-- WHY (Jorge, 2026-09-11): same posture as Wilmer's exports — "this is the
-- file that went out", not "one like it". The file itself is a client-side
-- rendering of what the leader sees; this row says who downloaded what,
-- when, under which filters, how many rows, and the sha256 of the bytes.
-- Immutable: a trigger blocks UPDATE (a gap from a DELETE is visible; an
-- edit would be a forgery). The download never depends on this insert: if
-- the record fails the file still comes down and the screen says so in red.
--
-- Apply by hand in the SQL editor. Idempotent.
-- ROLLBACK: DROP TABLE IF EXISTS comercial_forecast_exportado;
--           DROP FUNCTION IF EXISTS comercial_forecast_exportado_no_update();
--           DELETE FROM route_permissions WHERE route_pattern = '/api/comercial/exportado';

BEGIN;

CREATE TABLE IF NOT EXISTS comercial_forecast_exportado (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  area          VARCHAR(40) NOT NULL REFERENCES comercial_areas(slug),
  month         DATE NOT NULL,
  user_id       UUID NOT NULL REFERENCES user_profiles(id),
  autor         VARCHAR(500) NOT NULL,
  archivo       VARCHAR(200) NOT NULL,
  -- {busqueda, proveedor, categoria, etiqueta, modificados, bloqueado, enPantalla, guardadasFueraDePantalla}
  filtros       JSONB NOT NULL,
  total_filas   INT NOT NULL CHECK (total_filas >= 0),
  hash          CHAR(64) NOT NULL,        -- sha256 of the downloaded bytes
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_comercial_forecast_exportado_area_mes
  ON comercial_forecast_exportado (area, month, created_at DESC);

CREATE OR REPLACE FUNCTION comercial_forecast_exportado_no_update()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'comercial_forecast_exportado es inmutable (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS comercial_forecast_exportado_inmutable ON comercial_forecast_exportado;
CREATE TRIGGER comercial_forecast_exportado_inmutable
  BEFORE UPDATE ON comercial_forecast_exportado
  FOR EACH ROW EXECUTE FUNCTION comercial_forecast_exportado_no_update();

ALTER TABLE comercial_forecast_exportado ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comercial_forecast_exportado_read ON comercial_forecast_exportado;
CREATE POLICY comercial_forecast_exportado_read ON comercial_forecast_exportado
  FOR SELECT USING (auth_role() IS NOT NULL);
DROP POLICY IF EXISTS comercial_forecast_exportado_service_write ON comercial_forecast_exportado;
CREATE POLICY comercial_forecast_exportado_service_write ON comercial_forecast_exportado
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE comercial_forecast_exportado IS
  'One row per «Exportar a Excel» download of a channel forecast: who, when, '
  'filters, row count, sha256 of the bytes. Immutable. The archive UI reads it.';

-- Everyone who can see the forecast can export what they see, and the export records itself.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT r, '/api/comercial/exportado', '{POST}', 'Registro de exportaciones del forecast comercial'
FROM unnest(ARRAY['ventas','compras','gerencia','ceo','sales_manager','admin','operaciones']) AS r
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;

DO $$
DECLARE n_perm INT;
BEGIN
  SELECT count(*) INTO n_perm FROM route_permissions WHERE route_pattern = '/api/comercial/exportado';
  IF n_perm <> 7 THEN
    RAISE EXCEPTION 'route_permissions for /api/comercial/exportado: expected 7, found %', n_perm;
  END IF;
END $$;

COMMIT;
