-- Align route_permissions with the handlers.
--
-- Applied files are left as they are. This migration is the current grant set:
--   * GET /api/status is only gerencia and project_manager (superuser bypasses).
--   * admin no longer matches /api/admin/ml-health through /api/admin/*.
--   * /api/gerencia/* is replaced by the one route that still exists,
--     /api/gerencia/gap-report. /api/gerencia/validacion is gone.
--   * Grants for routes with no route.ts are revoked.

DELETE FROM route_permissions
 WHERE route_pattern = '/api/status'
   AND role NOT IN ('gerencia', 'project_manager', 'superuser');

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('admin', '/api/admin/users', '{GET,POST,DELETE}', 'User management'),
  ('admin', '/api/admin/data-status', '{GET}', 'Data status')
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;

DELETE FROM route_permissions
 WHERE role = 'admin' AND route_pattern = '/api/admin/*';

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT role, '/api/gerencia/gap-report', methods, 'Auditoría de discrepancias'
FROM route_permissions
WHERE route_pattern = '/api/gerencia/*'
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;

DELETE FROM route_permissions WHERE route_pattern = '/api/gerencia/*';

DELETE FROM route_permissions
 WHERE route_pattern IN (
   '/api/compras-internacionales/modelos',
   '/api/compras/reabastecimiento/destino',
   '/api/compras/reabastecimiento/pendiente'
 );
