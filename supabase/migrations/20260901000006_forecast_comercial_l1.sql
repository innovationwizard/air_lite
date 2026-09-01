-- FORECAST COMERCIAL — nivel 1: que las áreas puedan cargar, y que compras vea
-- el consolidado sin descargar ni pegar nada.
--
-- LA FECHA, que no la puso nadie de este proyecto: el ciclo del cliente cierra
-- captura el 2º VIERNES y se reúne el 3er MIÉRCOLES. En septiembre de 2026 eso
-- es el 11 y el 16. Si la captura no está abierta antes del 11, el módulo se
-- pierde el ciclo entero y la próxima oportunidad es octubre — justo el mes que
-- el pedido original quería cubrir.
--
-- QUÉ ARREGLA ESTA MIGRACIÓN SOBRE LA TABLA QUE YA EXISTÍA. `comercial_forecast`
-- se creó el 2026-07-24 y nunca recibió una fila, porque nunca hubo interfaz.
-- Al volver sobre ella con la especificación acordada aparecen tres desajustes:
--
--   1. `motivo` admitía DOS valores ('adicional', 'normal_critica') y la
--      especificación tiene TRES, y la diferencia entre ellos no es cosmética:
--      la EXTRAORDINARIA suma directo al pedido porque es certeza con
--      destinatario, mientras TEMPORADA y CRÍTICO son proyección del canal y
--      sólo se revisan si su suma supera la proyección de compras. Fundir los
--      dos últimos borra exactamente la distinción que hace funcionar la
--      reunión mensual.
--   2. No había forma de saber QUÉ ÁREA escribió una fila más allá de un texto
--      libre, ni de impedir que un área escribiera por otra.
--   3. Nada impedía duplicar el mismo código dos veces en el mismo mes, que es
--      el error más probable de una captura hecha a mano contra reloj.
--
-- La tabla tiene CERO filas, así que se corrige en su forma final en vez de
-- arrastrar compatibilidad con datos que no existen.
--
-- Aplicada con `supabase db push`. Idempotente.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · LAS ÁREAS COMERCIALES SON DATOS, NO UN ENUM
-- ─────────────────────────────────────────────────────────────────────────────
-- Deliberado: el cliente ya anunció que la cadena de bodegas se extiende, y los
-- canales comerciales se reorganizan con la misma facilidad. Un canal nuevo no
-- debería necesitar una migración ni un despliegue.

CREATE TABLE IF NOT EXISTS comercial_areas (
  slug        VARCHAR(40) PRIMARY KEY,
  nombre      VARCHAR(80) NOT NULL,
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO comercial_areas (slug, nombre) VALUES
  ('mayoreo',       'Mayoreo'),
  ('institucional', 'Institucional'),
  ('supermercados', 'Supermercados'),
  ('tiendas',       'Tiendas')
ON CONFLICT (slug) DO NOTHING;

-- A qué área pertenece cada jefe de canal. Vive en el perfil porque es parte de
-- quién es el usuario, igual que su rol. NULL para todos los que no capturan.
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS area VARCHAR(40) REFERENCES comercial_areas(slug);

COMMENT ON COLUMN user_profiles.area IS
  'Canal comercial del jefe de area (rol ventas). Determina que filas puede escribir.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · LOS TRES MOTIVOS, Y POR QUÉ IMPORTAN
-- ─────────────────────────────────────────────────────────────────────────────
--   extraordinaria — certeza con destinatario. SUMA DIRECTO al pedido.
--   temporada      — proyección del canal.  ┐ se revisan en la reunión sólo si
--   critico        — faltante o crítico.    ┘ su suma supera la proyección.

ALTER TABLE comercial_forecast DROP CONSTRAINT IF EXISTS comercial_forecast_motivo_check;
ALTER TABLE comercial_forecast ADD CONSTRAINT comercial_forecast_motivo_check
  CHECK (motivo IN ('extraordinaria', 'temporada', 'critico'));

-- `area` deja de ser texto libre y pasa a ser una referencia real.
ALTER TABLE comercial_forecast
  ALTER COLUMN area SET NOT NULL;
ALTER TABLE comercial_forecast DROP CONSTRAINT IF EXISTS comercial_forecast_area_fkey;
ALTER TABLE comercial_forecast
  ADD CONSTRAINT comercial_forecast_area_fkey
  FOREIGN KEY (area) REFERENCES comercial_areas(slug);

-- Un código aparece UNA vez por área y por mes. Volver a cargarlo corrige la
-- cantidad en lugar de sumar una fila nueva: en una captura contra reloj, el
-- duplicado silencioso es el error más caro, porque infla el pedido sin que
-- nadie lo note hasta que llega de más.
CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_forecast_area_mes_producto
  ON comercial_forecast (area, month, product_id);

-- La consulta del consolidado: todo lo de un mes, por área.
CREATE INDEX IF NOT EXISTS idx_comercial_forecast_month_area
  ON comercial_forecast (month, area);

COMMENT ON TABLE comercial_forecast IS
  'Forecast comercial por area (nivel 1): codigo, cantidad, motivo, mes. '
  'Una fila por (area, mes, producto). Tope de 50 codigos por area y mes y '
  'horizonte de 3 meses se validan en la API.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · PERMISOS DE RUTA
-- ─────────────────────────────────────────────────────────────────────────────
-- `ventas` escribe SÓLO su área (lo comprueba el handler contra
-- `user_profiles.area`); compras y gerencia leen el consolidado y no escriben.

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('ventas',    '/api/comercial/forecast', '{GET,PUT,DELETE}', 'Captura del forecast comercial del area propia'),
  ('compras',   '/api/comercial/forecast', '{GET}',            'Consolidado del forecast comercial'),
  ('gerencia',  '/api/comercial/forecast', '{GET}',            'Consolidado del forecast comercial'),
  ('admin',     '/api/comercial/forecast', '{GET,PUT,DELETE}', 'Forecast comercial'),
  ('operaciones','/api/comercial/forecast','{GET}',            'Consolidado del forecast comercial')
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;

-- El catálogo de productos alimenta el buscador de códigos de la pantalla.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT r, '/api/comercial/productos', '{GET}', 'Catalogo de codigos para el buscador'
FROM unnest(ARRAY['ventas','compras','gerencia','admin','operaciones']) AS r
ON CONFLICT (role, route_pattern) DO NOTHING;
