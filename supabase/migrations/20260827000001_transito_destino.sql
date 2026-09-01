-- DESTINO FINAL DEL TRÁNSITO, DECLARADO A MANO — W15-A.
--
-- ⚠️ ESTA TABLA IMPLEMENTA A PROPÓSITO UNA RESPUESTA QUE SABEMOS INCOMPLETA.
--
-- DECISIÓN (Jorge, 2026-08-27, respondiendo Q26), con el defecto enunciado por
-- él en la misma frase: «un furgón puede descargar algo en San José, después
-- algo en Zacapa, y después algo en Petén». Un solo destino por producto NO
-- puede representar eso. Se construye igual, y se construye PARA DISPARAR LA
-- CONVERSACIÓN DE DISEÑO: la forma más rápida de aprender cómo se comporta la
-- cadena es verlo intentar declararla y chocar con el límite.
--
-- EL PROBLEMA QUE INTENTA ALIVIAR MIENTRAS TANTO (medido 2026-08-27):
--   `sync_transit()` en ml/odoo_sync_reabastecimiento.py devuelve
--   `{product_id: qty}` SIN dimensión de bodega, y `assemble_inputs()` escribe
--   ese mismo número en las tres. El tránsito no está «revuelto»: está
--   REPLICADO. Por eso un tránsito ajeno anula el Sugerido de la bodega que él
--   está viendo — «no me da un sugerido porque está tomando los 3 saques».
--   La corrección de raíz es W15-B (atribuir en el sync); esto es el puente.
--
-- POR QUÉ APPEND-ONLY Y NO UN CAMPO EN `products`: **el historial de ediciones
-- ES el resultado de la investigación**. Las preguntas que la reunión de diseño
-- va a necesitar responder son: ¿cuántos productos llegó a declarar?, ¿cuántas
-- veces CAMBIÓ un destino (es decir, cuántas veces un solo destino estuvo mal)?,
-- ¿intentó expresar un reparto tecleando y borrando el mismo producto en varias
-- vistas?, ¿lo hizo sólo para los ~4-5 proveedores de entrega directa (W12) —
-- lo que convertiría la respuesta real en un ATRIBUTO DEL PROVEEDOR, mucho más
-- barato que cualquier otra opción? Nada de eso se puede reconstruir si la
-- última escritura pisa a la anterior. Mismo patrón que `transito_overrides`,
-- `bodega_cobertura` y `reyma_eta_config`.
--
-- PRECEDENCIA, de mayor a menor (implementada en api/.../rows.ts):
--   1. `transito_overrides` — la CANTIDAD que él teclea. Manda siempre: ya es
--      por (product_id, bodega), así que es la herramienta MÁS expresiva y no
--      se puede pisar con la menos expresiva.
--   2. este destino declarado — mueve el tránsito sincronizado a una bodega.
--   3. el tránsito sincronizado tal como viene.
--
-- ALCANCE: `General` NUNCA se reparte. Es el roll-up, la cifra global es la que
-- necesita, y es hoy la única vista donde el número está bien.
--
-- TEMPORAL POR DISEÑO: se reemplaza por lo que salga de la conversación (Q29).
-- La tabla queda append-only para que nada de lo tecleado se pierda cuando se
-- retire la columna.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS transito_destino (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    UUID REFERENCES tenants(id),
  product_id   INT NOT NULL REFERENCES products(id),
  -- El destino declarado. NULL = BORRADO (vuelve a regir el tránsito sincronizado).
  destino      VARCHAR(40),
  -- Desde qué vista lo tecleó. Metadato de la sonda, NO se usa en el cálculo:
  -- responde «¿estaba en Zacapa cuando dijo que era de San José?».
  vista_bodega VARCHAR(40) NOT NULL,
  note         TEXT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE transito_destino IS
  'W15-A (sonda, temporal): destino final del tránsito declarado a mano por Wilmer. '
  'Append-only — el historial de ediciones es el insumo del rediseño (Q29). '
  'Sabidamente incorrecta para furgones que descargan en varias bodegas: decisión '
  'consciente de Jorge 2026-08-27 para disparar la conversación de diseño.';

CREATE INDEX IF NOT EXISTS idx_transito_destino_prod
  ON transito_destino(product_id, created_at DESC);

-- RLS — mismo patrón que el resto del silo: lectura para cualquier perfil
-- autenticado, escritura sólo service_role (las rutas del servidor).
ALTER TABLE transito_destino ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transito_destino_read ON transito_destino;
CREATE POLICY transito_destino_read ON transito_destino
  FOR SELECT USING (auth_role() IS NOT NULL);

DROP POLICY IF EXISTS transito_destino_service_write ON transito_destino;
CREATE POLICY transito_destino_service_write ON transito_destino
  FOR ALL USING (auth.role() = 'service_role');

-- Permisos de ruta — refleja CAN_VIEW_COMPRAS (roles.ts): superuser hace bypass,
-- admin + gerencia + compras entran. check_route_access no matchea un path
-- exacto con un glob '/*', así que la ruta concreta se lista explícitamente.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/compras/reabastecimiento/destino', ARRAY['POST'],
       'Destino final del tránsito declarado a mano (W15-A, sonda temporal)'
FROM (VALUES ('admin'), ('compras'), ('gerencia')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role
     AND rp.route_pattern = '/api/compras/reabastecimiento/destino'
);
