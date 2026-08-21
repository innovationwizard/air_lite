-- SEPARAR ZACAPA DE PETÉN — W11 / B4.7.
--
-- PEDIDO (Wilmer, llamada 2026-08-20, verbatim):
--   «yo tengo que abastecer a Zacapa, pero Zacapa me debe de dar la venta de
--    ambos, pero separada y sumada»
--   «vende 150 Petén y Zacapa 50. Entonces, yo en el medio voy a mandar 200.
--    Pero Zacapa me dice, ¿por qué me estás mandando 200? Yo solo 50»
--
-- LA CADENA: San José Villanueva (central) → Zacapa → Petén. «Es una cadenita».
-- Zacapa guarda físicamente stock que NO es suyo: el de Petén va de paso. Por
-- eso la cifra fusionada es justo el número que Zacapa le discute, y la app
-- hasta hoy sólo podía darle esa.
--
-- POR QUÉ ESTABAN FUSIONADAS: se replicó la columna «Exist Z&P Ubicación» del
-- xlsx de Wilmer, que viene fusionada. Pero su Excel de trabajo las tiene
-- SEPARADAS y además sumadas — la fusión era del reporte, no de su operación.
--
-- DISPARADOR INMEDIATO (2026-08-21): la plantilla de Carvajal que Wilmer llena
-- a mano tiene TRES columnas de bodega — `San Jose | Petén | Zacapa` — así que
-- el archivo no se puede generar sin este corte.
--
-- CÓMO: `bodega_map` es la única fuente de bodegas del sync (stock, velocidad y
-- facturado la leen de aquí), así que basta reasignar estas dos filas. La
-- siguiente corrida escribe filas 'Petén' y 'Zacapa', y la purga por `as_of`
-- borra sola las viejas 'Zacapa-Petén' (no las toca ninguna corrida nueva).
--
-- SEGURIDAD DEL CAMBIO, medido 2026-08-21 antes de aplicar:
--   * capturas manuales que quedarían huérfanas por cambiar el nombre de
--     bodega: NINGUNA — transito_overrides (5) y pending_reserve_overrides (5)
--     están todas en 'San Jose VN'; comercial_forecast está vacía.
--   * el diario de facturas ya distingue los dos CD ('facturas cd zacapa' →
--     4ZAC, 'facturas cd peten' → 3PET), así que el facturado se separa solo.
--
-- ⚠️ LO QUE ESTO **NO** HACE: la mitad «sumada» del pedido de Wilmer. Él quiere
-- ver las dos por separado Y el total que debe llegar a Zacapa. Aquí sólo se
-- separan. En el archivo de Carvajal la suma la da la columna `Total`; una
-- vista combinada en pantalla queda pendiente en B4.7.
--
-- Aplicada con `supabase db push`. Idempotente.

UPDATE bodega_map
   SET bodega = 'Petén',
       note   = 'Separada de Zacapa el 2026-08-21 (W11). Antes ambas caían en '
                '''Zacapa-Petén'', réplica de la columna fusionada del xlsx. '
                'Wilmer: "Zacapa me debe de dar la venta de ambos, pero separada '
                'y sumada". Petén se abastece DESDE Zacapa.'
 WHERE odoo_warehouse_code = '3PET';

UPDATE bodega_map
   SET bodega = 'Zacapa',
       note   = 'Separada de Petén el 2026-08-21 (W11). Zacapa se abastece desde '
                'San José Villanueva y a su vez abastece a Petén, así que guarda '
                'stock que no es suyo — el motivo por el que la cifra fusionada '
                'no le servía a Wilmer para responderle a la bodega.'
 WHERE odoo_warehouse_code = '4ZAC';
