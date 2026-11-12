-- Routes for the rules admin page and the grid "why" drawer.
--
-- Superuser bypasses check_route_access, so it is not listed. admin is the
-- only role that may read or write the rules. The drawer is part of the live
-- grid, so the same roles that can GET /api/compras/reabastecimiento can GET
-- the explanation. Nothing here changes a calculation; the write only updates
-- config_rules, and the existing trigger appends history.
--
-- An exact path is not matched by a '/*' pattern, so each path is its own row.

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('admin', '/api/configuracion/reglas', ARRAY['GET', 'PUT'],
   'Leer y guardar las reglas de cálculo de reabastecimiento'),
  ('admin', '/api/configuracion/reglas/preview', ARRAY['POST'],
   'Vista previa de un SKU con un borrador de reglas, sin escribir el sync'),
  ('compras', '/api/compras/reabastecimiento/porque', ARRAY['GET'],
   'Por qué un número de la grilla: la regla vigente y el detalle en vivo'),
  ('ceo', '/api/compras/reabastecimiento/porque', ARRAY['GET'],
   'Por qué un número de la grilla: la regla vigente y el detalle en vivo'),
  ('sales_manager', '/api/compras/reabastecimiento/porque', ARRAY['GET'],
   'Por qué un número de la grilla: la regla vigente y el detalle en vivo')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods     = EXCLUDED.methods,
  description = EXCLUDED.description;
