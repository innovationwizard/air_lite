-- RETIRO DE `/api/compras/reabastecimiento/comercial` — la ruta ya no puede
-- funcionar, y su permiso es lo único que la mantiene alcanzable.
--
-- POR QUÉ SE RETIRA, Y NO SE ARREGLA. Esa ruta era el write-back de forecast
-- comercial de julio (F1), cuando `comercial_forecast` la escribía UN comprador
-- y era append-only. La migración 20260901000006 rehízo la tabla para los seis
-- canales, y desde entonces cada `INSERT` que la ruta puede construir viola el
-- esquema de tres maneras distintas:
--
--   1. `motivo` — validaba contra 'adicional' y 'normal_critica', y el CHECK
--      vigente sólo admite 'extraordinaria', 'temporada' y 'critico'.
--   2. `area` — inserta `area ?? null` contra una columna que ahora es NOT NULL
--      con FK a `comercial_areas`. Su lista de áreas, además, se quedó en
--      cuatro: nunca supo de Zacapa ni de Petén.
--   3. Es un `INSERT` pelado, así que esquiva el índice único
--      (area, month, product_id) del que depende la captura para corregir en
--      vez de duplicar.
--
-- O sea: sólo puede devolver 500. No hay nada en el frontend que la llame —
-- la captura vive en `/api/comercial/forecast` desde el 2026-09-01.
--
-- POR QUÉ IMPORTA HOY. `20260908000001` dejó el permiso en pie para `compras`
-- y `superuser`, así que hoy sigue siendo alcanzable por Wilmer con la
-- credencial que ya tiene. Una ruta viva que sólo falla es peor que una
-- borrada: parece una función del producto.
--
-- Aplicar a mano en el editor SQL (convención de este proyecto). Idempotente.

-- ROLLBACK EXACTO — lo que se borra acá, para poder reponerlo:
--   INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
--     ('compras',   '/api/compras/reabastecimiento/comercial', ARRAY['POST'], 'Commercial-forecast write-back (F1)'),
--     ('superuser', '/api/compras/reabastecimiento/comercial', ARRAY['POST'], 'Commercial-forecast write-back (F1)');
--   (reponer el permiso NO repone la ruta: el handler está borrado del repo.)

DELETE FROM route_permissions
 WHERE route_pattern = '/api/compras/reabastecimiento/comercial';

-- Verificación en la misma transacción: si algo quedó, revienta y no se guarda
-- nada. Un permiso a medio quitar deja la ruta viva para exactamente un rol y
-- nadie sabe cuál.
DO $$
DECLARE
  quedan INT;
BEGIN
  SELECT count(*) INTO quedan FROM route_permissions
   WHERE route_pattern = '/api/compras/reabastecimiento/comercial';
  IF quedan <> 0 THEN
    RAISE EXCEPTION 'Quedaron % permisos sobre la ruta comercial legacy', quedan;
  END IF;
END $$;
