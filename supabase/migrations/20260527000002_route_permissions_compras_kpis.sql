-- Restore /api/kpis/abc-xyz and /api/kpis/order-plan access for the compras role.
--
-- Regression class identical to 20260527000001_route_permissions_forecast.sql:
-- the auth-hardening rollout enforces per-route permissions via
-- check_route_access, but the compras role was only granted /api/kpis/stockout-risk
-- and /api/kpis/slow-moving — the two other KPI endpoints consumed by the
-- /compras landing page (Inicio Compras) were left unpermissioned.
--
-- Symptoms observed on /compras for the compras user:
--   - "GTQ inmovilizado" KPI card renders "—" instead of a value
--   - Plan de compras section (and ROP alerts above it) is silently absent
--
-- Frontend silently coalesces 403 responses to empty arrays via:
--   setAbcItems(Array.isArray(abcData) ? abcData : []);
--   setOrderPlan(planData?.suppliers ?? []);
-- An empty abcItems[] causes totalGtqInmovilizado === 0, which fmtGTQ renders
-- as the em-dash "—". An empty orderPlan[] causes the conditional
-- {!loading && orderPlan.length > 0 && ...} to skip rendering the entire
-- Plan de compras + ROP-alerts section.
--
-- Applied to prod via Supabase SQL editor on 2026-05-27 (this file is the
-- source-of-truth record for future fresh deploys). Idempotent.

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('compras', '/api/kpis/abc-xyz',   '{GET}',
   'GTQ inmovilizado KPI on /compras landing'),
  ('compras', '/api/kpis/order-plan', '{GET}',
   'Plan de compras + ROP alerts on /compras landing')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods = EXCLUDED.methods,
  description = EXCLUDED.description;
