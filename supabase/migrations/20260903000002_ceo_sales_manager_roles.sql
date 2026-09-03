-- Dos roles nuevos: `ceo` (Luis Roberto Cerezo) y `sales_manager` (Raquel
-- López), para que dejen de compartir el login demo `gerencia@airefill.app` y
-- tengan cuenta propia.
--
-- Jorge, verbatim: "make them clones of gerencia to begin with, and we fine
-- tune later" — así que este archivo no inventa una matriz de permisos nueva,
-- COPIA exactamente las filas de `gerencia` en `route_permissions`. El resto
-- de la RBAC (arrays en frontend/src/lib/auth/roles.ts: CAN_VIEW_*,
-- ROLLOUT_FOCUS, ROLE_LABELS) se clonó en el mismo commit.
--
-- Por qué son roles nuevos y no dos filas de `user_profiles` con role
-- 'gerencia': porque la petición explícita fue tener cuentas — y por lo tanto
-- roles — propios, para poder afinar el acceso de cada uno por separado más
-- adelante sin arrastrar al otro ni al resto de `gerencia`.
--
-- Aplicada con `supabase db push`. Idempotente — se puede correr de nuevo si
-- `gerencia` gana una fila de route_permissions después de esta fecha y hay
-- que resincronizar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · EXTENDER EL CHECK CONSTRAINT DE user_profiles.role
-- ─────────────────────────────────────────────────────────────────────────────
-- Mismo patrón que cada rol agregado antes (20260323000002, 20260422000002,
-- 20260901000002): el constraint es una lista literal, así que un rol nuevo
-- SIEMPRE pasa por este drop+add. Sin esto, `user_profiles` rechaza toda fila
-- con role='ceo' o role='sales_manager' — es justo el error que paró la
-- creación de estas dos cuentas en producción.

ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario',
                   'financiero', 'testuser', 'operaciones', 'project_manager',
                   'ceo', 'sales_manager'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · CLONAR LOS PERMISOS DE RUTA DE gerencia
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT 'ceo', route_pattern, methods, description
FROM route_permissions WHERE role = 'gerencia'
UNION ALL
SELECT 'sales_manager', route_pattern, methods, description
FROM route_permissions WHERE role = 'gerencia'
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;
