-- Reordenamiento del plan de /status: habilitar PUT en /api/status/plan.
--
-- POR QUÉ UN MÉTODO Y NO UNA RUTA NUEVA. Arrastrar una fila reordena TODAS las
-- posiciones, así que mandarlo como N peticiones PATCH sería lento y, peor,
-- no atómico: una tanda a medio aplicar deja el plan en un orden que nadie
-- eligió. El reordenamiento completo viaja en un solo PUT.
--
-- Se colgó del patrón que ya existe (`/api/status/plan`) en lugar de crear
-- `/api/status/plan/orden`, porque `check_route_access` sólo hace coincidencia
-- exacta o glob con `*`: una sub-ruta nueva NO queda cubierta por el patrón
-- exacto del padre y habría nacido denegada. Un método más sobre el patrón
-- existente es la superficie más pequeña que resuelve esto.
--
-- El reparto de autoridad no cambia: `project_manager` escribe el PLAN. No hay
-- ningún método, en ninguna ruta, que le permita tocar el ESTADO de un ítem.
--
-- Aplicada con `supabase db push`. Idempotente.

UPDATE route_permissions
   SET methods = ARRAY['GET', 'PATCH', 'PUT'],
       description = 'Plan: orden de prioridad (PUT reordena en bloque), fechas y notas'
 WHERE route_pattern = '/api/status/plan'
   AND role = 'project_manager';

DO $$
DECLARE ok BOOLEAN;
BEGIN
  SELECT 'PUT' = ANY(methods) INTO ok FROM route_permissions
   WHERE route_pattern = '/api/status/plan' AND role = 'project_manager';
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'project_manager no quedo con PUT sobre /api/status/plan';
  END IF;
END $$;
