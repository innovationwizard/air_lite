-- ============================================================================
-- RBAC — Role-Based Access Control
-- ============================================================================
-- 7 roles: superuser, admin, gerencia, compras, ventas, inventario, financiero
--
-- Authorization model:
--   - user_profiles.role determines what a user can access
--   - route_permissions maps roles to API route patterns
--   - RLS policies on business tables enforce read access by role
--   - Superuser bypasses all restrictions
-- ============================================================================

-- Step 1: Drop old CHECK constraint and add new one with all 7 roles
ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero'));

-- Step 2: Route permissions table
-- Maps roles to API route patterns they can access
CREATE TABLE IF NOT EXISTS route_permissions (
  id SERIAL PRIMARY KEY,
  role VARCHAR(20) NOT NULL,
  route_pattern VARCHAR(100) NOT NULL,
  methods VARCHAR(10)[] NOT NULL DEFAULT '{GET}',
  description TEXT,
  UNIQUE(role, route_pattern)
);

-- Step 3: Populate route permissions
-- Superuser: everything (enforced in code, not here — superuser bypasses all checks)
-- Admin: user management + app settings + all operational routes
-- Gerencia: read-only access to all KPIs and backtest
-- Compras/Ventas/Inventario/Financiero: backtest + their fear pages + KPIs

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  -- Admin routes
  ('admin', '/api/admin/*', '{GET,POST,PUT,DELETE}', 'Full admin access: users, settings, data status'),
  ('admin', '/api/backtest/*', '{GET,POST}', 'Run and view backtests'),
  ('admin', '/api/kpis/*', '{GET}', 'All KPI endpoints'),

  -- Gerencia: read-only everything
  ('gerencia', '/api/backtest/*', '{GET}', 'View backtest results (read-only)'),
  ('gerencia', '/api/kpis/*', '{GET}', 'All KPI endpoints'),

  -- Compras: backtest + purchase-related KPIs
  ('compras', '/api/backtest/*', '{GET}', 'View backtest results'),
  ('compras', '/api/kpis/stockout-risk', '{GET}', 'Stockout risk (drives purchase decisions)'),
  ('compras', '/api/kpis/slow-moving', '{GET}', 'Slow-moving items (avoid purchasing these)'),

  -- Ventas: backtest + demand-related KPIs
  ('ventas', '/api/backtest/*', '{GET}', 'View backtest results'),
  ('ventas', '/api/kpis/stockout-risk', '{GET}', 'Stockout risk (lost sales potential)'),
  ('ventas', '/api/kpis/abc-xyz', '{GET}', 'ABC/XYZ classification (demand patterns)'),

  -- Inventario: backtest + inventory-related KPIs
  ('inventario', '/api/backtest/*', '{GET}', 'View backtest results'),
  ('inventario', '/api/kpis/stockout-risk', '{GET}', 'Stockout risk'),
  ('inventario', '/api/kpis/slow-moving', '{GET}', 'Slow-moving items'),
  ('inventario', '/api/kpis/abc-xyz', '{GET}', 'ABC/XYZ classification'),

  -- Financiero: backtest + financial KPIs
  ('financiero', '/api/backtest/*', '{GET}', 'View backtest results'),
  ('financiero', '/api/kpis/*', '{GET}', 'All KPI endpoints (financial oversight)')
ON CONFLICT (role, route_pattern) DO NOTHING;

-- Step 4: Function to check if a user has access to a route
CREATE OR REPLACE FUNCTION check_route_access(
  p_user_id UUID,
  p_route VARCHAR,
  p_method VARCHAR DEFAULT 'GET'
)
RETURNS BOOLEAN AS $$
DECLARE
  v_role VARCHAR;
BEGIN
  SELECT role INTO v_role FROM user_profiles WHERE id = p_user_id;

  -- Superuser bypasses all checks
  IF v_role = 'superuser' THEN
    RETURN true;
  END IF;

  -- Check route_permissions for matching pattern
  RETURN EXISTS (
    SELECT 1 FROM route_permissions rp
    WHERE rp.role = v_role
      AND (
        -- Exact match
        rp.route_pattern = p_route
        -- Wildcard match: /api/backtest/* matches /api/backtest/run
        OR (
          rp.route_pattern LIKE '%*'
          AND p_route LIKE REPLACE(rp.route_pattern, '*', '%')
        )
      )
      AND p_method = ANY(rp.methods)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 5: Function to get user profile with role (used by middleware/API routes)
CREATE OR REPLACE FUNCTION get_user_profile(p_user_id UUID)
RETURNS TABLE(
  user_id UUID,
  display_name VARCHAR,
  role VARCHAR,
  tenant_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT up.id, up.display_name, up.role, up.tenant_id
  FROM user_profiles up
  WHERE up.id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 6: RLS policies — role-based read access
-- Drop existing permissive policies and replace with role-aware ones

-- Helper: get current user's role
CREATE OR REPLACE FUNCTION auth_role()
RETURNS VARCHAR AS $$
BEGIN
  RETURN (
    SELECT role FROM user_profiles
    WHERE id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Products: all roles can read
DROP POLICY IF EXISTS "products_service_role" ON products;
CREATE POLICY "products_read" ON products FOR SELECT USING (
  auth_role() IS NOT NULL  -- any authenticated user with a profile
);
CREATE POLICY "products_service_write" ON products FOR ALL USING (
  auth.role() = 'service_role'
);

-- Sale orders: all roles can read (backtest needs this)
DROP POLICY IF EXISTS "sale_orders_service_role" ON sale_orders;
CREATE POLICY "sale_orders_read" ON sale_orders FOR SELECT USING (
  auth_role() IS NOT NULL
);
CREATE POLICY "sale_orders_service_write" ON sale_orders FOR ALL USING (
  auth.role() = 'service_role'
);

-- Sale order lines: all roles can read
DROP POLICY IF EXISTS "sale_order_lines_service_role" ON sale_order_lines;
CREATE POLICY "sale_order_lines_read" ON sale_order_lines FOR SELECT USING (
  auth_role() IS NOT NULL
);
CREATE POLICY "sale_order_lines_service_write" ON sale_order_lines FOR ALL USING (
  auth.role() = 'service_role'
);

-- Inventory daily: all roles can read
DROP POLICY IF EXISTS "inventory_daily_service_role" ON inventory_daily;
CREATE POLICY "inventory_daily_read" ON inventory_daily FOR SELECT USING (
  auth_role() IS NOT NULL
);
CREATE POLICY "inventory_daily_service_write" ON inventory_daily FOR ALL USING (
  auth.role() = 'service_role'
);

-- Demand daily: all roles can read
DROP POLICY IF EXISTS "demand_daily_service_role" ON demand_daily;
CREATE POLICY "demand_daily_read" ON demand_daily FOR SELECT USING (
  auth_role() IS NOT NULL
);
CREATE POLICY "demand_daily_service_write" ON demand_daily FOR ALL USING (
  auth.role() = 'service_role'
);

-- Backtest runs: all roles can read, superuser/admin can write
DROP POLICY IF EXISTS "backtest_runs_service_role" ON backtest_runs;
CREATE POLICY "backtest_runs_read" ON backtest_runs FOR SELECT USING (
  auth_role() IS NOT NULL
);
CREATE POLICY "backtest_runs_write" ON backtest_runs FOR INSERT WITH CHECK (
  auth_role() IN ('superuser', 'admin', 'gerencia')
);
CREATE POLICY "backtest_runs_service_write" ON backtest_runs FOR ALL USING (
  auth.role() = 'service_role'
);

-- Backtest results: all roles can read
DROP POLICY IF EXISTS "backtest_results_service_role" ON backtest_results;
CREATE POLICY "backtest_results_read" ON backtest_results FOR SELECT USING (
  auth_role() IS NOT NULL
);
CREATE POLICY "backtest_results_service_write" ON backtest_results FOR ALL USING (
  auth.role() = 'service_role'
);

-- Backtest savings: all roles can read
DROP POLICY IF EXISTS "backtest_savings_service_role" ON backtest_savings;
CREATE POLICY "backtest_savings_read" ON backtest_savings FOR SELECT USING (
  auth_role() IS NOT NULL
);
CREATE POLICY "backtest_savings_service_write" ON backtest_savings FOR ALL USING (
  auth.role() = 'service_role'
);

-- User profiles: superuser/admin can read all, others can read own
CREATE POLICY "user_profiles_read_own" ON user_profiles FOR SELECT USING (
  id = auth.uid() OR auth_role() IN ('superuser', 'admin')
);
CREATE POLICY "user_profiles_write" ON user_profiles FOR ALL USING (
  auth_role() IN ('superuser', 'admin') OR auth.role() = 'service_role'
);

-- App settings: superuser can write, admin can read, others no access
CREATE POLICY "app_settings_read" ON app_settings FOR SELECT USING (
  auth_role() IN ('superuser', 'admin')
);
CREATE POLICY "app_settings_write" ON app_settings FOR ALL USING (
  auth_role() = 'superuser' OR auth.role() = 'service_role'
);

-- Audit log: superuser/admin can read
CREATE POLICY "audit_log_read" ON audit_log FOR SELECT USING (
  auth_role() IN ('superuser', 'admin')
);
CREATE POLICY "audit_log_write" ON audit_log FOR INSERT WITH CHECK (
  true  -- any authenticated action can create audit entries
);
CREATE POLICY "audit_log_service_write" ON audit_log FOR ALL USING (
  auth.role() = 'service_role'
);

-- Step 7: Enable RLS on user_profiles, app_settings, audit_log (not yet enabled)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
