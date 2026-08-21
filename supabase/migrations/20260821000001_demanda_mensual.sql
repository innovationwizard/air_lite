-- DEMANDA MENSUAL — la serie por mes que hace posible la alerta de tendencia.
--
-- PEDIDO (Wilmer, llamada 2026-08-20, verbatim):
--   «que me lo cambie de color o que me tire un signo de advertencia y que diga
--    que está subiendo, la tendencia es incrementar los últimos tres meses.
--    Entonces yo voy a revisar ya mejor mi Odoo y yo digo: ah sí, este amerita
--    que le suba la punta»
--
-- POR QUÉ HACE FALTA ESTA COLUMNA: hasta hoy `reabastecimiento_inputs` sólo
-- guardaba PROMEDIOS (`p6`, `p3`) y el mes en curso parcial (`mtd`). Con
-- promedios NO se puede saber si los últimos tres meses vienen subiendo — la
-- serie por mes no existía en ninguna parte del sistema. Se mide en Odoo en
-- cada corrida y se persiste aquí.
--
-- POR QUÉ AQUÍ Y NO EN UNA TABLA APARTE (decisión 2026-08-21, con Jorge
-- confirmando que el diseño de la base es nuestro):
--   * el grano es EXACTAMENTE el de esta tabla: producto × bodega;
--   * hereda gratis el ciclo de vida que ya existe — upsert por corrida y
--     purga de filas que la corrida no tocó (una serie huérfana sería un dato
--     viejo presentado como vigente, justo el fallo de 2026-08-06);
--   * la ruta de servicio ya hace `select('*')` sobre esta tabla: cero queries
--     y cero joins nuevos para pintar la alerta;
--   * es de ancho fijo (6 meses completos), no un histórico que crece.
-- Si algún día se necesita histórico largo o consultas por mes, eso SÍ pide su
-- propia tabla; esto no.
--
-- FORMA: objeto llave→valor, `{"2026-02": 2935.0, …}`, un par por cada uno de
-- los 6 meses COMPLETOS, con CEROS EXPLÍCITOS cuando el producto no vendió ese
-- mes. Se guarda llaveado por mes y no como arreglo posicional a propósito: un
-- arreglo obliga a leer por índice, y la posición se rompe sola en cuanto
-- cambie la ventana. La llave dice qué mes es; nadie tiene que contar.
--
-- El mes EN CURSO nunca entra: es parcial, y leerlo como un mes más haría que
-- casi todo producto pareciera venir cayendo durante casi todo el mes.
--
-- NULL = la sincronización todavía no corrió con esta columna. La app lo
-- reporta como «no evaluable», NUNCA como «no hay tendencia»: no tener el dato
-- y tener el dato en cero son cosas distintas.
--
-- Aplicada con `supabase db push`. Idempotente.

ALTER TABLE reabastecimiento_inputs
  ADD COLUMN IF NOT EXISTS demanda_mensual JSONB;

COMMENT ON COLUMN reabastecimiento_inputs.demanda_mensual IS
  'Demanda ordenada por mes completo, en la UNIDAD DE STOCK del producto: '
  '{"YYYY-MM": qty} con ceros explícitos, 6 meses, mes en curso excluido. '
  'Insumo de la alerta de tendencia creciente (Wilmer 2026-08-20). '
  'NULL = el sync aún no la calculó → la app muestra «no evaluable», no «sin tendencia».';
