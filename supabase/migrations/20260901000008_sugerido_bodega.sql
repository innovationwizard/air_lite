-- SUGERIDOS MANUALES DE BODEGA — A4.17.
--
-- QUÉ PROBLEMA RESUELVE, en las palabras del comprador (20-ago):
--   *«que lo sume... que lo tome en cuenta en el sugerido»*
--
-- Los encargados de los centros de distribución le mandan cada mes una lista de
-- ~80-110 códigos que ELLOS piden para su bodega, validada por el jefe de
-- mayoreo. Hoy ese pedido vive en un archivo aparte y él lo cruza contra su
-- tabla con un VLOOKUP a mano, mes tras mes. Ese cruce manual es exactamente lo
-- que esta tabla elimina.
--
-- POR QUÉ SUMA Y NO REEMPLAZA. Es un pedido ADICIONAL de la bodega, no una
-- corrección del cálculo: el motor proyecta lo que la bodega va a vender, y
-- esto es lo que además le están pidiendo que traiga. Si reemplazara, un código
-- pedido por el CD borraría la proyección de demanda de ese producto, que es
-- justo el dato que costó nueve meses construir.
--
-- POR QUÉ APPEND-ONLY, igual que `transito_overrides`, `transito_destino`,
-- `bodega_cobertura` y `reyma_eta_config`. El historial ES el dato: la pregunta
-- que va a aparecer en la reunión no es «cuánto pidió el CD» sino «cuánto pidió
-- y cuánto cambió después de que lo revisáramos». Una escritura que pisa a la
-- anterior no puede contestar eso. `qty = NULL` es una entrada de BORRADO —
-- misma convención que 20260813000001 — para que quitar una captura sea un
-- hecho registrado y no la ausencia de un hecho.
--
-- ⚠️ NO TOCA EL MOTOR. `engine.ts` está verificado al 99.85% de paridad contra
-- el libro de Wilmer y ya tiene un término aditivo (`adic`, el «Adicional»
-- comercial). El sugerido de bodega se SUMA a ese término en `rows.ts` antes de
-- llamar al motor, así que la fórmula no cambia y la paridad se conserva: con
-- cero capturas, el número es idéntico al de antes. Las dos fuentes viajan
-- separadas hacia la pantalla para que se pueda ver de dónde salió cada parte —
-- un aditivo que no dice su origen es un número que nadie puede defender.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS sugerido_bodega (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   UUID REFERENCES tenants(id),
  product_id  INT NOT NULL REFERENCES products(id),
  bodega      VARCHAR(40) NOT NULL,
  -- NULL = entrada de BORRADO: la captura se quitó. No es cero.
  qty         NUMERIC(15,4),
  note        TEXT,
  autor       VARCHAR(500) NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE sugerido_bodega IS
  'A4.17 — pedido adicional que el encargado del CD manda por producto x bodega. '
  'Append-only, gana la ultima entrada; qty NULL = borrado. Se SUMA al termino '
  'aditivo del motor en rows.ts; el motor no se toca.';

-- La lectura de cada carga de la página: lo último por producto × bodega.
CREATE INDEX IF NOT EXISTS idx_sugerido_bodega_prod
  ON sugerido_bodega (product_id, bodega, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sugerido_bodega_bodega
  ON sugerido_bodega (bodega, created_at DESC);

ALTER TABLE sugerido_bodega ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sugerido_bodega_service" ON sugerido_bodega;
CREATE POLICY "sugerido_bodega_service" ON sugerido_bodega
  FOR ALL USING (auth.role() = 'service_role');

-- Permisos de ruta — refleja CAN_VIEW_COMPRAS: superuser hace bypass;
-- admin, gerencia y compras entran. `check_route_access` no hace coincidencia
-- de glob contra un patrón exacto del padre, así que la ruta se lista entera.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/compras/reabastecimiento/sugerido-bodega', ARRAY['POST'],
       'Sugerido adicional que pide el encargado del CD (A4.17)'
FROM (VALUES ('admin'), ('compras'), ('gerencia')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
  WHERE rp.role = v.role
    AND rp.route_pattern = '/api/compras/reabastecimiento/sugerido-bodega'
);
