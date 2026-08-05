-- Route permissions for the live-Odoo Reyma endpoint (Alexis / Inventarios).
--
-- Same defense-in-depth pattern as 20260724000003: middleware
-- check_route_access (route_permissions) + in-handler requireAuth
-- (CAN_VIEW_INVENTARIOS). Superuser bypasses all checks (no entry needed).
-- Grants mirror CAN_VIEW_INVENTARIOS (roles.ts): superuser (bypass) + admin +
-- gerencia + inventario.
--
-- Applied via `supabase db push` (CLI bookkeeping repaired 2026-08-05).
-- Idempotent.

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('inventario', '/api/inventarios/reyma', '{GET}',
   'Live Reyma model view (Alexis)'),
  ('gerencia',   '/api/inventarios/reyma', '{GET}',
   'Live Reyma model view'),
  ('admin',      '/api/inventarios/reyma', '{GET}',
   'Live Reyma model view')
ON CONFLICT DO NOTHING;
