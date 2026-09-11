-- FORECAST COMERCIAL — LEVEL 2: per-channel demand history, customer
-- concentration, seasonal index, and the `base` motivo.
--
-- Plan: docs/compras/FORECAST_COMERCIAL_L2_BUILD_PLAN_2026-09-10.md (§2)
-- Spec: docs/compras/FORECAST_COMERCIAL_L2_SPEC_RESEARCH_2026-09-10.md
--
-- WHY. The Level-1 form gives the channel leader no information to decide
-- with: the only context number is the company-wide p3. Every velocity figure
-- in the system is per bodega; nothing is per commercial channel. This
-- migration creates the tables the hourly sync fills per channel x product,
-- the static seasonal index, and the rules that say which Odoo orders belong
-- to which channel — as DATA, because a channel was added three days after
-- the first four were seeded and Telemarketing appeared while this was being
-- designed.
--
-- DECISIONS (Jorge, 2026-09-10), all recorded in the plan §1:
--   Q1  strictly by team; only Mayoreo Interior split by sucursal
--   Q2  Oficina -> mayoreo, Telemarketing -> tiendas
--   Q-S seasonal index applied in mayoreo/zacapa/peten/supermercados only
--   Q6  a fourth motivo `base` that never sums into any purchase
--
-- Apply by hand in the SQL editor (project convention). Idempotent. One
-- transaction: the verification block at the end aborts everything if the
-- seed is inconsistent.
--
-- ROLLBACK (exact):
--   DROP TABLE IF EXISTS comercial_demanda_canal, comercial_estacionalidad,
--                        comercial_categoria_sai, comercial_area_reglas;
--   ALTER TABLE comercial_areas DROP COLUMN IF EXISTS aplica_estacional,
--                               DROP COLUMN IF EXISTS grupo_sai;
--   DELETE FROM comercial_areas WHERE slug = '_sin_asignar';
--   ALTER TABLE comercial_forecast DROP CONSTRAINT IF EXISTS comercial_forecast_motivo_check;
--   ALTER TABLE comercial_forecast ADD CONSTRAINT comercial_forecast_motivo_check
--     CHECK (motivo IN ('extraordinaria', 'temporada', 'critico'));
--   DELETE FROM route_permissions WHERE route_pattern = '/api/comercial/historial';

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · comercial_areas: the seasonal flag, the SAI group, and the reserved
--     bucket for demand no channel owns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE comercial_areas
  ADD COLUMN IF NOT EXISTS aplica_estacional BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS grupo_sai VARCHAR(10);

COMMENT ON COLUMN comercial_areas.aplica_estacional IS
  'Whether the recommendation multiplies by the category seasonal index. '
  'Backtested 2026-09-10: helps in mayoreo/zacapa/peten/supermercados, hurts in '
  'institucional/tiendas (spec §3.3). Re-validate yearly. The index is SHOWN in '
  'every channel regardless; this flag only decides whether it is applied.';
COMMENT ON COLUMN comercial_areas.grupo_sai IS
  'SAI channel group whose history builds this area''s seasonal index '
  '(comercial_estacionalidad.grupo_sai). MY = MYCAP+MYINT+OFICI. NULL = no index.';

UPDATE comercial_areas SET aplica_estacional = true,  grupo_sai = 'MY'    WHERE slug = 'mayoreo';
UPDATE comercial_areas SET aplica_estacional = true,  grupo_sai = 'MYINT' WHERE slug IN ('zacapa', 'peten');
UPDATE comercial_areas SET aplica_estacional = true,  grupo_sai = 'SUPER' WHERE slug = 'supermercados';
UPDATE comercial_areas SET aplica_estacional = false, grupo_sai = 'INSTI' WHERE slug = 'institucional';
UPDATE comercial_areas SET aplica_estacional = false, grupo_sai = 'TIEND' WHERE slug = 'tiendas';

-- Demand from Odoo teams that belong to no channel (today: `Sales`, `Point of
-- Sale`, and anything created later). Inactive so it never appears as a
-- capture target; it exists so that volume is REPORTED, never silently dropped.
INSERT INTO comercial_areas (slug, nombre, activa) VALUES
  ('_sin_asignar', 'Sin canal asignado', false)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · comercial_area_reglas: which Odoo orders belong to which channel
-- ─────────────────────────────────────────────────────────────────────────────
-- One area -> many rules; the area's demand is the UNION of its rules. Each
-- rule is one Odoo domain on sale.order: team_id, optionally restricted to (or
-- excluding) sucursales (branch.location = the client's "Sucursal").
--
-- Ids come from production Odoo, read 2026-09-10 (crm.team / branch.location):
--   teams:      5 Tienda · 6 Institucional · 7 Supermercado · 8 Mayoreo Interior
--               9 Mayoreo Capital · 10 Oficina · 13 Telemarketing
--   sucursales: 1 CD Peten · 2 CD Central · 3 CD Zacapa
-- To re-read them: execute('crm.team','search_read',[],fields=['id','name'])
-- and the same on 'branch.location'.
CREATE TABLE IF NOT EXISTS comercial_area_reglas (
  id                    UUID PRIMARY KEY DEFAULT uuidv7(),
  area                  VARCHAR(40) NOT NULL REFERENCES comercial_areas(slug),
  odoo_team_id          INT NOT NULL,
  sucursal_ids          INT[],          -- NULL = any sucursal
  excluir_sucursal_ids  INT[],          -- NULL = exclude none
  nota                  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT comercial_area_reglas_no_ambiguous
    CHECK (sucursal_ids IS NULL OR excluir_sucursal_ids IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_area_reglas
  ON comercial_area_reglas (area, odoo_team_id,
                            COALESCE(sucursal_ids, '{}'), COALESCE(excluir_sucursal_ids, '{}'));

COMMENT ON TABLE comercial_area_reglas IS
  'Odoo domain per commercial area (union of rules). The sync reads this; '
  'no team id lives in code. Partition check in the sync warns if rules '
  'overlap or leak against the General demand bucket.';

INSERT INTO comercial_area_reglas (area, odoo_team_id, sucursal_ids, excluir_sucursal_ids, nota) VALUES
  ('zacapa',        8, '{3}', NULL,    'Mayoreo Interior served from CD Zacapa (Q1)'),
  ('peten',         8, '{1}', NULL,    'Mayoreo Interior served from CD Peten (Q1)'),
  ('mayoreo',       9, NULL,  NULL,    'Mayoreo Capital, any sucursal'),
  ('mayoreo',       8, NULL,  '{1,3}', 'Mayoreo Interior outside Zacapa/Peten'),
  ('mayoreo',      10, NULL,  NULL,    'Oficina -> Mayoreo (Jorge 2026-09-10, Q2)'),
  ('institucional', 6, NULL,  NULL,    'Institucional, any sucursal'),
  ('supermercados', 7, NULL,  NULL,    'Supermercado, any sucursal'),
  ('tiendas',       5, NULL,  NULL,    'Tienda, any sucursal'),
  ('tiendas',      13, NULL,  NULL,    'Telemarketing -> Tiendas (Jorge 2026-09-10, Q2)')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · comercial_demanda_canal: the hourly-synced history per area x product
-- ─────────────────────────────────────────────────────────────────────────────
-- Same lifecycle as reabastecimiento_inputs: upsert per run, purge the rows
-- the run did not touch. JSONB series keyed by month with EXPLICIT ZEROS
-- (the demanda_mensual convention, 20260821000001): "did not sell" is an
-- answer; NULL means only "this column is newer than the row".
CREATE TABLE IF NOT EXISTS comercial_demanda_canal (
  id                          UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id                   UUID REFERENCES tenants(id),
  area                        VARCHAR(40) NOT NULL REFERENCES comercial_areas(slug),
  product_id                  INT NOT NULL REFERENCES products(id),
  -- {"YYYY-MM": qty} x 6 complete months, stock UoM, current month excluded
  pedido_mensual              JSONB NOT NULL,
  entregado_mensual           JSONB NOT NULL,
  -- {"YYYY-MM": {"pedido": q, "entregado": q}} for each of the 3 horizon
  -- months x up to 2 prior years (Odoo starts 2024-10)
  mismo_mes_anios_anteriores  JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- last 3 complete months
  clientes_3m                 INT NOT NULL DEFAULT 0,
  cliente_principal           VARCHAR(160),
  cliente_principal_share     NUMERIC(5,4),
  as_of                       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_sync_id              UUID REFERENCES sync_runs(id),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (area, product_id)
);
CREATE INDEX IF NOT EXISTS idx_comercial_demanda_canal_area ON comercial_demanda_canal (area);

COMMENT ON TABLE comercial_demanda_canal IS
  'Per commercial area x product: requested (product_uom_qty) and delivered '
  '(qty_delivered) per complete month, prior-year same months, and customer '
  'concentration. Filled by ml/odoo_sync_reabastecimiento.py sync_demanda_canal(). '
  'Requested = demand basis; delivered - requested = lost sales (cancelled moves).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · comercial_estacionalidad + comercial_categoria_sai: the seasonal index
-- ─────────────────────────────────────────────────────────────────────────────
-- Multiplicative monthly index per (SAI channel group x category), built from
-- SAI 2022-2024 + Odoo 2025 by ml/comercial_estacionalidad_carga.py, >= 2
-- mostly-complete years, clamped [0.6, 1.8]. categoria = '*' is the
-- channel-level fallback for categories without two years. STATIC: reloaded
-- once a year, not by the hourly sync.
CREATE TABLE IF NOT EXISTS comercial_estacionalidad (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  grupo_sai   VARCHAR(10) NOT NULL,
  categoria   VARCHAR(100) NOT NULL,
  mes         SMALLINT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  indice      NUMERIC(6,4) NOT NULL CHECK (indice > 0),
  anios       INT[] NOT NULL,
  cargado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (grupo_sai, categoria, mes)
);
COMMENT ON TABLE comercial_estacionalidad IS
  'Seasonal index per SAI channel group x category x month (categoria=* is the '
  'group fallback). Backtest 2026-09-10: December under-forecast -20% -> -5%. '
  'Loaded yearly by ml/comercial_estacionalidad_carga.py.';

-- SAI code -> category. The index is keyed by SAI category, not by
-- products.category, because that is the taxonomy the four years of history
-- carry. A product absent here falls back to the group index.
CREATE TABLE IF NOT EXISTS comercial_categoria_sai (
  sku         VARCHAR(50) PRIMARY KEY,
  categoria   VARCHAR(100) NOT NULL,
  cargado_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · RLS — the repo's standard block (read for any app role; service writes)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['comercial_area_reglas', 'comercial_demanda_canal',
                           'comercial_estacionalidad', 'comercial_categoria_sai']
  LOOP
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · The fourth motivo: `base` = an approved recommendation
-- ─────────────────────────────────────────────────────────────────────────────
-- It is none of the three existing reasons: not a commitment (extraordinaria)
-- and not a projection to review (temporada/critico). It NEVER sums into the
-- Sugerido — the wiring to purchasing is on hold (plan §1 Q5) — so the merge
-- in rows.ts puts it in its own bucket and the consolidated view shows it
-- without adding it.
ALTER TABLE comercial_forecast DROP CONSTRAINT IF EXISTS comercial_forecast_motivo_check;
ALTER TABLE comercial_forecast ADD CONSTRAINT comercial_forecast_motivo_check
  CHECK (motivo IN ('extraordinaria', 'temporada', 'critico', 'base'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 7 · Route permission for the history endpoint
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT r, '/api/comercial/historial', '{GET}',
       'Historial por canal + recomendacion (forecast comercial nivel 2)'
FROM unnest(ARRAY['ventas','compras','gerencia','ceo','sales_manager','admin','operaciones']) AS r
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8 · Verification in the same transaction
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  n_reglas INT; n_areas_sin_grupo INT; n_perm INT; n_sin_asignar INT;
BEGIN
  SELECT count(*) INTO n_reglas FROM comercial_area_reglas;
  IF n_reglas < 9 THEN
    RAISE EXCEPTION 'comercial_area_reglas: expected >= 9 seeded rules, found %', n_reglas;
  END IF;
  -- every ACTIVE area must have at least one rule, else its leader sees nothing
  IF EXISTS (SELECT 1 FROM comercial_areas a WHERE a.activa
             AND NOT EXISTS (SELECT 1 FROM comercial_area_reglas r WHERE r.area = a.slug)) THEN
    RAISE EXCEPTION 'an active comercial_area has no Odoo rule';
  END IF;
  SELECT count(*) INTO n_areas_sin_grupo FROM comercial_areas WHERE activa AND grupo_sai IS NULL;
  IF n_areas_sin_grupo <> 0 THEN
    RAISE EXCEPTION '% active areas have no grupo_sai', n_areas_sin_grupo;
  END IF;
  SELECT count(*) INTO n_sin_asignar FROM comercial_areas WHERE slug = '_sin_asignar' AND NOT activa;
  IF n_sin_asignar <> 1 THEN
    RAISE EXCEPTION '_sin_asignar bucket missing or active';
  END IF;
  SELECT count(*) INTO n_perm FROM route_permissions WHERE route_pattern = '/api/comercial/historial';
  IF n_perm <> 7 THEN
    RAISE EXCEPTION 'route_permissions for /api/comercial/historial: expected 7, found %', n_perm;
  END IF;
END $$;

COMMIT;
