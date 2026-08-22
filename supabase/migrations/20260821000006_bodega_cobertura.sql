-- COBERTURA DEL SUGERIDO POR BODEGA — cuántos días debe cubrir la sugerencia.
--
-- WILMER, verbatim (2026-08-21):
--   «Jorge, con el tema de la compra o abastecimiento de zacapa y peten; el
--    sugerido para estos CDs no es de 30 dias, sino de 15 dias por favor»
--
-- QUÉ SIGNIFICA «30 DÍAS» HOY: el forecast del motor se arma con promedios
-- MENSUALES (`p6`, `p3`, estacional), así que la cantidad sugerida cubre un mes
-- de demanda. Nadie eligió ese 30 — viene implícito en el libro de Excel. Él lo
-- nombra así y por eso se conserva su vocabulario.
--
-- POR QUÉ 15 EN ZACAPA Y PETÉN: se reabastecen DESDE San José Villanueva («es
-- una cadenita»), no del proveedor, y ese traslado interno es mucho más
-- frecuente que una orden de compra mensual. Pedir un mes entero a un CD que se
-- resurte cada quincena infla el inventario regional. Es la contraparte natural
-- de la separación Zacapa/Petén de hoy mismo (W11).
--
-- CONFIGURABLE POR BODEGA, no un `if` con dos nombres adentro: la política es
-- «cada bodega tiene su horizonte», y mañana puede cambiar cualquiera de ellas
-- sin tocar código. Mismo patrón append-only que `reyma_eta_config` /
-- `reyma_nc_config`: la última fila por bodega manda, las anteriores quedan como
-- historia de qué se decidió y por qué.
--
-- LA AUSENCIA ES UNA RESPUESTA: una bodega sin fila usa el default de 30 días
-- que vive en el motor. No se siembran filas de 30 para General ni San Jose VN
-- porque nadie decidió ese 30 — registrarlo como decisión sería inventar una.
--
-- ⚠️ ALCANCE: cambia SÓLO el término de cobertura del Sugerido. NO toca
--   * la ventana de proyección `win` (10 General / 5 bodegas) — es el consumo
--     durante el ciclo de resurtido, otro concepto, y Wilmer confirmó el 07-23
--     que la ventana fija en vez del lead time es deliberada;
--   * el DOH ni sus umbrales (3/7/30) — son diagnóstico, no cuánto pedir;
--   * la página de paridad xlsx, que no manda el campo y sigue en 30.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS bodega_cobertura (
  id         UUID PRIMARY KEY DEFAULT uuidv7(),
  bodega     VARCHAR(40) NOT NULL,
  dias       SMALLINT    NOT NULL CHECK (dias BETWEEN 1 AND 120),
  motivo     TEXT        NOT NULL,
  autor      VARCHAR(500) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bodega_cobertura_bodega
  ON bodega_cobertura (bodega, created_at DESC);

ALTER TABLE bodega_cobertura ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bodega_cobertura_service" ON bodega_cobertura;
CREATE POLICY "bodega_cobertura_service" ON bodega_cobertura
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE bodega_cobertura IS
  'Días que debe cubrir el Sugerido, por bodega. Append-only, la última fila por '
  'bodega manda; sin fila = 30 días (default del motor). Pedido de Wilmer '
  '2026-08-21: Zacapa y Petén a 15 días. No afecta DOH ni la ventana de proyección.';

INSERT INTO bodega_cobertura (bodega, dias, motivo, autor)
SELECT v.bodega, 15,
       'Wilmer, 2026-08-21, verbatim: «el sugerido para estos CDs no es de 30 dias, '
       'sino de 15 dias por favor». Zacapa y Petén se resurten desde San José '
       'Villanueva y no del proveedor, con traslados mucho más frecuentes que una '
       'orden de compra mensual.',
       'Wilmer (vía Jorge), mensaje del 2026-08-21'
FROM (VALUES ('Zacapa'), ('Petén')) AS v(bodega)
WHERE NOT EXISTS (SELECT 1 FROM bodega_cobertura b WHERE b.bodega = v.bodega);
