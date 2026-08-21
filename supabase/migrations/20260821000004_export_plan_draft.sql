-- BORRADOR DEL PLAN DE COMPRA — lo que Wilmer edita antes de mandarle el
-- archivo al proveedor, para que no se pierda.
--
-- EL PROBLEMA QUE RESUELVE: la primera versión del export (2026-08-21) tenía el
-- borrador SÓLO en memoria de React. Cerrar el modal y volver a abrirlo ya lo
-- perdía — el efecto de carga volvía a pedir la propuesta y la escribía encima.
-- Las cantidades que él teclea son decisiones suyas (cuánto pedirle a Carvajal,
-- por bodega, para la semana), y todo lo demás que se captura a mano en este
-- sistema se persiste: transito_overrides, pending_reserve_overrides,
-- comercial_forecast, reyma_conversion_bulto. Esto era la excepción.
--
-- ⚠️ INERTE, POR DECISIÓN EXPLÍCITA (Jorge, 2026-08-21).
-- Nada lee esta tabla para calcular. No alimenta tránsito, ni Sugerido, ni
-- fill-rate. Es memoria del borrador y nada más. Existe la tentación evidente
-- —el compromiso mensual de Carvajal no está en Odoo y ESTA es justo la
-- cantidad que falta (ver OPEN_QUESTIONS §2)— pero conectarla movería números
-- que el cliente valida a diario, y eso se decide aparte y a propósito, nunca
-- como efecto secundario de haber guardado un borrador.
--
-- POR QUÉ MUTABLE Y NO APPEND-ONLY, a diferencia de los overrides: un borrador
-- es estado de trabajo, no una decisión tomada. La regla append-only de este
-- proyecto protege los valores que ENTRAN a un cálculo, para poder reconstruir
-- por qué un número fue lo que fue. Este no entra a ninguno. Se guarda el
-- último estado, con quién lo tocó y cuándo.
--
-- ⚠️ LO QUE ESTO NO GUARDA: el archivo EMITIDO. Hoy no queda registro de qué se
-- descargó ni cuándo, así que «¿qué le mandamos a Carvajal en la semana 4?»
-- sigue sin tener respuesta en el sistema. Es un log aparte (inmutable, uno por
-- descarga) y todavía no está pedido.
--
-- LLAVE: (proveedor, semana, mes). Un plan por proveedor y semana, COMPARTIDO,
-- no uno por persona — «la operación debe seguir sin depender de una persona»
-- (Wilmer, 08-06). `autor` dice quién lo tocó de último, no de quién es.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS export_plan_draft (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  proveedor   VARCHAR(120) NOT NULL,
  semana      SMALLINT     NOT NULL CHECK (semana BETWEEN 1 AND 5),
  mes         DATE         NOT NULL,   -- primer día del mes
  -- [{product_id, cod, desc, orden, cantidades: {bodega: número|null}}]
  -- `null` en una bodega = celda VACÍA en la hoja, que no es lo mismo que 0:
  -- 0 le dice al proveedor «de esto no pidas nada», vacío «esto no va en este
  -- envío». La distinción se conserva hasta el archivo.
  lineas      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  autor       VARCHAR(500) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT export_plan_draft_unico UNIQUE (proveedor, semana, mes),
  CONSTRAINT export_plan_draft_lineas_array CHECK (jsonb_typeof(lineas) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_export_plan_draft_lookup
  ON export_plan_draft (proveedor, mes DESC, semana DESC);

ALTER TABLE export_plan_draft ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "export_plan_draft_service" ON export_plan_draft;
CREATE POLICY "export_plan_draft_service" ON export_plan_draft
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE export_plan_draft IS
  'Borrador editable del plan de compra por proveedor × semana (formato hoja del '
  'proveedor, W1(a)). MUTABLE a propósito: es estado de trabajo, no una decisión '
  'que alimente un cálculo. INERTE por decisión de Jorge 2026-08-21 — ninguna '
  'ruta ni sync lo lee para calcular nada.';

-- Permisos de ruta para el borrador (mismos tres roles que el resto del endpoint).
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/compras/reabastecimiento/export/draft', ARRAY['GET', 'PUT'],
       'Leer y guardar el borrador del plan de compra por proveedor y semana'
FROM (VALUES ('admin'), ('compras'), ('gerencia')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role
     AND rp.route_pattern = '/api/compras/reabastecimiento/export/draft'
);
