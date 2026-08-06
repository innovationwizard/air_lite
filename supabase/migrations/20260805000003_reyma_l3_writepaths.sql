-- Reyma L3 — write-paths (docs/inventarios/ALEXIS_REYMA_LIVE_PLAN.md batch L3)
-- + vendor-bill snapshot (NC + price-check source, probe-verified readable).
--
-- Write-path tables are APPEND-ONLY HISTORY (who/when/what — latest row wins,
-- resolved by the API): the workbook's edits had no author or history; the app
-- must be strictly better. Author = user_profiles display_name/email via
-- requireAuth (writes go through the API with the service client — RLS write
-- stays service_role, same pattern as comercial_forecast/transito_overrides).
--
-- Business grounding (docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md):
--   overrides  → rule 1 ("yo corrijo"; la columna proyección DEBE ser editable)
--   nc_config  → rule 8 (tarifa editable, fecha fin de promo editable)
--   furgon_notas → ETA no vive en Odoo (fechas de PO sin mantener) — Alexis
--                  las conoce por la factura/correo; se anotan sobre la PO
--   facturas   → NC = cajas facturadas × tarifa (categoría duroport) y
--                alertas de precio ("si no hay nada anunciado, eso no se paga")
--   plan_despacho → las hojas por día que se mandan al proveedor (bin-packing)

-- ============================================================================
-- 1. reyma_facturas — snapshot por sync de facturas de proveedor (posted)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_facturas (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  sync_id     UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  factura     VARCHAR(40) NOT NULL,       -- BILL/2026/08/0007
  fecha       DATE,
  referencia  VARCHAR(120),               -- "ORDEN DE JULIO 2026"
  tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('factura', 'nota_credito')),
  codigo      VARCHAR(20) NOT NULL REFERENCES reyma_products(codigo),
  cantidad    NUMERIC(15,4) NOT NULL DEFAULT 0,
  precio_unit NUMERIC(12,4) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_reyma_fact_sync ON reyma_facturas(sync_id);

-- ============================================================================
-- 2. reyma_proyeccion_overrides — historial de "yo corrijo" (latest wins)
--    cajas NULL = volver a la proyección automática (promedio móvil)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_proyeccion_overrides (
  id         UUID PRIMARY KEY DEFAULT uuidv7(),
  codigo     VARCHAR(20) NOT NULL REFERENCES reyma_products(codigo),
  cajas      NUMERIC(15,4),
  autor      VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_proy_cod ON reyma_proyeccion_overrides(codigo, created_at DESC);

-- ============================================================================
-- 3. reyma_nc_config — historial de tarifa NC / vigencia de promo (latest wins)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_nc_config (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  tarifa_usd    NUMERIC(8,4) NOT NULL,
  vigente_hasta DATE,                     -- NULL = sin fecha de fin anunciada
  nota          TEXT,
  autor         VARCHAR(120) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Seed: tarifa vigente confirmada por Alexis (USD 0.41/caja, categoría VASOS DE DUROPORT)
INSERT INTO reyma_nc_config (tarifa_usd, vigente_hasta, nota, autor)
VALUES (0.41, NULL, 'Tarifa confirmada en reunión 2026-08-04; agosto continúa la promoción de julio', 'seed:migración')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 4. reyma_furgon_notas — ETA/nota por PO (latest per po_name wins)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_furgon_notas (
  id         UUID PRIMARY KEY DEFAULT uuidv7(),
  po_name    VARCHAR(200) NOT NULL,
  eta        DATE,
  nota       TEXT,
  autor      VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_notas_po ON reyma_furgon_notas(po_name, created_at DESC);

-- ============================================================================
-- 5. reyma_plan_despacho — planes semanales generados/editados (historial)
--    payload JSONB: {dias:[{dia, furgones:[{no, lineas:[{codigo, cajas}]}]}]}
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_plan_despacho (
  id         UUID PRIMARY KEY DEFAULT uuidv7(),
  semana     DATE NOT NULL,               -- lunes de la semana planificada
  payload    JSONB NOT NULL,
  autor      VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_plan_semana ON reyma_plan_despacho(semana, created_at DESC);

-- ============================================================================
-- 6. RLS (same pattern) + route permissions for the write endpoints
-- ============================================================================
DO $$
DECLARE
  t TEXT;
  table_list TEXT[] := ARRAY[
    'reyma_facturas', 'reyma_proyeccion_overrides', 'reyma_nc_config',
    'reyma_furgon_notas', 'reyma_plan_despacho'
  ];
BEGIN
  FOREACH t IN ARRAY table_list LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (auth_role() IS NOT NULL)',
      t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_service_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')',
      t || '_service_write', t);
  END LOOP;
END$$;

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('inventario', '/api/inventarios/reyma/proyeccion',  '{POST}', 'Override de proyección (Alexis)'),
  ('gerencia',   '/api/inventarios/reyma/proyeccion',  '{POST}', 'Override de proyección'),
  ('admin',      '/api/inventarios/reyma/proyeccion',  '{POST}', 'Override de proyección'),
  ('inventario', '/api/inventarios/reyma/nc-config',   '{POST}', 'Tarifa/vigencia NC Duroport'),
  ('gerencia',   '/api/inventarios/reyma/nc-config',   '{POST}', 'Tarifa/vigencia NC Duroport'),
  ('admin',      '/api/inventarios/reyma/nc-config',   '{POST}', 'Tarifa/vigencia NC Duroport'),
  ('inventario', '/api/inventarios/reyma/furgon-nota', '{POST}', 'ETA/nota de furgón (PO)'),
  ('gerencia',   '/api/inventarios/reyma/furgon-nota', '{POST}', 'ETA/nota de furgón (PO)'),
  ('admin',      '/api/inventarios/reyma/furgon-nota', '{POST}', 'ETA/nota de furgón (PO)'),
  ('inventario', '/api/inventarios/reyma/plan',        '{POST}', 'Plan semanal de despacho'),
  ('gerencia',   '/api/inventarios/reyma/plan',        '{POST}', 'Plan semanal de despacho'),
  ('admin',      '/api/inventarios/reyma/plan',        '{POST}', 'Plan semanal de despacho')
ON CONFLICT DO NOTHING;
