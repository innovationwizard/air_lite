-- GRUPOS DE PROVEEDORES — filtro de reabastecimiento-vivo.
--
-- QUÉ PROBLEMA RESUELVE. El filtro «Todos los proveedores» de
-- reabastecimiento-vivo lista cada `suppliers.name` distinto que aparece en
-- las filas — hoy ~70, muchos de ellos la MISMA opción de compra real:
-- entidades legales duplicadas, empresas del mismo grupo, o proveedores
-- sustitutos entre sí. Ver PROVEEDORES_GROUPING_UX_DESIGN.md y
-- PROVEEDORES_GROUPING_BUILD_PLAN.md.
--
-- DECISIONES DEL CLIENTE (2026-09-03), de las que este esquema es consecuencia
-- directa:
--   1. El agrupamiento es GLOBAL por proveedor, no por producto — si A y B son
--      sustitutos, lo son para todo lo que se compra de cualquiera de los dos.
--   2. UN proveedor pertenece A LO SUMO A UN grupo. Enforced abajo con
--      supplier_id como PRIMARY KEY de supplier_group_members, no con un
--      UNIQUE INDEX — así una reasignación es un UPDATE del mismo row, no una
--      segunda fila que hay que recordar borrar.
--   3. Solo Wilmer (rol `compras`) mantiene esto — ver la migración de
--      route_permissions abajo. Sin ruta nueva: la gestión vive en un panel
--      dentro de reabastecimiento-vivo, así que no hay página que confinar.
--
-- POR QUÉ NO ES APPEND-ONLY, a diferencia de transito_overrides/
-- sugerido_bodega/reyma_factura_match. Esas tablas auditan una DECISIÓN
-- automatizada o financiera que alguien más tiene que poder reconstruir. Un
-- grupo de proveedores lo escribe Wilmer directamente, sin motor de
-- propuestas que auditar, y un grupo mal armado es visible de inmediato como
-- "salieron los proveedores equivocados en mi filtro" — no un número
-- financiero silenciosamente corrompido. CRUD mutable, con quién-y-cuándo
-- para trazabilidad, es proporcional al riesgo real.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS supplier_groups (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    UUID REFERENCES tenants(id),
  display_name VARCHAR(255) NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un row por proveedor agrupado. `supplier_id` es la PRIMARY KEY (no un
-- UNIQUE INDEX aparte) precisamente para que "un proveedor, a lo sumo un
-- grupo" sea imposible de violar por construcción, no solo por convención de
-- la API.
CREATE TABLE IF NOT EXISTS supplier_group_members (
  supplier_id INT PRIMARY KEY REFERENCES suppliers(id),
  group_id    UUID NOT NULL REFERENCES supplier_groups(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_group_members_group
  ON supplier_group_members(group_id);

COMMENT ON TABLE supplier_groups IS
  'Grupos nombrados de proveedores duplicados/sustituibles, mantenidos por '
  'Wilmer desde reabastecimiento-vivo. Ver PROVEEDORES_GROUPING_UX_DESIGN.md '
  'y PROVEEDORES_GROUPING_BUILD_PLAN.md.';
COMMENT ON TABLE supplier_group_members IS
  'Un row por proveedor agrupado; supplier_id es PK: un proveedor pertenece '
  'a lo sumo a un grupo (decision del cliente, 2026-09-03).';

ALTER TABLE supplier_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_groups_service" ON supplier_groups;
CREATE POLICY "supplier_groups_service" ON supplier_groups
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE supplier_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_group_members_service" ON supplier_group_members;
CREATE POLICY "supplier_group_members_service" ON supplier_group_members
  FOR ALL USING (auth.role() = 'service_role');

-- Permisos de ruta — SOLO compras (Wilmer). Superuser hace bypass en
-- check_route_access (20260323000002) sin necesitar fila. Dos patrones,
-- igual que /api/forecast (20260527000001_route_permissions_forecast.sql):
-- la ruta exacta NO es alcanzada por su propio glob "/*", así que hacen falta
-- ambas filas o el GET a la ruta base quedaría fuera del enforcement.
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('compras', '/api/compras/proveedor-grupos',   '{GET,POST}',
   'Listar y crear grupos de proveedores (reabastecimiento-vivo)'),
  ('compras', '/api/compras/proveedor-grupos/*', '{PATCH,DELETE}',
   'Editar/borrar un grupo de proveedores (reabastecimiento-vivo)')
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;
