-- ============================================================================
-- Warehouse cubicaje capacity — Central seeded, others left NULL
-- ============================================================================
-- Alexis (Gerente General) asked on 2026-04-22 (lines 80-98 of the feedback
-- transcript) for cubicaje visibility: "cuántos furgones representa mi compra
-- versus mi espacio de almacenamiento."
--
-- For tomorrow's demo, only the Central (San José) warehouse is needed —
-- Carvajal and Reyma both feed Central. Capacity for Central comes from the
-- Warehouse Dimensions user memory (4 internal sub-bodegas × 2,501.82 m³ =
-- 10,007 m³), cross-referenced with the floor plan in ______PlanosBodegas.png.
--
-- Zacapa, Peten, Zona 11 capacities are approximate per Jorge's 2026-04-22
-- screenshot but not Mario-validated. Leave NULL until field measurements
-- land (post-Alexis approval, per plan §5 P2).
-- ============================================================================

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS capacity_m3 NUMERIC(10, 2);

COMMENT ON COLUMN warehouses.capacity_m3 IS
  'Usable cubicaje (m³) for racked storage. NULL = not yet measured. Central warehouse value is from 2026-04-22 user memory (4 × 2,501.82 m³) pending Mario field-validation.';

-- Seed the Central warehouse only. Other bodegas stay NULL.
UPDATE warehouses
SET capacity_m3 = 10007.28
WHERE id = 1
  AND name = '1 Bodega Central';
