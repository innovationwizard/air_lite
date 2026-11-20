-- Wilmer, 2026-11-19, tres huecos de la pantalla de reabastecimiento.
--
-- 1. Cantidad que él digita para cubicar la carga, por producto y por bodega
--    (incluida General). No reemplaza el Sugerido: la fórmula sigue visible.
--    Casilla vacía = esa línea sigue siendo el Sugerido. Append-only, igual
--    que tránsito y pide bodega: qty NULL es quitar la captura.
--
-- 2. El CD Zona 11 (almacén 2Z11) entra al sync de existencias y de venta
--    ordenada para poder verse desde Zacapa. in_scope queda FALSE: no es
--    pestaña, no entra al pendiente de General, y el tránsito de PO-PZ11-
--    sigue sin mapa. Tienda Zona 11 sigue siendo San José.

INSERT INTO bodega_map (odoo_warehouse_code, odoo_warehouse_name, bodega, in_scope, note)
VALUES (
  '2Z11',
  '2 Bodega Zona 11',
  'Zona 11',
  false,
  'CD Zona 11. Wilmer 2026-11-19: inventario y días de inventario en la pestaña Zacapa. '
  || 'No es pestaña. Tienda Zona 11 sigue en San José. PO-PZ11- no entra al tránsito.'
)
ON CONFLICT (odoo_warehouse_code) DO UPDATE SET
  odoo_warehouse_name = EXCLUDED.odoo_warehouse_name,
  bodega = EXCLUDED.bodega,
  in_scope = false,
  note = EXCLUDED.note;

CREATE TABLE IF NOT EXISTS cantidad_pedida (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id   UUID REFERENCES tenants(id),
  product_id  INT NOT NULL REFERENCES products(id),
  bodega      VARCHAR(40) NOT NULL,
  -- NULL = entrada de BORRADO: la captura se quitó. No es cero.
  qty         NUMERIC(15,4),
  autor       VARCHAR(500) NOT NULL,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cantidad_pedida_qty_sane CHECK (qty IS NULL OR (qty >= 0 AND qty <= 1000000))
);

COMMENT ON TABLE cantidad_pedida IS
  'Cantidad que Compras digita para cubicar, por producto x bodega (incluida General). '
  'Append-only, gana la ultima entrada; qty NULL = borrado. No entra al Sugerido: '
  'la casilla vacia significa que el cubicaje y la copia usan el Sugerido calculado.';

CREATE INDEX IF NOT EXISTS idx_cantidad_pedida_prod
  ON cantidad_pedida (product_id, bodega, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cantidad_pedida_bodega
  ON cantidad_pedida (bodega, created_at DESC);

ALTER TABLE cantidad_pedida ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "cantidad_pedida_service" ON cantidad_pedida;
CREATE POLICY "cantidad_pedida_service" ON cantidad_pedida
  FOR ALL USING (auth.role() = 'service_role');
DROP POLICY IF EXISTS "cantidad_pedida_auth_read" ON cantidad_pedida;
CREATE POLICY "cantidad_pedida_auth_read" ON cantidad_pedida
  FOR SELECT USING (auth_role() IS NOT NULL);

GRANT SELECT ON cantidad_pedida TO authenticated;

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/compras/reabastecimiento/cantidad-pedida', ARRAY['POST'],
       'Cantidad digitada para cubicar el pedido (Wilmer 2026-11-19)'
FROM (VALUES ('admin'), ('compras'), ('gerencia')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
  WHERE rp.role = v.role
    AND rp.route_pattern = '/api/compras/reabastecimiento/cantidad-pedida'
);
