-- ============================================================================
-- Add 'project_manager' role — el PM del cliente, dueño del plan de /status
-- ============================================================================
-- Roles after this migration:
--   superuser, admin, gerencia, compras, ventas, inventario, financiero,
--   testuser, operaciones, project_manager
--
-- POR QUÉ UN ROL Y NO REUSAR 'compras'. El PM del cliente entra hoy con una
-- credencial de rol `compras` — la misma familia de rol que el comprador. Si
-- la escritura del plan se autorizara por ese rol, el comprador quedaría con
-- autoridad para mover fechas y prioridades del proyecto que lo mide a él.
-- No es hipotético: es la misma clase de confusión de identidad que ya se
-- registró cuando un segundo usuario entraba con credencial ajena y sus
-- reportes se atribuían a otra persona.
--
-- ALCANCE DELIBERADAMENTE MÍNIMO. Este rol NO hereda los silos de compras ni
-- de inventarios. Ve /status y escribe el plan; nada más. Si después se decide
-- que deba ver esas pantallas, es otra decisión y otra migración — un rol
-- nuevo es barato, un rol que acumuló permisos por inercia no.
--
-- EL REPARTO QUE ESTE ROL IMPLEMENTA:
--   * el ESTADO (¿está hecho?) lo juzga quien construyó, vía TSV versionado
--     y `scripts/sync_status.py`. NO hay ruta que permita a este rol tocarlo.
--   * el PLAN (¿cuándo?) lo escribe este rol, en `status_plan`.
-- Ver la cabecera de `20260901000001_status_gap_analysis.sql`.
--
-- ⚠️ ESTA MIGRACIÓN NO CREA LA CUENTA. Crea el rol y sus permisos. El alta del
-- usuario y la entrega de la credencial son un paso humano aparte, y sin él el
-- rol existe y no lo tiene nadie.
--
-- Aplicada con `supabase db push`. Idempotente.
-- ============================================================================

-- Step 1: Extend the role CHECK constraint
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero', 'testuser', 'operaciones', 'project_manager'));

-- Step 2: Grant route permissions
--   El gap analysis se LEE por todos los roles (ver la migración hermana), pero
--   `status/plan` en escritura es exclusivo de este rol y de superuser.
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('project_manager', '/api/status',         '{GET}',       'Gap analysis — lectura'),
  ('project_manager', '/api/status/plan',    '{GET,PATCH}', 'Plan: orden de prioridad, fechas y notas'),
  ('project_manager', '/api/status/export',  '{GET}',       'Exportación del gap analysis a xlsx')
ON CONFLICT (role, route_pattern) DO NOTHING;

-- Step 3: /api/status en lectura para todos los demás roles operativos.
--   `superuser` no se lista: pasa por encima de check_route_access.
INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT r, '/api/status', '{GET}', 'Gap analysis — lectura'
FROM unnest(ARRAY['admin','gerencia','compras','ventas','inventario','financiero','testuser','operaciones']) AS r
ON CONFLICT (role, route_pattern) DO NOTHING;

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT r, '/api/status/export', '{GET}', 'Exportación del gap analysis a xlsx'
FROM unnest(ARRAY['admin','gerencia','compras','ventas','inventario','financiero','testuser','operaciones']) AS r
ON CONFLICT (role, route_pattern) DO NOTHING;
