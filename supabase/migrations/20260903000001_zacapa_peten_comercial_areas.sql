-- FORECAST COMERCIAL — faltaban dos de las seis áreas.
--
-- `comercial_areas` (20260901000006) sólo sembró los cuatro canales de venta
-- (mayoreo, institucional, supermercados, tiendas). La definición de terminado
-- (docs/compras/DEFINICION_TERMINADO_FORECAST_COMERCIAL.md §1) es explícita:
-- "la hoja compartida la llenaron CUATRO DE SEIS áreas" — las otras dos son las
-- sedes Zacapa y Petén, que cargan su propio forecast igual que un canal.
--
-- Sin esta fila, un usuario `ventas` con área 'zacapa' o 'peten' es imposible
-- de crear: `user_profiles.area` referencia `comercial_areas(slug)`.

INSERT INTO comercial_areas (slug, nombre) VALUES
  ('zacapa', 'Zacapa'),
  ('peten',  'Petén')
ON CONFLICT (slug) DO NOTHING;
