-- Cuarentena de claves REYMA sin mapa — nunca detiene la factura entera.
--
-- INCIDENTE (2026-09-01/02): F173634 (G-251-2026) trae CH2PRXN, que no tenía
-- fila en `reyma_products`. La regla vieja clasificaba una clave sin mapa
-- como error DE FACTURA ENTERA (`reyma_factura_carga.py` original), así que
-- las otras 10 líneas buenas de esa factura tampoco se cargaron. Investigado:
-- el producto SÍ existe en Odoo (77201001, ligado a REYMA vía
-- `product.supplierinfo` desde el 31-jul) — el catálogo `reyma_products`
-- simplemente nunca lo vio, porque el seed sólo corre una vez (55 códigos del
-- xlsx de julio) y nunca vuelve a crecer.
--
-- DECISIÓN (Jorge, 2026-09-09), en dos partes:
--   1. «Stop the invoice» no es una opción: en temporada alta los SKU nuevos
--      se agrupan justo cuando Alexis tiene menos margen para lidiar con una
--      factura rota, y bloquear 10 líneas buenas por 1 clave desconocida
--      tira exactamente el motivo por el que existe esta carga (llega antes
--      que la contabilización de Odoo — ver saldos.ts).
--   2. La resolución («¿CH2PRXN es 77201001?») la sigue haciendo Alexis — es
--      quien conoce el producto — pero NO en el momento de descargar el
--      furgón. Se mueve a una pantalla propia
--      (`/inventarios/facturas/pendientes`) que visita cuando puede.
--
-- `ml/reyma_factura_carga.py` ya cambió: una clave sin mapa ahora RETIENE la
-- línea (`tipo='clave_sin_mapa'`) en vez de detener la factura. Estas dos
-- tablas son lo que hace falta para que esa retención sea recuperable en vez
-- de una pérdida silenciosa:
--
--   * `reyma_clave_map` — el cruce clave REYMA → código Suplicentro que
--     decide un humano. Historial append-only (mismo patrón que
--     `reyma_conversion_bulto` / `reyma_eta_config`): última fila por clave
--     manda. Vive SEPARADO de `reyma_products.clave` a propósito — esa
--     columna sigue sirviendo a las 53 claves ya buenas del seed de julio;
--     ésta es donde entra todo lo nuevo, sin tocar lo que ya funciona.
--   * `reyma_factura_pendiente` — la cola de líneas retenidas por clave sin
--     mapa. Guarda lo suficiente (`archivo`/`folio_fiscal`/`fecha`/`bultos`/
--     `precio_unitario`, con destino y ETA ya confirmados por Alexis) para
--     reconstruir la línea y volver a llamar `evaluar()` — la MISMA regla,
--     nunca una reimplementación — el día que la clave se resuelve.
--
-- Aplicada por Jorge en el editor SQL de Supabase (no `supabase db push` —
-- ver la nota de historial de migraciones). Idempotente.

CREATE TABLE IF NOT EXISTS reyma_clave_map (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  clave       VARCHAR(60) NOT NULL,          -- clave REYMA, verbatim del CFDI
  codigo      VARCHAR(20) NOT NULL,          -- código Suplicentro que Alexis eligió
  descripcion VARCHAR(300),                  -- descripción REYMA, verbatim (informativo)
  evidencia   JSONB NOT NULL DEFAULT '{}'::jsonb, -- qué vio y eligió Alexis al resolver
  autor       VARCHAR(500) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reyma_clave_map_clave
  ON reyma_clave_map (clave, created_at DESC);
COMMENT ON TABLE reyma_clave_map IS
  'Cruce clave REYMA → código Suplicentro, decidido por un humano. Append-only: '
  'la última fila por clave manda. Complementa (no reemplaza) reyma_products.clave.';

ALTER TABLE reyma_clave_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reyma_clave_map_service" ON reyma_clave_map;
CREATE POLICY "reyma_clave_map_service" ON reyma_clave_map
  FOR ALL USING (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS reyma_factura_pendiente (
  id              UUID PRIMARY KEY DEFAULT uuidv7(),
  clave           VARCHAR(60) NOT NULL,      -- clave REYMA sin mapa, verbatim
  descripcion     VARCHAR(300) NOT NULL,     -- descripción REYMA, verbatim
  guia            VARCHAR(20) NOT NULL,      -- 'G-251-2026'
  factura         VARCHAR(20) NOT NULL,      -- 'F173634'
  folio_fiscal    VARCHAR(36) NOT NULL,
  archivo         VARCHAR(255) NOT NULL,     -- nombre del PDF (evaluar() lo necesita)
  fecha           VARCHAR(10) NOT NULL,      -- 'dd/mm/aaaa', tal como lo lee evaluar()
  observ_destino  VARCHAR(200) NOT NULL DEFAULT '',
  destino         VARCHAR(20) NOT NULL,      -- ya confirmado por Alexis (paso 2 de la carga)
  eta             DATE,                      -- ya confirmado por Alexis; puede ser NULL
  cantidad_cfdi   NUMERIC(15,4) NOT NULL,
  unidad          VARCHAR(10) NOT NULL,
  bultos          NUMERIC(12,4),             -- sólo si la unidad es KGM
  importe         NUMERIC(15,4),
  precio_unitario NUMERIC(15,4),
  motivo          VARCHAR(200) NOT NULL,
  autor           VARCHAR(500) NOT NULL,     -- quién cargó la factura original
  estado          VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'aplicada', 'descartada')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  aplicada_at     TIMESTAMPTZ,
  UNIQUE (folio_fiscal, clave)                -- reenviar el mismo PDF no duplica
);
CREATE INDEX IF NOT EXISTS idx_reyma_factura_pendiente_estado
  ON reyma_factura_pendiente (estado, clave, created_at DESC);
COMMENT ON TABLE reyma_factura_pendiente IS
  'Líneas retenidas por clave REYMA sin mapa (tipo=clave_sin_mapa en '
  'reyma_factura_carga.py). Se aplican a reyma_facturas_pdf en cuanto '
  'reyma_clave_map resuelve la clave — nunca se pierden en silencio.';

ALTER TABLE reyma_factura_pendiente ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reyma_factura_pendiente_service" ON reyma_factura_pendiente;
CREATE POLICY "reyma_factura_pendiente_service" ON reyma_factura_pendiente
  FOR ALL USING (auth.role() = 'service_role');

-- route_permissions — mismo trío de roles que el resto de la carga de
-- facturas (20260825000001): inventario (Alexis), gerencia, admin.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, v.ruta, v.metodos, v.descripcion
FROM (VALUES
  ('inventario', '/api/inventarios/reyma/clave-pendiente', ARRAY['GET'],
   'Claves REYMA pendientes de resolver (facturas en cuarentena)'),
  ('gerencia',   '/api/inventarios/reyma/clave-pendiente', ARRAY['GET'],
   'Claves REYMA pendientes de resolver (facturas en cuarentena)'),
  ('admin',      '/api/inventarios/reyma/clave-pendiente', ARRAY['GET'],
   'Claves REYMA pendientes de resolver (facturas en cuarentena)'),
  ('inventario', '/api/inventarios/reyma/clave-pendiente/buscar', ARRAY['GET'],
   'Buscar en vivo el producto REYMA en Odoo, para mapear una clave pendiente'),
  ('gerencia',   '/api/inventarios/reyma/clave-pendiente/buscar', ARRAY['GET'],
   'Buscar en vivo el producto REYMA en Odoo, para mapear una clave pendiente'),
  ('admin',      '/api/inventarios/reyma/clave-pendiente/buscar', ARRAY['GET'],
   'Buscar en vivo el producto REYMA en Odoo, para mapear una clave pendiente'),
  ('inventario', '/api/inventarios/reyma/clave-pendiente/resolver', ARRAY['POST'],
   'Confirmar clave → código y aplicar las líneas retenidas que esperaban'),
  ('gerencia',   '/api/inventarios/reyma/clave-pendiente/resolver', ARRAY['POST'],
   'Confirmar clave → código y aplicar las líneas retenidas que esperaban'),
  ('admin',      '/api/inventarios/reyma/clave-pendiente/resolver', ARRAY['POST'],
   'Confirmar clave → código y aplicar las líneas retenidas que esperaban')
) AS v(role, ruta, metodos, descripcion)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role AND rp.route_pattern = v.ruta
);
