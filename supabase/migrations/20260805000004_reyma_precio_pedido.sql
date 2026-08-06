-- Reyma C2 + C5 (docs/inventarios/PLAN_CAMBIOS_2026-08-05.md):
--   C2 precio de compra editable en la app (Alexis: "si vos cambias aquí a 13,
--      del otro lado te va a cambiar a 13") — historial append-only; el valor
--      vigente vive en reyma_products.precio_factura (el POST actualiza ambos,
--      así el sync de alertas de precio y el GET leen una sola fuente).
--   C5 pedido mensual (orden global) generado/editado/persistido — historial
--      por mes; payload JSONB {lineas:[{codigo,cajas,precio}], notas?}.

CREATE TABLE IF NOT EXISTS reyma_precio_overrides (
  id         UUID PRIMARY KEY DEFAULT uuidv7(),
  codigo     VARCHAR(20) NOT NULL REFERENCES reyma_products(codigo),
  precio     NUMERIC(12,4) NOT NULL,
  autor      VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_precio_cod ON reyma_precio_overrides(codigo, created_at DESC);

CREATE TABLE IF NOT EXISTS reyma_pedido_mensual (
  id         UUID PRIMARY KEY DEFAULT uuidv7(),
  mes        DATE NOT NULL,               -- primer día del mes pedido
  payload    JSONB NOT NULL,
  autor      VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_pedido_mes ON reyma_pedido_mensual(mes, created_at DESC);

DO $$
DECLARE
  t TEXT;
  table_list TEXT[] := ARRAY['reyma_precio_overrides', 'reyma_pedido_mensual'];
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
  ('inventario', '/api/inventarios/reyma/precio', '{POST}', 'Precio de compra editable (Alexis)'),
  ('gerencia',   '/api/inventarios/reyma/precio', '{POST}', 'Precio de compra editable'),
  ('admin',      '/api/inventarios/reyma/precio', '{POST}', 'Precio de compra editable'),
  ('inventario', '/api/inventarios/reyma/pedido', '{POST}', 'Pedido mensual (orden global)'),
  ('gerencia',   '/api/inventarios/reyma/pedido', '{POST}', 'Pedido mensual (orden global)'),
  ('admin',      '/api/inventarios/reyma/pedido', '{POST}', 'Pedido mensual (orden global)')
ON CONFLICT DO NOTHING;
