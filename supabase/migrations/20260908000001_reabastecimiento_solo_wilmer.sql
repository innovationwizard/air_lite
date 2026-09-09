-- REABASTECIMIENTO-VIVO ES DE WILMER Y DE NADIE MÁS.
--
-- Decisión del cliente (Jorge, 2026-09-08), aplicada acá a los permisos que
-- todavía no la reflejaban. La página se construyó para reemplazar el Excel de
-- Wilmer: las capturas que se hacen ahí —tránsito, pendiente de tomar reserva,
-- destino final, el pedido de bodega, el horizonte del Sugerido— son SUS
-- decisiones de compra, y cada una mueve el Sugerido. Que otro rol pueda
-- escribirlas significa que el número que él defiende puede cambiar sin que él
-- lo sepa, y eso es exactamente lo que la página existe para evitar.
--
-- LO QUE SE ENCONTRÓ (medido 2026-09-08, sobre producción):
-- siete patrones de esta página tenían 33 filas en `route_permissions`; sólo 7
-- eran de `compras`. Las otras 26 le daban lectura Y escritura a admin, ceo,
-- gerencia y sales_manager. Las rutas nuevas (`/snapshot`, `/snapshot/*`,
-- `/compras/proveedor-grupos`) ya estaban bien: nacieron después de la
-- decisión. Las viejas son de antes y nadie volvió a mirarlas.
--
-- QUIÉN PIERDE ACCESO DE VERDAD — tres personas, medido, no estimado:
--   Luis Roberto Cerezo (ceo) · Luis Roberto (gerencia) · Raquel Lopez (sales_manager)
-- ⚠️ La pérdida NO es elegante: `/api/compras/reabastecimiento` (GET) es la que
-- carga la página. Para ellos deja de cargar, sin mensaje que lo explique.
-- Avisarles ANTES de aplicar esto no es cortesía, es parte del cambio.
--
-- `admin` sale también, y no le quita acceso a nadie: no existe ni un solo
-- usuario con rol `admin` (verificado 2026-09-08, tabla user_profiles).
-- Las filas estaban concediéndole permiso a un conjunto vacío de personas.
--
-- SE CONSERVA EL ACCESO DE EMERGENCIA: `check_route_access` (20260323000002)
-- corta antes de mirar esta tabla — `IF v_role = 'superuser' THEN RETURN true`.
-- El superusuario entra igual, así que nadie queda encerrado fuera del sistema.
-- Por eso el DELETE excluye 'superuser' explícitamente en vez de borrar todo lo
-- que no sea 'compras': si algún día se agrega una fila de superusuario acá,
-- esta migración no debe ser la que la borre.
--
-- IDEMPOTENTE: un DELETE que ya corrió no borra nada la segunda vez, y la
-- verificación de abajo sigue pasando porque comprueba el ESTADO FINAL (no
-- quedan filas ajenas), no cuántas filas se borraron.
--
-- ⚠️ NO TOCA `/snapshot` NI `/snapshot/*`: ya son de `compras` (+ superuser).
--
-- ROLLBACK EXACTO — el estado de producción al 2026-09-08, tal cual se leyó.
-- Para revertir: INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
--   ('admin', '/api/compras/reabastecimiento', ARRAY['GET'], 'Live reabastecimiento view'),
--   ('ceo', '/api/compras/reabastecimiento', ARRAY['GET'], 'Live reabastecimiento view'),
--   ('gerencia', '/api/compras/reabastecimiento', ARRAY['GET'], 'Live reabastecimiento view'),
--   ('sales_manager', '/api/compras/reabastecimiento', ARRAY['GET'], 'Live reabastecimiento view'),
--   ('admin', '/api/compras/reabastecimiento/cobertura', ARRAY['POST'], 'Horizonte de cobertura del Sugerido (días), por bodega'),
--   ('gerencia', '/api/compras/reabastecimiento/cobertura', ARRAY['POST'], 'Horizonte de cobertura del Sugerido (días), por bodega'),
--   ('admin', '/api/compras/reabastecimiento/comercial', ARRAY['POST'], 'Commercial-forecast write-back (F1)'),
--   ('ceo', '/api/compras/reabastecimiento/comercial', ARRAY['POST'], 'Commercial-forecast write-back (F1)'),
--   ('gerencia', '/api/compras/reabastecimiento/comercial', ARRAY['POST'], 'Commercial-forecast write-back (F1)'),
--   ('sales_manager', '/api/compras/reabastecimiento/comercial', ARRAY['POST'], 'Commercial-forecast write-back (F1)'),
--   ('admin', '/api/compras/reabastecimiento/destino', ARRAY['POST'], 'Destino final del tránsito declarado a mano (W15-A, sonda temporal)'),
--   ('ceo', '/api/compras/reabastecimiento/destino', ARRAY['POST'], 'Destino final del tránsito declarado a mano (W15-A, sonda temporal)'),
--   ('gerencia', '/api/compras/reabastecimiento/destino', ARRAY['POST'], 'Destino final del tránsito declarado a mano (W15-A, sonda temporal)'),
--   ('sales_manager', '/api/compras/reabastecimiento/destino', ARRAY['POST'], 'Destino final del tránsito declarado a mano (W15-A, sonda temporal)'),
--   ('admin', '/api/compras/reabastecimiento/pendiente', ARRAY['POST'], 'Manual pendiente-de-tomar-reserva entry (no system source)'),
--   ('ceo', '/api/compras/reabastecimiento/pendiente', ARRAY['POST'], 'Manual pendiente-de-tomar-reserva entry (no system source)'),
--   ('gerencia', '/api/compras/reabastecimiento/pendiente', ARRAY['POST'], 'Manual pendiente-de-tomar-reserva entry (no system source)'),
--   ('sales_manager', '/api/compras/reabastecimiento/pendiente', ARRAY['POST'], 'Manual pendiente-de-tomar-reserva entry (no system source)'),
--   ('admin', '/api/compras/reabastecimiento/sugerido-bodega', ARRAY['POST'], 'Sugerido adicional que pide el encargado del CD (A4.17)'),
--   ('ceo', '/api/compras/reabastecimiento/sugerido-bodega', ARRAY['POST'], 'Sugerido adicional que pide el encargado del CD (A4.17)'),
--   ('gerencia', '/api/compras/reabastecimiento/sugerido-bodega', ARRAY['POST'], 'Sugerido adicional que pide el encargado del CD (A4.17)'),
--   ('sales_manager', '/api/compras/reabastecimiento/sugerido-bodega', ARRAY['POST'], 'Sugerido adicional que pide el encargado del CD (A4.17)'),
--   ('admin', '/api/compras/reabastecimiento/transito', ARRAY['POST'], 'Manual tránsito override (Carvajal fallback)'),
--   ('ceo', '/api/compras/reabastecimiento/transito', ARRAY['POST'], 'Manual tránsito override (Carvajal fallback)'),
--   ('gerencia', '/api/compras/reabastecimiento/transito', ARRAY['POST'], 'Manual tránsito override (Carvajal fallback)'),
--   ('sales_manager', '/api/compras/reabastecimiento/transito', ARRAY['POST'], 'Manual tránsito override (Carvajal fallback)');
DELETE FROM route_permissions
 WHERE route_pattern IN (
   '/api/compras/reabastecimiento',
   '/api/compras/reabastecimiento/cobertura',
   '/api/compras/reabastecimiento/comercial',
   '/api/compras/reabastecimiento/destino',
   '/api/compras/reabastecimiento/pendiente',
   '/api/compras/reabastecimiento/sugerido-bodega',
   '/api/compras/reabastecimiento/transito'
 )
   AND role NOT IN ('compras', 'superuser');

-- Verificación en la misma transacción: si algo quedó fuera de sitio, esto
-- revienta y no se guarda nada. Un permiso a medio quitar es peor que uno
-- entero: deja media página funcionando y nadie sabe cuál mitad.
DO $$
DECLARE
  ajenas INT;
  propias INT;
BEGIN
  SELECT count(*) INTO ajenas FROM route_permissions
   WHERE route_pattern LIKE '/api/compras/reabastecimiento%'
     AND role NOT IN ('compras', 'superuser');
  IF ajenas > 0 THEN
    RAISE EXCEPTION 'Quedaron % filas de otros roles en reabastecimiento', ajenas;
  END IF;

  -- Y que no nos hayamos llevado por delante a Wilmer, que es el punto entero.
  SELECT count(*) INTO propias FROM route_permissions
   WHERE route_pattern LIKE '/api/compras/reabastecimiento%'
     AND role = 'compras';
  IF propias < 9 THEN
    RAISE EXCEPTION 'Wilmer quedó con % permisos; se esperaban al menos 9', propias;
  END IF;
END $$;
