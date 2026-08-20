-- ============================================================================
-- G4 — Dual demand perspective: ordered AND invoiced, both visible
-- ============================================================================
-- Wilmer plans on ORDERED (sale.order.line). Raquel/contabilidad validates on
-- INVOICED (Ventas → Análisis de facturas). Their meetings turn into number
-- disputes because each is right about a different perimeter. Jorge, 2026-07-28:
-- "tener los dos puntos de vista dentro de la app".
--
-- MEASURED 2026-08-20 (July 2026, production):
--   CD journals   266,317 invoiced vs 255,891 ordered on the 3 purchasing
--                 bodegas → a 4.1% timing gap, not a dispute.
--   Tienda journals 501,014 invoiced, ~0% linked to any sale order — retail
--                 billing that Wilmer's basis excludes by design (B0.2).
--   That second block is the whole "113% disagreement".
--
-- Raquel's filter, verbatim from David demonstrating it (2026-07-28):
--   "todas las facturas que no estén en borrador… y todo aquello que no esté
--    cancelado… y el tipo de ingreso… yo no voy a mostrar algo que tenga como
--    bancos o circular… y aparte es un tema de gastos, que es otra cosa"
--   → account.move.line, parent_state='posted', move_type in
--     (out_invoice, out_refund) with refunds negated, account_type in
--     (income, income_other), display_type='product'. Metric: quantity
--     (units) alongside price_subtotal ("subtotal venta sin IVA").
--
-- ⚠️ DISPLAY ONLY. f6/f3 must never feed the engine: the Sugerido stays
-- demand(ordered)-driven per H1 ("hemos comprado mal y re mal, históricamente"
-- — purchases/other bases may inform, never determine).
-- ============================================================================

-- Invoiced monthly averages, same windows as p6/p3 (sum ÷ 6, sum ÷ 3, whole
-- months). NULL = the sync has not computed it yet — distinct from 0 = billed
-- nothing. The engine ignores both.
ALTER TABLE reabastecimiento_inputs
  ADD COLUMN IF NOT EXISTS f6 NUMERIC(15,4),
  ADD COLUMN IF NOT EXISTS f3 NUMERIC(15,4);

COMMENT ON COLUMN reabastecimiento_inputs.f6 IS
  'Invoiced monthly avg, 6-month window (Raquel filter). Display only — never an engine input.';
COMMENT ON COLUMN reabastecimiento_inputs.f3 IS
  'Invoiced monthly avg, 3-month window (Raquel filter). Display only — never an engine input.';

-- Tiendas are their own perimeter, never merged into a purchasing bodega.
-- Wilmer 2026-08-06 said tienda demand is a traslado that "al final es un
-- número para San José", but tiendas ALSO place their own sale orders
-- (T8TER 36,063 units in July 2026), so folding their invoices into San José
-- would double-count. Decision 2026-08-20 (Jorge): keep them visible and
-- separate; let Wilmer and Raquel settle the attribution with the split on
-- screen.
CREATE TABLE IF NOT EXISTS invoiced_tiendas (
  id             UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id      UUID REFERENCES tenants(id),
  product_id     INT NOT NULL REFERENCES products(id),
  tienda         VARCHAR(80) NOT NULL,        -- journal name, verbatim from Odoo
  f6             NUMERIC(15,4) NOT NULL DEFAULT 0,
  f3             NUMERIC(15,4) NOT NULL DEFAULT 0,
  as_of          TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_sync_id UUID REFERENCES sync_runs(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (product_id, tienda)
);

CREATE INDEX IF NOT EXISTS idx_invoiced_tiendas_product ON invoiced_tiendas(product_id);

COMMENT ON TABLE invoiced_tiendas IS
  'Invoiced units per product per tienda journal (retail perimeter, outside abasto). Display only.';

DO $$
DECLARE
  t TEXT := 'invoiced_tiendas';
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR SELECT USING (auth_role() IS NOT NULL)',
    t || '_read', t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_service_write', t);
  EXECUTE format(
    'CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')',
    t || '_service_write', t);
END$$;
