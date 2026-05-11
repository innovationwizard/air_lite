# Forecast: Cantidad Recomendada Column · FURGO_M3 Confirmed · Plan-007 Section 4–5 Updates

**Date:** 2026-05-11  
**Scope:** 23 demo SKUs (`is_top_10_in_class = true`). Inventory snapshot: 2026-03-03.  
**Stack:** Next.js 14, TypeScript (strict), Supabase PostgreSQL, Tailwind CSS.  
**Trigger:** Plan 007 Section 5 Priority 2 (Cantidad Recomendada column); user confirmation that FURGO_M3 = 122 is correct; plan document accuracy updates for Sections 4 and 5.

---

## Summary of Changes

| Category | Items |
|---|---|
| Modified Next.js pages | 1 |
| Modified Next.js API routes | 1 |
| Modified layout/components | 0 |
| New SQL migrations | 0 |
| Updated `_qci/` planning documents | 2 |
| Updated `changelogs/` | 1 (this file) |

---

## What Was Built

### 1. Forecast Page — Cantidad Recomendada Column

**File:** `frontend/src/app/(authenticated)/compras/forecast/page.tsx`

The `/compras/forecast` page now has a **"Recomendado"** metric filter (new default) that shows a two-column group per SKU:

| Column | Content |
|---|---|
| **Unidades** | Recommended order quantity in stock units, rounded to packing multiple |
| **Furgones** | Furgones equivalent at 122 m³/truck |

The column shows `✓ OK` (green) when stock is already above the target level (no order needed), and `—` when the SKU has no demand or lead time data.

#### Formula

```
cell              = abc_class + xyz_class  (e.g. "AX", "BY")
safety_stock_days = SAFETY_STOCK_DAYS[cell] ?? 7
target_stock      = avg_daily_demand × (2 × lead_time_days + safety_stock_days)
rec_raw           = max(0, target_stock − current_stock)
packing_multiple  = PACKING_MULTIPLES[stock_uom] ?? 1
cantidad_recomendada = ceil(rec_raw / packing_multiple) × packing_multiple
```

Rationale: `target_stock` covers one full lead time of demand (to order now) plus another lead time (to cover demand while waiting for delivery) plus safety stock. This is the standard replenishment formula for a continuous-review system.

#### Packing multiples

| UoM | Multiple |
|---|---|
| FARDO10 | 10 |
| FARDO05 | 5 |
| FARDO04 | 4 |
| FARDO20 | 20 |
| CAJA40 | 40 |
| (any other) | 1 |

#### Data source — zero additional API calls

The page already fetched `/api/kpis/stockout-risk` for the urgency banner. That route returns `avg_daily_demand`, `current_stock`, `lead_time_days`, `abc_class`, `xyz_class` per SKU (enriched in the previous session). A `riskMap: Map<string, StockoutRisk>` is built from this existing fetch. The `rows` useMemo takes `riskMap` as a dependency and computes `cantidad_recomendada` when creating each `SkuRow` entry. No changes to `/api/forecast/route.ts`.

#### Other page changes

- `StockoutRisk` interface extended: `avg_daily_demand`, `current_stock`, `abc_class`, `xyz_class`
- `SkuRow` type extended: `cantidad_recomendada: number | null`
- `metricFilter` state type extended: `'recomendado'` added, default changed from `'compras_ordenadas'` to `'recomendado'`
- `furgoTotalForSort` handles `metric === 'recomendado'` case
- `totals` useMemo adds `rec_qty` and `furgo_rec`
- CSV export adds "Cantidad Recomendada" and "Furgones Recomendados" columns (blank when 0 or null)
- `SAFETY_STOCK_DAYS`, `DEFAULT_SAFETY_STOCK_DAYS`, `PACKING_MULTIPLES` constants added

---

### 2. FURGO_M3 = 122 Confirmed — Disclaimers Removed

**Confirmed:** Client confirmed CARVAJAL and REYMA both deliver in furgón 53 pies (122 m³). Gate #2 in `_qci/pre-production-requirements.md` marked ✅ RESOLVED.

All WARNING comments and UI disclaimers updated across four files:

| File | Change |
|---|---|
| `frontend/src/app/(authenticated)/compras/forecast/page.tsx` | Added confirmed note to `FURGO_M3` constant |
| `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx` | WARNING comment replaced with confirmed note |
| `frontend/src/app/api/kpis/order-plan/route.ts` | WARNING comment replaced with confirmed note |
| `frontend/src/app/(authenticated)/compras/page.tsx` | UI span changed from amber `⚠ ... pendiente confirmación con proveedor` to gray `Furgones: furgón 53 pies (122 m³)` |

---

### 3. Plan-007 Document Updates

**`_qci/plan-007-compras-manager-command-center.md`**

- Section 4 review status: marked `[x]` — stale subsections updated 2026-05-11
- Section 4.1: removed "past months" framing; updated stockout overlay description; noted urgency filter implemented
- Section 4.2: struck the original "fix" instruction (change to Apr & May); replaced with gate #8 resolution note
- Section 4.4: removed "No abc_class + xyz_class" from "does NOT return" list; added 2026-05-11 enrichment note
- Section 4.6: updated to ✅ CONFIRMED 2026-05-11
- Section 4.7: removed `← STALE` from Feb & Mar entry; noted Programación disabled (gate #9)
- Section 5, Priority 1: struck through; superseded by gate #8
- Section 5, Priority 2: marked ✅ DONE; documented zero-additional-call approach
- Section 5, Priority 4: marked ✅ DONE; documented actual implementation (proper ABC/XYZ, no workaround)
- Section 6 table: updated Priority 1 (struck), Priority 2 (done), Priority 4 (done), Priority 6 (gate #2 resolved)
- Section 7 table: emergency_qty row noted as done

**`_qci/pre-production-requirements.md`**
- Gate #2: marked ✅ RESOLVED 2026-05-11

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/app/(authenticated)/compras/forecast/page.tsx` | Cantidad Recomendada column; FURGO_M3 confirmed comment; new constants; StockoutRisk/SkuRow types extended; riskMap state; metricFilter default 'recomendado' |
| `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx` | WARNING comment replaced |
| `frontend/src/app/api/kpis/order-plan/route.ts` | WARNING comment replaced |
| `frontend/src/app/(authenticated)/compras/page.tsx` | UI disclaimer changed to neutral label |
| `_qci/plan-007-compras-manager-command-center.md` | Sections 4.1, 4.2, 4.4, 4.6, 4.7, Priority 1–4 in Section 5, Section 6 table, Section 7 table |
| `_qci/pre-production-requirements.md` | Gate #2 resolved |

---

## TypeScript Verification

`npx tsc --noEmit` — 0 errors after all changes.

---

## Known Limitations

| Limitation | Status |
|---|---|
| `cantidad_recomendada` has no open-PO deduction | Snapshot constraint — no live PO data. Upper bound on order qty. |
| SKUs with `lead_time_days = 0` (7 CARVAJAL SKUs) return `cantidad_recomendada = null` | Gate #6 — CARVAJAL lead times must be fixed in Odoo |
| SKUs absent from `rpc_stockout_risks` return `cantidad_recomendada = null` | Only demo 23 SKUs covered by the RPC |
| `avg_daily_demand` sourced from `rpc_stockout_risks` → `demand_daily` table | Gate #5 — reliability of `demand_daily` for non-demo SKUs unverified; demo scope unaffected |
