-- FORECAST COMERCIAL — Institucional forecasts PER SELLER (sub-channels).
--
-- WHY (Jorge, 2026-09-11): Institucional is not one leader with one list —
-- it is five sellers, each forecasting THEIR OWN customers (68 % of the
-- channel's volume is one-client SKUs; the seller is the one who knows
-- whether that client orders again). So `institucional` becomes a PARENT
-- area with five child areas, one per seller, attributed by the order's
-- salesperson (`sale.order.user_id`) inside team Institucional.
--
-- Measured in production Odoo 2026-09-11 (team 6, confirmed orders since
-- 2024-10): Alejandra Ortiz 4,755 · Lucrecia Cerezo 4,114 · Edna del Aguila
-- 3,760 · Silvia de Pichardo 1,408 · Angela De León 94 · Tania Acevedo 2,635
-- (Telemarketing, grouped under Tiendas — Jorge) · 2 stray orders in two
-- years (Delty Monzon, Sandy Requena) → «sin asignar».
--
-- WHAT CHANGES:
--   1. comercial_areas.padre — a child area rolls up into its parent on
--      Wilmer's page and in the consolidado; the parent captures nothing.
--   2. comercial_area_reglas.odoo_user_ids / excluir_user_ids — a rule can
--      name salespeople, not only the team.
--   3. Seeds: five child areas (INSTI seasonal group, index shown-not-applied
--      like the parent), five seller rules, Tania's Institucional-team orders
--      to tiendas, and the old team-wide `institucional` rule removed.
--
-- The `institucional` login stays: it becomes a read-only view of the five
-- sellers' columns plus a total (Jorge). Its user_profiles.area still says
-- `institucional`; the API treats a parent area as read-only.
--
-- Apply by hand in the SQL editor. Idempotent. Rollback at the end.

BEGIN;

ALTER TABLE comercial_areas
  ADD COLUMN IF NOT EXISTS padre VARCHAR(40) REFERENCES comercial_areas(slug);
COMMENT ON COLUMN comercial_areas.padre IS
  'Parent area. A child (padre NOT NULL) has its own leader, rules, history, '
  'locks and captures; it rolls up into the parent on Wilmer''s page and in the '
  'consolidado. A parent captures nothing itself.';

ALTER TABLE comercial_area_reglas
  ADD COLUMN IF NOT EXISTS odoo_user_ids INT[],
  ADD COLUMN IF NOT EXISTS excluir_user_ids INT[];
COMMENT ON COLUMN comercial_area_reglas.odoo_user_ids IS
  'Restrict the rule to these salespeople (sale.order.user_id = res.users.id). NULL = any.';
COMMENT ON COLUMN comercial_area_reglas.excluir_user_ids IS
  'Exclude these salespeople. NULL = exclude none.';
ALTER TABLE comercial_area_reglas DROP CONSTRAINT IF EXISTS comercial_area_reglas_no_ambiguous_users;
ALTER TABLE comercial_area_reglas ADD CONSTRAINT comercial_area_reglas_no_ambiguous_users
  CHECK (odoo_user_ids IS NULL OR excluir_user_ids IS NULL);
-- The unique index must see the new dimensions too.
DROP INDEX IF EXISTS uq_comercial_area_reglas;
CREATE UNIQUE INDEX IF NOT EXISTS uq_comercial_area_reglas
  ON comercial_area_reglas (area, odoo_team_id,
                            COALESCE(sucursal_ids, '{}'), COALESCE(excluir_sucursal_ids, '{}'),
                            COALESCE(odoo_user_ids, '{}'), COALESCE(excluir_user_ids, '{}'));

-- The five sellers. Slugs follow the login convention i.<apellido>.
INSERT INTO comercial_areas (slug, nombre, activa, aplica_estacional, grupo_sai, padre) VALUES
  ('institucional_ortiz',     'Institucional · Alejandra Ortiz',    true, false, 'INSTI', 'institucional'),
  ('institucional_cerezo',    'Institucional · Lucrecia Cerezo',    true, false, 'INSTI', 'institucional'),
  ('institucional_delaguila', 'Institucional · Edna del Aguila',    true, false, 'INSTI', 'institucional'),
  ('institucional_pichardo',  'Institucional · Silvia de Pichardo', true, false, 'INSTI', 'institucional'),
  ('institucional_deleon',    'Institucional · Angela De León',     true, false, 'INSTI', 'institucional')
ON CONFLICT (slug) DO UPDATE
  SET nombre = EXCLUDED.nombre, activa = EXCLUDED.activa, aplica_estacional = EXCLUDED.aplica_estacional,
      grupo_sai = EXCLUDED.grupo_sai, padre = EXCLUDED.padre;

-- The parent no longer has rules of its own: its demand is the sum of its children.
DELETE FROM comercial_area_reglas WHERE area = 'institucional';

INSERT INTO comercial_area_reglas (area, odoo_team_id, odoo_user_ids, nota) VALUES
  ('institucional_ortiz',     6, '{52}',  'Institucional, orders by Alejandra Ortiz (res.users 52)'),
  ('institucional_cerezo',    6, '{54}',  'Institucional, orders by Lucrecia Cerezo (54)'),
  ('institucional_delaguila', 6, '{53}',  'Institucional, orders by Edna del Aguila (53)'),
  ('institucional_pichardo',  6, '{55}',  'Institucional, orders by Silvia de Pichardo (55)'),
  ('institucional_deleon',    6, '{198}', 'Institucional, orders by Angela De León (198)'),
  ('tiendas',                 6, '{56}',  'Tania Acevedo (56) is Telemarketing → Tiendas, even on Institucional-team orders (Jorge 2026-09-11)')
ON CONFLICT DO NOTHING;

-- Existing history rows of the parent are now stale: the next sync writes
-- the children and purges what it did not touch, but do not wait for it.
DELETE FROM comercial_demanda_canal WHERE area = 'institucional';

DO $$
DECLARE n_hijos INT; n_reglas_padre INT; n_reglas_hijos INT;
BEGIN
  SELECT count(*) INTO n_hijos FROM comercial_areas WHERE padre = 'institucional' AND activa;
  IF n_hijos <> 5 THEN RAISE EXCEPTION 'expected 5 active Institucional children, found %', n_hijos; END IF;
  SELECT count(*) INTO n_reglas_padre FROM comercial_area_reglas WHERE area = 'institucional';
  IF n_reglas_padre <> 0 THEN RAISE EXCEPTION 'the parent institucional still has % rules', n_reglas_padre; END IF;
  SELECT count(*) INTO n_reglas_hijos FROM comercial_area_reglas r JOIN comercial_areas a ON a.slug = r.area
   WHERE a.padre = 'institucional';
  IF n_reglas_hijos <> 5 THEN RAISE EXCEPTION 'expected 5 seller rules, found %', n_reglas_hijos; END IF;
  IF NOT EXISTS (SELECT 1 FROM comercial_area_reglas WHERE area = 'tiendas' AND odoo_team_id = 6 AND odoo_user_ids = '{56}') THEN
    RAISE EXCEPTION 'Tania Acevedo rule missing';
  END IF;
END $$;

COMMIT;

-- ROLLBACK (exact):
--   DELETE FROM comercial_area_reglas WHERE area LIKE 'institucional_%' OR (area = 'tiendas' AND odoo_team_id = 6);
--   INSERT INTO comercial_area_reglas (area, odoo_team_id, nota) VALUES ('institucional', 6, 'Institucional, any sucursal');
--   UPDATE user_profiles SET area = 'institucional' WHERE area LIKE 'institucional_%';
--   DELETE FROM comercial_forecast WHERE area LIKE 'institucional_%';   -- only if none captured
--   DELETE FROM comercial_areas WHERE padre = 'institucional';
--   ALTER TABLE comercial_area_reglas DROP COLUMN odoo_user_ids, DROP COLUMN excluir_user_ids;
--   ALTER TABLE comercial_areas DROP COLUMN padre;
