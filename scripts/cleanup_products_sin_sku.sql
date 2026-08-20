-- ============================================================================
-- LIMPIEZA — filas basura en `products` (productos de Odoo sin default_code)
-- ============================================================================
-- NO es una migración a propósito: vive en scripts/ para que `supabase db push`
-- nunca la corra sola. Se ejecuta a mano, en el SQL editor, y SOLO DESPUÉS de
-- desplegar el fix del sync (ml/odoo_sync_reabastecimiento.py :: plan_catalog_rows).
-- Si se corre antes, el cron vuelve a crear 50 filas por hora.
--
-- ORIGEN (medido en producción 2026-08-20):
--   El matching pasó a ser SOLO-por-SKU el 2026-08-06 (los odoo_id cambian en
--   cada build). Un producto de Odoo sin `default_code` nunca puede volver a
--   emparejarse → caía en "genuinamente nuevo" en CADA corrida. Con el cron
--   horario vivo desde el 08-13: 50 inserts/hora ≈ 1,200/día.
--   products = 13,806 filas para 1,595 productos reales en Odoo.
--   Dos filas sin código llegaron a la tabla de Wilmer con velocidad de venta:
--   'Descuento ' (p3=24, p6=37.8 en San José) y '88001005' (1 unidad).
--
-- QUÉ BORRA: filas de `products` con sku IS NULL que ninguna otra tabla
-- referencia, y los enlaces product_suppliers que apuntan a esas filas.
-- QUÉ NO BORRA: cualquier fila sin sku que sí esté referenciada por datos
-- históricos (ML: inventory_daily, stock_moves, sale_order_lines, demand_daily…).
-- Esas 48 filas (id <= 1653) son del cargue de marzo y se quedan: la limpieza
-- no toca dato del que cuelgue historia.
-- ============================================================================


-- ── PASO 0 · PREVIEW (solo lectura — correr primero y leer los números) ─────
WITH sin_sku AS (SELECT id FROM products WHERE sku IS NULL),
     referenciados AS (
       SELECT s.id FROM sin_sku s WHERE EXISTS (
         SELECT 1 FROM reabastecimiento_inputs t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM inventory_daily          t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM demand_daily             t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM stock_moves              t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM stock_quants             t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM sale_order_lines         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM purchase_order_lines     t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM revenue_daily            t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM revenue_daily_for_ml     t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM forecast_results         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM backtest_results         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM open_order_lines         t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM dispatch_plan_weeks      t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM extraordinary_order_lines t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM weekly_audits            t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM comercial_forecast       t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM transito_overrides       t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM pending_reserve_overrides t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM sync_issues              t WHERE t.product_id = s.id UNION ALL
         SELECT 1 FROM products_acid_test_active t WHERE t.products_id = s.id))
SELECT
  (SELECT count(*) FROM products)                                    AS products_hoy,
  (SELECT count(*) FROM products WHERE sku IS NOT NULL)              AS con_sku,
  (SELECT count(*) FROM sin_sku)                                     AS sin_sku,
  (SELECT count(*) FROM referenciados)                               AS sin_sku_referenciados_se_quedan,
  (SELECT count(*) FROM sin_sku) - (SELECT count(*) FROM referenciados) AS a_borrar,
  (SELECT count(*) FROM product_suppliers ps
     WHERE ps.product_id IN (SELECT id FROM sin_sku))                AS enlaces_proveedor_a_borrar;
-- Referencia 2026-08-20 20:30 UTC: products 13,956 · con_sku 1,668 · sin_sku 12,288
-- · referenciados ~48 · a_borrar ~12,240 · enlaces ~746. (sin_sku crece 50/hora
--   mientras el fix no esté desplegado.)


-- ── PASO 1 · LIMPIEZA (transaccional — todo o nada) ─────────────────────────
BEGIN;

-- Congelar el conjunto una sola vez: product_suppliers NO entra en el guard
-- (sus enlaces a productos basura son basura y se borran en el mismo paso).
CREATE TEMP TABLE basura ON COMMIT DROP AS
SELECT p.id FROM products p
WHERE p.sku IS NULL
  AND NOT EXISTS (SELECT 1 FROM reabastecimiento_inputs   t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM inventory_daily           t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM demand_daily              t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM stock_moves               t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM stock_quants              t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM sale_order_lines          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_order_lines      t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM revenue_daily             t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM revenue_daily_for_ml      t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM forecast_results          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM backtest_results          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM open_order_lines          t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM dispatch_plan_weeks       t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM extraordinary_order_lines t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM weekly_audits             t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM comercial_forecast        t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM transito_overrides        t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM pending_reserve_overrides t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM sync_issues               t WHERE t.product_id = p.id)
  AND NOT EXISTS (SELECT 1 FROM products_acid_test_active t WHERE t.products_id = p.id);

SELECT count(*) AS filas_a_borrar FROM basura;

DELETE FROM product_suppliers WHERE product_id IN (SELECT id FROM basura);
DELETE FROM products          WHERE id         IN (SELECT id FROM basura);

-- Leer los dos conteos ANTES de confirmar. Si no cuadran con el preview: ROLLBACK.
SELECT count(*) AS products_despues,
       count(*) FILTER (WHERE sku IS NULL) AS sin_sku_restantes
FROM products;

COMMIT;   -- ← o ROLLBACK; si algo no cuadra


-- ── PASO 2 · VERIFICACIÓN (después de la siguiente corrida horaria) ─────────
-- products_inserted debe ser 0 en cada corrida a partir del deploy del fix.
-- SELECT started_at, counts->>'products_inserted' AS insertados,
--        counts->>'input_rows' AS filas
-- FROM sync_runs WHERE kind = 'reabastecimiento'
-- ORDER BY started_at DESC LIMIT 5;


-- ── PASO 3 · OPCIONAL · candado para que no vuelva a pasar ──────────────────
-- Hoy el único código que inserta en `products` es el sync ya corregido
-- (verificado 2026-08-20: el frontend solo lee; odoo_sync_oa_v2 solo hace PATCH
-- por sku; el sync de Reyma no escribe la tabla). NOT VALID = las 48 filas
-- históricas sin sku se quedan como están; solo se bloquean inserts nuevos.
-- Si se adopta, va como migración: supabase/migrations/20260820000001_products_sku_present.sql
--
-- ALTER TABLE products
--   ADD CONSTRAINT products_sku_present CHECK (sku IS NOT NULL) NOT VALID;
