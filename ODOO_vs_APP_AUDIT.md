# Odoo vs AIRefill App — Data Comparison Audit (v6)

**Odoo Report Date:** Enero 2026 (frozen 2026-03-03 22:51:11)
**App API queries run:** 2026-03-04 (post v6 deploy: zero-price filter + aggregate margin formula + inventory clamp)
**Comparison date range:** Rolling 30-day window (2026-02-02 to 2026-03-04) for `/ventas/` endpoints; 90-day via `/bi/gerencia/strategic-reports`

---

## Changes Since v5

| # | Change | Status |
|---|--------|--------|
| 20 | **Zero-price filter** — added `AND s.total_price > 0` to 11 margin/COGS queries across 9 files. Filters Odoo section/note/sample lines with `unit_price = 0`. | **DEPLOYED** |
| 21 | **Aggregate margin formula** — replaced 7 `AVG((total_price - qty*cost) / NULLIF(total_price, 0))` formulas with correct `(SUM(revenue) - SUM(cost)) / NULLIF(SUM(revenue), 0)` | **DEPLOYED** |
| 22 | **Inventory valuation clamp** — applied `GREATEST(quantity_on_hand, 0)` to ~12 inventory valuation queries across 4 files to exclude negative backorder quantities | **DEPLOYED** |

---

## All Bugs Fixed (v1–v6)

| # | Bug | Fixed in |
|---|-----|---------|
| 1 | `/ventas/resumen` — BigInt serialization crash | v1 |
| 2 | `/gerencia/resumen-ejecutivo` — missing `orders` table | v1 |
| 3 | `sales_partitioned` had no Jan 2026 data (wrong dates) | v1 |
| 4 | `/ventas/productos-top` — BigInt serialization crash | v1 |
| 5 | BI sparklines ignoring date params | v1 |
| 6 | Duplicate sale lines (953K from 477K parsed) — LATERAL JOIN fan-out | v2 |
| 7 | `/ventas/tendencia` — BigInt serialization crash | v2 |
| 8 | `getWorkingCapital` ignoring date params | v2 |
| 9 | 24 BI queries missing `AND is_deleted = false` | v3 (deployed v4) |
| 10 | UOM not interpreted — raw quantities mixed across unit scales | v4 |
| 11 | Strategic report returning Q0.00 (`timestamptz >= text` cast error) | v4 |
| 12 | **COGS formula double-counting UOM** — `quantity * uom_ratio * p.cost` was wrong because `p.cost` is per-UOM-unit | v5 |
| 13 | **Unfiltered order states** — CSV included draft/cancelled/quotation orders (6.3% of orders, 5.5% of lines) | v5 |
| 14 | **Zero-price lines skewing margin** — Odoo section/note/sample lines with `total_price = 0` contributed cost but no revenue | v6 |
| 15 | **BI Gross Margin wrong formula** — `AVG(per-row-margin)` statistically skewed by outlier rows; replaced with aggregate formula | v6 |
| 16 | **Inventory value Q-202M** — negative `quantity_on_hand` from Odoo backorders; clamped with `GREATEST(qty, 0)` | v6 |

---

## 1. Summary KPIs

**Endpoint:** `GET /ventas/resumen` (rolling 30-day window: 2026-02-02 to 2026-03-04)

| Metric | Odoo (Jan) | App v4 | App v5 | App v6 | Notes |
|--------|-----------|--------|--------|--------|-------|
| **Venta Neta** | Q25,086,052 | Q33,741,995 | Q31,581,835 | **Q31,581,835** | Unchanged — zero-price filter doesn't affect revenue |
| **Unidades Vendidas** | 244,752 | 7,012,786 | 6,541,601 | **6,541,308** | Tiny reduction from zero-price filter |
| **Ticket Promedio** | N/A | Q1,111.84 | Q1,109.81 | Q1,109.81 | ~same |
| **% Margen Bruto** | 19.67% | -2,945.9% | -1.55% | **-1.54%** | Zero-price filter minimal impact (~0.01%). See root cause below. |
| **Productos Distintos** | ~14 shown | 750 | 724 | 724 | Same |

**Root cause of -1.54% margin:** The zero-price filter had minimal impact because the negative margin comes from products with `cost > unit_price` (data quality issue in `products` table). Top 10 products (38% of revenue) show 20.4% aggregate margin matching Odoo. The long tail of 714+ other products drags the aggregate negative. This requires Odoo data investigation, not further query changes.

---

## 2. Top Products (30-day window)

**Endpoint:** `GET /ventas/productos-top`

| # | Product | Revenue (v5) | Margin (v5) | Margin % | Was (v4) |
|---|---------|-------------|------------|----------|----------|
| 1 | BANDEJA 2P TERMO FOM BIO 10/50 | Q3,067,103 | **Q693,655** | **22.6%** | Q-21.4M |
| 2 | VASO DUROPORT No. 10 REYMA 40-25 | Q2,077,038 | **Q517,563** | **24.9%** | Q-60.0M |
| 3 | VASO No 8 OZ VIVA DUROPORT BIODEG. 40X25 | Q1,848,615 | **Q386,965** | **20.9%** | Q-50.3M |
| 4 | VASO DUROPORT No. 8 REYMA 40-25 | Q998,482 | **Q247,844** | **24.8%** | Q-29.6M |
| 5 | PORTACOMIDA BIO 7X7 C/D TERMO 4/50 | Q886,258 | **Q223,036** | **25.2%** | Q-1.8M |
| 6 | VASO No 10 OZ VIVA DUROPORT BIODEG.40X25 | Q866,757 | **Q164,119** | **18.9%** | Q-26.1M |
| 7 | VASO No.16 TRANSPARENTE REYMA 40/25 | Q795,755 | Q20,354 | 2.6% | Q-23.7M |
| 8 | VASO No. 12 TRANSPARENTE REYMA 20/50 | Q634,171 | **Q130,037** | **20.5%** | Q-9.3M |
| 9 | VASO No. 10 TRANSPARENTE REYMA 20/50 | Q414,439 | Q-27,375 | -6.6% | Q-5.9M |
| 10 | ENVASE DUROPORT REYMA 16 ONZ. 20/25 | Q406,055 | **Q85,499** | **21.1%** | N/A |

**Top 10 aggregate: Q11,994,672 revenue, Q2,441,696 margin = 20.4%** (close to Odoo's 19.67%)

---

## 3. BI Dashboards

### BI Gerencia Dashboard (`GET /bi/dashboards?role=Gerencia`)

| KPI | v4 Value | v5 Value | v6 Value | Notes |
|-----|----------|----------|----------|-------|
| Monthly Revenue | Q31,851,376 | Q29,728,555 | **Q29,709,214** | Tiny change from zero-price filter |
| Gross Margin | -19,066.89% | -982.34% | **-2.75%** | **FIXED** — aggregate formula + zero-price filter |
| Working Capital | Q46,706,843 | Q44,584,022 | **Q44,564,681** | Slight adjustment |
| Active Customers | 1,838 | 1,772 | 1,772 | Same |
| Revenue Volatility | Q699,108 | Q656,415 | Q656,415 | Stable |
| AI Value Add | Q0 | Q0 | Q0 | No AI features active |
| maxDataDate | — | 2026-03-03 | 2026-03-03 | |

**Note on BI Gross Margin (-2.75%):** Now uses correct aggregate formula `(SUM(revenue) - SUM(cost)) / NULLIF(SUM(revenue), 0)`. The -2.75% vs -1.54% (ventas/resumen) difference is due to different date windows and query scopes. Both are affected by the same `products.cost` data quality issue in the long tail.

---

## 4. Gerencia Executive Summary

**Endpoint:** `GET /gerencia/resumen-ejecutivo` (rolling 30-day)

| Metric | Odoo (Jan) | App v4 | App v5 | App v6 | Notes |
|--------|-----------|--------|--------|--------|-------|
| Ventas Totales | Q25,086,052 | Q33,741,995 | Q31,581,835 | **Q31,581,835** | Same |
| Margen Bruto | 19.67% | -2,945.9% | -1.55% | **-1.54%** | Minimal improvement from zero-price filter |
| Valor Inventario | N/A | Q-202,173,120 | Q-202,173,120 | **Q24,796,952** | **FIXED** — `GREATEST(qty, 0)` clamp |
| Perfect Order Rate | N/A | 0% | 0% | 0% | No delivery data |

---

## 5. Strategic Report

**Endpoint:** `POST /bi/gerencia/strategic-reports` (90-day: 2025-12-04 to 2026-03-04)

| Widget | v4 Value | v5 Value | Notes |
|--------|----------|----------|-------|
| **Ingresos Totales** | Q95,830,600 | **Q88,980,564** | -7.2% from confirmed-only filter |
| Delta vs prior period | -5.5% | **-4.2%** | |
| Other KPIs | No disponible | No disponible | Require delivery/purchase/inventory data |

---

## 6. Impact Summary

### v4 → v5: COGS formula + confirmed-order filter

| Metric | Before (v4) | After (v5) | Expected |
|--------|-------------|------------|----------|
| Top product margin (BANDEJA 2P) | Q-21.4M | **Q+693K (22.6%)** | ~20-25% |
| Top 10 aggregate margin | Deeply negative | **20.4%** | ~19.67% (Odoo) |
| Overall margin (`gerencia`) | -2,945.9% | **-1.55%** | ~15-20% |
| BI Gross Margin | -19,066.89% | -982.34% | Should use aggregate formula |
| Sale lines loaded | 476,882 | **450,464** | -5.5% reduction |
| 30-day revenue | Q33,741,995 | **Q31,581,835** | -6.4% |
| 90-day revenue | Q95,830,600 | **Q88,980,564** | -7.2% |

### v5 → v6: Zero-price filter + aggregate margin formula + inventory clamp

| Metric | Before (v5) | After (v6) | Notes |
|--------|-------------|------------|-------|
| Overall margin (`ventas/resumen`) | -1.55% | **-1.54%** | Minimal — root cause is `products.cost` data quality |
| BI Gross Margin | -982.34% | **-2.75%** | **FIXED** — aggregate formula replaced `AVG(per-row)` |
| Inventory Value | Q-202,173,120 | **Q+24,796,952** | **FIXED** — `GREATEST(qty, 0)` clamp |
| Working Capital | Q44,584,022 | **Q44,564,681** | Slight adjustment |
| Top 10 margin | 20.4% | 20.4% | Unchanged (already correct) |

---

## 7. Remaining Issues

| # | Issue | Severity | Status | Root Cause |
|---|-------|----------|--------|-----------|
| 1 | **App revenue still ~26% above Odoo** (Q31.6M vs Q25.1M for ~same period) | MEDIUM | OPEN | 30-day window is Feb 2–Mar 4, not Jan. Different date ranges. |
| 2 | **Overall margin -1.54% (should be ~19.67%)** | MEDIUM | OPEN | `products.cost` data quality: long tail of 714+ products have `cost > unit_price`, dragging aggregate margin negative. Top 10 (38% of revenue) show correct 20.4%. Requires Odoo data investigation. |
| 3 | ~~BI Gross Margin uses wrong formula~~ | — | **FIXED v6** | Replaced with aggregate formula. Now -2.75%. |
| 4 | ~~Inventory value negative (Q-202M)~~ | — | **FIXED v6** | Clamped with `GREATEST(qty, 0)`. Now Q+24.8M. |
| 5 | `/ventas/` endpoints ignore date query params | LOW | OPEN | Hardcoded 30-day rolling window |

### Recommended Next Steps

1. **Investigate `products.cost` data quality** — query products where `cost > price_min` to find which products have incorrect costs from Odoo. This is the root cause of -1.54% aggregate margin while top products show correct 20.4%.
2. **Add date params to `/ventas/` endpoints** for direct Odoo period comparison.
3. **Consider refreshing `products` table** with latest Odoo `product.template` export to fix cost data.
