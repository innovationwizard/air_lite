# Plan 006 — Per-Warehouse Hot List Implementation Progress
**Started:** 2026-05-08  
**Objective:** Add per-warehouse stock rows + warehouse filter to the Hot List (`/preocupaciones/desabastecimiento`), closing the last gap from Plan 005 (P2 warehouse filter).  
**Rule:** Update this file after EVERY batch before moving to the next.

---

## Context

From the gap analysis: "Location imbalance detection: same SKU with 45 days in Bodega 1 and 2 days in Bodega 2 — flag before buying more."  
From Plan 005 acceptance criteria (incomplete): "Hot List filterable by supplier, **warehouse**, risk level, and search."

Data confirmed available: `inventory_daily` has `warehouse_id NOT NULL` with UNIQUE on `(product_id, warehouse_id, snapshot_date)`. 10 internal warehouses in raw data. Data is already per-warehouse in the DB — the old RPC just aggregated it away.

**Architecture decision:** Create a NEW RPC `rpc_stockout_risks_by_warehouse()` that returns `product × warehouse` rows. Keep `rpc_stockout_risks()` untouched — the Compras and Operaciones command centers call it and must not be broken. The Hot List page is upgraded to fetch the per-warehouse RPC, aggregate client-side for KPI totals (deduplicating by product_id), and show per-warehouse rows when a specific warehouse is filtered.

---

## Batch Status

| Batch | Description | Status | Notes |
|---|---|---|---|
| B1 | Read all source files | ✅ Done | Risk levels are lead-time-based, not fixed thresholds. Page fetches product-level aggregated data. |
| B2 | New migration: `rpc_stockout_risks_by_warehouse` + apply | ✅ Done | 20260508000003 applied to remote Supabase |
| B3 | New API route: `/api/kpis/stockout-risk-by-warehouse` | ✅ Done | New file, existing route untouched |
| B4 | Update `desabastecimiento/page.tsx` — warehouse filter + per-warehouse display | ✅ Done | Both endpoints fetched in parallel; KPI totals always product-level |
| B5 | TypeScript verification | ✅ Done | tsc --noEmit: 0 errors |

---

## Files to Read (B1)

- `supabase/migrations/20260508000001_rpc_stockout_risks_add_financial.sql` — current RPC definition
- `frontend/src/app/api/kpis/stockout-risk/route.ts` — current API route
- `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx` — current page

---

## Decisions Log

- **New RPC, not modify old one:** `rpc_stockout_risks()` is called by compras/page.tsx and operaciones/page.tsx. Touching it risks breaking the command centers. New function = zero breakage risk.
- **Per-warehouse as second endpoint:** `/api/kpis/stockout-risk-by-warehouse` — new file, no changes to existing route.
- **Client-side aggregation for KPI totals:** When showing "Todas las bodegas", deduplicate by product_id and take worst risk_level. Do NOT double-count the same product in two warehouses as two "critical items."
- **days_of_supply semantics:** `warehouse_stock / company_avg_daily_demand`. Demand is product-level (not split by warehouse). Labeled clearly in UI.
- **Warehouse filter only changes the table, not KPI totals:** KPI totals always reflect company-wide product-level risk. Warehouse filter narrows the rows shown.

---

## Blocked Items

*(none yet)*

---

## Changes Made

*(filled in as batches complete)*
