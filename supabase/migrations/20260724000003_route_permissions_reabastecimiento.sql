-- Route permissions for the live-Odoo reabastecimiento endpoint.
--
-- The auth-hardening rollout enforces per-route access via check_route_access
-- (route_permissions table, role x route_pattern x methods). Superuser bypasses
-- all checks (no entry needed). check_route_access matches patterns with a LIKE
-- rewrite where '*' -> '%'; an EXACT path is NOT matched by a '/*' glob, so each
-- concrete route is listed explicitly.
--
-- Grants mirror CAN_VIEW_COMPRAS (roles.ts): superuser (bypass) + admin +
-- gerencia + compras. Routes:
--   GET  /api/compras/reabastecimiento            -- the live replenishment view
--   POST /api/compras/reabastecimiento/comercial  -- commercial-forecast write-back (F1)
--   POST /api/compras/reabastecimiento/transito   -- manual tránsito override (Carvajal fallback)
--
-- NOTE (B5.3, pending): the commercial-forecast POST may later be opened to
-- area-leader roles (ventas / institucional) once those roles are defined —
-- add rows here at that point. For now only the compras-silo roles can write.
--
-- Applied to prod via the Supabase SQL editor; this file is the source-of-truth
-- record. Idempotent.

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('compras',  '/api/compras/reabastecimiento',           '{GET}',
   'Live reabastecimiento view (Wilmer)'),
  ('gerencia', '/api/compras/reabastecimiento',           '{GET}',
   'Live reabastecimiento view'),
  ('admin',    '/api/compras/reabastecimiento',           '{GET}',
   'Live reabastecimiento view'),

  ('compras',  '/api/compras/reabastecimiento/comercial', '{POST}',
   'Commercial-forecast write-back (F1)'),
  ('gerencia', '/api/compras/reabastecimiento/comercial', '{POST}',
   'Commercial-forecast write-back (F1)'),
  ('admin',    '/api/compras/reabastecimiento/comercial', '{POST}',
   'Commercial-forecast write-back (F1)'),

  ('compras',  '/api/compras/reabastecimiento/transito',  '{POST}',
   'Manual tránsito override (Carvajal fallback)'),
  ('gerencia', '/api/compras/reabastecimiento/transito',  '{POST}',
   'Manual tránsito override (Carvajal fallback)'),
  ('admin',    '/api/compras/reabastecimiento/transito',  '{POST}',
   'Manual tránsito override (Carvajal fallback)')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods     = EXCLUDED.methods,
  description = EXCLUDED.description;
