-- FORECAST COMERCIAL — motivo `ajustado`: the leader changed the app's number.
--
-- WHY (Jorge, 2026-09-11, «Modificados» filter): "modified" has to be a fact
-- recorded at save time, not a live comparison — the recommendation moves a
-- little with every hourly sync, so a row approved unchanged yesterday would
-- read as modified today. When the saved quantity differs from the
-- recommendation at that moment, the row is stored as `ajustado` instead of
-- `base`. Like `base`, it NEVER sums into the Sugerido (plan L2 §1 Q5); the
-- consolidado shows both in the «Aprobado (no suma)» column.
--
-- Apply by hand in the SQL editor. Idempotent.
-- ROLLBACK: re-create the CHECK without 'ajustado' (after UPDATE … SET motivo='base' WHERE motivo='ajustado').

ALTER TABLE comercial_forecast DROP CONSTRAINT IF EXISTS comercial_forecast_motivo_check;
ALTER TABLE comercial_forecast ADD CONSTRAINT comercial_forecast_motivo_check
  CHECK (motivo IN ('extraordinaria', 'temporada', 'critico', 'base', 'ajustado'));
