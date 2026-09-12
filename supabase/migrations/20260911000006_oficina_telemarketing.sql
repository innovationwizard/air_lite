-- FORECAST COMERCIAL — Oficina and Telemarketing become channels of their own.
--
-- WHY (Jorge, 2026-09-11): the two teams had been folded into Mayoreo and
-- Tiendas (Q2, 2026-09-10). They are separate channels with their own
-- people — Oficina is Delty Monzon (team 10), Telemarketing is Olga Dieguez'
-- team (13) with Tania Acevedo — and each gets its own login, table and
-- pedido. Tania's history follows HER, not the team on the order: her
-- Institucional-team orders (616 since March, before she moved) and her
-- Tienda-team orders go to Telemarketing.
--
-- Seasonal index: shown, not applied, for both (Oficina's OFICI group was
-- never backtested alone; Telemarketing has ~1 month of history and no SAI).
--
-- Apply by hand in the SQL editor. Idempotent.
-- ROLLBACK (exact):
--   DELETE FROM comercial_area_reglas WHERE area IN ('oficina','telemarketing');
--   INSERT INTO comercial_area_reglas (area, odoo_team_id, nota) VALUES ('mayoreo', 10, 'Oficina -> Mayoreo'), ('tiendas', 13, 'Telemarketing -> Tiendas');
--   INSERT INTO comercial_area_reglas (area, odoo_team_id, odoo_user_ids, nota) VALUES ('tiendas', 6, '{56}', 'Tania -> Tiendas');
--   UPDATE comercial_area_reglas SET excluir_user_ids = NULL WHERE area = 'tiendas' AND odoo_team_id = 5;
--   UPDATE comercial_areas SET activa = false WHERE slug IN ('oficina','telemarketing');

BEGIN;

INSERT INTO comercial_areas (slug, nombre, activa, aplica_estacional, grupo_sai, padre) VALUES
  ('oficina',       'Oficina',       true, false, 'OFICI', NULL),
  ('telemarketing', 'Telemarketing', true, false, NULL,    NULL)
ON CONFLICT (slug) DO UPDATE
  SET nombre = EXCLUDED.nombre, activa = EXCLUDED.activa, aplica_estacional = EXCLUDED.aplica_estacional,
      grupo_sai = EXCLUDED.grupo_sai, padre = EXCLUDED.padre;

-- Out of Mayoreo and Tiendas…
DELETE FROM comercial_area_reglas WHERE area = 'mayoreo' AND odoo_team_id = 10;
DELETE FROM comercial_area_reglas WHERE area = 'tiendas' AND odoo_team_id IN (13, 6);
-- …and Tania out of the Tienda-team rule too: the person, not the team.
UPDATE comercial_area_reglas SET excluir_user_ids = '{56}'
 WHERE area = 'tiendas' AND odoo_team_id = 5;

INSERT INTO comercial_area_reglas (area, odoo_team_id, odoo_user_ids, nota) VALUES
  ('oficina',       10, NULL,   'Oficina (Delty Monzon), any sucursal'),
  ('telemarketing', 13, NULL,   'Telemarketing team (Olga Dieguez)'),
  ('telemarketing',  6, '{56}', 'Tania Acevedo (56) on Institucional-team orders: her history follows her'),
  ('telemarketing',  5, '{56}', 'Tania Acevedo (56) on Tienda-team orders: her history follows her')
ON CONFLICT DO NOTHING;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM comercial_areas WHERE slug IN ('oficina','telemarketing') AND activa AND padre IS NULL;
  IF n <> 2 THEN RAISE EXCEPTION 'expected 2 new top-level areas, found %', n; END IF;
  IF EXISTS (SELECT 1 FROM comercial_area_reglas WHERE (area = 'mayoreo' AND odoo_team_id = 10) OR (area = 'tiendas' AND odoo_team_id IN (13, 6))) THEN
    RAISE EXCEPTION 'old Oficina/Telemarketing rules still present';
  END IF;
  SELECT count(*) INTO n FROM comercial_area_reglas WHERE area = 'telemarketing';
  IF n <> 3 THEN RAISE EXCEPTION 'expected 3 telemarketing rules, found %', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM comercial_area_reglas WHERE area = 'tiendas' AND odoo_team_id = 5 AND excluir_user_ids = '{56}') THEN
    RAISE EXCEPTION 'tiendas team-5 rule must exclude Tania (56)';
  END IF;
END $$;

COMMIT;
