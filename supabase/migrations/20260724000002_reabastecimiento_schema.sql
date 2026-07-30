-- Reabastecimiento (live-Odoo) schema — supports the /compras/reabastecimiento
-- endpoint that reproduces Wilmer's xlsx replenishment engine on live data.
--
-- Design: engine math stays in frontend engine.ts (single source of truth,
-- 99.85% xlsx parity). These tables hold the SYNCED INPUTS + WRITE-BACK +
-- PROVENANCE the engine consumes. New tables use uuidv7() PKs per _THE_RULES;
-- FKs to existing SERIAL tables (products) stay INT. RLS matches the
-- 2026-04-23 backfill pattern (read = any authenticated profile; write =
-- service_role). Applied via Supabase SQL editor; this file is the record.
--
-- Grounding: docs/compras/MAYO2026_XLSX_MANIFEST.md §3 (engine),
-- docs/compras/REABASTECIMIENTO_LIVE_PLAN.md §2 (input mapping),
-- docs/compras/OPEN_QUESTIONS.md OQ-A/B/C/D (open data questions).

-- ============================================================================
-- 1. Sync provenance
-- ============================================================================
CREATE TABLE IF NOT EXISTS sync_runs (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    UUID REFERENCES tenants(id),
  kind         VARCHAR(40) NOT NULL,              -- e.g. 'reabastecimiento'
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       VARCHAR(20) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'partial', 'failed')),
  counts       JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {products, stock, transit, sales, ...}
  note         TEXT
);
COMMENT ON TABLE sync_runs IS 'One row per Odoo->Supabase sync run (reabastecimiento & future syncs).';

CREATE TABLE IF NOT EXISTS sync_issues (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  sync_id     UUID NOT NULL REFERENCES sync_runs(id) ON DELETE CASCADE,
  severity    VARCHAR(10) NOT NULL CHECK (severity IN ('info', 'warning', 'error')),
  entity      VARCHAR(40),                         -- 'product' | 'stock' | 'transit' | 'sales' | 'bodega_map'
  odoo_id     VARCHAR(50),
  product_id  INT REFERENCES products(id),
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE sync_issues IS 'Queryable anomalies per sync run — the ETL drops nothing, it flags (SOP §12).';
CREATE INDEX IF NOT EXISTS idx_sync_issues_sync ON sync_issues(sync_id);

-- ============================================================================
-- 2. bodega_map — Odoo warehouse -> business bodega
-- ============================================================================
CREATE TABLE IF NOT EXISTS bodega_map (
  odoo_warehouse_code VARCHAR(20) PRIMARY KEY,     -- e.g. '1CET','3PET','4ZAC'
  odoo_warehouse_name VARCHAR(120),
  bodega              VARCHAR(40) NOT NULL,         -- 'San Jose VN' | 'Zacapa-Petén' | ...
  in_scope            BOOLEAN NOT NULL DEFAULT true,
  note                TEXT
);
COMMENT ON TABLE bodega_map IS 'Maps Odoo warehouses to Wilmer''s bodegas. "General" is a computed roll-up, not a single warehouse — see OQ-A.';

-- ============================================================================
-- 3. reabastecimiento_inputs — latest synced engine inputs per product x bodega
--    Columns mirror engine.ts ProductRow. One row per (product_id, bodega),
--    upserted each sync (latest snapshot; add as_of history later if needed).
-- ============================================================================
CREATE TABLE IF NOT EXISTS reabastecimiento_inputs (
  id              UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id       UUID REFERENCES tenants(id),
  product_id      INT NOT NULL REFERENCES products(id),
  bodega          VARCHAR(40) NOT NULL,
  p6              NUMERIC(15,4) NOT NULL DEFAULT 0,  -- Promedio 6 meses (ordered qty)
  p3              NUMERIC(15,4) NOT NULL DEFAULT 0,  -- Promedio 3 meses
  h               NUMERIC(15,4) NOT NULL DEFAULT 0,  -- seasonal same-month prior year (0 for locations)
  existencias     NUMERIC(15,4) NOT NULL DEFAULT 0,  -- on-hand (gross; net computed with reserved/pending)
  reserved        NUMERIC(15,4) NOT NULL DEFAULT 0,
  pending_reserve NUMERIC(15,4),                     -- NULL = unknown (OQ-C); engine must NOT treat NULL as 0
  patio           NUMERIC(15,4) NOT NULL DEFAULT 0,  -- yard safety stock (OQ-B)
  transito        NUMERIC(15,4) NOT NULL DEFAULT 0,  -- future-dated open PO pending qty
  win             SMALLINT NOT NULL DEFAULT 10,       -- projection window: 10 General / 5 locations
  as_of           TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_sync_id  UUID REFERENCES sync_runs(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, bodega)
);
COMMENT ON TABLE reabastecimiento_inputs IS 'Synced engine inputs (engine.ts ProductRow) per product x bodega. Net available = existencias - reserved - pending_reserve (+ patio).';
CREATE INDEX IF NOT EXISTS idx_reabast_inputs_bodega ON reabastecimiento_inputs(bodega);

-- ============================================================================
-- 4. comercial_forecast — write-back: area-leader commercial input (F1)
--    Append-only; the API/engine decides how to fold entries into `adic`.
-- ============================================================================
CREATE TABLE IF NOT EXISTS comercial_forecast (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   UUID REFERENCES tenants(id),
  product_id  INT NOT NULL REFERENCES products(id),
  bodega      VARCHAR(40),                          -- NULL = applies to all bodegas
  month       DATE NOT NULL,                        -- first day of target month
  quantity    NUMERIC(15,4) NOT NULL DEFAULT 0,
  motivo      VARCHAR(20) NOT NULL
    CHECK (motivo IN ('adicional', 'normal_critica')),
  area        VARCHAR(40),                          -- 'mayoreo'|'institucional'|'supermercados'|'tiendas'
  note        TEXT,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE comercial_forecast IS 'Commercial-forecast entries from area leaders (F1): codigo, cantidad, motivo, mes. Feeds the engine Comercial term.';
CREATE INDEX IF NOT EXISTS idx_comercial_forecast_prod_month ON comercial_forecast(product_id, month);

-- ============================================================================
-- 5. transito_overrides — write-back: manual pending qty (Carvajal fallback)
-- ============================================================================
CREATE TABLE IF NOT EXISTS transito_overrides (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id      UUID REFERENCES tenants(id),
  product_id     INT NOT NULL REFERENCES products(id),
  bodega         VARCHAR(40) NOT NULL,
  qty            NUMERIC(15,4) NOT NULL DEFAULT 0,
  effective_week DATE,                              -- optional week bucket
  note           TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE transito_overrides IS 'Manual in-transit pending qty Wilmer keys when Odoo lacks it (esp. Carvajal weekly). Latest per product x bodega applies.';
CREATE INDEX IF NOT EXISTS idx_transito_overrides_prod ON transito_overrides(product_id, bodega);

-- ============================================================================
-- 6. RLS — match the 2026-04-23 backfill pattern:
--    read = any authenticated profile (auth_role() IS NOT NULL);
--    write = service_role (batch jobs / server routes via service key).
-- ============================================================================
DO $$
DECLARE
  t TEXT;
  table_list TEXT[] := ARRAY[
    'sync_runs', 'sync_issues', 'bodega_map',
    'reabastecimiento_inputs', 'comercial_forecast', 'transito_overrides'
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

-- ============================================================================
-- 7. bodega_map seed — ONLY the data-confirmed rows (from the workbook's
--    Exist* `Ubicación` column, measured 2026-07-24). See OPEN_QUESTIONS OQ-A.
--    "General" (a computed roll-up) and the in/out scope of 2Z11 & 5DEP are
--    PENDING Wilmer's confirmation — DO NOT add them until answered.
-- ============================================================================
INSERT INTO bodega_map (odoo_warehouse_code, odoo_warehouse_name, bodega, in_scope, note) VALUES
  ('1CET', '1 Bodega Central', 'San Jose VN',  true,  'Confirmed: Exist SJVN Ubicación = 1CET/Existencias (837/837 rows)'),
  ('3PET', '3 Peten',          'Zacapa-Petén', true,  'Confirmed: Exist Z&P Ubicación includes 3PET/Existencias (264 rows)'),
  ('4ZAC', '4 Bodega Zacapa',  'Zacapa-Petén', true,  'Confirmed: Exist Z&P Ubicación includes 4ZAC/Existencias (430 rows)')
ON CONFLICT (odoo_warehouse_code) DO UPDATE SET
  odoo_warehouse_name = EXCLUDED.odoo_warehouse_name,
  bodega              = EXCLUDED.bodega,
  in_scope            = EXCLUDED.in_scope,
  note                = EXCLUDED.note;

-- TODO (OQ-A, pending Wilmer):
--   * "General": define its roll-up set (hypothesis = 1CET + 3PET + 4ZAC). It is
--     a COMPUTED aggregate across in-scope warehouses, handled in the sync (B2),
--     not a single bodega_map row.
--   * Confirm 2Z11 (2 Bodega Zona 11) and 5DEP (Produccion/Reempaque) are OUT of
--     scope; if in, add rows here. Tiendas / subcontracts (incl. Envaica SUB) /
--     MP / MDE / adjustment warehouses are presumed OUT.
