-- ============================================================================
-- Seed route_permissions for /api/superuser/*
--
-- Purpose: open up a superuser-only API surface for diagnostic / observability
-- endpoints. The first endpoint is /api/superuser/forecast-diagnostic which
-- backs the ECharts deep-analytics page. Future endpoints (system-internal
-- audit, ML diagnostics, raw query helpers) will reuse the same pattern.
--
-- Per RBAC convention in lib/auth/roles.ts, superuser bypasses isAuthorized()
-- anyway, so this row is technically redundant for the runtime check. We
-- include it for self-documenting intent in the DB and to keep the route_
-- permissions table the single source of truth (matches the convention set
-- by 20260423000005_route_permissions_acid_test_gerencia_export_poc.sql).
--
-- Idempotent: ON CONFLICT (role, route_pattern) DO UPDATE.
-- ============================================================================

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('superuser', '/api/superuser/*', '{GET,POST,PUT,DELETE}',
   'Superuser-only diagnostic + observability endpoints (forecast-diagnostic, future ML/system audit tools)')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods = EXCLUDED.methods,
  description = EXCLUDED.description;
