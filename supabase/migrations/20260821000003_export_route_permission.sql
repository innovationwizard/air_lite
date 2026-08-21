-- Permiso de ruta para la descarga xlsx del plan de compra (W1 formato a).
--
-- `/api/compras/reabastecimiento/export` es una ruta nueva bajo /api, y el
-- middleware exige una fila en `route_permissions` por rol × patrón × método
-- (defense-in-depth: matriz en datos + requireAuth en el handler). Sin esto la
-- descarga responde 403 aunque el handler la permita.
--
-- Mismos tres roles que ya tienen el resto del endpoint de reabastecimiento
-- (medido 2026-08-21: admin, compras, gerencia en GET/transito/pendiente/
-- comercial). Es POST y no GET porque el cliente manda la lista ordenada de
-- productos que está viendo — la prioridad del archivo ES ese orden.
--
-- Idempotente: sólo inserta si no existe ya la combinación rol × patrón.

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, '/api/compras/reabastecimiento/export', ARRAY['POST'],
       'Descargar el plan de compra en el formato xlsx del proveedor (Carvajal)'
FROM (VALUES ('admin'), ('compras'), ('gerencia')) AS v(role)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role
     AND rp.route_pattern = '/api/compras/reabastecimiento/export'
);
