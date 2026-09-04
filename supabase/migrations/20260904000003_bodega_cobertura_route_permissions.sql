-- route_permissions for the new write path onto bodega_cobertura (20260821000006).
--
-- The table and its read side (rows.ts) already existed — Wilmer's 2026-08-21
-- "Zacapa/Petén a 15 días" request was seeded by hand as a one-off row. This
-- opens the same table up as a per-bodega dropdown filter (Jorge, 2026-09-04):
-- POST /api/compras/reabastecimiento/cobertura, mirroring the
-- sugerido-bodega route_permissions grant exactly (20260901000008).
--
-- Aplicada con `supabase db push`. Idempotente.

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/compras/reabastecimiento/cobertura', ARRAY['POST'],
       'Horizonte de cobertura del Sugerido (días), por bodega'
FROM (VALUES ('admin'), ('compras'), ('gerencia')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
  WHERE rp.role = v.role
    AND rp.route_pattern = '/api/compras/reabastecimiento/cobertura'
);
