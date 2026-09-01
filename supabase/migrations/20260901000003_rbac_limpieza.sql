-- LIMPIEZA DE RBAC — revocar permisos que apuntan a rutas inexistentes.
--
-- HALLAZGO (auditoría del 2026-09-01, comparando las 56 rutas `route.ts` del
-- código contra las 143 filas de `route_permissions`): tres patrones conceden
-- acceso a rutas que NO EXISTEN.
--
-- POR QUÉ ESTO IMPORTA, Y POR QUÉ NO ES SIMETRICO CON `PAGE_PERMISSIONS`.
-- Las dos tablas de autorización de este proyecto funcionan al revés una de
-- la otra, y eso decide qué se limpia y qué se deja:
--
--   * `route_permissions` CONCEDE. Una fila que apunta a una ruta inexistente
--     es un permiso latente: el día que alguien cree esa ruta, nace con acceso
--     ya otorgado a roles que nadie volvió a revisar. Eso se revoca.
--   * `PAGE_PERMISSIONS` (TypeScript) RESTRINGE — una página sin entrada la
--     abre cualquier sesión autenticada. Una entrada que apunta a una página
--     inexistente no concede nada, y protege por adelantado si esa página
--     algún día aparece. Eso se DEJA.
--
-- Los tres patrones revocados:
--   /api/acid-test/*     — sus rutas se desmantelaron; el grant quedó huérfano.
--   /api/export/*        — ídem.
--   /api/status/export   — lo concedí yo el 01-sep junto con el rol
--                          project_manager, pero la ruta de exportación a xlsx
--                          todavía no se construyó. Un permiso no debe adelantarse
--                          a su ruta: se vuelve a conceder en la misma migración
--                          que la entregue.
--
-- NO se toca `/api/health`: no tiene fila y no debe tenerla — está en
-- PUBLIC_API_ROUTES del middleware, antes de cualquier verificación de rol.
--
-- Aplicada con `supabase db push`. Idempotente.

DELETE FROM route_permissions
WHERE route_pattern IN ('/api/acid-test/*', '/api/export/*', '/api/status/export');

-- Comprobación: si algo quedó, la migración lo dice en vez de pasar callada.
DO $$
DECLARE sobrantes INT;
BEGIN
  SELECT count(*) INTO sobrantes FROM route_permissions
   WHERE route_pattern IN ('/api/acid-test/*', '/api/export/*', '/api/status/export');
  IF sobrantes > 0 THEN
    RAISE EXCEPTION 'Quedaron % filas huerfanas en route_permissions', sobrantes;
  END IF;
END $$;
