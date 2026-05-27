-- Restore /api/forecast access for the roles that have forecast UI pages.
--
-- Regression context: the auth-hardening rollout (Phase 1 per
-- docs/security/PLAN_API_AUTH_DEFENSE_IN_DEPTH.md) added per-route
-- enforcement via check_route_access in middleware. /api/forecast was
-- never granted to the gerencia or compras roles, so calls from
-- /gerencia/forecast and /compras/forecast return 403 "No autorizado".
-- The frontend pages coalesce the error to an empty array
-- (`feb.forecasts ?? []`), silently rendering zero rows. Confirmed
-- working as of May 5, broken May 27 — diagnosed via DevTools network tab.
--
-- Two patterns per role required because /api/forecast (exact path) is
-- NOT matched by /api/forecast/* glob (the LIKE rewrite in check_route_access
-- produces '/api/forecast/%' which requires a trailing segment).
-- Sub-routes covered by the glob: /api/forecast/purchase-history (called
-- by both gerencia/forecast and compras/forecast pages).
--
-- Superuser bypasses all checks via check_route_access (no entry needed).

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('admin',    '/api/forecast',   '{GET,POST,PUT,DELETE}',
   'Forecast results — full admin access'),
  ('admin',    '/api/forecast/*', '{GET,POST,PUT,DELETE}',
   'Forecast sub-routes (purchase-history, run) — full admin access'),

  ('gerencia', '/api/forecast',   '{GET}',
   'Forecast a Ciegas page — read-only access to forecast_results'),
  ('gerencia', '/api/forecast/*', '{GET}',
   'Forecast a Ciegas sub-routes (purchase-history) — read-only'),

  ('compras',  '/api/forecast',   '{GET}',
   'Compras Forecast page — read-only access to forecast_results'),
  ('compras',  '/api/forecast/*', '{GET}',
   'Compras Forecast sub-routes (purchase-history) — read-only')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods = EXCLUDED.methods,
  description = EXCLUDED.description;
