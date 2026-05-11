# Fix Demand Signal in Three Stockout/ABC RPCs — Plan 009

**Date:** 2026-05-11  
**Scope:** `rpc_stockout_risks`, `rpc_abc_xyz_classification`, `rpc_stockout_risks_by_warehouse` — all active products, all warehouses.  
**Stack:** Supabase PostgreSQL (plpgsql). Zero TypeScript changes.  
**Trigger:** `/compras` command center showed Excepciones activas = 0, GTQ en riesgo = —, Cobertura promedio = — after deploying Plan 008. GTQ inmovilizado (Q 15,099,815) was also identified as incorrect. Root cause analysis documented in `_qci/plan-009-fix-demand-signal-rpc.md`.

---

## Summary of Changes

| Category | Items |
|---|---|
| New SQL migrations applied to remote Supabase | 2 |
| RPCs fixed | 3 |
| TypeScript route changes | 0 |
| Page changes | 0 |

---

## Root Cause

All three RPCs computed `avg_daily_demand` using:
```sql
WHERE demand_date >= CURRENT_DATE - INTERVAL '30 days'
```

The inventory snapshot is from 2026-03-03. As of 2026-05-11, `CURRENT_DATE - 30 days` = April 11, 2026. `demand_daily` has no rows after 2026-03-03. The window returned zero rows for every product.

**Downstream consequences, confirmed by reading the SQL:**

1. `rpc_stockout_risks` and `rpc_stockout_risks_by_warehouse`: the WHERE clause `COALESCE(avg_demand, 0) > 0` filtered out every product → 0 rows → all Hot List KPIs showed 0/—.

2. `rpc_abc_xyz_classification`: `avg_daily_demand = 0` for all 980 rows. The GTQ inmovilizado formula (`max(0, current_stock - lead_time × 3 × avg_demand) × unit_cost`) collapsed to `current_stock × unit_cost` — treating **all** inventory as excess over policy. The Q 15,099,815 figure was the total value of all stock across all active products, not just the excess above the 3× lead-time maximum target.

**Verified before writing the fix (queries run directly against Supabase):**
- `demand_daily` date range: 2024-10-01 to 2026-03-03.
- 17,072 rows with `is_censored = false` exist in the target window (2025-12-03 to 2026-03-03). The demand signal is present and correct — only the time window filter was wrong.
- REYMA "11 de 12 SKUs" (vs. 12/12 in pre-implementation simulation): investigated and confirmed as **correct behavior**. All 12 REYMA demo SKUs have non-zero `products.cost` (Q 62–269) and non-zero `demand_daily.revenue` (Q 1M–10M+). The 11/12 means one SKU has adequate current stock (`target_stock ≤ current_stock`, so `qty_recommended = 0`). No fix needed.

---

## Migration 1 — `20260511000001_fix_rpc_demand_signal.sql`

**Change in all three RPCs:** Replace the stale `CURRENT_DATE`-relative demand window with a snapshot-anchored 90-day window computed at query time.

```sql
-- Before (all three RPCs):
WHERE dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'

-- After (all three RPCs):
DECLARE
  v_snapshot_date DATE;
  v_demand_from   DATE;
BEGIN
  SELECT MAX(id2.snapshot_date) INTO v_snapshot_date FROM inventory_daily id2;
  v_demand_from := v_snapshot_date - INTERVAL '90 days';
  ...
  WHERE dd.demand_date BETWEEN v_demand_from AND v_snapshot_date
```

**Why `MAX(snapshot_date)` instead of a hardcoded date:**  
Using the latest snapshot date as the anchor means the RPCs self-adapt if a newer snapshot is ever loaded into `inventory_daily`. Hardcoding `'2026-03-03'` would reintroduce the same breakage in the future.

**Why 90 days instead of 30:**  
- 30 days was already marginal at original deploy time (snapshot was 33 days old).
- 90 days is consistent with the order-plan route (`DEMAND_WINDOW_DAYS = 90`).
- 90 days produces a more statistically stable daily average (less sensitivity to weekly seasonality and short-term spikes).

**Functions rewritten (DROP + CREATE in each case):**
- `rpc_stockout_risks` — demand lateral join window fixed
- `rpc_abc_xyz_classification` — `recent_demand` CTE window fixed; revenue ranking and XYZ classification logic unchanged
- `rpc_stockout_risks_by_warehouse` — `demand_30d` CTE renamed to `demand_90d`, window fixed

---

## Migration 2 — `20260511000002_fix_rpc_risk_level_cast.sql`

**Discovered during verification of Migration 1.** After applying the demand window fix, `rpc_stockout_risks` returned:
```
{"code":"42804","details":"Returned type text does not match expected type character varying in column 9.","hint":null,"message":"structure of query does not match function result type"}
```

**Root cause:** PostgreSQL infers the type of bare string literals in a CASE expression as `text`. The RETURNS TABLE declared `risk_level VARCHAR` (`character varying`). PostgreSQL enforces this distinction strictly when the function is freshly compiled via DROP + CREATE. The previous version of the function (from migration `20260322000003`) was created with `CREATE OR REPLACE` on top of an existing function — PostgreSQL accepted the implicit coercion in that context. After the DROP in migration `20260511000001`, the fresh CREATE exposed the mismatch.

**Fix:** Add `::VARCHAR` cast to the `risk_level` CASE expression in `rpc_stockout_risks` and `rpc_stockout_risks_by_warehouse`. Also added `::NUMERIC` cast to the `9999` literal in `days_of_supply` CASE for the same reason.

`rpc_abc_xyz_classification` was unaffected — it already used `::CHAR(1)` and `::VARCHAR` casts on all its CASE expressions since migration `20260508000002`.

---

## Verified Results (queried against remote Supabase after both migrations)

### `rpc_stockout_risks`

| Risk level | Count |
|---|---|
| crítico | 322 |
| alto | 125 |
| medio | 21 |
| bajo | 279 |
| **Total** | **747** |

Sample (top 5 by urgency):
```
77201496   critico   dos=0.0d   lt=30d   avg_demand=1.000    unit_price=145.00
88110309   critico   dos=0.0d   lt=30d   avg_demand=17.000   unit_price=1.00
88110303   critico   dos=0.0d   lt=30d   avg_demand=3.000    unit_price=234.08
88110302   critico   dos=0.0d   lt=30d   avg_demand=4.000    unit_price=295.00
88110305   critico   dos=0.0d   lt=30d   avg_demand=5.000    unit_price=302.50
```

### `rpc_abc_xyz_classification`

| Demand signal | Count |
|---|---|
| `avg_daily_demand > 0` | 747 |
| `avg_daily_demand = 0` | 233 (legitimately no sales in 90-day window) |
| **Total** | **980** |

Sample GTQ inmovilizado (computed client-side from the corrected values):
```
77205001   AY   avg_demand=1706.110   stock=7898    dos=5d    gtq_inmov=Q 382,802
77205207   AY   avg_demand=378.613    stock=8241    dos=22d   gtq_inmov=Q 854,351
77201046   AZ   avg_demand=345.044    stock=0       dos=0d    gtq_inmov=Q 0
77205034   AY   avg_demand=305.135    stock=3373    dos=11d   gtq_inmov=Q 285,265
```

The Q 15,099,815 figure is no longer valid — GTQ inmovilizado now correctly reflects only stock above the `lead_time × 3` maximum policy target.

---

## Impact on UI (no code changes — RPCs drive all KPI cards)

| Page / Component | Before | After |
|---|---|---|
| `/compras` — Excepciones activas | 0 | Real count (crítico + alto from 447 items) |
| `/compras` — GTQ en riesgo | — | Real Q value |
| `/compras` — Cobertura promedio | — | Real days of supply average |
| `/compras` — Top 5 Excepciones panel | Absent (empty array) | Populated with top 5 by GTQ en riesgo |
| `/preocupaciones/desabastecimiento` | Empty table | 747 products, filterable |
| `/preocupaciones/capital-congelado` — GTQ total | Q 15,099,815 (wrong — all stock × cost) | Correct value (only excess above 3× LT target) |
| `/operaciones` command center | Same broken KPIs as `/compras` | Fixed |

---

## Files Changed

### New files
| File | Purpose |
|---|---|
| `supabase/migrations/20260511000001_fix_rpc_demand_signal.sql` | Demand window fix — all three RPCs |
| `supabase/migrations/20260511000002_fix_rpc_risk_level_cast.sql` | PostgreSQL `text` vs `VARCHAR` cast fix — two stockout RPCs |
| `_qci/plan-009-fix-demand-signal-rpc.md` | Root cause analysis, fix design, verified findings |

### No files modified
All fixes are contained in the two new migrations. All Next.js API routes, pages, and TypeScript interfaces are correct as-is.

---

## Key Design Decisions

**Snapshot anchor, not hardcoded date.**  
`MAX(snapshot_date) FROM inventory_daily` is used as the demand window upper bound. This makes the functions correct regardless of when they are called — no future maintenance needed if new snapshots are loaded.

**`demand_daily`, not `revenue_daily`.**  
The order-plan route (`/api/kpis/order-plan`) already uses `revenue_daily` as its demand source (the RPC field was broken and needed a workaround). These RPCs now use `demand_daily` with the corrected window. `demand_daily` has confirmed coverage for all active products (17,072 rows in the target window) — unlike `revenue_daily` which was loaded specifically for the 23 demo SKUs during the SSOT acid test work. Keeping the RPCs on `demand_daily` maintains correct behavior for the full ~1,251-product portfolio, not just the demo subset.

**90-day window, not 30-day.**  
The 30-day window was already stale at original deploy. 90 days is statistically more robust and consistent with the order-plan computation. Average daily demand derived from 90 days is less sensitive to short-term promotional spikes or slow periods that could distort risk classification.
