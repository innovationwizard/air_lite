-- DRILL-DOWN DE TRÁNSITO — A6.15 / W14 / A2.
--
-- LA PREGUNTA QUE CONTESTA, textual (Mario vía Wilmer, 20-ago):
--   *«1,200 en tránsito: ¿500 entran el 24?»*
-- Hoy la columna Tránsito dice UN número y no dice cuándo. Saber que vienen
-- 1,200 no ayuda a decidir si hay que comprar: lo que decide es si entran esta
-- semana o el mes que viene.
--
-- UN SOLO BUILD PARA LOS DOS SILOS. La misma pregunta la hace el silo
-- internacional con otras palabras —*«¿cuándo entra este producto?»*, que le
-- preguntan todo el día a Alexis y hoy contesta de memoria— y la hacen ventas y
-- logística. Es la fila 3.13 del reporte anterior y la A2 del corpus: una sola
-- construcción sirve a las dos, y por eso vale más de lo que parece por su
-- tamaño.
--
-- POR QUÉ UNA TABLA DERIVADA Y NO UNA CONSULTA A ODOO EN VIVO. La página tiene
-- que abrir rápido y Odoo es lento; además todo el resto de la pantalla ya sale
-- de la sincronización horaria, así que una consulta en vivo mostraría un dato
-- de OTRO momento que los que tiene al lado. Un número fresco junto a números
-- de hace una hora no es mejor: es una inconsistencia que nadie puede explicar.
--
-- SE REEMPLAZA ENTERA EN CADA SINCRONIZACIÓN. Es un espejo de Odoo, no una
-- captura de nadie: no hay nada que conservar y sí mucho que ensuciar si se
-- acumulan líneas de órdenes que ya se recibieron. Esto la distingue de
-- `transito_overrides` y `sugerido_bodega`, que son append-only justamente
-- porque ahí el historial ES el dato.
--
-- LA FECHA QUE SE MUESTRA es la de la LÍNEA (`date_planned`), que es la «Fecha
-- Esperada» con la que se arma la rampa, y sólo cuando falta se cae a la del
-- encabezado. La inclusión (qué órdenes cuentan como tránsito) sigue decidida
-- por la fecha del ENCABEZADO, exactamente como antes — este detalle explica un
-- total, nunca lo cambia. Si las dos fechas discrepan, la suma del detalle
-- sigue cuadrando con la columna.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS transito_detalle (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  product_id   INT NOT NULL REFERENCES products(id),
  bodega       VARCHAR(40) NOT NULL,
  -- Cuándo se espera que entre. NULL cuando Odoo no tiene fecha: se muestra
  -- como «sin fecha» y NO se adivina — una fecha inventada haría que alguien
  -- decidiera no comprar por una entrada que quizá nunca llega.
  fecha        DATE,
  qty          NUMERIC(15,4) NOT NULL,
  -- El correlativo de la orden, para poder rastrearlo en Odoo.
  orden        VARCHAR(64),
  sync_id      UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE transito_detalle IS
  'A6.15 — desglose por fecha del transito que la columna muestra sumado. '
  'DERIVADA: se reemplaza entera en cada sincronizacion. La suma por '
  '(product_id, bodega) cuadra con reabastecimiento_inputs.transito.';

-- La lectura de la página: el desglose de una bodega, lo más próximo primero.
CREATE INDEX IF NOT EXISTS idx_transito_detalle_bodega_prod
  ON transito_detalle (bodega, product_id, fecha);

ALTER TABLE transito_detalle ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "transito_detalle_service" ON transito_detalle;
CREATE POLICY "transito_detalle_service" ON transito_detalle
  FOR ALL USING (auth.role() = 'service_role');
