-- FORECAST COMERCIAL — «Aprobar pedido»: the act that SENDS a channel's
-- forecast to Compras' page.
--
-- WHY (Jorge, 2026-09-11): «Bloquear cambios» freezes and stores the
-- numbers but does NOT send them; «Aprobar pedido» (there is no partial
-- approval) is what makes them appear on Wilmer's page. Flow:
--   fill «Voy a pedir» → Bloquear cambios → Aprobar pedido.
-- Approval requires the active lock and is recorded ON that lock row (who,
-- when). What Wilmer sees is exactly the frozen record. Unlocking withdraws
-- the approval (the row goes inactive; a later re-lock + re-approval is a
-- new version).
--
-- Until now every saved row reached Wilmer's page the moment it was saved;
-- from now on only rows of an area+month with an ACTIVE, APPROVED lock do.
--
-- Apply by hand in the SQL editor. Idempotent.
-- ROLLBACK: ALTER TABLE comercial_forecast_bloqueos DROP COLUMN aprobado_at, DROP COLUMN aprobado_por, DROP COLUMN aprobado_autor;
--           re-create the trigger function from 20260911000001; remove PATCH from the two permission rows.

BEGIN;

ALTER TABLE comercial_forecast_bloqueos
  ADD COLUMN IF NOT EXISTS aprobado_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS aprobado_por   UUID REFERENCES user_profiles(id),
  ADD COLUMN IF NOT EXISTS aprobado_autor VARCHAR(500);
ALTER TABLE comercial_forecast_bloqueos DROP CONSTRAINT IF EXISTS comercial_forecast_bloqueos_aprobacion_completa;
ALTER TABLE comercial_forecast_bloqueos ADD CONSTRAINT comercial_forecast_bloqueos_aprobacion_completa CHECK (
  (aprobado_at IS NULL AND aprobado_por IS NULL AND aprobado_autor IS NULL)
  OR (aprobado_at IS NOT NULL AND aprobado_por IS NOT NULL AND aprobado_autor IS NOT NULL)
);
COMMENT ON COLUMN comercial_forecast_bloqueos.aprobado_at IS
  '«Aprobar pedido»: when the frozen record was sent to Compras. NULL = locked but not sent. Counts only while activo.';

-- Two legal transitions now: APPROVE (activo stays true, aprobado_* set once)
-- and UNLOCK (activo true -> false with desbloqueado_* set). Everything
-- frozen stays frozen in both.
CREATE OR REPLACE FUNCTION comercial_forecast_bloqueos_solo_desbloqueo()
RETURNS TRIGGER AS $$
DECLARE congelado_igual BOOLEAN;
BEGIN
  congelado_igual := NEW.area = OLD.area AND NEW.month = OLD.month AND NEW.version = OLD.version
    AND NEW.user_id = OLD.user_id AND NEW.autor = OLD.autor AND NEW.filas = OLD.filas
    AND NEW.total_filas = OLD.total_filas AND NEW.hash = OLD.hash AND NEW.created_at = OLD.created_at;
  -- approve: once, while active, nothing else changes
  IF congelado_igual AND OLD.activo AND NEW.activo
     AND OLD.aprobado_at IS NULL AND NEW.aprobado_at IS NOT NULL
     AND NEW.desbloqueado_por IS NULL AND NEW.desbloqueado_at IS NULL THEN
    RETURN NEW;
  END IF;
  -- unlock: approval fields untouched (history), activo off
  IF congelado_igual AND OLD.activo AND NOT NEW.activo
     AND NEW.desbloqueado_por IS NOT NULL AND NEW.desbloqueado_at IS NOT NULL
     AND NEW.aprobado_at IS NOT DISTINCT FROM OLD.aprobado_at
     AND NEW.aprobado_por IS NOT DISTINCT FROM OLD.aprobado_por
     AND NEW.aprobado_autor IS NOT DISTINCT FROM OLD.aprobado_autor THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'comercial_forecast_bloqueos es inmutable: sólo se puede aprobar o desbloquear (id=%)', OLD.id;
END;
$$ LANGUAGE plpgsql;

-- PATCH = approve. The leader approves their own area; admin on behalf.
UPDATE route_permissions SET methods = '{GET,POST,PATCH}'
 WHERE route_pattern = '/api/comercial/bloqueo' AND role = 'ventas';
UPDATE route_permissions SET methods = '{GET,POST,PATCH,DELETE}'
 WHERE route_pattern = '/api/comercial/bloqueo' AND role = 'admin';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM route_permissions WHERE route_pattern = '/api/comercial/bloqueo' AND role = 'ventas' AND 'PATCH' = ANY(methods)) THEN
    RAISE EXCEPTION 'ventas lacks PATCH on /api/comercial/bloqueo';
  END IF;
END $$;

COMMIT;
