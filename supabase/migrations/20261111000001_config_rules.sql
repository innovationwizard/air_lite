-- Reabastecimiento calculation rules — phase 1, schema and seed.
--
-- The sync and the live page used to read these rules from constants in
-- ml/odoo_sync_reabastecimiento.py, ml/pendiente_reserva.py, ml/api.py, and
-- frontend/src/lib/compras/bodega.ts. This table is that same list, so a
-- later edit can change a rule without a deploy. This phase only adds the
-- table and the read path. Nothing in the app writes a new value, and the
-- seed below is the rule those constants already applied.
--
-- A reader that cannot see a row, or cannot query the table, keeps the
-- constant. Applying this migration therefore does not change a number.
-- ON CONFLICT DO NOTHING so a later edit survives a second `db push`.
--
-- Shapes, and the constant each one copies:
--   stock.existencias.locations  {"kind":"Existencias"}
--       Per-bodega location name is `{warehouse}/{kind}`. General keeps every
--       internal location whose complete_name ends with `/{kind}`.
--   stock.patio                   {"location":"1CET/Entrada",
--                                  "bodegas":["San Jose VN","General"]}
--       Yard quant, and which bodegas store it. Zacapa and Petén stay 0.
--   transit.rules                 {"states":["purchase","done"],
--                                  "date_cutoff":"today_utc"}
--       `today_utc` is not a frozen date. It means the PO header
--       date_planned, compared as text, is >= today's UTC date at 00:00:00
--       (`%Y-%m-%d 00:00:00`). Empty and past headers stay out.
--   transit.prefix_map            {"PO-P-":"1CET", ...}
--       Sucursal prefix → warehouse code. Exact match, not startswith.
--       PO-PZ11- stays unmapped on purpose.
--   pendiente.rules               {"sequence_codes":["OUT","INT"],
--                                  "excluded_states":["cancel","done"],
--                                  "origin":"warehouse_lot_stock"}
--       `warehouse_lot_stock` means the move leaves the warehouse's
--       lot_stock_id (its Existencias).
--   bodega.general_excluded_wh    ["5DEP"]
--       Warehouse codes left out of the General stock and tránsito roll-up.
--
-- config_rules_history is the audit trail. The trigger records the seed and
-- any later update. It does not participate in the calculation.
--
-- Reads: any signed-in profile (auth_role() IS NOT NULL), same as the
-- 2026-04-23 backfill. Writes stay on service_role. No route permission:
-- there is no endpoint in this phase.

CREATE TABLE IF NOT EXISTS config_rules (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ,
  updated_by  TEXT
);

CREATE TABLE IF NOT EXISTS config_rules_history (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key         TEXT,
  value       JSONB,
  changed_at  TIMESTAMPTZ DEFAULT now(),
  changed_by  TEXT,
  note        TEXT
);

CREATE INDEX IF NOT EXISTS idx_config_rules_history_key
  ON config_rules_history (key, changed_at DESC);

COMMENT ON TABLE config_rules IS
  'Reabastecimiento calculation rules. Phase 1 seed equals the previous constants; readers fall back to those constants when a row is missing or the query fails.';

COMMENT ON TABLE config_rules_history IS
  'Append-only copies of config_rules values. Written by trigger on insert and update, not by the calculation.';

ALTER TABLE config_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_rules_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS config_rules_read ON config_rules;
CREATE POLICY config_rules_read ON config_rules
  FOR SELECT USING (auth_role() IS NOT NULL);
DROP POLICY IF EXISTS config_rules_service_write ON config_rules;
CREATE POLICY config_rules_service_write ON config_rules
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS config_rules_history_read ON config_rules_history;
CREATE POLICY config_rules_history_read ON config_rules_history
  FOR SELECT USING (auth_role() IS NOT NULL);
DROP POLICY IF EXISTS config_rules_history_service_write ON config_rules_history;
CREATE POLICY config_rules_history_service_write ON config_rules_history
  FOR ALL USING (auth.role() = 'service_role');

GRANT SELECT ON config_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON config_rules TO service_role;
GRANT SELECT ON config_rules_history TO authenticated;
GRANT SELECT, INSERT ON config_rules_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.config_rules_history_id_seq TO service_role;

CREATE OR REPLACE FUNCTION config_rules_record_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO config_rules_history (key, value, changed_by, note)
  VALUES (NEW.key, NEW.value, NEW.updated_by, TG_OP);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS config_rules_record_history ON config_rules;
CREATE TRIGGER config_rules_record_history
  AFTER INSERT OR UPDATE ON config_rules
  FOR EACH ROW
  EXECUTE FUNCTION config_rules_record_history();

INSERT INTO config_rules (key, value, updated_at, updated_by)
VALUES
  (
    'stock.existencias.locations',
    '{"kind":"Existencias"}'::jsonb,
    now(),
    'seed'
  ),
  (
    'stock.patio',
    '{"location":"1CET/Entrada","bodegas":["San Jose VN","General"]}'::jsonb,
    now(),
    'seed'
  ),
  (
    'transit.rules',
    '{"states":["purchase","done"],"date_cutoff":"today_utc"}'::jsonb,
    now(),
    'seed'
  ),
  (
    'transit.prefix_map',
    '{
      "PO-P-": "1CET",
      "PO-PE-": "3PET",
      "PO-PZ-": "4ZAC",
      "PO-PT11-": "1CET",
      "PO-PT9-": "1CET",
      "PO-PT17-": "1CET",
      "PO-PTTorre-": "1CET",
      "PO-PT6-": "1CET"
    }'::jsonb,
    now(),
    'seed'
  ),
  (
    'pendiente.rules',
    '{
      "sequence_codes": ["OUT", "INT"],
      "excluded_states": ["cancel", "done"],
      "origin": "warehouse_lot_stock"
    }'::jsonb,
    now(),
    'seed'
  ),
  (
    'bodega.general_excluded_wh',
    '["5DEP"]'::jsonb,
    now(),
    'seed'
  )
ON CONFLICT (key) DO NOTHING;
