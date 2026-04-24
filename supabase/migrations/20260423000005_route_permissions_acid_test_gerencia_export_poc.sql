-- ============================================================================
-- Seed route_permissions for the 4 patterns missing from the original matrix:
--   /api/acid-test/*   (new today, for gap-report)
--   /api/gerencia/*    (pre-existing but never permissioned)
--   /api/export/*      (pre-existing but never permissioned)
--   /api/poc/*         (pre-existing but never permissioned)
--
-- Per user direction (2026-04-23): grant to superuser, admin, gerencia for
-- all four patterns. All methods (GET, POST, PUT, DELETE) granted to all
-- three roles — same future-proofing pattern as /api/admin/* and /api/oa/*.
--
-- Note on superuser: isAuthorized() in lib/auth/roles.ts bypasses the
-- allowedRoles list for superuser anyway, so the superuser rows are
-- technically redundant. Including them per explicit user direction for
-- self-documenting intent in the DB.
--
-- Idempotent: ON CONFLICT (role, route_pattern) DO UPDATE.
-- ============================================================================

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('superuser', '/api/acid-test/*', '{GET,POST,PUT,DELETE}',
   'Acid-test reports: gap-report and future spot-check tools'),
  ('admin',     '/api/acid-test/*', '{GET,POST,PUT,DELETE}',
   'Acid-test reports: gap-report and future spot-check tools'),
  ('gerencia',  '/api/acid-test/*', '{GET,POST,PUT,DELETE}',
   'Acid-test reports: gap-report and future spot-check tools'),

  ('superuser', '/api/gerencia/*', '{GET,POST,PUT,DELETE}',
   'Gerencia validation surfaces (validacion, future CEO dashboards)'),
  ('admin',     '/api/gerencia/*', '{GET,POST,PUT,DELETE}',
   'Gerencia validation surfaces (validacion, future CEO dashboards)'),
  ('gerencia',  '/api/gerencia/*', '{GET,POST,PUT,DELETE}',
   'Gerencia validation surfaces (validacion, future CEO dashboards)'),

  ('superuser', '/api/export/*', '{GET,POST,PUT,DELETE}',
   'Data exports (CSV, XLSX) for reporting'),
  ('admin',     '/api/export/*', '{GET,POST,PUT,DELETE}',
   'Data exports (CSV, XLSX) for reporting'),
  ('gerencia',  '/api/export/*', '{GET,POST,PUT,DELETE}',
   'Data exports (CSV, XLSX) for reporting'),

  ('superuser', '/api/poc/*', '{GET,POST,PUT,DELETE}',
   'POC surfaces (purchase-schedule and any future proof-of-concept tools)'),
  ('admin',     '/api/poc/*', '{GET,POST,PUT,DELETE}',
   'POC surfaces (purchase-schedule and any future proof-of-concept tools)'),
  ('gerencia',  '/api/poc/*', '{GET,POST,PUT,DELETE}',
   'POC surfaces (purchase-schedule and any future proof-of-concept tools)')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods = EXCLUDED.methods,
  description = EXCLUDED.description;
