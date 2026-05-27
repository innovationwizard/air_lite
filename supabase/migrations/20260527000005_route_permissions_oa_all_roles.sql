-- Grant /api/oa/* to all roles in CAN_VIEW_OA except operaciones (who
-- already has it via 20260422000003_operaciones_user_profile.sql) and
-- superuser (bypasses check_route_access).
--
-- Rationale: the OA module pages (espacio-bodega, excepciones, plan-maestro,
-- cumplimiento, dashboard-proveedor, extraordinarios, recepcion,
-- reporte-proveedor, configuracion) are visible to 7 roles per the
-- frontend's CAN_VIEW_OA array, but until now only the operaciones role
-- could actually call /api/oa/*. The sidebar navigation to these pages is
-- currently commented out (Sidebar.tsx, 2026-05-27), so they are reachable
-- only by direct URL — but during a demo, pasting a URL like
-- /oa/espacio-bodega from any of these roles should not silently 403.
--
-- Methods: {GET,POST,PUT,DELETE} to match the existing operaciones grant.
-- Some OA pages do POST (e.g., recalc-unload, warehouse config updates).
-- Roles that only need read access still get write because the OA module
-- treats its endpoints as a single permission unit (per the original
-- operaciones grant pattern).

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('admin',      '/api/oa/*', '{GET,POST,PUT,DELETE}',
   'Open Orders module — full access (admin tier)'),
  ('gerencia',   '/api/oa/*', '{GET,POST,PUT,DELETE}',
   'Open Orders module — gerencia oversight via direct URL (sidebar nav hidden 2026-05-27)'),
  ('compras',    '/api/oa/*', '{GET,POST,PUT,DELETE}',
   'Open Orders module — compras context via direct URL (sidebar nav hidden 2026-05-27)'),
  ('inventario', '/api/oa/*', '{GET,POST,PUT,DELETE}',
   'Open Orders module — inventario context via direct URL (sidebar nav hidden 2026-05-27)'),
  ('financiero', '/api/oa/*', '{GET,POST,PUT,DELETE}',
   'Open Orders module — financiero context via direct URL (sidebar nav hidden 2026-05-27)')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods = EXCLUDED.methods,
  description = EXCLUDED.description;
