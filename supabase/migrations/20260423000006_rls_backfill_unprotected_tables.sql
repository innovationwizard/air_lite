-- ============================================================================
-- Phase 2 — RLS backfill on all tables not yet protected
-- ============================================================================
-- Audit ran 2026-04-23 found 26 tables in 2 buckets:
--
--   Bucket A (5 tables) — RLS policies defined in RBAC migration but the
--     tables themselves were never ALTER TABLE ... ENABLE ROW LEVEL SECURITY.
--     Policies are currently inert. Just enable RLS; policies already exist.
--
--   Bucket B (21 tables) — never had RLS at all. Enable RLS and add baseline
--     policies: any authenticated user can SELECT; service_role has ALL.
--
-- Baseline policy pattern (Bucket B) matches the one used in the RBAC
-- migration for products/sale_orders/etc.:
--
--   CREATE POLICY "<t>_read" ON <t> FOR SELECT USING (
--     auth_role() IS NOT NULL  -- any authenticated user with a profile
--   );
--   CREATE POLICY "<t>_service_write" ON <t> FOR ALL USING (
--     auth.role() = 'service_role'
--   );
--
-- This is DELIBERATELY PERMISSIVE — baseline says "any logged-in user can
-- read". Tightening to role-specific policies per table is Phase 5 of the
-- defense-in-depth plan (separate workstream, needs per-table decision).
--
-- All statements are idempotent (IF NOT EXISTS / ... WHERE NOT EXISTS guards
-- on policy creation; ENABLE RLS is no-op if already enabled).
--
-- Reference: docs/security/PLAN_API_AUTH_DEFENSE_IN_DEPTH.md §3 Layer 3
-- ============================================================================

-- ─── Helper: idempotent ENABLE RLS (no-op if already enabled) ────────────
-- Postgres doesn't have IF NOT EXISTS for ALTER TABLE ... ENABLE RLS,
-- but ENABLE RLS is idempotent by itself. Leaving as plain statements.

-- ============================================================================
-- BUCKET A: ENABLE RLS only (policies already exist)
-- ============================================================================

ALTER TABLE backtest_results   ENABLE ROW LEVEL SECURITY;
ALTER TABLE backtest_savings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE demand_daily       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_daily    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_order_lines   ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- BUCKET B: ENABLE RLS + baseline policies
-- ============================================================================
-- Helper macro via DO block so we don't repeat 21 times.

DO $$
DECLARE
  t TEXT;
  table_list TEXT[] := ARRAY[
    -- Reference (from initial_schema, pre-existing but never protected)
    'tenants',
    'exchange_rates',
    'product_suppliers',
    'stock_locations',
    'stock_quants',
    'purchase_order_lines',
    'units_of_measure',
    'warehouses',
    -- RBAC infrastructure
    'route_permissions',
    -- OA module (2026-03-26)
    'open_orders',
    'open_order_lines',
    'dispatch_plan_weeks',
    'warehouse_config',
    'unloading_times',
    'reception_schedule',
    'weekly_audits',
    'extraordinary_orders',
    'extraordinary_order_lines',
    -- Acid-test (2026-04-23)
    'revenue_daily',
    'products_acid_test_active',
    'products_acid_test_archived'
  ];
BEGIN
  FOREACH t IN ARRAY table_list LOOP
    -- 1. Enable RLS
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);

    -- 2. Read policy: any authenticated user with a profile
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      t || '_read', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (auth_role() IS NOT NULL)',
      t || '_read', t
    );

    -- 3. Service-role write policy: bypass for trusted batch jobs
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON %I',
      t || '_service_write', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (auth.role() = ''service_role'')',
      t || '_service_write', t
    );

    RAISE NOTICE 'RLS backfilled on %', t;
  END LOOP;
END$$;

-- ============================================================================
-- Verification query (run after migration to confirm coverage)
-- ============================================================================
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY rowsecurity DESC, tablename;
--
-- Expected: every user-table has rowsecurity = true.
-- ============================================================================
