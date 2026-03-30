-- ============================================================================
-- OA Module v2 — Improvements based on client answers (_Respuestas.pdf)
-- Date: 2026-03-30
-- ============================================================================

-- ============================================================================
-- 1. Add volume and export fields to products
-- ============================================================================

-- Product volume in m3 — 74.6% of products have this in Odoo (product.product.volume)
ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_m3 NUMERIC(12,6);

-- Export flag — products from international suppliers (Carvajal/El Salvador, Reyma/Mexico)
-- cannot be paused or reduced once ordered (may be on ship or land route)
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_export BOOLEAN NOT NULL DEFAULT false;

-- Supplier origin country for logistics planning
ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_origin VARCHAR(50);

-- ============================================================================
-- 2. Extend reception_schedule for actual time tracking
-- ============================================================================

-- Actual start/end timestamps for auto-recalculating unload times
ALTER TABLE reception_schedule ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE reception_schedule ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- ============================================================================
-- 3. Extend unloading_times for auto-recalculation
-- ============================================================================

-- Manual override flag: when true, use estimated_hours (manual); when false, use calculated_hours
ALTER TABLE unloading_times ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT true;

-- Auto-calculated average from historical data
ALTER TABLE unloading_times ADD COLUMN IF NOT EXISTS calculated_hours NUMERIC(5,2);

-- How many real measurements were used to calculate the average
ALTER TABLE unloading_times ADD COLUMN IF NOT EXISTS sample_count INT NOT NULL DEFAULT 0;

-- ============================================================================
-- 4. Seed warehouse_config with REAL data from client answers
--    Bodega Central: 5 rampas
--    Bodega Zona 11: 1 rampa
--    Bodega Peten: 1 rampa
--    Bodega Zacapa: 1 rampa
--    Working hours: 06:00 to 00:00 (18 effective hours, 2 shifts)
--    max_capacity_m3 left NULL — client must provide this value
-- ============================================================================

INSERT INTO warehouse_config (warehouse_id, warehouse_label, num_docks, working_hours_start, working_hours_end, dock_cleanup_minutes, overtime_threshold)
VALUES
  (1, 'Bodega Central',  5, '06:00', '00:00', 30, '16:00'),
  (2, 'Bodega Zona 11',  1, '06:00', '00:00', 30, '16:00'),
  (3, 'Bodega Peten',    1, '06:00', '00:00', 30, '16:00'),
  (4, 'Bodega Zacapa',   1, '06:00', '00:00', 30, '16:00')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 5. Auto-derive is_export from product_suppliers relationships
--    Carvajal supplier IDs: 300, 301, 490, 550
--    Reyma supplier ID: 1752
--    These are international suppliers — products cannot be paused once ordered
-- ============================================================================

UPDATE products SET is_export = true, supplier_origin = 'el_salvador'
WHERE id IN (
  SELECT DISTINCT ps.product_id
  FROM product_suppliers ps
  WHERE ps.supplier_id IN (300, 301, 490, 550)
);

UPDATE products SET is_export = true, supplier_origin = 'mexico'
WHERE id IN (
  SELECT DISTINCT ps.product_id
  FROM product_suppliers ps
  WHERE ps.supplier_id = 1752
)
AND (is_export = false OR is_export IS NULL);

-- ============================================================================
-- 6. Add index for export product queries
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_products_export ON products(is_export) WHERE is_export = true;
CREATE INDEX IF NOT EXISTS idx_products_volume ON products(volume_m3) WHERE volume_m3 IS NOT NULL;
