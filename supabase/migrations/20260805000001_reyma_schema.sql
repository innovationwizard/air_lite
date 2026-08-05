-- Reyma (live-Odoo) schema — supports /inventarios/reyma-vivo, Alexis' model
-- on live data. Phase-2 batch L1 of docs/inventarios/ALEXIS_REYMA_LIVE_PLAN.md.
--
-- Design mirrors the reabastecimiento schema (20260724000002): engine math
-- stays in frontend engine.ts (2,752/2,752 xlsx parity — phase 1); these
-- tables hold SYNCED INPUTS + PROVENANCE. Snapshot tables (stock, pendientes,
-- transito) are append-only per sync run keyed by sync_id — the API reads the
-- latest successful `sync_runs` row of kind 'reyma'; history stays queryable.
-- Reuses the existing generic sync_runs/sync_issues tables.
--
-- Business rules grounded in docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md:
--   rule 3 (pendientes ≤8 días — detail rows carry edad_dias; the API filters),
--   rule 6 (entregas directas = POs destino Z11), rule 7 (código canónico
--   77201018; 77201028 excluido — es un tenedor real en Odoo, no un alias).
-- Categoría: seed desde el xlsx (fuente='xlsx') hasta que David cargue las
-- categorías en Odoo (P7, pendiente 55/55 al 2026-08-05) — entonces el sync
-- las promueve a fuente='odoo'.

-- ============================================================================
-- 1. reyma_products — master per código (upserted; seeded from phase-1 xlsx)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_products (
  codigo           VARCHAR(20) PRIMARY KEY,
  odoo_product_id  INT,
  clave            VARCHAR(40),          -- clave proveedor Reyma (xlsx col B)
  nombre_odoo      VARCHAR(200),
  descripcion      VARCHAR(200),         -- descripción Plasticentro (xlsx col D)
  categoria        VARCHAR(60) NOT NULL, -- categoría de negocio (xlsx hasta P7)
  categoria_fuente VARCHAR(10) NOT NULL DEFAULT 'xlsx'
    CHECK (categoria_fuente IN ('xlsx', 'odoo')),
  cubicaje         NUMERIC(12,6) NOT NULL DEFAULT 0,   -- m³/caja (Odoo volume)
  precio_factura   NUMERIC(12,4),        -- precio factura proveedor (xlsx col G); NULL = desconocido
  uom              VARCHAR(40),
  activo           BOOLEAN NOT NULL DEFAULT true,
  en_alcance       BOOLEAN NOT NULL DEFAULT true,      -- línea Reyma vigente
  source_sync_id   UUID REFERENCES sync_runs(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE reyma_products IS
  'Línea Reyma (Alexis). Seed = 55 productos del xlsx de julio; cubicaje/uom/nombre vienen de Odoo en cada sync.';

-- ============================================================================
-- 2. reyma_stock — snapshot por sync: existencias por bodega
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_stock (
  id        UUID PRIMARY KEY DEFAULT uuidv7(),
  sync_id   UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  codigo    VARCHAR(20) NOT NULL REFERENCES reyma_products(codigo),
  bodega    VARCHAR(10) NOT NULL CHECK (bodega IN ('SJ', 'Z11', 'PET', 'ZAC', 'PAT')),
  cantidad  NUMERIC(15,4) NOT NULL DEFAULT 0,
  reservada NUMERIC(15,4) NOT NULL DEFAULT 0,
  UNIQUE (sync_id, codigo, bodega)
);
COMMENT ON TABLE reyma_stock IS
  'Existencias por bodega por corrida. SJ=1CET/Existencias, PAT=1CET/Entrada (regla patio), Z11=2Z11, PET=3PET, ZAC=4ZAC.';
CREATE INDEX IF NOT EXISTS idx_reyma_stock_sync ON reyma_stock(sync_id);

-- ============================================================================
-- 3. reyma_pendientes — snapshot por sync: salidas a cliente no realizadas
--    (detalle con edad; la regla "≤ 8 días" la aplica el API — rule 3)
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_pendientes (
  id               UUID PRIMARY KEY DEFAULT uuidv7(),
  sync_id          UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  codigo           VARCHAR(20) NOT NULL REFERENCES reyma_products(codigo),
  picking          VARCHAR(60),
  bodega_origen    VARCHAR(10),
  fecha_programada TIMESTAMPTZ,
  cantidad         NUMERIC(15,4) NOT NULL DEFAULT 0,
  edad_dias        NUMERIC(8,2)                       -- hoy − fecha_programada (negativo = futuro)
);
COMMENT ON TABLE reyma_pendientes IS
  'Pendientes por surtir (pickings outgoing no done/cancel) con edad. Regla Alexis: solo cuentan ≤ 8 días.';
CREATE INDEX IF NOT EXISTS idx_reyma_pend_sync ON reyma_pendientes(sync_id);

-- ============================================================================
-- 4. reyma_transito — snapshot por sync: líneas de PO Reyma abiertas
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_transito (
  id                  UUID PRIMARY KEY DEFAULT uuidv7(),
  sync_id             UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  codigo              VARCHAR(20) NOT NULL REFERENCES reyma_products(codigo),
  po_name             VARCHAR(30) NOT NULL,
  fecha_planeada      DATE,
  cantidad_pendiente  NUMERIC(15,4) NOT NULL DEFAULT 0,
  destino             VARCHAR(10),                     -- SJ | Z11 | PET | ZAC (por picking type)
  es_entrega_directa  BOOLEAN NOT NULL DEFAULT false,  -- destino Z11 (rule 6)
  es_fecha_pasada     BOOLEAN NOT NULL DEFAULT false   -- regla Wilmer: pasado no cuenta; se reporta
);
COMMENT ON TABLE reyma_transito IS
  'Tránsito Reyma (partner 23188, state=purchase, qty−recibido>0). Entrega directa = destino Z11.';
CREATE INDEX IF NOT EXISTS idx_reyma_trans_sync ON reyma_transito(sync_id);

-- ============================================================================
-- 5. reyma_ventas_mensuales — histórico mensual por código (upsert)
--    Doble fuente para validación cruzada: sale.order (Odoo, desde 2024-10)
--    y sales.history (SAE, 2021-2025). El API resuelve por regla documentada.
-- ============================================================================
CREATE TABLE IF NOT EXISTS reyma_ventas_mensuales (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  codigo         VARCHAR(20) NOT NULL REFERENCES reyma_products(codigo),
  anio           SMALLINT NOT NULL,
  mes            SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  cajas          NUMERIC(15,4) NOT NULL DEFAULT 0,
  fuente         VARCHAR(20) NOT NULL CHECK (fuente IN ('sale_order', 'sales_history')),
  source_sync_id UUID REFERENCES sync_runs(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (codigo, anio, mes, fuente)
);
COMMENT ON TABLE reyma_ventas_mensuales IS
  'Ventas mensuales por código y fuente. sale_order = product_uom_qty estados sale/done; sales_history = SAE.';
CREATE INDEX IF NOT EXISTS idx_reyma_ventas_cod ON reyma_ventas_mensuales(codigo, anio, mes);

-- ============================================================================
-- 6. RLS — same pattern as 20260724000002 (read = authenticated, write = service)
-- ============================================================================
DO $$
DECLARE
  t TEXT;
  table_list TEXT[] := ARRAY[
    'reyma_products', 'reyma_stock', 'reyma_pendientes',
    'reyma_transito', 'reyma_ventas_mensuales'
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
