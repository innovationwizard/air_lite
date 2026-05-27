-- Final route_permissions sweep on 2026-05-27 — covers all remaining gaps
-- found by a static cross-reference of sidebar visibility per role vs the
-- API endpoints each visible page fetches.
--
-- Method: enumerated every page.tsx under frontend/src/app/(authenticated),
-- grep'd every fetch('/api/...') call, cross-referenced against existing
-- route_permissions, and listed every (role, endpoint) pair where the role
-- can see the page in the sidebar but lacks the API permission.
--
-- Gaps found (all are silent-403-coalesced-to-empty-array failures, same
-- pattern as the 4 fixed earlier tonight in migrations 20260527000001,
-- 000002, 000003 and the /compras KPI fix):
--
--   operaciones missing /api/kpis/stockout-risk-by-warehouse
--     -> breaks /preocupaciones/desabastecimiento (Hot List)
--     -> breaks /preocupaciones/capital-congelado (Hold List)
--     CRITICAL: both are top-level items in the operaciones sidebar
--
--   ventas missing /api/kpis/stockout-risk-by-warehouse and /api/kpis/slow-moving
--     -> breaks /preocupaciones/desabastecimiento, capital-congelado,
--        costos-almacenamiento
--     Not in demo path but ventas role exists and would hit these
--
--   inventario missing /api/kpis/stockout-risk-by-warehouse
--     -> breaks /preocupaciones/desabastecimiento, capital-congelado
--     Not in demo path but role exists
--
-- Note on roles NOT in this migration:
--   - admin, gerencia, financiero already have /api/kpis/* (glob) — no gaps
--   - compras already fully covered after tonight's earlier migrations
--   - superuser bypasses check_route_access entirely
--   - testuser is intentionally scoped to backtest+POC only

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('operaciones', '/api/kpis/stockout-risk-by-warehouse', '{GET}',
   'Hot List + Hold List per-warehouse breakdown — Operaciones silo'),

  ('inventario',  '/api/kpis/stockout-risk-by-warehouse', '{GET}',
   'Hot List + Hold List per-warehouse breakdown — Riesgos Empresariales section'),

  ('ventas',      '/api/kpis/stockout-risk-by-warehouse', '{GET}',
   'Hot List + Hold List per-warehouse breakdown — Riesgos Empresariales section'),
  ('ventas',      '/api/kpis/slow-moving', '{GET}',
   'Costos de Almacenamiento + Hold List — Riesgos Empresariales section')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods = EXCLUDED.methods,
  description = EXCLUDED.description;
