-- ETA per factura/furgón on the PDF-captured lines (drop 2026-08-13).
--
-- Alexis encodes the furgón's ETA in the folder name of each mail drop
-- (e.g. 'zacapa-eta-agosto-14') — this is the live version of row 5 of his
-- SALDOS sheet (ETA por furgón). Stored per line (all lines of a factura
-- share the ETA of their furgón). Destino now also takes the regional
-- bodegas: 'bodega-san-jose' | 'bodega-zacapa' | 'bodega-peten' |
-- 'entrega-directa' (only the last one is excluded from the orden-global
-- saldo count — saldos.ts).
-- Applied via `supabase db push`. Idempotent.

ALTER TABLE reyma_facturas_pdf ADD COLUMN IF NOT EXISTS eta DATE;
