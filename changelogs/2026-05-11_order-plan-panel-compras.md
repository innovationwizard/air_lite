# Order Plan Panel — `/compras` Command Center (Plan 008)

**Date:** 2026-05-11  
**Scope:** 23 demo SKUs (12 REYMA + 11 CARVAJAL) — `is_top_10_in_class = true` in `products_acid_test_active`. Inventory snapshot: 2026-03-03.  
**Stack:** Next.js 14, TypeScript (strict), Supabase PostgreSQL (RPC + direct table query), Tailwind CSS.  
**Trigger:** The `/compras` command center KPI cards showed GTQ en riesgo and GTQ inmovilizado, but gave no answer to the compras manager's most immediate question: "¿Qué le compro a CARVAJAL esta semana? ¿Y a REYMA?" — zero purchasing recommendation existed anywhere on the page.

---

## Summary of All Changes

| Category | Items |
|---|---|
| New Next.js API routes | 1 |
| Modified Next.js pages | 1 |
| New `_qci/` planning documents | 1 |
| Broken data sources discovered and worked around | 2 |

---

## What Was Built

### New API Route: `frontend/src/app/api/kpis/order-plan/route.ts`

Returns a supplier-level purchasing summary for the 23 demo SKUs, aggregated by `supplier_class` (`CARVAJAL` / `REYMA`).

**Response shape:**
```typescript
{
  suppliers: SupplierOrderSummary[];   // one row per supplier_class
  snapshot_date: '2026-03-03';
  furgo_m3: 122;
  furgo_confirmed: false;              // always false until confirmed with client
}

interface SupplierOrderSummary {
  supplier_class: string;
  sku_count_total: number;            // all SKUs in supplier_class
  sku_count_with_order: number;       // SKUs where qty_recommended > 0
  total_gtq: number;                  // sum of qty_recommended × unit_cost
  total_furgones: number;             // sum of (qty_recommended × volume_m3) / 122
  skus_with_zero_lead_time: number;   // SKUs excluded due to lead_time_days = 0 in Odoo
}
```

**Data pipeline (4 queries, no new RPC):**
1. `products_acid_test_active` WHERE `is_top_10_in_class = true` → 23 SKUs with `supplier_class`
2. `products` WHERE `sku IN (23 demo SKUs)` → `volume_m3` per SKU
3. `rpc_abc_xyz_classification()` → `abc_class`, `xyz_class`, `current_stock`, `lead_time_days`, `unit_cost` per SKU
4. `revenue_daily` WHERE `metric = 'sales'` AND `observation_date` BETWEEN `2025-12-03` AND `2026-03-03` → summed to compute `avg_daily_demand` (90-day window before snapshot)

### Panel: `frontend/src/app/(authenticated)/compras/page.tsx`

New "Plan de compras — esta semana" panel inserted between the 4 KPI cards and the Top 5 Excepciones panel.

| Before | After |
|---|---|
| Page showed risk KPIs + top exceptions only | New panel shows CARVAJAL / REYMA order summary above exceptions |
| No purchasing recommendation on the page | SKU count (with order / total), GTQ value, furgones per supplier |
| `Promise.all` fetched 2 endpoints | `Promise.all` now fetches 3 in parallel (added `/api/kpis/order-plan`) |
| No furgones disclaimer on command center | Footer shows 53-pies caveat + lead-time gap counter |

---

## Order Recommendation Formula

```
safety_stock_days  = SAFETY_STOCK_DAYS[abc_class + xyz_class] ?? 7
target_stock       = avg_daily_demand × (2 × lead_time_days + safety_stock_days)
qty_recommended    = ceil(max(0, target_stock - current_stock))
gtq_value          = qty_recommended × unit_cost
furgones           = (qty_recommended × volume_m3) / 122
```

**Safety stock days by ABC/XYZ cell (source: `capital-congelado/page.tsx` policy constant):**

| Cell | Days | Cell | Days | Cell | Days |
|---|---|---|---|---|---|
| AX | 3 | BX | 5 | CX | 7 |
| AY | 7 | BY | 10 | CY | 10 |
| AZ | 14 | BZ | 14 | CZ | 14 |

**Constants:**
```typescript
const SNAPSHOT_DATE = '2026-03-03';
const DEMAND_WINDOW_DAYS = 90;
const DEMAND_FROM = '2025-12-03';
const FURGO_M3 = 122; // WARNING: unconfirmed with client — 53-foot trailer approximation
const DEFAULT_SAFETY_STOCK_DAYS = 7;
```

SKUs are skipped (not counted toward `sku_count_with_order`) if `avg_daily_demand = 0` or `unit_cost = 0`. SKUs with `lead_time_days = 0` are counted in `skus_with_zero_lead_time` and produce `qty_recommended = 0` (because `target_stock` collapses to `safety_stock_days × avg_daily_demand` which is typically less than `current_stock`).

---

## Broken Data Sources Discovered During Implementation

### 1. `avg_daily_demand = 0` in `rpc_abc_xyz_classification()` — all rows

**Discovery:** Running the RPC against all 980 rows returned `avg_daily_demand = 0` for every row without exception. The field exists in the function signature but is not correctly populated.

**Root cause:** The RPC's demand aggregation logic does not match where demand data is actually stored. The `demand_daily` table (referenced in the RPC) is not the authoritative source — `revenue_daily` (metric = `'sales'`) is.

**Workaround:** `avg_daily_demand` is computed entirely in the API route from `revenue_daily`, using a 90-day window before the snapshot date. The RPC's `avg_daily_demand` field is explicitly not used.

**Impact:** This affects any route that calls `rpc_abc_xyz_classification()` and trusts `avg_daily_demand`. The existing `/api/kpis/abc-xyz` route returns 0 for all items — this is a pre-existing issue, not introduced by this plan.

### 2. `lead_time_days = 0` for most CARVAJAL SKUs in Odoo

**Discovery:** Cross-referencing `rpc_abc_xyz_classification()` output against `real_data/product.supplierinfo_*.csv`: all CARVAJAL supplier info rows show `delay` (lead time) of 0 or 1 day in the CSV. This is a data quality issue in the Odoo configuration, not a pipeline bug.

**Effect:** 7 of 11 CARVAJAL SKUs return `lead_time_days = 0`, which collapses `target_stock` to `safety_stock_days × avg_daily_demand` — typically less than current stock, so `qty_recommended = 0`. Only 4 of 11 CARVAJAL SKUs produce an order recommendation.

**Handling:** The API route counts `skus_with_zero_lead_time` and returns it in the response. The UI footer displays this count ("N SKUs excluidos (lead time = 0 en Odoo)") so the compras manager understands why CARVAJAL shows fewer SKUs than expected. No assumed lead time is substituted — using a wrong lead time is worse than showing a gap.

---

## Computed Output (Python pre-implementation simulation)

Verified against real data before writing TypeScript. Numbers shown are from the simulation; actual API values may differ slightly due to floating-point rounding.

| Supplier | SKUs with order | Total SKUs | GTQ | Furgones |
|---|---|---|---|---|
| CARVAJAL | 4 | 11 | Q 690,007 | 5.6 |
| REYMA | 12 | 12 | Q 6,093,118 | 37.8 |

REYMA's larger GTQ reflects both higher SKU coverage (12/12 vs 4/11) and longer, correctly configured lead times in Odoo.

---

## Files Changed

### New files
| File | Type | Purpose |
|---|---|---|
| `frontend/src/app/api/kpis/order-plan/route.ts` | Next.js API route | Computes per-supplier order summary for 23 demo SKUs |
| `_qci/plan-008-order-plan-panel-compras.md` | Planning doc | Formula derivation, data source analysis, implementation plan |

### Modified files
| File | Change |
|---|---|
| `frontend/src/app/(authenticated)/compras/page.tsx` | Added `SupplierOrderSummary` interface, `orderPlan` + `orderPlanGaps` state, extended `Promise.all` to 3 fetches, new JSX panel |

---

## TypeScript Verification

`npx tsc --noEmit` — 0 errors on modified files after implementation.

---

## Known Limitations

| Limitation | Status |
|---|---|
| `FURGO_M3 = 122` (53-foot trailer) unconfirmed with client | Displayed as caveat in panel footer; `furgo_confirmed: false` in API response |
| No open PO deduction — if open POs exist, `qty_recommended` is overstated | Acceptable for demo scope; snapshot data does not include open PO real-time status |
| `avg_daily_demand = 0` bug in `rpc_abc_xyz_classification()` | Pre-existing; worked around in this route; root fix requires RPC rewrite (out of scope) |
| CARVAJAL lead times = 0 in Odoo for 7 of 11 SKUs | Pre-existing Odoo data quality issue; surfaced in UI with gap counter |
