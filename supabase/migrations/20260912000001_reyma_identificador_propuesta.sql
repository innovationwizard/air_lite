-- Identificador REYMA → SKU: propuesta + confirmación de Alexis (2026-09-12)
--
-- Decisión de Jorge (2026-09-12): la app PROPONE el SKU para un identificador
-- REYMA nuevo (con la orden de compra, la palabra de REYMA en Odoo y la
-- estructura de la descripción), y Alexis lo CONFIRMA con «Sí»/«No» — en la
-- misma pantalla de carga si hay propuesta, o en /facturas/pendientes. Nunca
-- se asigna sin confirmación humana, y Alexis es la única fuente autorizada.
--
-- Vocabulario en pantalla: «identificador» (CH2PRXN — así lo llama la factura
-- de REYMA) y «SKU» (77201001). Las columnas `clave`/`codigo` no cambian.
--
-- Sin tablas nuevas: sólo los permisos de las tres rutas nuevas, con el mismo
-- trío de roles del resto de la carga de facturas.
--
-- Aplicada por Jorge en el editor SQL de Supabase (no `supabase db push`).
-- Idempotente.

INSERT INTO route_permissions (role, route_pattern, methods, description)
SELECT v.role, v.ruta, v.metodos, v.descripcion
FROM (VALUES
  ('compras_internacionales', '/api/compras-internacionales/reyma/clave-pendiente/proponer', ARRAY['POST'],
   'Proponer el SKU para un identificador REYMA nuevo (sólo lectura; Alexis confirma)'),
  ('gerencia',                '/api/compras-internacionales/reyma/clave-pendiente/proponer', ARRAY['POST'],
   'Proponer el SKU para un identificador REYMA nuevo (sólo lectura; Alexis confirma)'),
  ('admin',                   '/api/compras-internacionales/reyma/clave-pendiente/proponer', ARRAY['POST'],
   'Proponer el SKU para un identificador REYMA nuevo (sólo lectura; Alexis confirma)'),
  ('compras_internacionales', '/api/compras-internacionales/reyma/clave-pendiente/verificar-sku', ARRAY['GET'],
   'Verificar en Odoo un SKU escrito a mano antes de asignarlo'),
  ('gerencia',                '/api/compras-internacionales/reyma/clave-pendiente/verificar-sku', ARRAY['GET'],
   'Verificar en Odoo un SKU escrito a mano antes de asignarlo'),
  ('admin',                   '/api/compras-internacionales/reyma/clave-pendiente/verificar-sku', ARRAY['GET'],
   'Verificar en Odoo un SKU escrito a mano antes de asignarlo'),
  ('compras_internacionales', '/api/compras-internacionales/reyma/factura/reevaluar', ARRAY['POST'],
   'Reevaluar una factura en staging tras confirmar un identificador'),
  ('gerencia',                '/api/compras-internacionales/reyma/factura/reevaluar', ARRAY['POST'],
   'Reevaluar una factura en staging tras confirmar un identificador'),
  ('admin',                   '/api/compras-internacionales/reyma/factura/reevaluar', ARRAY['POST'],
   'Reevaluar una factura en staging tras confirmar un identificador')
) AS v(role, ruta, metodos, descripcion)
WHERE NOT EXISTS (
  SELECT 1 FROM route_permissions rp
   WHERE rp.role = v.role AND rp.route_pattern = v.ruta
);

-- Verificación: se esperan 9 filas.
-- SELECT role, route_pattern, methods FROM route_permissions
--  WHERE route_pattern IN (
--    '/api/compras-internacionales/reyma/clave-pendiente/proponer',
--    '/api/compras-internacionales/reyma/clave-pendiente/verificar-sku',
--    '/api/compras-internacionales/reyma/factura/reevaluar')
--  ORDER BY route_pattern, role;
