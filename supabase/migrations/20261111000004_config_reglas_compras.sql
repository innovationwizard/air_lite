-- Let the compras role use the self-service rules page.
--
-- Wilmer (compras) already opens the reabastecimiento grid and the "why"
-- drawer. This adds the two routes the rules screen calls. admin keeps the
-- rows from 20261111000002. Superuser still bypasses check_route_access.
-- No other role is inserted or updated.
--
-- An exact path is not matched by a '/*' pattern, so each path is its own row.

INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('compras', '/api/configuracion/reglas', ARRAY['GET', 'PUT'],
   'Leer y guardar las reglas de cálculo de reabastecimiento'),
  ('compras', '/api/configuracion/reglas/preview', ARRAY['POST'],
   'Vista previa de un SKU con un borrador de reglas, sin escribir el sync')
ON CONFLICT (role, route_pattern) DO UPDATE SET
  methods     = EXCLUDED.methods,
  description = EXCLUDED.description;
