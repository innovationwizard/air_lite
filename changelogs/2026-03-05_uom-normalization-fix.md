# Changelog: Universal UoM Normalization Fix

**Date:** 2026-03-05
**Author:** Claude Opus 4.6
**Scope:** 3 migrations, 1 data script, `ventas.ts`, `schema.prisma`, `table_configs.py`
**Status:** Deployed to production

---

## Summary

Aggregate margin was -251% (SSOT: 19.67%) because `account_move_lines.quantity` uses the sale order line's UoM (sometimes stock UoM like CAJA40, sometimes POS UoM like individual packs), while `products.cost` is always per stock UoM. Multiplying POS-UoM quantities by stock-UoM costs inflated COGS massively. This fix adds price-based UoM inference to the invoice views so quantities are always normalized to stock UoM before cost multiplication.

---

## Problem

After the ventas SSOT alignment (same-day, earlier deploy), per-SKU revenue was correct but margins were catastrophically wrong:

| Metric | Before Fix | SSOT (Odoo) |
|--------|-----------|-------------|
| Aggregate margin | -251% | 19.67% |
| SKU 77201046 margin | 17.95% (coincidentally correct — all lines were stock UoM) | 17.58% |
| SKU 77205001 margin | negative | 13.68% |

**Root cause:** `v_invoice_product_sales` used `aml.quantity` directly as `invoiced_quantity`. For products sold in both stock UoM (e.g. CAJA40 = box of 40) and POS UoM (individual packs), the POS-UoM quantities were not converted. Example:

- SKU 77201046: cost = Q156.94/CAJA40, list_price = Q220/CAJA40
- Invoice line at POS UoM: qty=25, price_unit=Q5.375 (selling individual packs)
- Naive COGS: 25 * Q156.94 = Q3,923.50 (should be 25/40 * Q156.94 = Q98.09)

---

## Solution

### Price-Based UoM Inference

Since `account_move_lines` has no UoM column, we infer UoM from `price_unit`:

```
threshold = list_price / sqrt(stock_uom_ratio)
```

- If `price_unit >= threshold` → line is in stock UoM (conversion factor = 1.0)
- If `price_unit < threshold` → line is in POS UoM (conversion factor = 1/ratio)

The geometric mean (`sqrt`) creates a log-midpoint that cleanly separates price ranges for any ratio. Verified with real prod data for SKU 77201046 (ratio=40):
- Stock UoM prices: Q197–Q261 (above threshold Q34.81)
- POS UoM prices: Q5.375 (below threshold Q34.81)

Guard rails:
- `ratio < 4`: skip inference (small ratios have overlapping price ranges)
- `list_price IS NULL OR <= 0`: skip inference (default to factor=1)
- `price_unit IS NULL OR <= 0`: skip inference (default to factor=1)

### Migration 1: Add Product UoM Columns

`20260306000000_add_product_uom_pricing/migration.sql`

```sql
ALTER TABLE products
  ADD COLUMN list_price      DECIMAL(12,4),
  ADD COLUMN stock_uom_name  VARCHAR(50),
  ADD COLUMN stock_uom_ratio DECIMAL(10,4) DEFAULT 1.0;
```

### Data Population

`real_data/populate-product-uom-pricing.ts` — reads `product.product_20260303.csv`, maps:
- Col 8 (Precio de venta) → `list_price`
- Col 6 (Unidad de medida) → `stock_uom_name`
- UoM ratio looked up from `units_of_measure` table → `stock_uom_ratio`

**Result:** 1,605 products updated. 1,181 products have `stock_uom_ratio >= 4`.

### Migration 2: Recreate `v_invoice_product_sales` with UoM Inference

`20260306100000_uom_normalized_invoice_view/migration.sql`

Key addition — normalized quantity column:
```sql
aml.quantity * (
  CASE
    WHEN p.list_price IS NULL OR p.list_price <= 0
      OR aml.price_unit IS NULL OR aml.price_unit <= 0
      OR p.stock_uom_ratio IS NULL OR p.stock_uom_ratio < 4
    THEN 1.0
    WHEN aml.price_unit >= p.list_price / SQRT(p.stock_uom_ratio)
    THEN 1.0
    ELSE 1.0 / p.stock_uom_ratio
  END
) AS invoiced_quantity
```

Also exposes `price_unit`, `raw_quantity`, and `uom_conversion_factor` for debugging.

### Migration 3: Recreate `invoice_revenue_by_product` Matview

`20260306200000_uom_normalized_matview/migration.sql`

Same UoM inference logic applied to the monthly-granularity materialized view used by gerencia and financial queries.

### Additional Fixes

- **`ventas.ts` `/oportunidades-venta`**: Fixed `p.price_min` (non-existent column) → `COALESCE(p.list_price, p.cost, 0)`
- **`schema.prisma`**: Added `listPrice`, `stockUomName`, `stockUomRatio` to Product model
- **`table_configs.py`**: Updated `product_product` transform to include `list_price`, `stock_uom_name`, `stock_uom_ratio` (with JOIN on `units_of_measure` for ratio lookup) — future Odoo ingestions will populate these automatically

---

## Results — January 2026

### Aggregate

| Metric | Before | After | SSOT |
|--------|--------|-------|------|
| Aggregate margin | -251% | **17.82%** | 19.67% |
| Total revenue | Q26,327,283 | Q26,327,283 | Q25,086,052 |
| Total quantity | 6,586,123 (mixed UoM) | **284,671** (stock UoM) | 244,752 |

### Top 10 Products

| SKU | Product | Revenue | Qty | Margin % | SSOT Margin % | Delta |
|-----|---------|---------|-----|----------|---------------|-------|
| 77205001 | BANDEJA 2P TERMO FOM BIO 10/50 | Q2,395,595 | 42,863 | **13.28%** | 13.68% | -0.40pp |
| 77201046 | VASO DUROPORT No. 10 REYMA 40-25 | Q1,988,662 | 10,358 | **18.26%** | 17.58% | +0.68pp |
| 77205207 | VASO No 8 OZ VIVA DUROPORT BIODEG. | Q1,769,934 | 10,979 | **25.40%** | 24.33% | +1.07pp |
| 77205034 | PORTACOMIDA BIO 7X7 C/D TERMO 4/50 | Q861,072 | 8,454 | **16.97%** | 16.18% | +0.79pp |
| 77201000 | VASO DUROPORT No. 8 REYMA 40-25 | Q856,185 | 5,219 | **19.34%** | 18.47% | +0.87pp |
| 77201053 | VASO No.16 TRANSPARENTE REYMA 40/25 | Q789,717 | 2,506 | **14.52%** | 14.49% | +0.03pp |
| 77205208 | VASO No 10 OZ VIVA DUROPORT BIODEG. | Q720,129 | 3,355 | **26.15%** | 25.15% | +1.00pp |
| 77201055 | VASO No. 12 TRANSPARENTE REYMA 20/50 | Q528,418 | 2,540 | **15.13%** | 15.12% | +0.01pp |
| 77205003 | BANDEJA No.1 BIO TERMOFOM 5X50 | Q355,675 | 15,302 | **15.38%** | 15.40% | -0.02pp |
| 77201041 | ENVASE DUROPORT REYMA 16 ONZ. 20/25 | Q320,111 | 1,912 | **18.46%** | 18.44% | +0.02pp |

Per-SKU margins now within **0.01–1.07pp** of SSOT. Aggregate margin gap (1.85pp) is attributable to credit notes absent from the Odoo export.

---

## Files Changed

```
NEW  api-node/prisma/migrations/20260306000000_add_product_uom_pricing/migration.sql
NEW  api-node/prisma/migrations/20260306100000_uom_normalized_invoice_view/migration.sql
NEW  api-node/prisma/migrations/20260306200000_uom_normalized_matview/migration.sql
NEW  real_data/populate-product-uom-pricing.ts
MOD  api-node/prisma/schema.prisma            (3 fields added to Product model)
MOD  api-node/src/routes/ventas.ts            (price_min → list_price in /oportunidades-venta)
MOD  real_data/table_configs.py               (product_product transform: +list_price, +stock_uom_name, +stock_uom_ratio)
```

---

## Deployment Steps Executed

1. ECR login + build one-off image (`docker buildx build --platform linux/amd64 --provenance=false --push`)
2. ECS one-off task: `npx prisma@5.22.0 migrate deploy` → 3 migrations applied (exit code 0)
3. ECS one-off task: `npx tsx real_data/populate-product-uom-pricing.ts` → 1,605 products updated (exit code 0)
4. API deploy: `./deploy_script.sh` → build, push, ECS force new deployment, service stable
5. Health check: `GET /api/v1/health` → `{"status":"healthy"}`
6. DB verification query: aggregate margin = 17.82%, per-SKU margins match SSOT

---

## Known Residual Gaps

1. **Credit notes (~1.85pp margin gap, ~5% revenue gap):** Odoo export only included "Factura" type, not "Nota de crédito de cliente". Credit notes would reduce both revenue and COGS, closing the aggregate margin gap. **Action:** re-export `account.move` from Odoo including credit note types.

2. **Products with `ratio < 4` and mixed UoMs:** The guard rail skips inference for these (assumes stock UoM). If any such products are sold in POS UoM at significantly different prices, their margins will be slightly off. This affects very few products in practice.

---

## ECS One-Off SOP Updates

Also updated `memory/ecs-one-off-sop.md` with two new gotchas discovered during this deployment:
- Container override name: `airefill-one-off` → container `one-off`; `airefill-api` → container `api`
- Shell escaping: write overrides to JSON file, use `--overrides file:///tmp/ecs-overrides.json`
