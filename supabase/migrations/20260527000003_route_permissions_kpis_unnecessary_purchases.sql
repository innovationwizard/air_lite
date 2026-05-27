-- Restore /api/kpis/unnecessary-purchases access for roles that can see the
-- "Compras Innecesarias" page (sidebar visibility per CAN_VIEW_RISKS and
-- CAN_VIEW_OPERACIONES) but were not previously granted the API.
--
-- Fourth instance tonight of the silent-403-coalesced-to-empty-array pattern:
--   1. 20260527000001 - /api/forecast for gerencia + compras
--   2. 20260527000002 - /api/kpis/abc-xyz + /api/kpis/order-plan for compras
--   3. (this one)     - /api/kpis/unnecessary-purchases for ventas/inventario/operaciones
--
-- Symptoms observed on /preocupaciones/compras-innecesarias for the operaciones
-- user: "SKUs comprados en exceso" = 0, both GTQ totals render "—". Caused by
-- the frontend's silent coalesce:
--   setItems(Array.isArray(data) ? data : []);
-- When the API returns 403 {error:'No autorizado'}, Array.isArray returns false,
-- items stays empty, all derived totals are 0, fmtGTQ(0) returns the em-dash.
--
-- Why these 3 roles and not all: admin, gerencia, financiero already have
-- '/api/kpis/*' (glob) per the original RBAC migration. compras is not in
-- either CAN_VIEW_RISKS or CAN_VIEW_OPERACIONES so doesn't see the page.
-- superuser bypasses check_route_access. The 3 below are the only roles that
-- can SEE the page link but lacked the underlying API permission.

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('ventas',      '/api/kpis/unnecessary-purchases', '{GET}',
   'Compras Innecesarias page — Riesgos Empresariales section visibility'),
  ('inventario',  '/api/kpis/unnecessary-purchases', '{GET}',
   'Compras Innecesarias page — Riesgos Empresariales section visibility'),
  ('operaciones', '/api/kpis/unnecessary-purchases', '{GET}',
   'Compras Innecesarias page — Operaciones silo section visibility')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods = EXCLUDED.methods,
  description = EXCLUDED.description;
