# Reorder Point Alerts — Pedir HOY / Pedir esta semana (Plan 010)

**Date:** 2026-05-11  
**Scope:** 23 demo SKUs (`is_top_10_in_class = true` in `products_acid_test_active`). Inventory snapshot: 2026-03-03.  
**Stack:** Next.js 14, TypeScript (strict), Supabase PostgreSQL, Tailwind CSS.  
**Trigger:** The `/compras` command center KPI grid showed financial exposure (GTQ en riesgo, GTQ inmovilizado) and order totals by supplier, but answered nothing about urgency timing — the compras manager could not tell which SKUs needed an order placed *today* vs. which could wait until later in the week. Two KPI cards were absent.

---

## Summary of Changes

| Category | Items |
|---|---|
| New API routes | 0 (existing route extended) |
| Modified Next.js API routes | 1 |
| Modified Next.js pages | 1 |
| New SQL migrations | 0 |
| New `_qci/` planning documents | 1 |

---

## What Was Built

### Two New KPI Cards: `frontend/src/app/(authenticated)/compras/page.tsx`

Inserted between the existing 4-card KPI grid and the Order Plan panel:

**Pedir HOY** (red) — count of SKUs where `current_stock ≤ ROP`. The reorder point has already been breached; an order should have been placed.

**Pedir esta semana** (amber) — count of SKUs where `current_stock > ROP` but `current_stock − avg_daily_demand × 7 ≤ ROP`. The reorder point will be breached within the next 7 calendar days at the current demand rate.

The two counts are **mutually exclusive**: a SKU belongs to exactly one category. If `current_stock ≤ ROP`, it is HOY regardless of the 7-day window.

Each card has an `ℹ` hover tooltip (Tailwind `group-hover:block` pattern, same as `capital-congelado/page.tsx`) with the full definition in Spanish, so the compras manager understands exactly what the number means without navigating away.

---

## ROP Formula

```
safety_stock_days  = SAFETY_STOCK_DAYS[abc_class + xyz_class] ?? 7 (default)
rop                = avg_daily_demand × (lead_time_days + safety_stock_days)

is_order_today     = current_stock ≤ rop                                             (eligible SKUs only)
is_order_this_week = current_stock > rop  AND  current_stock − avg_daily_demand × 7 ≤ rop
```

**Eligibility:** SKUs are counted only when `avg_daily_demand > 0` AND `lead_time_days > 0`. The 3 SKUs with `lead_time_days = 0` in Odoo (already surfaced by the order-plan panel gap counter) are excluded from both counts.

**Safety stock days by ABC/XYZ cell** (source: `capital-congelado/page.tsx` CELL_POLICY constant):

| Cell | Days | Cell | Days | Cell | Days |
|---|---|---|---|---|---|
| AX | 3 | BX | 5 | CX | 7 |
| AY | 7 | BY | 10 | CY | 10 |
| AZ | 14 | BZ | 14 | CZ | 14 |

Default (null abc/xyz): 7 days.

---

## Demand Source — Why `revenue_daily`, Not `rpc_abc_xyz_classification`

This app is under a **blind test**: the ML model was trained on data through 2026-01-31. The inventory snapshot is 2026-03-03. Decision makers have real Feb/Mar/Apr 2026 outcomes on their screens and are comparing them against this system's recommendations.

`avg_daily_demand` for the ROP calculation uses `revenue_daily` (metric = `sales`, 90-day window: `2025-12-03` → `2026-03-03`) — the financial view of demand based on posted invoices (`account.move.line`). This is:

- The **same signal** already driving the order-plan panel (`/api/kpis/order-plan/route.ts`) for formula consistency
- The **same signal** verified to zero gap against the CEO's dashboard for the anchor SKU (77201046, Nov/Dec 2024) — see `docs/reconciliation/SSOT_WINNING_FORMULAS.md`
- **Uncensored**: captures true committed demand, not just delivered quantity

`rpc_abc_xyz_classification` returns `avg_daily_demand` from `demand_daily` (operational view). Both sources are now correct after Plan 009 fixed the demand window. `revenue_daily` is preferred here for the blind test because it is the validated SSOT formula used for all 23 demo SKUs, not just the anchor.

---

## API Route Extension: `frontend/src/app/api/kpis/order-plan/route.ts`

No new DB queries were added. The existing 4-query data pipeline already fetches every value needed for ROP:

| Value | Source |
|---|---|
| `avg_daily_demand` | `revenue_daily` (already computed in Step 4 of the route) |
| `current_stock` | `rpc_abc_xyz_classification` (already fetched in Step 3) |
| `lead_time_days` | `rpc_abc_xyz_classification` (already fetched in Step 3) |
| `abc_class`, `xyz_class` | `rpc_abc_xyz_classification` (already fetched in Step 3) |

The ROP block was inserted inside the existing SKU loop (Step 5), after variable extraction and before the `continue` guard for zero cost:

```typescript
if (avg > 0 && leadTime > 0) {
  const rop = avg * (leadTime + ssDay);
  if (currentStock <= rop) {
    ropToday += 1;
  } else if (currentStock - avg * 7 <= rop) {
    ropThisWeek += 1;
  }
}
```

The `continue` guard (which skips SKUs with `avg = 0 || unitCost = 0`) was moved to after the ROP block so SKUs with demand but no cost data are still eligible for ROP counting.

**Extended response shape:**
```typescript
{
  suppliers: SupplierOrderSummary[];
  rop_alerts: {
    order_today: number;      // SKUs where current_stock ≤ ROP
    order_this_week: number;  // SKUs where current_stock > ROP but breaches in ≤7 days
  };
  snapshot_date: '2026-03-03';
  furgo_m3: 122;
  furgo_confirmed: false;
}
```

No new network call is made from the frontend. The `rop_alerts` field is read from the existing `planData` returned by the already-parallel `/api/kpis/order-plan` fetch.

---

## Frontend Changes: `compras/page.tsx`

| Before | After |
|---|---|
| 4 KPI cards — all financial or aggregate operational | 4 KPI cards + 2-card urgency row below |
| No indication of which SKUs needed orders placed already | "Pedir HOY" card (red) with count and tooltip |
| No indication of which SKUs would breach ROP this week | "Pedir esta semana" card (amber) with count and tooltip |
| `Package` imported from lucide-react but unused | `Info` added to lucide-react import for tooltip icon |
| `planData?.rop_alerts` not consumed | `setRopAlerts(planData?.rop_alerts ?? null)` wired in existing `.then` handler |

The 2-card row renders only when `!loading && ropAlerts !== null`. If both counts are 0, the cards still render — zero is a valid and meaningful signal ("all 20 eligible SKUs have stock above ROP for the next 7 days").

---

## Verification Requirements

Counts observed at runtime must satisfy:
1. `order_today ≥ 0` and `order_this_week ≥ 0`
2. `order_today + order_this_week ≤ 20` (23 SKUs − 3 with zero lead time = 20 eligible)
3. Mutual exclusivity: no SKU appears in both counts (enforced by `if / else if` in the route)
4. Tooltip appears on hover of the `ℹ` icon on each card

---

## Files Changed

### Modified files
| File | Change |
|---|---|
| `frontend/src/app/api/kpis/order-plan/route.ts` | Added `ropToday` / `ropThisWeek` counters inside existing SKU loop; extended return value with `rop_alerts`; moved `continue` guard to after ROP block |
| `frontend/src/app/(authenticated)/compras/page.tsx` | Added `Info` to lucide import; added `ropAlerts` state; wired `setRopAlerts` in existing fetch handler; added 2-card JSX section with hover tooltips |

### New files
| File | Purpose |
|---|---|
| `_qci/plan-010-rop-alerts.md` | Formula derivation, data source rationale, UI placement decision, implementation spec |

---

## TypeScript Verification

`npx tsc --noEmit` — 0 errors on modified files after implementation.

---

## Known Limitations

| Limitation | Status |
|---|---|
| No open PO deduction — if open POs exist, `current_stock` overstates true available stock | Pre-existing; acceptable for demo scope; snapshot does not include live PO status |
| CARVAJAL lead times = 0 for 7 of 11 SKUs in Odoo | Pre-existing data quality issue; those 7 SKUs are excluded from ROP counts |
| `FURGO_M3 = 122` unconfirmed | Unrelated to this feature but noted for completeness — affects furgones in the Order Plan panel, not the ROP counts |
| 7-day window for "esta semana" is a calendar assumption | No business-day calendar is applied; weekends count as demand days for this calculation |
