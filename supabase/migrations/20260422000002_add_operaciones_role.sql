-- ============================================================================
-- Add 'operaciones' role (Mario — warehouse/logistics operations)
-- ============================================================================
-- Roles after this migration:
--   superuser, admin, gerencia, compras, ventas, inventario, financiero, testuser, operaciones
-- (Adds 'operaciones'. Also reconciles 'testuser' into the CHECK — the prior RBAC
--  migration omitted it, but a testuser row has existed in user_profiles since
--  2026-03-24. This migration brings the DB constraint in line with that reality.)
--
-- 'operaciones' access:
--   - Backtest (value demo)
--   - KPIs: stockout-risk (Hot List), abc-xyz (Hold List), slow-moving, days-of-inventory
--   - OA module (shared with compras — excepciones, espacio-bodega, recepcion, etc.)
-- ============================================================================

-- Step 1: Extend the role CHECK constraint
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero', 'testuser', 'operaciones'));

-- Step 2: Grant route permissions
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('operaciones', '/api/backtest/*',              '{GET}', 'View backtest results (value demo)'),
  ('operaciones', '/api/kpis/stockout-risk',      '{GET}', 'Hot List — productos por agotarse'),
  ('operaciones', '/api/kpis/abc-xyz',            '{GET}', 'Hold List context — clasificación ABC/XYZ'),
  ('operaciones', '/api/kpis/slow-moving',        '{GET}', 'Productos sin movimiento'),
  ('operaciones', '/api/kpis/days-of-inventory',  '{GET}', 'Días de inventario por SKU y bodega'),
  ('operaciones', '/api/oa/*',                    '{GET,POST,PUT,DELETE}', 'Open Orders module — shared operational view')
ON CONFLICT (role, route_pattern) DO NOTHING;
