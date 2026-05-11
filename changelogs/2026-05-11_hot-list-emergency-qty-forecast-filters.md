# Hot List: Emergency Order Qty + Days Display · Forecast: Urgency Filter + Furgones Sort · Nav: Programación Disabled

**Date:** 2026-05-11  
**Scope:** 23 demo SKUs (`is_top_10_in_class = true`). Inventory snapshot: 2026-03-03.  
**Stack:** Next.js 14, TypeScript (strict), Supabase PostgreSQL, Tailwind CSS.  
**Trigger:** Plan 007 Section 2.3 review identified two unimplemented Hot List items (emergency order quantity, days-count display). Section 3.1 review identified two unimplemented forecast filters (urgency, furgones sort). Section 2.4 review confirmed `/poc/programacion` is not operational — navigation disabled with cascade.

---

## Summary of Changes

| Category | Items |
|---|---|
| Modified Next.js API routes | 1 |
| Modified Next.js pages | 3 |
| Modified layout components | 1 |
| New SQL migrations | 0 |
| New `_qci/` planning documents | 0 |
| Updated `_qci/` planning documents | 2 |
| Build artifact fixes | 1 |

---

## What Was Built

### 1. Hot List — Emergency Order Quantity (`Pedido urgente` column)

**Files:** `frontend/src/app/api/kpis/stockout-risk/route.ts`, `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx`

#### API route enrichment

The `/api/kpis/stockout-risk` route now makes two parallel RPC calls instead of one:

```typescript
const [stockout, abcxyz] = await Promise.all([
  supabase.rpc('rpc_stockout_risks'),
  supabase.rpc('rpc_abc_xyz_classification'),
]);
```

A `Map<product_id, { abc_class, xyz_class }>` is built from the ABC/XYZ result and joined onto each stockout-risk row. Products not present in `rpc_abc_xyz_classification` receive `abc_class: null, xyz_class: null`. No new SQL migration required — both RPCs already existed.

#### Emergency order quantity formula

```
cell             = abc_class + xyz_class  (e.g. "AX", "BY", "CZ")
safety_stock_days = SAFETY_STOCK_DAYS[cell] ?? 7
rop              = avg_daily_demand × (lead_time_days + safety_stock_days)
emergency_qty    = max(0, ceil(rop − current_stock))
```

Safety stock days by ABC/XYZ cell (same lookup table as `order-plan/route.ts` and `capital-congelado/page.tsx`):

| Cell | Days | Cell | Days | Cell | Days |
|---|---|---|---|---|---|
| AX | 3 | BX | 5 | CX | 7 |
| AY | 7 | BY | 10 | CY | 10 |
| AZ | 14 | BZ | 14 | CZ | 14 |

Default (null abc/xyz): 7 days. SKUs with `avg_daily_demand ≤ 0` or `lead_time_days ≤ 0` return 0.

**Note:** `open_order_qty = 0` — the March 3 snapshot does not include live PO status. Emergency qty is therefore an upper bound on what needs to be ordered.

#### "Pedido urgente" column in the table

- Shown **only in the company-wide view** (`!isPerWarehouse`). Hidden when a specific bodega is selected, because per-warehouse `current_stock` does not represent total available inventory and would produce misleading order quantities.
- Red bold number when `emergency_qty > 0`; `—` when 0.
- Position: between "GTQ en riesgo" and "Se agota".
- Added to CSV export as "Pedido urgente (unidades)" (blank when 0).

---

### 2. Hot List — Days Until Stockout Display (Item 2)

**File:** `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx`

The previous layout had two separate columns: "Días" (raw integer) and "Se agota" (date string). Both conveyed the same underlying `days_of_supply` value in different formats, using two columns.

**After:** Single merged "Se agota" column:
- **Primary:** `Xd` bold (`font-semibold text-gray-900 tabular-nums`) — the count is the actionable signal
- **Secondary:** date string in `text-xs text-gray-400` below

The standalone "Días" column header and cell were removed. Net column count unchanged (removed 1, added 1 via "Pedido urgente").

---

### 3. Forecast Page — Urgency Filter ("Pedir ahora vs. Planificar")

**File:** `frontend/src/app/(authenticated)/compras/forecast/page.tsx`

The page already fetched `/api/kpis/stockout-risk` in a 4th parallel call and stored the top 5 at-risk SKUs in `urgentItems` (for the red banner). The full risk array was discarded.

**After:** The full set of at-risk SKUs is now stored as `urgentSkus: Set<string>` — all SKUs where `days_of_supply < lead_time_days`, not just the top 5. A new "Urgencia" filter row appears between the Métrica and Historial OC filter rows:

| Button | Behavior |
|---|---|
| **Todos** (default) | No filter — all SKUs visible |
| **Pedir ahora (N)** | Only SKUs in `urgentSkus` — stock already below lead time | 
| **Planificar** | Only SKUs NOT in `urgentSkus` — stock still above lead time |

"Pedir ahora" button uses red styling (`bg-red-50 text-red-700` / `bg-red-600 text-white`) to match the urgency signal. Badge count `(N)` shows the number of at-risk SKUs.

---

### 4. Forecast Page — Sort by Furgones Descending

**File:** `frontend/src/app/(authenticated)/compras/forecast/page.tsx`

New `furgoTotalForSort(r: SkuRow, metric: string): number` helper:

```typescript
// units = feb + mar for the active metric
// metric === '' falls back to compras_ordenadas
furgones = (units × volume_m3) / FURGO_M3
```

A "↓ Furgones" toggle button appears right-aligned in the Urgencia filter row. When active (emerald), the `visible` array is sorted descending by `furgoTotalForSort`. When inactive, the default order (supplier class → movement rank) is preserved.

`visible` was also converted from a plain `filter()` call to a `useMemo` — urgency filter, class filter, tier filter, and furgones sort are now all applied in one memoized pass. `totals` useMemo remains dependent on `visible` and recomputes correctly.

---

### 5. Navigation Disabled — `/poc/programacion`

**Files:** `frontend/src/components/layout/FearsSidebar.tsx`, `frontend/src/app/(authenticated)/compras/page.tsx`

Plan 007 Section 2.4 confirmed `/poc/programacion` is not operational:
- Historical playback only — no live run generation
- No furgones calculation
- No delivery date per line
- Supplier UoM not shown

All three UI entry points were disabled:

| Location | Entry | Change |
|---|---|---|
| `FearsSidebar.tsx` | COMPRAS section | `disabled: true` → renders as `<div>` with `opacity-40 cursor-not-allowed` |
| `FearsSidebar.tsx` | Prueba de Concepto section | Same |
| `compras/page.tsx` | Nav card grid | `disabled: true` → renders as `<div>` with `opacity-40 cursor-not-allowed`, no arrow icon |

`NavItem` interface extended with `disabled?: boolean`. Disabled items render as non-interactive `<div>` elements instead of `<Link>` — no `href` is active, no hover state, no click target.

---

### 6. Build Artifact Fix

**File:** `frontend/.next/types/validator.ts`, `frontend/.next/types/app/api/acid-test/` (deleted)

Stale `.next/types/` entries from the `acid-test` → production route rename (commit `2a52281`) caused 9 TypeScript errors on `tsc --noEmit`. Removed the three stale validation blocks from `validator.ts` and deleted the `acid-test` type stub directory. All errors resolved. These were generated build artifacts, not source files.

---

### 7. Planning Document Updates

**`_qci/plan-007-compras-manager-command-center.md`**
- Section 2.1: confirmed 2026-05-11; UI capacity notes added for Cobertura promedio (747 products, unweighted mean) and Order plan panel (23 SKUs, 2 supplier classes, flat layout)
- Section 2.2: blind test months corrected to Feb & Mar (not Apr & May); metric-filter progressive disclosure design documented
- Section 2.3: implemented 2026-05-11 (items 1+2 built, item 3 deferred); pending user confirmation
- Section 2.4: status documented — 1 of 4 items present (reasoning); 3 items absent

**`_qci/pre-production-requirements.md`**
- Gate #8 (forecast months): marked ✅ RESOLVED — Feb & Mar hardcoding is intentional (blind test months)
- Gate #9 (NEW): `/poc/programacion` not operational — documents all 4 missing items; notes navigation disabled
- Gate #10 (NEW): Cascade from gate #9 — Sections 3.1 "generate new run", 3.2 "live CSV", 3.3 "Generate a Live Purchase Plan" all blocked

---

## Files Changed

### Modified files
| File | Change |
|---|---|
| `frontend/src/app/api/kpis/stockout-risk/route.ts` | Added parallel `rpc_abc_xyz_classification` call; join on `product_id`; enriched response with `abc_class`/`xyz_class` |
| `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx` | Added `SAFETY_STOCK_DAYS`, `emergencyQty()`; new "Pedido urgente" column (company-wide view only); merged "Días"+"Se agota" into single cell; updated CSV |
| `frontend/src/app/(authenticated)/compras/forecast/page.tsx` | Added `urgentSkus`, `urgencyFilter`, `sortByFurgones` states; `furgoTotalForSort()` helper; fetch handler builds full `urgentSkus` Set; `visible` converted to `useMemo`; "Urgencia" filter row + "↓ Furgones" sort toggle added |
| `frontend/src/components/layout/FearsSidebar.tsx` | Added `disabled?: boolean` to `NavItem`; both programacion entries disabled; render loop handles disabled items as non-interactive `<div>` |
| `frontend/src/app/(authenticated)/compras/page.tsx` | Programacion nav card marked `disabled: true`; render updated to handle disabled cards |
| `frontend/.next/types/validator.ts` | Removed 3 stale `acid-test` validation blocks |
| `_qci/plan-007-compras-manager-command-center.md` | Sections 2.1–2.4 updated with findings and confirmed status |
| `_qci/pre-production-requirements.md` | Gate #8 resolved; gates #9 and #10 added |

### Deleted
| Path | Reason |
|---|---|
| `frontend/.next/types/app/api/acid-test/` | Stale type stub directory from route rename |

---

## TypeScript Verification

`npx tsc --noEmit` — 0 errors after all changes.

---

## Known Limitations

| Limitation | Status |
|---|---|
| `emergency_qty` has no open-PO deduction — if open POs exist, qty is overestimated | Pre-existing snapshot constraint; acceptable for demo scope |
| "Pedido urgente" hidden in per-warehouse view | Intentional — per-warehouse stock ≠ company-wide available inventory |
| `/poc/programacion` navigation disabled until fully operational | Gates #9 and #10 document what must be built first |
| Urgency filter on forecast page uses `days_of_supply < lead_time_days` threshold | Same threshold as the existing red banner; does not incorporate safety stock days |
