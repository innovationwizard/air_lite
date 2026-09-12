-- CEO y SALES_MANAGER — Compras y Compras Internacionales EN SÓLO LECTURA.
--
-- POR QUÉ (Jorge, 2026-09-11): "Compras read only and Compras internacionales
-- read only. His dedicated page has not been built yet." Luis Roberto entró
-- con rol `ceo` y vio únicamente el Forecast Comercial — ese era el
-- confinamiento de 2026-09-03 (clon de `gerencia`, "fine tune later"). Éste es
-- el ajuste. Mismo día, misma sesión: "Give role sales_manager the exact same
-- access and permissions as role ceo" — así que Raquel entra acá con las
-- mismas filas. La única diferencia que sobrevive a propósito es
-- `/api/comercial/bloqueo` DELETE (Raquel desbloquea; Luis Roberto no —
-- Jorge: "keep the unlock"). Esta migración no toca /api/comercial/*.
--
-- La mitad de páginas vive en código (ROLLOUT_FOCUS, CAN_EDIT_COMPRAS,
-- CAN_EDIT_COMPRAS_INTERNACIONALES, `soloLectura` en las vistas). Ésta es la
-- mitad del API: el middleware consulta esta tabla por método ANTES de que el
-- handler mire ninguna lista, así que sin esto un POST llegaría al handler y
-- dependería sólo del código.
--
-- ⚠️ REVIERTE, sólo para estos dos roles y sólo en LECTURA, la decisión de
-- 20260908000001 ("reabastecimiento-vivo es de Wilmer y de nadie más"): esa
-- migración les borró también el GET, y su verificación exige que no quede
-- fila ajena bajo /api/compras/reabastecimiento%. La decisión del 09-11 es
-- posterior y más precisa — mirar sí, escribir no —, así que la verificación
-- del 09-08 deja de ser cierta y NO debe volver a correrse tal cual.
--
-- TRES PASOS, en orden:
--
--   1. Reparar el renombre a medias de 20260909000002. Esa migración movió
--      `/api/inventarios/…` → `/api/compras-internacionales/…` SÓLO para las
--      filas de `inventario`. Las de admin / gerencia / ceo / sales_manager se
--      quedaron apuntando a rutas que ya no existen — y check_route_access
--      compara por igualdad, así que esos roles reciben 403 en el modelo
--      Reyma y en Darnel/Asia desde el 09-09. Se corrige para TODOS los roles:
--      es el mismo defecto, no tiene sentido arreglarlo sólo para el ceo.
--
--   2. Asegurar los GET que sus páginas llaman (reabastecimiento vivo + su
--      historial, modelo Reyma/Carvajal, reorden Darnel/Asia). Insertar si
--      falta; no tocar si ya está.
--
--   3. Dejar a `ceo` y `sales_manager` en GET puro dentro de /api/compras/* y
--      /api/compras-internacionales/*: la fila que tenía GET se queda con GET;
--      la que sólo escribía se borra. Todo lo demás (comercial, status,
--      bug-reports…) NO se toca.
--
-- Aplicar a mano en el SQL editor. Idempotente.
-- ROLLBACK del paso 3: re-correr 20260903000002 (clona gerencia → ambos).

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · Renombre pendiente de /api/inventarios → /api/compras-internacionales
-- ─────────────────────────────────────────────────────────────────────────────
-- Si el destino ya existe para ese rol (alguien lo insertó a mano), la fila
-- vieja simplemente sobra.
DELETE FROM route_permissions viejo
 WHERE viejo.route_pattern LIKE '/api/inventarios%'
   AND EXISTS (
     SELECT 1 FROM route_permissions nuevo
      WHERE nuevo.role = viejo.role
        AND nuevo.route_pattern = replace(viejo.route_pattern, '/api/inventarios', '/api/compras-internacionales')
   );

UPDATE route_permissions
   SET route_pattern = replace(route_pattern, '/api/inventarios', '/api/compras-internacionales')
 WHERE route_pattern LIKE '/api/inventarios%';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · Lecturas que las páginas de ceo / sales_manager necesitan
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT r.role, v.route_pattern, '{GET}', v.description
FROM unnest(ARRAY['ceo', 'sales_manager']) AS r(role)
CROSS JOIN (VALUES
  ('/api/compras/reabastecimiento',            'Reabastecimiento vivo — lectura'),
  ('/api/compras/reabastecimiento/snapshot',   'Historial de snapshots — lectura'),
  ('/api/compras/reabastecimiento/snapshot/*', 'Un snapshot congelado — re-descarga'),
  ('/api/compras-internacionales/reyma',       'Modelo Reyma / Carvajal en vivo — lectura'),
  ('/api/compras-internacionales/reorden',     'Punto de reorden Darnel / Asia — lectura')
) AS v(route_pattern, description)
ON CONFLICT (role, route_pattern) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · ceo y sales_manager = GET puro en los dos silos
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM route_permissions
 WHERE role IN ('ceo', 'sales_manager')
   AND (route_pattern LIKE '/api/compras/%' OR route_pattern LIKE '/api/compras-internacionales%')
   AND NOT ('GET' = ANY(methods));

UPDATE route_permissions
   SET methods = '{GET}'
 WHERE role IN ('ceo', 'sales_manager')
   AND (route_pattern LIKE '/api/compras/%' OR route_pattern LIKE '/api/compras-internacionales%')
   AND methods <> '{GET}';

-- ─────────────────────────────────────────────────────────────────────────────
-- Verificación en la misma transacción: si algo quedó mal, no se aplica nada.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM route_permissions WHERE route_pattern LIKE '/api/inventarios%';
  IF n > 0 THEN
    RAISE EXCEPTION 'quedan % fila(s) apuntando a /api/inventarios', n;
  END IF;

  SELECT COUNT(*) INTO n FROM route_permissions
   WHERE role IN ('ceo', 'sales_manager')
     AND (route_pattern LIKE '/api/compras/%' OR route_pattern LIKE '/api/compras-internacionales%')
     AND methods <> '{GET}';
  IF n > 0 THEN
    RAISE EXCEPTION 'ceo/sales_manager conservan % grant(s) de escritura en compras', n;
  END IF;

  -- 4 lecturas × 2 roles.
  IF (SELECT COUNT(*) FROM route_permissions
       WHERE role IN ('ceo', 'sales_manager') AND 'GET' = ANY(methods)
         AND route_pattern IN ('/api/compras/reabastecimiento',
                               '/api/compras/reabastecimiento/snapshot',
                               '/api/compras-internacionales/reyma',
                               '/api/compras-internacionales/reorden')) <> 8 THEN
    RAISE EXCEPTION 'a ceo o sales_manager le falta alguna de las 4 lecturas que sus páginas llaman';
  END IF;

  -- Los dos roles quedan iguales bajo los dos silos — es la definición del cambio.
  IF EXISTS (
    SELECT route_pattern, methods FROM route_permissions WHERE role = 'ceo'
       AND (route_pattern LIKE '/api/compras/%' OR route_pattern LIKE '/api/compras-internacionales%')
    EXCEPT
    SELECT route_pattern, methods FROM route_permissions WHERE role = 'sales_manager'
       AND (route_pattern LIKE '/api/compras/%' OR route_pattern LIKE '/api/compras-internacionales%')
  ) OR EXISTS (
    SELECT route_pattern, methods FROM route_permissions WHERE role = 'sales_manager'
       AND (route_pattern LIKE '/api/compras/%' OR route_pattern LIKE '/api/compras-internacionales%')
    EXCEPT
    SELECT route_pattern, methods FROM route_permissions WHERE role = 'ceo'
       AND (route_pattern LIKE '/api/compras/%' OR route_pattern LIKE '/api/compras-internacionales%')
  ) THEN
    RAISE EXCEPTION 'ceo y sales_manager difieren bajo /api/compras* — debían quedar iguales';
  END IF;

  -- Y lo que ya tenían sigue ahí.
  IF (SELECT COUNT(*) FROM route_permissions WHERE role IN ('ceo', 'sales_manager') AND route_pattern = '/api/comercial/forecast') <> 2 THEN
    RAISE EXCEPTION 'ceo o sales_manager perdió /api/comercial/forecast — su aterrizaje';
  END IF;
  -- La única diferencia deliberada entre los dos: Raquel desbloquea.
  IF NOT EXISTS (SELECT 1 FROM route_permissions WHERE role = 'sales_manager' AND route_pattern = '/api/comercial/bloqueo' AND 'DELETE' = ANY(methods)) THEN
    RAISE EXCEPTION 'sales_manager perdió el DELETE de /api/comercial/bloqueo — debía conservarlo';
  END IF;
END $$;

COMMIT;

-- Para mirar el resultado:
--   SELECT role, route_pattern, methods FROM route_permissions
--    WHERE role IN ('ceo', 'sales_manager') ORDER BY 2, 1;
