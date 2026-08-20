-- N14 — Conciliación factura PDF ↔ vendor bill de Odoo, con enlaces persistidos
-- y procedencia. Reemplaza la regla de dedupe por substring de `saldos.ts`.
--
-- EL PROBLEMA (medido en producción 2026-08-20): contabilidad ya cargó en Odoo
-- 5 de las facturas que también entraron por PDF. La regla vieja buscaba el
-- número de factura del CFDI dentro de `factura + referencia` de la bill; el
-- `ref` y el `payment_reference` de REYMA dicen `PEDIDO AGOSTO 2026` y NUNCA el
-- folio, así que la regla no puede dispararse y la misma mercadería se cuenta
-- dos veces. Fill rate mostrado 55.9% contra 40.5% real; 7 de 47 códigos con
-- facturado > pedido.
--
-- POR QUÉ UNA TABLA Y NO SÓLO CÓDIGO: el enlace es un HECHO con procedencia
-- (qué regla lo produjo, con qué evidencia, quién lo confirmó o lo rechazó), no
-- un resultado de pantalla. Persistirlo da tres cosas que el cálculo al vuelo
-- no puede tener: rastro auditable, override humano cuando el motor se
-- equivoca, y una cola de excepciones estable.
--
-- HISTORIAL APPEND-ONLY, la última fila por par (folio_fiscal, odoo_factura)
-- manda — mismo patrón que reyma_eta_config, reyma_nc_config y los overrides.
-- Nunca se hace UPDATE ni DELETE: si alguien se arrepiente, agrega una fila
-- nueva y la anterior queda como historia.
--
-- ESTADOS:
--   'auto'       — lo propuso el motor (tier 1 o 2) y se aplica.
--   'confirmado' — un humano lo ratificó; se aplica aunque el motor deje de
--                  proponerlo (p. ej. si cambia una cantidad).
--   'rechazado'  — un humano dijo que NO son la misma factura; veta el par
--                  aunque el motor insista.
--
-- TIERS (la escalera, validada contra datos reales — 5/5 correctas, 0 falsos
-- positivos sobre 16 facturas PDF × 5 bills):
--   0 — enlace humano, sin regla automática detrás.
--   1 — el folio del CFDI aparece en `referencia` de la bill (lo que Odoo
--       diseñó para esto: el campo `ref` / Vendor Reference).
--   2 — monto total + composición de líneas + fecha, los tres exactos.
-- La fecha NO es opcional: G-216 y G-224 son gemelas ($14,652.00, una sola
-- línea VT10XN 666) y sin la fecha el par es genuinamente ambiguo. Por lo mismo
-- la resolución es asignación 1:1, no búsqueda por fila.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS reyma_factura_match (
  id            UUID PRIMARY KEY DEFAULT uuidv7(),
  folio_fiscal  VARCHAR(36) NOT NULL,   -- UUID SAT del CFDI (lado PDF)
  factura       VARCHAR(20) NOT NULL,   -- 'F171849' — legible, redundante con el folio
  odoo_factura  VARCHAR(60) NOT NULL,   -- 'BILL/2026/08/0054' (lado Odoo)
  mes           DATE NOT NULL,          -- primer día del mes que concilia
  tier          SMALLINT NOT NULL CHECK (tier BETWEEN 0 AND 2),
  regla         VARCHAR(120) NOT NULL,  -- descripción de la regla que disparó
  estado        VARCHAR(12) NOT NULL CHECK (estado IN ('auto', 'confirmado', 'rechazado')),
  -- Evidencia verbatim del momento del enlace: montos, fechas y comparación de
  -- líneas de ambos lados. Se guarda para que el enlace se pueda auditar
  -- aunque el sync reemplace las filas de origen.
  evidencia     JSONB NOT NULL,
  autor         VARCHAR(500) NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reyma_factura_match_par
  ON reyma_factura_match (folio_fiscal, odoo_factura, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reyma_factura_match_mes
  ON reyma_factura_match (mes, created_at DESC);

ALTER TABLE reyma_factura_match ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "reyma_factura_match_service" ON reyma_factura_match;
CREATE POLICY "reyma_factura_match_service" ON reyma_factura_match
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE reyma_factura_match IS
  'Enlaces factura PDF ↔ vendor bill de Odoo con procedencia. Append-only: la '
  'última fila por (folio_fiscal, odoo_factura) manda. Ver N14 en '
  'docs/docs-alexis/MANIFEST.md.';
COMMENT ON COLUMN reyma_factura_match.evidencia IS
  'Snapshot de lo que se comparó al enlazar: totales, fechas, códigos y '
  'cantidades de ambos lados. Permite auditar el enlace aunque el sync haya '
  'reemplazado las filas de reyma_facturas.';

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('inventario', '/api/inventarios/reyma/conciliacion', '{POST}', 'Conciliar facturas PDF con las de Odoo (Alexis)'),
  ('gerencia',   '/api/inventarios/reyma/conciliacion', '{POST}', 'Conciliar facturas PDF con las de Odoo'),
  ('admin',      '/api/inventarios/reyma/conciliacion', '{POST}', 'Conciliar facturas PDF con las de Odoo')
ON CONFLICT (role, route_pattern) DO NOTHING;
