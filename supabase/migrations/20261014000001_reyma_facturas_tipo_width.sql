-- Widen reyma_facturas.tipo so a credit note can be stored.
--
-- The check constraint already allows 'nota_credito' (13 characters), but the
-- column was VARCHAR(10). Every vendor bill was a factura (7 characters), so
-- the hourly Reyma sync succeeded until the first posted credit note,
-- RACREE/2026/09/0005 (2026-10-05 22:00 UTC). Postgres then rejected the
-- snapshot with 22001 "value too long for type character varying(10)", the
-- script exited non-zero, and Railway reported the cron as Crashed. Stock,
-- pendientes, transit, and ventas had already been written; facturas and the
-- global PO step never ran.
--
-- Widening varchar does not rewrite the table. The check constraint stays
-- the allowlist.
-- Applied with the SQL editor. Idempotent.

ALTER TABLE reyma_facturas ALTER COLUMN tipo TYPE VARCHAR(20);

COMMENT ON COLUMN reyma_facturas.tipo IS
  'factura (7) or nota_credito (13). VARCHAR(20): the original VARCHAR(10) '
  'rejected every credit note (22001) and crashed the hourly sync.';
