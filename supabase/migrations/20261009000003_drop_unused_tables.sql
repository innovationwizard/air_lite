-- Drop tables the application no longer reads or writes.
-- Policies and indexes go with the tables.
-- extraordinary_order_lines goes first: it references extraordinary_orders.
-- /api/poc/purchase-schedule is removed in the same change. Those two
-- purchase_schedule tables were never created. The /api/poc/* grant pointed
-- at a route that no longer exists.

DROP TABLE IF EXISTS extraordinary_order_lines;
DROP TABLE IF EXISTS extraordinary_orders;
DROP TABLE IF EXISTS transito_destino;
DROP TABLE IF EXISTS pending_reserve_overrides;
DROP TABLE IF EXISTS products_acid_test_archived;
DROP TABLE IF EXISTS audit_log;

DELETE FROM route_permissions
 WHERE route_pattern = '/api/poc/*'
    OR route_pattern LIKE '/api/poc/%';
