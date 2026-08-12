-- C7 Fill rate / Saldos de pedido — the orden global baseline + PDF facturas.
--
-- Unblocked 2026-08-12 by Alexis: "La orden de compra de REYMA para Agosto es
-- la PO-P-3003" + the 7 factura PDFs (docs/docs-alexis/MANIFEST.md).
--
-- Design (matches R1/R2 of the manifest):
--   * reyma_orden_global: which Odoo PO is THE monthly global order — data,
--     not code (append-only; latest row per mes wins). Seeded with August.
--   * reyma_po_lineas: the PO's lines synced from Odoo per run (pedido /
--     recibidas / precio) — the fill-rate baseline. Replaced per sync
--     (sync_id), same pattern as reyma_facturas.
--   * reyma_facturas_pdf: factura lines captured from the supplier PDFs that
--     arrive by mail DAYS before contabilidad posts them in Odoo (R2). L4
--     mail-ingestion will feed this table automatically; until then rows are
--     captured manually with provenance (folio fiscal SAT). The app merges
--     Odoo + PDF facturado, deduping by factura number, and labels sources.
-- Applied via `supabase db push`. Idempotent.

CREATE TABLE IF NOT EXISTS reyma_orden_global (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  mes DATE NOT NULL,                 -- first day of the month it governs
  po_name VARCHAR(30) NOT NULL,      -- e.g. 'PO-P-3003'
  autor VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_orden_global_mes ON reyma_orden_global (mes, created_at DESC);

CREATE TABLE IF NOT EXISTS reyma_po_lineas (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  sync_id UUID NOT NULL,
  po_name VARCHAR(30) NOT NULL,
  codigo VARCHAR(20) NOT NULL,
  cajas NUMERIC(12,4) NOT NULL,
  recibidas NUMERIC(12,4) NOT NULL DEFAULT 0,
  precio_unit NUMERIC(12,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_po_lineas_sync ON reyma_po_lineas (sync_id, po_name);

CREATE TABLE IF NOT EXISTS reyma_facturas_pdf (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  folio_fiscal VARCHAR(36) NOT NULL,  -- SAT UUID — provenance of the source CFDI
  factura VARCHAR(20) NOT NULL,       -- e.g. 'F171849'
  guia VARCHAR(20),                   -- e.g. 'G-216-2026' (correlativo furgón)
  destino VARCHAR(40),                -- 'bodega-san-jose' | 'entrega-directa'
  fecha DATE NOT NULL,
  codigo VARCHAR(20) NOT NULL,        -- Suplicentro SKU (mapped via reyma_products.clave)
  clave VARCHAR(30) NOT NULL,         -- REYMA identifier as printed (verbatim)
  cantidad NUMERIC(12,4) NOT NULL,
  precio_unit NUMERIC(12,4) NOT NULL,
  autor VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (folio_fiscal, codigo)
);

-- RLS: same posture as the other reyma_* tables (service writes; reads go
-- through the API with requireAuth).
ALTER TABLE reyma_orden_global ENABLE ROW LEVEL SECURITY;
ALTER TABLE reyma_po_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE reyma_facturas_pdf ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reyma_orden_global_service" ON reyma_orden_global;
CREATE POLICY "reyma_orden_global_service" ON reyma_orden_global FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "reyma_po_lineas_service" ON reyma_po_lineas;
CREATE POLICY "reyma_po_lineas_service" ON reyma_po_lineas FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "reyma_facturas_pdf_service" ON reyma_facturas_pdf;
CREATE POLICY "reyma_facturas_pdf_service" ON reyma_facturas_pdf FOR ALL USING (auth.role() = 'service_role');

-- Seed: Alexis' answer, verbatim provenance.
INSERT INTO reyma_orden_global (mes, po_name, autor)
SELECT '2026-08-01', 'PO-P-3003', 'Alexis (mensaje 2026-08-12, vía Jorge)'
WHERE NOT EXISTS (
  SELECT 1 FROM reyma_orden_global WHERE mes = '2026-08-01' AND po_name = 'PO-P-3003'
);

-- Route permissions for the new write endpoint (superuser bypasses).
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('inventario', '/api/inventarios/reyma/orden-global', '{POST}', 'Registrar la PO global del mes (Alexis)'),
  ('gerencia',   '/api/inventarios/reyma/orden-global', '{POST}', 'Registrar la PO global del mes'),
  ('admin',      '/api/inventarios/reyma/orden-global', '{POST}', 'Registrar la PO global del mes')
ON CONFLICT (role, route_pattern) DO NOTHING;
