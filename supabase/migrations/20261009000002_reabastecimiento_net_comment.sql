-- The live grid does not use the formula in the original table comment.
-- Net stock is existencias - reserved - the pending quantity read from Odoo
-- on each request. Patio is shown and is not an input to Sugerido.
-- The pending_reserve column is not what gets subtracted.

COMMENT ON TABLE reabastecimiento_inputs IS
  'Synced Odoo inputs per product and bodega for the live replenishment grid. '
  'Net stock shown there is existencias - reserved - pending read live from Odoo. '
  'Patio is visible and is not an input to Sugerido. '
  'The pending_reserve column is not what gets subtracted.';
