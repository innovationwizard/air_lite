-- API reads use the signed-in session, so row-level security has to let
-- that session SELECT. Many tables only had a service_role FOR ALL policy.
-- FOR ALL is not a SELECT policy, and a session read of those tables
-- returns zero rows.
--
-- Same rule as the 2026-04-23 backfill: any authenticated user with a
-- profile may read. Role checks stay on route_permissions and requireAuth.
-- Writes stay on the service role; this file adds no INSERT, UPDATE, or
-- DELETE policy for the session.
--
-- Tables that never had RLS (comercial_areas, revenue_daily_for_ml, and
-- anything created the same way) get the same pair: session SELECT, and
-- service_role FOR ALL so batch jobs keep writing. Extension tables are
-- left alone.
--
-- rpc_days_of_inventory, rpc_gerencia_validation, and
-- rpc_gerencia_validation_runs were SECURITY DEFINER, so the session
-- client still bypassed table policies inside them. They become INVOKER.
-- auth_role(), check_route_access, and get_user_profile stay DEFINER.

DO $$
DECLARE
  r record;
  pol text;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype = 'e'
      )
  LOOP
    IF NOT r.rls_on THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.table_name);
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = r.table_name
          AND p.cmd = 'ALL'
      ) THEN
        pol := r.table_name || '_service_write';
        IF char_length(pol) > 63 THEN
          pol := left(r.table_name, 40) || '_' || substr(md5(r.table_name), 1, 8) || '_svc';
        END IF;
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL USING (auth.role() = ''service_role'')',
          pol, r.table_name
        );
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public'
        AND p.tablename = r.table_name
        AND p.cmd = 'SELECT'
    ) THEN
      pol := r.table_name || '_auth_read';
      IF char_length(pol) > 63 THEN
        pol := left(r.table_name, 46) || '_' || substr(md5(r.table_name), 1, 8) || '_read';
      END IF;
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT USING (auth_role() IS NOT NULL)',
        pol, r.table_name
      );
    END IF;
  END LOOP;
END $$;

GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;

ALTER FUNCTION rpc_days_of_inventory() SECURITY INVOKER;
ALTER FUNCTION rpc_gerencia_validation(integer, boolean) SECURITY INVOKER;
ALTER FUNCTION rpc_gerencia_validation_runs() SECURITY INVOKER;
