-- ============================================================================
-- Perfil del usuario project_manager (David)
-- ============================================================================
-- Crea la fila de `user_profiles` para el usuario de auth pm@airefill.app, que
-- se aprovisionó por la API de administración el 2026-09-01 para que la
-- gerencia de proyecto del cliente pueda escribir el PLAN de /status —orden de
-- prioridad, fechas objetivo y notas— sin usar una credencial ajena.
--
-- POR QUÉ EXISTE ESTA MIGRACIÓN SI LA CUENTA YA ESTÁ CREADA. El usuario de
-- auth vive en `auth.users`, que ninguna migración toca. Sin esta fila, el
-- historial de migraciones no explicaría de dónde salió un perfil con un rol
-- que sí definen las migraciones, y una base reconstruida desde cero quedaría
-- con el rol existente y sin nadie que lo tenga. Mismo criterio y misma forma
-- que `20260422000006_gerencia_user_profile.sql`.
--
-- EL REPARTO QUE ESTA CUENTA MATERIALIZA:
--   * el ESTADO de cada ítem (¿está hecho?) lo juzga quien construyó, por
--     `juicio.tsv` + `scripts/sync_status.py`. NO hay ruta que permita a este
--     rol modificarlo.
--   * el PLAN (¿para cuándo?) lo escribe este rol, en `status_plan`.
-- Ver `20260901000001_status_gap_analysis.sql` y `20260901000002_…_role.sql`.
--
-- Credenciales (viven en `auth.users`, no en esta tabla):
--   email:      pm@airefill.app
--   contraseña: temporal, generada al azar en la creación y ROTADA antes de
--               entregarse. No se registra acá.
--
-- Aplicada con `supabase db push`. Idempotente.
-- ============================================================================

INSERT INTO user_profiles (id, display_name, role)
VALUES (
  '1d0b2a95-36d2-4b06-a09b-dca475e927ff',
  'David',
  'project_manager'
)
ON CONFLICT (id) DO UPDATE SET role = 'project_manager', display_name = 'David';
