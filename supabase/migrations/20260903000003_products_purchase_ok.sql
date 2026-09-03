-- ============================================================================
-- products.purchase_ok — Odoo product.template "Can be Purchased" flag
-- Date: 2026-09-03
--
-- Feeds the "solo comprables" filter on reabastecimiento-vivo (Wilmer). Kept
-- live by ml/odoo_sync_reabastecimiento.py (sync_catalog): populated on
-- insert for new products, and repaired in place for existing ones when the
-- flag drifts from Odoo — unlike most product fields, which are set once and
-- never mutated (see that function's docstring).
--
-- Default true: Odoo's own default for the field, and the safe read for the
-- ~1,670 rows already in the table until the next sync backfills them.
-- ============================================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_ok BOOLEAN NOT NULL DEFAULT true;
