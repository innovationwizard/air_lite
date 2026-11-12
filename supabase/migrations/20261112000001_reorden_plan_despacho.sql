-- Plan de furgones de los modelos de punto de reorden (Darnel, Asia).
--
-- El armado lo hace `packLines` en el navegador, con la cantidad sugerida
-- (millares) y el m³ por millar que la pantalla de reorden ya usa. Esta tabla
-- guarda ese resultado. No es `reyma_plan_despacho`: aquella es el historial
-- semanal de Reyma (semana, sin modelo) y mezclar los contenedores de Darnel
-- ahí los haría parecer un despacho semanal de Reyma.
--
-- Append-only. Nada de esta tabla se escribe en Odoo: es un plan interno.
-- La capacidad que autorizó el plan queda en la fila, copiada de
-- `modelo_proveedor.capacidad_contenedor_m3` en el momento de guardar.
--
-- Aplicar a mano en el editor SQL. Idempotente.

CREATE TABLE IF NOT EXISTS reorden_plan_despacho (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  modelo        VARCHAR(40) NOT NULL REFERENCES modelo_proveedor(slug),
  capacidad_m3  NUMERIC(10,2) NOT NULL,
  payload       JSONB NOT NULL,
  autor         VARCHAR(500) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reorden_plan_modelo
  ON reorden_plan_despacho (modelo, created_at DESC);

COMMENT ON TABLE reorden_plan_despacho IS
  'Historial de planes de furgon generados en Darnel/Asia desde el pedido sugerido. '
  'payload: { capacidad_m3, unidad: ML, plan: resultado de packLines, meta }. '
  'No se escribe en Odoo.';

ALTER TABLE reorden_plan_despacho ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reorden_plan_despacho_read ON reorden_plan_despacho;
CREATE POLICY reorden_plan_despacho_read ON reorden_plan_despacho
  FOR SELECT USING (auth_role() IS NOT NULL);

DROP POLICY IF EXISTS reorden_plan_despacho_service_write ON reorden_plan_despacho;
CREATE POLICY reorden_plan_despacho_service_write ON reorden_plan_despacho
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT ON reorden_plan_despacho TO authenticated;
GRANT SELECT, INSERT ON reorden_plan_despacho TO service_role;

-- El GET del modelo sigue en /api/compras-internacionales/reorden.
-- Esta ruta sólo recibe el POST de «Guardar plan». ceo y sales_manager
-- no entran: su acceso a compras internacionales es de lectura.
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('compras_internacionales', '/api/compras-internacionales/reorden/plan', ARRAY['POST'],
   'Guardar el plan de furgones de Darnel o Asia'),
  ('gerencia', '/api/compras-internacionales/reorden/plan', ARRAY['POST'],
   'Guardar el plan de furgones de Darnel o Asia'),
  ('admin', '/api/compras-internacionales/reorden/plan', ARRAY['POST'],
   'Guardar el plan de furgones de Darnel o Asia')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods     = EXCLUDED.methods,
  description = EXCLUDED.description;
