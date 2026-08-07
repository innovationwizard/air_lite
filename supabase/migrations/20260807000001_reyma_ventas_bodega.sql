-- L3.5 (docs/inventarios/PLAN_CAMBIOS_2026-08-05.md): MRP por bodega necesita
-- ventas POR BODEGA — Alexis: "para sacar un pedido para Petén y Zacapa tengo
-- que poner el inventario de Zacapa… el mismo modelo del MRP" con nivelación a
-- ~3 semanas. Hasta hoy las ventas se agregaban global; la demanda regional se
-- negó a adivinarse (RESPUESTAS regla 4 + tracker L3.5).
--
-- bodega = 'GLOBAL' (suma de todo, comportamiento previo — sigue alimentando
-- el Modelo/PM2) o SJ/Z11/PET/ZAC (por warehouse del pedido de venta; las
-- tiendas NO generan fila por bodega: Alexis las excluye, pero sí suman al
-- GLOBAL). sales_history (SAE) no trae bodega → solo GLOBAL.

ALTER TABLE reyma_ventas_mensuales
  ADD COLUMN IF NOT EXISTS bodega VARCHAR(10) NOT NULL DEFAULT 'GLOBAL';

ALTER TABLE reyma_ventas_mensuales
  DROP CONSTRAINT IF EXISTS reyma_ventas_mensuales_codigo_anio_mes_fuente_key;
ALTER TABLE reyma_ventas_mensuales
  ADD CONSTRAINT reyma_ventas_mensuales_cod_periodo_fuente_bodega_key
  UNIQUE (codigo, anio, mes, fuente, bodega);

CREATE INDEX IF NOT EXISTS idx_reyma_ventas_bodega
  ON reyma_ventas_mensuales(bodega, codigo, anio, mes);
