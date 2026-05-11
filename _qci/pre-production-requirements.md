# Pre-Production Requirements — Scale Gates & Unresolved Dependencies

**Purpose:** Each entry below is a hard gate. It records what action would violate the constraint, what must be done first, and where the evidence came from. This document must be checked before expanding the scope of any page or feature beyond its current demo limits.

**Rule:** No entry may be removed unless the requirement has been fulfilled and verified. Mark fulfilled entries with ✅ and the date.

---

## 1. Forecast table — virtual scrolling or server-side pagination

**Trigger:** Expanding `/compras/forecast` or `/gerencia/forecast` beyond the current 23 demo SKUs.

**Constraint:** The current table renders all rows into the DOM simultaneously with no pagination and no virtual scrolling. At 23 SKUs this is fine. At 950 SKUs (the full confirmed purchase scope) or 1,348 SKUs (all products ever sold) this will cause significant browser performance degradation — slow paint, janky scroll, possible tab crash on low-end hardware.

**What must be built first:** Either server-side pagination (preferred for large datasets — row count stays fixed in the DOM) or windowed/virtual rendering (rows outside the viewport are not mounted). The choice depends on whether filtered exports must stay client-side.

**Also required before expanding forecast scope:** The ML model is trained on 23 SKUs only (`is_top_10_in_class = true`). Expanding to 950+ SKUs requires a full model retrain — this is a post-sale implementation deliverable and cannot be done on the current snapshot alone.

**Evidence:** Plan 007 Section 1.3 UI capacity note (`/compras/forecast`), confirmed by user 2026-05-11.  
**Affects:** `frontend/src/app/(authenticated)/compras/forecast/page.tsx`, `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx`

---

## 2. FURGO_M3 = 122 — must be confirmed with client before removing disclaimer

**Trigger:** Presenting furgones calculations as confirmed, reliable, or production-grade to the client — or removing the "pendiente confirmación con proveedor" disclaimer from any UI.

**Constraint:** `FURGO_M3 = 122` (53-foot trailer, ~122 m³) is an unverified approximation used across four locations in the codebase. A 10% error in this constant propagates a 10% error into every furgones figure shown on the platform. CARVAJAL and REYMA may deliver in different truck configurations (48-foot trailers are common in Guatemala: 105–110 m³; 10-ton trucks: 45–60 m³).

**What must happen first:** A direct confirmation from PLASTICENTRO's logistics or purchasing team: what truck type does CARVAJAL deliver in? What truck type does REYMA deliver in? Are different routes or order volumes served by different truck sizes?

**Current workaround:** All four UI locations show a visible disclaimer. The order-plan API returns `furgo_confirmed: false`. Do not remove either until the constant is confirmed.

**Affected files (all hardcode `FURGO_M3 = 122`):**
- `frontend/src/app/(authenticated)/compras/forecast/page.tsx` line 11
- `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx` line 14
- `frontend/src/app/api/kpis/order-plan/route.ts` line 15
- `frontend/src/app/(authenticated)/compras/page.tsx` (disclaimer rendered in Order Plan panel footer and ROP cards)

**Evidence:** Plan 007 Section 4.6, Plan 008 Section 4.2, Plan 010 known limitations.

---

## 3. Order plan panel — scrollable supplier list before expanding beyond CARVAJAL + REYMA

**Trigger:** Expanding the `/compras` Order Plan panel or `/api/kpis/order-plan` to cover suppliers beyond the current two (`supplier_class = 'CARVAJAL'` or `'REYMA'`).

**Constraint:** The current panel is a flat two-row list hardcoded to 2 supplier classes. PLASTICENTRO has 74 distinct supplier name entries with confirmed/received POs (approximately 65 deduplicated legal entities). Rendering 65+ rows in the current flat layout produces an unnavigable wall of data with no grouping or search.

**What must be built first:** Replace the fixed two-row layout with a scrollable list with a max-height, overflow-y-auto, and a search/filter input. Each row must remain the same — only the container changes.

**Evidence:** Plan 007 Section 1.3 UI capacity note (`/compras`), Plan 008 Section 4.2.  
**Affects:** `frontend/src/app/(authenticated)/compras/page.tsx` (Order Plan panel JSX)

---

## 4. Programación de Compras — supplier accordion before expanding beyond 2 suppliers

**Trigger:** Expanding `/poc/programacion` to cover suppliers beyond CARVAJAL and REYMA.

**Constraint:** The current page uses a flat table with expandable accordion rows — one layout for all suppliers. At 2 suppliers × ~23 SKUs this is navigable. At 74 supplier entries × up to 950 SKUs, a single scroll produces hundreds of undifferentiated rows with no per-supplier grouping. The compras manager cannot find their CARVAJAL order in that layout.

**What must be built first:** A supplier accordion structure — one collapsible section per supplier, with per-supplier totals visible in the collapsed header (total units, total GTQ, total furgones). A search/filter bar to jump to a specific supplier. Per-supplier CSV export.

**Evidence:** Plan 007 Section 1.3 UI capacity note (`/poc/programacion`).  
**Affects:** `frontend/src/app/(authenticated)/poc/programacion/page.tsx`

---

## 5. `rpc_abc_xyz_classification` — `avg_daily_demand` field is not reliable

**Trigger:** Any new route or page that calls `rpc_abc_xyz_classification()` and reads the `avg_daily_demand` field from the result.

**Constraint:** Plan 009 fixed the demand window (snapshot-anchored 90-day window instead of `CURRENT_DATE - 30 days`). However, the original design of this RPC sources demand from `demand_daily`, which was populated from a specific operational SSOT formula. Whether `demand_daily` covers all 980 products with the same accuracy as `revenue_daily` covers the 23 demo SKUs has not been verified. The existing `/api/kpis/abc-xyz` route returns the RPC output as-is and is consumed by `capital-congelado/page.tsx` — which uses `avg_daily_demand` to compute `gtqInmovilizado`. Any new consumer of this field must verify it returns non-zero values for the target SKU set before trusting it.

**Workaround in place:** `/api/kpis/order-plan/route.ts` and `/api/kpis/order-plan` (ROP alerts) independently source `avg_daily_demand` from `revenue_daily` rather than from the RPC.

**Evidence:** Plan 008 Section 1.1 (discovery note), changelog `2026-05-11_order-plan-panel-compras.md` section "Broken Data Sources."  
**Affects:** Any future route calling `rpc_abc_xyz_classification()`.

---

## 6. CARVAJAL lead times — must be corrected in Odoo before order quantities are operationally reliable

**Trigger:** Presenting CARVAJAL order recommendations as operationally reliable to PLASTICENTRO's purchasing team (post-sale).

**Constraint:** 7 of 11 CARVAJAL demo SKUs have `lead_time_days = 0` in the Odoo supplier info (`product.supplierinfo`). This is a data quality issue in the client's Odoo configuration. With `lead_time_days = 0`, the order recommendation formula produces `target_stock = safety_stock_days × avg_daily_demand`, which is almost always less than current stock — so `qty_recommended = 0`. These SKUs are excluded from the order plan panel and ROP alerts, with a footer note.

**What must happen first:** PLASTICENTRO's purchasing team must update supplier lead times in Odoo for all CARVAJAL SKUs. This is an Odoo configuration fix, not a code fix.

**Current handling:** Gap counter in the Order Plan panel footer ("N SKUs excluidos (lead time = 0 en Odoo)") and excluded from ROP alert counts.

**Evidence:** Plan 008 changelog, `rpc_abc_xyz_classification` output verified 2026-05-11.  
**Affects:** `/api/kpis/order-plan`, `/compras` Order Plan panel, `/compras` ROP alert cards.

---

## 7. Hot List and Hold List — not accessible to pure `CAN_VIEW_COMPRAS` role

**Trigger:** Deploying to a user who has `CAN_VIEW_COMPRAS` but not `CAN_VIEW_OPERACIONES`.

**Constraint:** The Hot List (`/preocupaciones/desabastecimiento`) and Hold List (`/preocupaciones/capital-congelado`) are in the OPERACIONES sidebar section. A user with only the COMPRAS role cannot navigate to them. These pages directly answer purchasing questions ("what do I order now?" and "what should I not over-order?") and belong in the COMPRAS sidebar as well.

**What must be built first:** Add both pages as nav items in the COMPRAS section of `FearsSidebar.tsx` (Plan 007 Priority 3 — estimated 30 minutes).

**Evidence:** Plan 007 Section 4.7, Section 5 Priority 3.  
**Affects:** `frontend/src/components/layout/FearsSidebar.tsx`

---

## 10. Section 3.1 / 3.2 / 3.3 items dependent on `/poc/programacion` — blocked

**Trigger:** Any attempt to implement or present the following features before `/poc/programacion` is operational (gate #9).

**Blocked items (cascade from gate #9):**
- **Section 3.1:** "Programación: generate a NEW run from the current snapshot" — blocked. The page is historical playback only; no trigger mechanism exists.
- **Section 3.2:** "Programación CSV: must be exportable for the LIVE run" — blocked. CSV export only works for historical runs; a live-run export requires the live-run feature first.
- **Section 3.3:** "The One Critical Missing Action: Generate a Live Purchase Plan" — the entire section is blocked. This is the core deliverable of `/poc/programacion` and cannot exist until gate #9 is resolved.

**What must happen first:** Gate #9 resolved — `/poc/programacion` made operational with live run generation.

**Evidence:** Plan 007 Sections 3.1, 3.2, 3.3, assessed 2026-05-11.
**Affects:** `frontend/src/app/(authenticated)/poc/programacion/page.tsx`, plan-007 Sections 3.1–3.3.

---

## 9. Programación de Compras (`/poc/programacion`) — not operational

**Trigger:** Any user navigating to `/poc/programacion` expecting a live purchase plan.

**Constraint:** The page is historical playback only — it reads pre-computed `purchase_schedule_runs` rows from Supabase and displays them as a slideshow. It does not generate a live order plan from the March 3 snapshot. Current status of the four items the compras manager should see (Section 2.4):

- **Current week's order plan (live):** NOT implemented. No "Generar plan" trigger exists. The page cannot produce a new run from the current snapshot.
- **Per-supplier order brief (SKU, qty in supplier UoM, GTQ, delivery date):** PARTIAL. SKU, recommended quantity, and GTQ value are present. Delivery date per line is not shown. Supplier UoM is not shown — quantities are in stock units.
- **Truck fill summary (total furgones CARVAJAL / REYMA):** NOT present. No furgones calculation on this page.
- **Reasoning per line:** ✅ Present. `line.reasoning` rendered in expandable row.

**What must be built first:** (1) "Generar plan" button triggering a new run via the existing algorithm against the March 3 snapshot. (2) Delivery date per line. (3) Furgones totals per supplier. (4) Supplier UoM display.

**Current state:** Navigation to this page is disabled in the sidebar until the page is fully operational. The page remains in the codebase.

**Evidence:** Plan 007 Section 2.4, assessed 2026-05-11.
**Affects:** `frontend/src/components/layout/FearsSidebar.tsx` (nav disabled), `frontend/src/app/(authenticated)/poc/programacion/page.tsx`

---

## ✅ 8. Forecast months — RESOLVED 2026-05-11

**Original concern:** Forecast months hardcoded to Feb & Mar 2026 were assumed to be stale past months that needed updating.

**Resolution:** Feb & Mar 2026 are the correct and intentional blind test months. The ML model was trained through January 31, 2026. Decision makers have real Feb & Mar 2026 outcomes on their screens and are evaluating this system's forecasts against them. The hardcoded `2026-02-01` and `2026-03-01` in `compras/forecast/page.tsx` and the "Feb & Mar 2026 — 23 SKUs" subtitle in `FearsSidebar.tsx` are correct — do not change them.
