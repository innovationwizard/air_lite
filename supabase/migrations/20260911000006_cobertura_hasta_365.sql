-- COBERTURA DEL SUGERIDO: el tope sube de 120 a 365 días.
--
-- WILMER, verbatim (2026-09-11), al pedir que el horizonte se digite y no se
-- elija de un menú:
--   «necesito enviar orden de compra a este proveedor que tienen un lead time
--    de 35 días, entonces entiendo debería colocar sugerido 65 por mi lead time»
--
-- Su horizonte es una SUMA — cobertura + lead time del proveedor — y el tope de
-- 120 de la migración 20260821000006 fue un límite de cordura elegido cuando el
-- valor sólo podía ser 15 ó 30. Con lead times de importación de 90 a 120 días
-- (Reyma, Compras Internacionales) la suma pasa de 120 en el caso normal, no en
-- el raro. 365 sigue siendo cordura: un año de demanda es el máximo que un
-- pedido puede querer cubrir; más que eso es un error de tecleo.
--
-- El mismo tope vive en `frontend/src/lib/compras/cobertura.ts`
-- (COBERTURA_MAX_DIAS = 365): el input, la ruta POST /cobertura y esta CHECK
-- tienen que decir el mismo número. Cambiar uno sin el otro deja un valor que
-- la pantalla acepta y la base rechaza, o al revés.
--
-- Sólo el tope cambia. Ni el mínimo (1), ni el default del motor (30), ni las
-- filas existentes (todas ≤ 45) se tocan.
--
-- Idempotente: se puede aplicar a mano en el editor SQL y volver a correr.
-- El nombre del constraint es el que Postgres asigna a un CHECK de columna
-- (`<tabla>_<columna>_check`).

ALTER TABLE bodega_cobertura
  DROP CONSTRAINT IF EXISTS bodega_cobertura_dias_check;

ALTER TABLE bodega_cobertura
  ADD CONSTRAINT bodega_cobertura_dias_check CHECK (dias BETWEEN 1 AND 365);

COMMENT ON TABLE bodega_cobertura IS
  'Días que debe cubrir el Sugerido, por bodega. Append-only, la última fila por '
  'bodega manda; sin fila = 30 días (default del motor). Pedido de Wilmer '
  '2026-08-21: Zacapa y Petén a 15 días. Desde 2026-09-11 se digita cualquier '
  'entero 1–365 (cobertura + lead time del proveedor). No afecta DOH ni la '
  'ventana de proyección.';
