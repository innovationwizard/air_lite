# COMPRAS & OPERACIONES Demo Upgrade — Plan 005 + Plan 006

**Date:** 2026-05-08  
**Scope:** Full rewrite of the COMPRAS and OPERACIONES demo sections. 7 pages updated, 3 SQL migrations created and applied, 2 new API routes, 1 new page created.  
**Stack:** Next.js 14, TypeScript (strict), Supabase PostgreSQL (RPC), Tailwind CSS.  
**Trigger:** Gap analysis against world-class supply chain platforms (Slim4, Kinaxis, o9, Blue Yonder, SAP S/4HANA) produced in `_qci/gap-analysis-compras-operaciones-vs-best-in-class.md`. 10 identified gaps, all demo-blocking.  
**Non-constraint confirmed:** Live Odoo sync is a post-sale deliverable. All features use the existing real Supabase snapshot (PLASTICENTRO, S.A., March 3, 2026). Zero mock data.

---

## Summary of All Changes

| Category | Items |
|---|---|
| New SQL migrations applied to remote Supabase | 3 |
| New Next.js API routes | 2 |
| New Next.js pages | 1 |
| Pages rewritten (complete rewrite) | 4 |
| Pages updated (targeted additions) | 3 |
| New `_qci/` planning documents | 3 |
| New `_qci/` progress tracker | 2 |

---

## Priority 1 — Financial Quantification: Hot List (GTQ en riesgo)

**Gap closed:** Hot List showed risk labels only (Crítico/Alto). Decision makers could not answer "how much money is at risk right now?"

### Migration: `20260508000001_rpc_stockout_risks_add_financial.sql`

Extended `rpc_stockout_risks()` to return two new columns:
- `unit_price NUMERIC` — `products.list_price` (selling price, not cost — correct for revenue-at-risk calculation)
- `supplier_name VARCHAR` — primary supplier by shortest lead time (LATERAL join)

**Breaking change handled:** PostgreSQL's `cannot change return type of existing function` requires `DROP FUNCTION IF EXISTS` before `CREATE OR REPLACE`. Applied.

**GTQ en riesgo formula (client-side):**
```
max(0, lead_time_days - days_of_supply) × avg_daily_demand × unit_price
```
This is the revenue at risk if no purchase order is placed before the lead time elapses. Uses `list_price` (selling price) because the measure is lost sales revenue, not capital cost.

### Page: `preocupaciones/desabastecimiento/page.tsx` — complete rewrite

| Before | After |
|---|---|
| 3 KPI cards: counts only | 3 KPI cards: Items Críticos, GTQ en riesgo (Crítico+Alto), Total monitoreados |
| Sort: by days_of_supply ASC | Sort: GTQ en riesgo DESC (ties: days_of_supply ASC) — financial impact first |
| No supplier column | Proveedor column |
| No financial column | GTQ en riesgo column per row |
| No projected date | "Se agota" column: today + days_of_supply, formatted as "lun 11 may" |
| No filters | Risk chips, supplier dropdown, search, "Limpiar filtros" |
| No export | CSV export (UTF-8 BOM, honors filters, all columns, Spanish headers) |

---

## Priority 2 — Financial Quantification: Hold List (GTQ inmovilizado)

**Gap closed:** Hold List showed ABC/XYZ labels only. CFO question "how much working capital is frozen in slow-moving inventory?" went unanswered.

### Migration: `20260508000002_rpc_abc_xyz_add_inventory_fields.sql`

Extended `rpc_abc_xyz_classification()` to return five new columns:
- `current_stock NUMERIC` — sum across all warehouses at latest snapshot
- `avg_daily_demand NUMERIC` — 30-day rolling average from `demand_daily` (is_censored=false)
- `lead_time_days INT` — shortest lead time across suppliers
- `unit_cost NUMERIC` — `products.cost` (purchase cost, not list price — correct for capital calculation)
- `supplier_name VARCHAR` — primary supplier by shortest lead time

**Breaking change handled:** Same `DROP FUNCTION IF EXISTS` pattern as above.

**GTQ inmovilizado formula (client-side):**
```
max(0, current_stock - (lead_time_days × 3 × avg_daily_demand)) × unit_cost
```
`lead_time_days × 3` is the max policy target — consistent with the `rpc_days_of_inventory` thresholds (>3× LT = "hold"). Uses `cost` (purchase cost) because the measure is frozen capital, not lost revenue.

**Daily carrying cost:**
```
GTQ_inmovilizado × 0.18 / 365
```
18% annual holding cost rate — matches the rate used in the existing backtest savings calculation.

### Page: `preocupaciones/capital-congelado/page.tsx` — complete rewrite

| Before | After |
|---|---|
| 3 KPI cards: class counts | 3 KPI cards: GTQ inmovilizado total, Costo por día total, Items clase A |
| No GTQ column | GTQ inmovilizado column per row |
| No carrying cost | Costo/día column per row |
| No filters | ABC chips, XYZ chips (with separator), supplier dropdown, sort selector, search |
| Sort: by revenue (fixed) | Sort selector: GTQ inmovilizado (default) / ABC-XYZ class / CV de demanda |
| No policy context | Policy tooltip on ABC+XYZ badge hover (CSS group-hover); 9-cell policy legend panel |
| No export | CSV export (UTF-8 BOM, honors filters) |

**Policy tooltip data (local constant, no DB query):**
| Cell | Nivel de servicio | Stock de seguridad | Frecuencia |
|---|---|---|---|
| AX | 99% | 3 días | Semanal |
| AY | 97% | 7 días | Semanal |
| AZ | 95% | 14 días | Bisemanal |
| BX | 97% | 5 días | Quincenal |
| BY | 95% | 10 días | Quincenal |
| BZ | 90% | 14 días | Mensual |
| CX | 95% | 7 días | Mensual |
| CY | 90% | 10 días | Mensual |
| CZ | 85% | 14 días | Mensual |

---

## Priority 3 — Policy Context: Días de Inventario

**Gap closed:** "34 días" shown without context. Decision maker could not tell if that was good or bad without knowing the policy target.

### Page: `operaciones/dias-inventario/page.tsx` — targeted additions

**New columns:**
- **Cob. efectiva** (Cobertura efectiva): `days_of_supply - lead_time_days`
  - `< 0`: "OC atrasada" (red, bold) — already past the reorder point
  - `0–3`: `{n}d — Pedir ya` (amber, bold)
  - `> 3`: numeric, neutral
- **GTQ en stock**: `current_stock × unit_cost` — capital value of current inventory
- **vs. Política**: badge showing:
  - "BAJO mínimo" (red) — `days_of_supply < lead_time_days`
  - "OK" (green) — `lead_time_days ≤ days_of_supply ≤ lead_time_days × 3`
  - "SOBRE máximo" (blue) — `days_of_supply > lead_time_days × 3`

**KPI cards updated:** GTQ totals per status bucket shown below count (computed via `useMemo`).

**CSV export added** — UTF-8 BOM, honors current filters, all visible columns including new ones.

---

## Priority 4 — Forecast for COMPRAS Role

**Gap closed:** Live Prophet forecast lived at `/gerencia/forecast` (Gerencia/Superuser only). The decision maker with COMPRAS role never saw the core AI value proposition.

### New page: `compras/forecast/page.tsx`

Buyer-focused forecast view accessible to `CAN_VIEW_COMPRAS` (includes `compras` role). Access control at sidebar/layout level — consistent with all other pages.

**Differences from `gerencia/forecast`:**
- Default metric filter: `compras_ordenadas` (buyers care about PO quantities, not sales)
- Column order: Compras Ordenadas first, then Compras Recibidas, then Ventas
- **"¿Qué comprar ahora?" urgency panel:** fetches `/api/kpis/stockout-risk` in parallel with forecast APIs. Shows up to 5 SKUs where `days_of_supply < lead_time_days`, sorted by most urgent first. Each row shows days of inventory, lead time, and supplier name.
- Slightly shorter OC stoplight tooltips (technical depth reduced for buyer audience)

**Data sources:** Identical to `gerencia/forecast`:
- `/api/acid-test/forecast?scope=top&forecast_month=2026-02-01`
- `/api/acid-test/forecast?scope=top&forecast_month=2026-03-01`
- `/api/acid-test/purchase-history?scope=top`
- `/api/kpis/stockout-risk` (new — for urgency panel)

### Sidebar: `FearsSidebar.tsx` — targeted change

COMPRAS section: `"Forecast de Demanda" → /backtest` changed to `"Forecast de Compras" → /compras/forecast`.

### Hub: `compras/page.tsx` — card array update

"Forecast de Demanda" card renamed to "Demostración de Valor" (points to `/backtest`). New "Forecast de Compras" card added pointing to `/compras/forecast`.

---

## Priority 5 — Hub Pages: Static Card Grids → Live Command Centers

**Gap closed:** Inicio Compras and Inicio Operaciones showed card grids with zero data. First impression communicated "POC". Command centers communicate "production system".

### `compras/page.tsx` — complete rewrite

- Now `'use client'` — fetches `/api/kpis/stockout-risk` + `/api/kpis/abc-xyz` in parallel
- **4 KPI cards:** Excepciones activas (Crítico+Alto count), GTQ en riesgo (sum), GTQ inmovilizado (sum), Cobertura promedio (days)
- **Top 5 Excepciones panel:** critico+alto items sorted by GTQ en riesgo DESC; each row shows SKU, risk badge, GTQ, days/lead time; links to full Hot List
- **5 quick-action cards:** Forecast de Compras, Hot List, Hold List, Programación, Demostración de Valor
- Hardcoded "Wilmer, empecemos acá." removed → "Panel de Compras"

### `operaciones/page.tsx` — complete rewrite

- Now `'use client'` — fetches `/api/kpis/stockout-risk` + `/api/kpis/abc-xyz` in parallel
- **4 KPI cards:** Items Hot (count + GTQ en riesgo), Items Hold (count + GTQ inmovilizado), Cobertura promedio, Total inventario GTQ (all stock × unit_cost)
- **Status distribution bar:** horizontal segmented bar showing critico/alto/medio/bajo proportions with color legend
- **Top 5 Críticos panel:** by days_of_supply ASC; shows SKU, risk badge, days, lead time; links to Hot List
- **Top 5 Capital Inmovilizado panel:** by GTQ inmovilizado DESC; shows SKU, GTQ, unit count; links to Hold List
- **4 quick-action cards:** Días de Inventario, Hot List, Hold List, Órdenes Abiertas
- Hardcoded "Mario, empecemos acá." removed → "Panel de Operaciones"

---

## Priority 6 — ABC/XYZ Policy Consequence (Part of Hold List rewrite)

Covered in Priority 2 above. The policy tooltip and 9-cell legend panel were implemented as part of the Hold List rewrite.

---

## Priority 7 — CSV Export on All Table Pages

| Page | Export added | Notes |
|---|---|---|
| Hot List | ✅ | Honors risk/supplier/search/warehouse filters |
| Hold List | ✅ | Honors all filters; includes GTQ inmovilizado, Costo/día |
| Días de Inventario | ✅ | Honors warehouse/status/search filters; includes new columns |
| Programación de Compras | ✅ | Available when a week is loaded; exports all schedule lines for that week |

All exports: UTF-8 BOM (`﻿`) for Excel compatibility with Spanish locale. Filenames include ISO date. Spanish column headers throughout.

---

## Plan 006 — Per-Warehouse Hot List (Warehouse Filter)

**Gap closed:** Hot List had no warehouse filter. Demo would break on "show me just Bodega Zona 11." Also implements the "location imbalance detection" gap from the analysis (same SKU with critical stock in one bodega but healthy stock in another).

### Data availability confirmed

`real_data/stock.quant1_20260303.csv`: 4,331 internal stock rows across 10 warehouses. `inventory_daily` schema: `warehouse_id INT NOT NULL REFERENCES warehouses(id)`, UNIQUE on `(product_id, warehouse_id, snapshot_date)`. Data was always stored per warehouse — `rpc_stockout_risks()` was simply aggregating it away with `SUM`.

### Migration: `20260508000003_rpc_stockout_risks_by_warehouse.sql`

New function `rpc_stockout_risks_by_warehouse()` — does NOT modify `rpc_stockout_risks()` (command centers depend on it).

Returns `product × warehouse` rows where `quantity_on_hand > 0`.

Risk level thresholds: **identical to `rpc_stockout_risks()`** — lead-time-based, not fixed:
- `critico`: `stock <= 0`
- `alto`: `days_of_supply < lead_time_days`
- `medio`: `days_of_supply < lead_time_days × 1.5`
- `bajo`: `days_of_supply >= lead_time_days × 1.5`

`days_of_supply = warehouse_stock / company_avg_daily_demand`. Demand is product-level (company-wide), not split by warehouse — the standard interpretation. Labeled explicitly in the UI.

### New API route: `app/api/kpis/stockout-risk-by-warehouse/route.ts`

New file. Zero changes to the existing `/api/kpis/stockout-risk` route.

### `preocupaciones/desabastecimiento/page.tsx` — second rewrite

**Two endpoints now fetched in parallel on mount:**
1. `/api/kpis/stockout-risk` — product-level (for KPI totals; no double-counting)
2. `/api/kpis/stockout-risk-by-warehouse` — per-warehouse (for warehouse filter table)

**KPI totals (Items Críticos, GTQ en riesgo, Total monitoreados):** always computed from product-level data regardless of warehouse filter. A product that exists in 3 warehouses counts as 1 item, not 3.

**Warehouse filter behavior:**
- `"Todas las bodegas"` (default): table uses product-level rows — same UX as before
- `"2 Bodega Zona 11"` (example): table switches to per-warehouse rows for that bodega; "Bodega" column appears showing `code` badge + full name; explanatory note clarifies days_of_supply semantics

**New `WarehouseRisk` TypeScript interface** extends `StockoutRisk` with `warehouse_id`, `warehouse_name`, `warehouse_code`.

CSV export: includes "Bodega" column when per-warehouse view is active.

**Existing filters (risk chips, supplier dropdown, search) continue to work** on whichever row set is active (product-level or per-warehouse).

**"Limpiar filtros" also resets warehouse filter.**

---

## Files Changed (Complete List)

### New files
| File | Type | Purpose |
|---|---|---|
| `supabase/migrations/20260508000001_rpc_stockout_risks_add_financial.sql` | SQL migration | Adds `unit_price`, `supplier_name` to `rpc_stockout_risks()` |
| `supabase/migrations/20260508000002_rpc_abc_xyz_add_inventory_fields.sql` | SQL migration | Adds 5 inventory/financial fields to `rpc_abc_xyz_classification()` |
| `supabase/migrations/20260508000003_rpc_stockout_risks_by_warehouse.sql` | SQL migration | New `rpc_stockout_risks_by_warehouse()` function |
| `frontend/src/app/api/kpis/stockout-risk-by-warehouse/route.ts` | Next.js API route | Calls `rpc_stockout_risks_by_warehouse` |
| `frontend/src/app/(authenticated)/compras/forecast/page.tsx` | Next.js page | Buyer-facing forecast with urgency panel |
| `_qci/gap-analysis-compras-operaciones-vs-best-in-class.md` | Planning doc | 10-gap analysis vs. Slim4, Kinaxis, o9, etc. |
| `_qci/plan-005-compras-operaciones-roadmap.md` | Planning doc | 7-priority implementation plan |
| `_qci/plan-005-progress.md` | Progress tracker | Batch-by-batch progress log for Plan 005 |
| `_qci/plan-006-progress.md` | Progress tracker | Batch-by-batch progress log for Plan 006 |

### Modified files
| File | Change |
|---|---|
| `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx` | Complete rewrite ×2 (P1+P2+P7, then Plan 006 warehouse filter) |
| `frontend/src/app/(authenticated)/preocupaciones/capital-congelado/page.tsx` | Complete rewrite (P1+P2+P6+P7) |
| `frontend/src/app/(authenticated)/operaciones/dias-inventario/page.tsx` | New columns, KPI cards, CSV export (P3+P7) |
| `frontend/src/app/(authenticated)/compras/page.tsx` | Complete rewrite — live command center (P5) |
| `frontend/src/app/(authenticated)/operaciones/page.tsx` | Complete rewrite — live command center (P5) |
| `frontend/src/components/layout/FearsSidebar.tsx` | COMPRAS "Forecast de Demanda" → "Forecast de Compras" → `/compras/forecast` (P4) |
| `frontend/src/app/(authenticated)/poc/programacion/page.tsx` | CSV export added (P7) |

---

## TypeScript Verification

`npx tsc --noEmit` passed clean (0 errors) after every batch. Final verification after Plan 006 complete also clean.

---

## Gaps NOT Closed (Out of Scope — Post-Sale)

| Gap | Reason not closed |
|---|---|
| Purchase order creation workflow | Requires Odoo write-back and approval workflow |
| Supplier performance tracking | Requires live data cadence |
| Real-time demand split per warehouse | `demand_daily` is product-level; splitting by warehouse requires redesigned data pipeline |
| Scenario planning ("what if demand +30%") | Requires live parameterized simulation |

---

## Key Design Decisions

**GTQ en riesgo uses `list_price`; GTQ inmovilizado uses `cost`.**  
These are not the same number and should not be. `list_price` measures lost revenue (Hot List: sales you can't make). `cost` measures frozen capital (Hold List: money tied up in inventory). Using `cost` for the Hot List or `list_price` for the Hold List would produce meaningless numbers.

**KPI totals on Hot List always use product-level data, never per-warehouse.**  
If a product exists in 3 warehouses and all 3 are at risk, it is 1 critical product with Q47,000 at risk — not 3 products with Q141,000. Counting per-warehouse rows for company-level KPIs would inflate every number.

**`rpc_stockout_risks()` untouched by Plan 006.**  
The Compras and Operaciones command centers call it. Modifying it would require re-testing both command centers. New function `rpc_stockout_risks_by_warehouse()` is additive only.

**Policy parameters for ABC/XYZ stored as a TypeScript constant, not in DB.**  
These are defined policy values — they do not vary by product or by historical data. Adding a DB table for them would create a migration requirement every time policy is adjusted. A local constant is correct architecture for this use case.
