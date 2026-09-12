-- VENTAS — Forecast Comercial and NOTHING else.
--
-- WHY (Jorge, 2026-09-11): the tiendas@ login (role `ventas`, one of the
-- channel-head accounts that capture their own channel's forecast) was seeing
-- the whole «Riesgos Empresariales» group and could open /poc and
-- /preocupaciones/*. The page side is fixed in code (ROLLOUT_FOCUS.ventas,
-- CAN_VIEW_OPERATIONAL, CAN_VIEW_POC). This is the API side: `ventas` keeps
-- ONLY the comercial routes and the shared read-only lookups the forecast
-- page itself calls. The KPI and backtest grants — which only fed the pages
-- that are now closed — go.
--
-- What `ventas` keeps: /api/comercial/*, /api/status (GET), /api/bug-reports
-- and any other route the forecast page needs. This migration does NOT touch
-- those; it only deletes rows for the closed pages.
--
-- Apply by hand in the SQL editor. Idempotent.
-- ROLLBACK: re-run the ventas INSERTs in 20260323000002_rbac.sql,
--           20260527000003_route_permissions_kpis_unnecessary_purchases.sql and
--           20260527000004_route_permissions_audit_sweep.sql.

BEGIN;

DELETE FROM route_permissions
 WHERE role = 'ventas'
   AND (
     route_pattern LIKE '/api/backtest%'
     OR route_pattern LIKE '/api/kpis/%'
   );

-- Verification in the same transaction: if anything is left, blow up.
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM route_permissions
   WHERE role = 'ventas'
     AND (route_pattern LIKE '/api/backtest%' OR route_pattern LIKE '/api/kpis/%');
  IF n > 0 THEN
    RAISE EXCEPTION 'ventas still holds % backtest/kpis grant(s)', n;
  END IF;
  -- And the thing it must keep is still there.
  IF NOT EXISTS (SELECT 1 FROM route_permissions WHERE role = 'ventas' AND route_pattern = '/api/comercial/forecast') THEN
    RAISE EXCEPTION 'ventas lost /api/comercial/forecast — that is the one route it must keep';
  END IF;
END $$;

COMMIT;
