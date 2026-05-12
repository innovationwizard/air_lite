# Plan 007 — Compras Manager Command Center: Full Vision, Research & Gap Closure
**Date:** 2026-05-11  
**Author:** Research-driven. Based on: (1) direct reading of every compras-related page and API in the codebase, (2) gap-analysis-compras-operaciones-vs-best-in-class.md, (3) plan-005-compras-operaciones-roadmap.md, (4) plan-005-progress.md, (5) plan-006-progress.md, (6) Slim4, Kinaxis Maestro, Blue Yonder Luminate, o9 Solutions, Streamline/GMDH benchmarks from the gap analysis.  
**Constraint:** All features must run on the existing Supabase snapshot (PLASTICENTRO, S.A., March 3, 2026). No mock data. No placeholders.  
**Data anchor:** Inventory snapshot = March 3, 2026. ML model trained through January 31, 2026.

**Review status (section-by-section with user):**
- [x] Section 0 — confirmed OK
- [x] Section 1.1 — confirmed OK
- [ ] Section 1.2 — NOT independently verified by user (no time for independent research). Review interrupted here by context compaction — resume from this section.
- [x] Section 1.3 — fully confirmed 2026-05-11. Hard gates for both subsections documented in `_qci/pre-production-requirements.md` (gates #1, #4).
- [x] Section 2.1 — confirmed 2026-05-11
- [x] Section 2.2 — confirmed 2026-05-11
- [x] Section 2.3 — confirmed 2026-05-11. Item 1 (emergency order qty) ✅. Item 2 (days display) ✅. Item 3 (historical alert frequency) deferred ✅.
- [x] Section 2.4 — deferred 2026-05-11. All 4 items in this section depend on `/poc/programacion` being operational. That page is historical playback only — no live run generation, no delivery date per line, no furgones totals, no supplier UoM. Navigation to the page is disabled (gate #9). This section cannot be completed until gate #9 is resolved. Deferred by user decision — not abandoned, blocked by upstream prerequisite.
- [x] Section 3.1 — items 1+2 implemented 2026-05-11; item 3 blocked by gate #9; confirmed
- [x] Section 3.2 — all currently buildable exports done; 2 missing items blocked by upstream features; confirmed
- [ ] Section 3.3 — assessed 2026-05-11; entirely blocked by gate #9; pending user confirmation
- [x] Section 4 — stale subsections updated 2026-05-11 (4.1, 4.2, 4.4, 4.6, 4.7); confirmed
- [x] Section 5 — confirmed 2026-05-11 (P1 struck/superseded; P2/P4/P6 done; P3 unimplemented gate #7; P5 blocked gate #9)
- [x] Section 6 — confirmed 2026-05-11 (implementation table updated with done/blocked statuses)
- [x] Section 7 — confirmed 2026-05-11 (emergency_qty row noted done; remaining rows valid future deliverables)

---

## 0. The Three Questions That Define the Compras Manager's Job

Every compras manager at every company in every market answers the same three operational questions on a recurring cycle:

1. **What do I need to order?** — Which SKUs require a purchase order before I run out?  
2. **How much?** — What quantity satisfies the policy target (neither stockout nor overstock)?  
3. **Can I fit it?** — Does this order fit in my budget, my warehouse capacity, and my truck schedule?

Every page, every feature, every number in the COMPRAS section must be evaluated against these three questions. If a feature does not help answer at least one of them, it does not belong in the COMPRAS section.

---

## 1. WHAT SHOULD THE COMPRAS PAGES SHOW?

### 1.1 The Fundamental Problem: No Page Answers "What Do I Order Next?"

**From the code (read directly, not inferred):**

| Route | What it actually shows today | Answers question 1? | Answers question 2? | Answers question 3? |
|---|---|---|---|---|
| `/compras` | Live KPI dashboard: Excepciones, GTQ en riesgo, GTQ inmovilizado, Cobertura promedio + Top 5 exceptions by GTQ + nav cards | Partial (shows what's urgent, not what to order proactively) | No | No |
| `/compras/forecast` | **Hardcoded** Feb & Mar 2026 forecast for top 23 SKUs. Fetches `/api/forecast?forecast_month=2026-02-01` and `...2026-03-01`. Both months are in the past as of today (May 11, 2026). | No — past months | No — past months | Partially — furgones column exists but for past months |
| `/poc/programacion` | Historical POC playback. Reads pre-computed `purchase_schedule_runs` from Supabase. Shows weekly schedules for historical weeks. Not live. Not actionable for future weeks. | No — historical only | No — historical only | No — historical only |
| `/backtest` | Sequential slideshow of historical backtest months (Oct 2024–Feb 2026). Savings estimate cards. | No — demonstration, not operational | No | No |
| `/preocupaciones/desabastecimiento` (Hot List) | Stockout risk table with GTQ en riesgo, fecha agotamiento, filters by risk/supplier/warehouse/search. CSV export. Per-warehouse breakdown. | Partially — shows what's ALREADY urgent. Tells you what's on fire, not what will catch fire next week. | No — shows risk severity, not recommended order quantity | No |
| `/preocupaciones/capital-congelado` (Hold List) | ABC/XYZ table with GTQ inmovilizado, costo/día, policy badges, filters. CSV export. | No — tells you what NOT to order more of | No | No |
| `/operaciones/dias-inventario` | Days of inventory per SKU×warehouse with policy badges (BAJO/DENTRO/SOBRE), cobertura efectiva, GTQ en stock | Partially — shows which SKUs are below policy | No | No |

**Conclusion from reading the actual code:** Zero pages in the COMPRAS section answer the question "What should I order from CARVAJAL this week and how many furgones will it fill?" with live, forward-looking data. The forecast page is the closest attempt — but it shows past months and lacks the critical output the compras manager needs: a **concrete order recommendation with quantity, GTQ value, and furgones**.

---

### 1.2 What Best-in-Class Shows (Benchmarks from Gap Analysis)

**Slim4 (Slimstock) — the most directly comparable platform for FMCG distributors:**
- Replenishment recommendations per SKU per warehouse, generated continuously
- Supplier constraints encoded: MOQ, price breaks, packing multiples, lead time variability
- Explainability per line: "Why Q240? Current stock 180 units, 7-day demand = 43 units/day × 7 days target − 180 = 121 → rounded up to packing multiple of 40 = 160 → MOQ compliance → 240"
- Order batching to hit freight break points
- Published outcomes: up to 50% fewer stockouts, 30% inventory reduction

**Kinaxis Maestro:**
- Exception Review screen — anomalies surfaced with explainable drivers
- MAPE + bias tracking per SKU
- Projected stockout date per item ("runs out June 12")
- GTQ revenue at risk = (days_short × avg_daily_demand × unit_price)

**Blue Yonder Luminate:**
- Probabilistic forecast — not a single number but a range with percentile bands
- "Glass box" explainability: lists which factors drove each forecast change
- Planner efficiency improvement: 75%

**Streamline (GMDH) — direct Odoo competitor, mid-market:**
- Native Odoo connector
- Combines forecast + MRP in one platform
- Published: 90% reduction in manual planning time, 36% inventory reduction

**What all of them have that this app does not:**
1. A forward-looking **recommended order quantity** per SKU — not just a forecast number, but the actual units to put on a PO
2. Supplier-grouped order summaries: one view per supplier showing total units, total GTQ, total furgones
3. Reorder point alerts: not "this is Crítico" but "this breached its reorder point 3 days ago — here is the suggested emergency order"
4. Packing multiple compliance: recommended quantities rounded to UoM packing units
5. Freight optimization: flag orders that are close to filling a truck (add more to avoid wasted space) or that overflow a truck (split into two)

---

### 1.3 What Each Compras Page SHOULD Show

#### `/compras` — Purchasing Command Center

- **Financial exposure today:** Total GTQ en riesgo (Crítico + Alto) and total GTQ inmovilizado — the two numbers that define the cost of inaction right now
- **Order plan this week by supplier:** "CARVAJAL: Q XXX,XXX — X furgones" / "REYMA: Q XXX,XXX — X furgones" — derived from the live purchase recommendation engine, not a static card
- **Reorder point alerts:** How many SKUs need an order placed TODAY vs. THIS WEEK — distinguished by urgency, not just by risk label
- **Data recency badge:** Prominently visible — the compras manager must always know which date the snapshot reflects so they do not act on stale numbers

> **UI capacity note — source: `real_data/` CSVs (March 3, 2026 Odoo export):** PLASTICENTRO operates **25 warehouses** in Odoo; **11 are physical operational storage** (Bodegas + Tiendas + Producción + Walmart). The March 3 snapshot has **1,251 distinct SKUs with positive stock** across those 11 warehouses. The purchase history contains **74 distinct supplier names** with at least one confirmed or received PO (`Bloqueado` + `Orden de compra` states) — several are duplicate legal entity registrations for the same company (e.g., CARVAJAL appears as 3 separate entries; HALCON as 2; GLOBAL PACK as 2). The current command center is designed for 2 supplier classes (CARVAJAL, REYMA). The "order plan this week by supplier" panel must be designed as a scrollable list capable of showing all 74 supplier entries (or deduplicated to ~65 legal entities) — not a two-row hardcoded layout. KPI cards work at any volume. The Top 5 exceptions panel is capped by design and scales fine.

---

I, developer, am persisting this here due to Claude Code's increasing tendency to forget important questions and important answers: 


```
Based on reading compras/page.tsx directly:

1. Financial exposure today (GTQ en riesgo + GTQ inmovilizado)
YES — both are present.

Lines 113–119: "GTQ en riesgo" card shows totalGtqEnRiesgo (Crítico + Alto), subtitle "Si no se actúa"
Lines 120–126: "GTQ inmovilizado" card shows totalGtqInmovilizado, subtitle "Sobre política máxima"
2. Order plan this week by supplier (CARVAJAL: Q X — X furgones / REYMA: Q X — X furgones)
NO — does not exist anywhere on this page.
There is no per-supplier order plan, no furgones calculation, and no purchase recommendation engine output. The page has no concept of a supplier-level order summary.

3. Reorder point alerts (SKUs needing order TODAY vs. THIS WEEK)
NO — does not exist.
Line 107–111 shows a single "Excepciones activas" count grouping Crítico + Alto together. There is no reorder point calculation on this page and no distinction between orders due today vs. this week.

4. Data recency badge (prominently visible)
NO — present but not prominent.
Line 233: <p className="text-xs text-gray-400">Datos: snapshot 3-mar-2026...</p> — it exists but is rendered as the smallest, lightest-colored text on the entire page, pinned to the bottom. It is not a badge and it is not prominent.

Summary: 1 of 4 items is fully present. 2 are absent entirely. 1 is present but fails the "prominently visible" requirement.

```
---


#### `/compras/forecast` — Forecast de Compras

The job of this page is to answer one question: **"What is demand going to look like next month, and how much do I need to order to be ready for it?"**

That answer requires three things per SKU, displayed together:

1. **Forecasted demand** — units predicted to sell, by month, for the next two actionable planning months
2. **Recommended purchase quantity** — the actual units to put on a PO, computed from forecast + current stock + policy target (formula in Section 3), rounded to the packing multiple of each SKU's UoM
3. **Furgones recomendados** — the freight translation of the recommended quantity, so the compras manager can schedule trucks at the same time they decide quantities

Additionally:
- **Per-supplier totals row** — total recommended units, total GTQ value, total furgones per supplier
- **Truck fill indicator** — flags when a supplier order is close to filling a truck ("98.5 furgones → 98 full + 1 at 40% — considera agregar Q X,XXX para completarlo") or overflows into an extra truck
- **Data quality badge per SKU** — how many months of purchase history back the forecast, so the compras manager knows which numbers to trust and which to verify manually

> **UI capacity note — source: `real_data/` CSVs (March 3, 2026 Odoo export):** The current page renders **23 SKUs** with no pagination and no virtual scrolling — all rows are inserted into the DOM simultaneously. The full demand base is **1,348 distinct products ever sold** (from `sale.order.line`); **950 distinct products** appear in confirmed or received purchase orders (by product name; 776 by internal reference, excluding the default ref `[0]`); **1,251 products** have positive stock in the 11 operational warehouses. The current table implementation cannot handle these volumes without significant performance degradation in the browser. Before expanding the forecast scope beyond 23 SKUs, the table must be rebuilt with either server-side pagination or virtual scrolling (windowed rendering). The ML forecast model is trained on 23 SKUs only (filtered by `is_top_10_in_class`). Expanding to 950+ SKUs requires retraining the model — a post-sale implementation deliverable. For the current demo scope (23 SKUs), the existing table architecture is adequate.

---

#### `/poc/programacion` — Programación de Compras

- **Live weekly order plan** — what to order from each supplier this week and the next three, generated from current inventory and forecast, not a playback of historical weeks
- **Per-supplier, per-day breakdown** — structured as the compras manager would actually send the order: SKU, quantity in the supplier's packing UoM, GTQ value, requested delivery date
- **Per-line reasoning** — why the system recommends that quantity: current stock, demand rate, policy target, and the arithmetic that connects them
- **Per-supplier weekly summary** — total units, total GTQ, total furgones — the numbers the compras manager brings to supplier negotiations

> **UI capacity note — source: `real_data/` CSVs (March 3, 2026 Odoo export):** The current algorithm and page are hardcoded for CARVAJAL and REYMA only (2 of the **74 supplier names** with confirmed/received POs). The full confirmed purchase scope covers **950 distinct products** (by name) across those 74 supplier entries. The current expandable-row layout — one flat table with accordion rows — works at 2 suppliers × ~23 SKUs. At 74 supplier entries × up to 950 SKUs, it becomes unnavigable: a single scroll renders hundreds of rows with no grouping. Before expanding beyond the 2-supplier demo scope, the page requires a supplier accordion structure (one collapsible section per supplier) with per-section totals and a search/filter bar. This is a post-sale scope item; the 2-supplier demo layout is adequate for closing the sale.

---

## 2. WHAT SHOULD THE COMPRAS MANAGER BE ABLE TO SEE?

### 2.1 At the Command Center (`/compras`)

The compras manager should open the app and immediately see — without clicking anything:

**Financial exposure today:**
- Total GTQ en riesgo if no action taken (Crítico + Alto items)
- Total GTQ inmovilizado (excess stock above policy)
- Net working capital picture: at-risk vs. frozen

**Operational state today:**
- How many SKUs need orders placed TODAY (already past reorder point)
- How many SKUs need orders placed THIS WEEK (will breach reorder point within lead time)
- Average days of supply across all active SKUs

> **UI capacity note — source: `supabase/migrations/20260511000001_fix_rpc_demand_signal.sql` (rpc_stockout_risks lines 80–104) + `compras/page.tsx` lines 104–108:** "Cobertura promedio" is a **simple unweighted arithmetic mean** of `days_of_supply` across all rows returned by `rpc_stockout_risks()`. "Active" is defined by two criteria applied in the RPC: (1) `products.is_active = true` in Odoo; (2) `AVG(demand_daily.quantity_sold) > 0` in the 90-day window before the snapshot. This produces **747 products**; the remaining active products with zero demand in that window are excluded (no demand signal → no meaningful coverage ratio). `days_of_supply` per product is computed as `SUM(inventory_daily.quantity_on_hand)` across **all warehouses** at the snapshot date, divided by company-wide `AVG(demand_daily.quantity_sold)`. A product with 300 units in Bodega 1 and 0 in Bodega 2 shows the same days-of-supply as if stock were evenly distributed — location imbalance is invisible in this metric. The mean is unweighted: a slow-moving CZ product with 400 days of supply contributes equally to the average as a fast-moving AX product with 15 days of supply, biasing the company-wide figure upward. A revenue-weighted or inventory-value-weighted average would be more operationally precise but is not currently implemented. Current observed value: **20d** (2026-05-11). All aggregation is server-side; the metric scales to any active product count without frontend impact.

**Order plan this week:**
- CARVAJAL: N SKUs to order / Q XXX,XXX / X.X furgones
- REYMA: N SKUs to order / Q XXX,XXX / X.X furgones

> **UI capacity note — source: `frontend/src/app/api/kpis/order-plan/route.ts` + `products_acid_test_active` table schema:** The order plan panel is **explicitly scoped to 23 demo SKUs** (`is_top_10_in_class = true` in `products_acid_test_active`), grouped into 2 `supplier_class` values: CARVAJAL (11 SKUs) and REYMA (12 SKUs). `supplier_class` is a column that exists **only in `products_acid_test_active`** — it is not present on the general `products` table. The route does not join to any broader product universe; expanding the order plan to cover additional products would require: (1) adding a `supplier_class` field to those products in `products_acid_test_active` or an equivalent table, (2) rebuilding the panel UI with a scrollable supplier list capable of handling all 74 supplier entries with confirmed/received POs in PLASTICENTRO's Odoo (hard gate documented in `_qci/pre-production-requirements.md` §3). Current UI renders 2 rows; the flat layout is adequate for the demo scope and unnavigable beyond ~5 suppliers.

---

### 2.2 On the Forecast Page (`/compras/forecast`)

Per SKU, per month (**February & March** from the March 3 snapshot — confirmed 2026-05-11):

> **Blind test scope:** The ML model was trained through January 31, 2026. Decision makers have real February & March 2026 outcomes on their screens and are evaluating this system's forecasts against them. Showing Feb & Mar is the correct window: both months are verifiable, which is where trust is built or lost. The current page hardcodes Feb & Mar — this is intentional and correct, not a bug.

#### Design pattern: metric-filter progressive disclosure (mirrors `/gerencia/forecast`)

Rather than a flat 9-column table, the page uses a **metric filter** — the same pattern as the blind test page. The user selects one metric group at a time; only that group's columns are rendered. This keeps the table to 4–5 visible columns in any given view instead of an unnavigable 9-column wall.

**Metric filter buttons** (same pill-button row as the blind test page):

| Filter state | Columns shown | Purpose |
|---|---|---|
| **Compras recomendadas** ← default | Feb rec. units · Mar rec. units · Feb furgones rec. · Mar furgones rec. | The primary action: what to put on the PO |
| **Ventas pronosticadas** | Feb forecast units · Mar forecast units · Feb furgones demanda · Mar furgones demanda | The demand signal: why those quantities |
| **Todo** | All of the above side by side | Full data dump for power users |

**Sticky SKU column** (always visible regardless of metric filter — same pattern as blind test page):

| Field | What it shows |
|---|---|
| SKU + product name | Identity |
| Supplier pill + UoM pill | CARVAJAL/REYMA + CAJA40/FARDO10/etc. |
| Completeness tier pill | Datos completos / parciales / insuficientes (green/amber/red — same logic as blind test page: based on `po_history_real_months`) |
| Stock actual | Units on hand at March 3 — the starting point |
| Cobertura actual | `current_stock / avg_daily_demand` in days — urgency signal, visible at all times |

**Supporting context per SKU** (available via `ℹ` popover on click — not a table column):
- Punto de reorden: `avg_daily_demand × (lead_time_days + safety_stock_days)`
- Lead time days + safety stock days by ABC/XYZ cell
- ROP breach status: already past / will breach within 7 days / safe

**Color coding** (mirrors blind test page):
- Compras recomendadas group → blue (`bg-blue-50/60`, `text-blue-900`)
- Ventas pronosticadas group → emerald (`bg-emerald-50/60`, `text-emerald-900`)
- Furgones columns → darker shade of the same hue, `font-semibold`

**Per-supplier totals section** (below the table, not a tfoot row — two supplier blocks side by side):

```
CARVAJAL (N SKUs)                    REYMA (N SKUs)
Compras rec.: X,XXX unidades         Compras rec.: X,XXX unidades
Valor total:  Q XXX,XXX              Valor total:  Q XXX,XXX
Furgones:     X.X furgones           Furgones:     X.X furgones
[truck fill indicator if applicable] [truck fill indicator if applicable]
```

Truck fill indicator: shown when `furgones mod 1 > 0.6` (the last truck is more than 60% empty — worth flagging). Example: "34.8 furgones → 34 completos + 1 al 80% — considera agregar Q X,XXX para completarlo."

---

### 2.3 On the Hot List (`/preocupaciones/desabastecimiento`)

Already largely correct from Plan 005 + 006. What is still missing:

- **Suggested emergency order quantity** per Crítico/Alto item:  
  `emergency_qty = ROP - current_stock - open_order_qty` (if positive)  
  Example: ROP = 12,000, current_stock = 3,000, open_order = 0 → emergency_qty = 9,000 units
- **Days until stockout** (a count, not just a date): "8 días" is more actionable than "mié 11 mar"
- **Historical frequency of this alert**: "Este SKU ha estado en Crítico 4 veces en los últimos 6 meses" — context that tells the compras manager whether this is a systemic problem or a one-time event

---

### 2.4 On the Programación de Compras (`/poc/programacion`)

The compras manager should see:

- **Current week's order plan** — what to order right now, from each supplier
- **Per-supplier order brief** — structured as they would actually send the order: SKU, quantity in the supplier's UoM, GTQ value, delivery date requested
- **Truck fill summary** — total furgones for this CARVAJAL order / total furgones for this REYMA order
- **Reasoning** — per line, why the system recommends that quantity (already exists in `purchase_schedule_lines.reasoning` column — it just needs to be made live instead of historical playback)

---

## 3. WHAT SHOULD THE COMPRAS MANAGER BE ABLE TO DO?

### 3.1 Filter and Slice — Already Partially Done

**Already implemented (from reading the code):**
- Hot List: filter by risk level, supplier, warehouse, search. ✓
- Hold List: filter by ABC, XYZ, supplier, search, sort. ✓
- Días de Inventario: filter by status, warehouse, search. ✓
- Forecast: filter by supplier, data quality tier, metric. ✓

**Still missing:**
- Forecast page: filter by "needs order now" (reorder point breached) vs. "plan ahead" (reorder point not yet breached)
- Forecast page: sort by furgones descending (to prioritize the SKUs that fill trucks most)
- Programación: generate a NEW run from the current snapshot (not just playback historical)

---

### 3.2 Export — Largely Done

**Already implemented:**
- Hot List: CSV export with all columns including GTQ en riesgo and fecha agotamiento. ✓
- Hold List: CSV export with GTQ inmovilizado, costo/día, policy parameters. ✓
- Días de Inventario: CSV export (from dias-inventario/page.tsx). ✓
- Forecast: CSV export with units and furgones per month. ✓ (but for past months — needs to be updated)
- Programación: CSV export (from poc/programacion/page.tsx lines 54–80). ✓ (but for historical runs)

**Still missing:**
- Forecast CSV: must include "Cantidad recomendada" column when that feature is built
- Programación CSV: must be exportable for the LIVE run (not just historical)

---

### 3.3 The One Critical Missing Action: Generate a Live Purchase Plan

**This is the most important thing the compras manager cannot do today.**

The app shows what's wrong (Hot List), shows what's excessive (Hold List), and shows a historical demo of what a purchase schedule looks like (Programación). But the compras manager **cannot generate a new purchase plan from today's data**.

The `purchase_schedule_runs` table and the POC algorithm already exist and work. What's needed is:
1. A "Generar plan" button that triggers a new run via the existing algorithm
2. The run executes against the March 3 snapshot data
3. The result appears as the "current week's" plan
4. The compras manager can export it and take it to supplier negotiations

This is the difference between a demo and an operational tool.

---

## 4. FULL RESEARCH — CURRENT STATE OF EVERY RELEVANT FILE

### 4.1 `/compras/forecast/page.tsx` — Full Diagnosis

**Forecast months:** Two hardcoded fetch calls to Feb & Mar 2026 (`forecast_month=2026-02-01` and `2026-03-01`). These are **intentional and correct** — confirmed 2026-05-11 (gate #8 resolved in `_qci/pre-production-requirements.md`). The ML model was trained through Jan 31, 2026; Feb & Mar are the blind test months that decision makers can verify against real outcomes. Do not change these dates.  
**FURGO_M3 = 122** — 53-foot trailer capacity. Appears in three files: compras/forecast, gerencia/forecast, and order-plan route. All four UI locations carry a visible disclaimer ("pendiente confirmación con proveedor"). Gate #2 in pre-production-requirements.md — do not remove the disclaimer until confirmed with client.  
**Stockout risk overlay:** Calls `/api/kpis/stockout-risk` live. Banner shows the top 5 at-risk SKUs (by days_of_supply asc). As of 2026-05-11, the full `urgentSkus` Set powers a new "Urgencia" filter row ("Pedir ahora (N)" / "Planificar") — urgency filter is now implemented.  
**Purchase history tooltip:** Shows 2024/2025/2026 monthly actuals per SKU. Useful for context but not actionable on its own.

**What the page does NOT have:**
- No "Cantidad recomendada" column
- No reorder point displayed per SKU
- No per-supplier order total
- No truck fill efficiency indicator
- No way to generate a fresh forecast run

**What the page does NOT have:**
- No "Cantidad recomendada" column
- No reorder point displayed
- No per-supplier order total
- No truck fill efficiency indicator
- No way to generate a fresh forecast run

---

### 4.2 `/api/forecast/route.ts` — Full Diagnosis

**Flexibility:** The API accepts `?forecast_month=YYYY-MM-DD` — it is NOT hardcoded at the API level. Any month can be queried.  
**Dependency:** It reads from `forecast_results` table. Rows exist for Feb & Mar 2026 (`prediction_end: "2026-03-31"`).  
**Months status:** Feb & Mar 2026 are the correct and intentional blind test months — confirmed 2026-05-11 (gate #8 resolved). The `forecast_results` table already has the rows needed. No re-run of the ML model is required for the current demo scope. The original "fix" described here (run model for Apr & May, update fetch calls to Apr & May) was written before the blind test design was confirmed — that instruction is superseded by gate #8. Do not change the forecast months.

---

### 4.3 `/api/poc/purchase-schedule/route.ts` — Full Diagnosis

**Reads from:** `purchase_schedule_runs` (list of completed runs) and `purchase_schedule_lines` (per-SKU order lines with reasoning).  
**Problem:** Only returns historical completed runs. No mechanism to trigger a new run from the API.  
**The algorithm** (from reading the schedule lines schema): uses `forecasted_weekly_demand`, `current_inventory`, `max_inventory_qty = avg_daily_demand × max_inventory_days`, and derives `recommended_qty = max_inventory_qty - current_inventory`.  
**Missing pieces in the existing schema:**
- No `open_order_qty` subtraction (existing open orders not deducted from recommended qty)
- No packing multiple rounding (CAJA40=40, FARDO10=10, FARDO05=5)
- No safety stock by ABC/XYZ cell
- `max_inventory_days` is a single global constant (14) — not differentiated by ABC/XYZ cell

---

### 4.4 `/api/kpis/stockout-risk/route.ts` — Full Diagnosis

**Calls:** `rpc_stockout_risks()` Supabase RPC.  
**Returns per row:** `product_id, product_name, sku, category, current_stock, avg_daily_demand, days_of_supply, lead_time_days, risk_level, unit_price, supplier_name`  
**What it does NOT return:**
- No `open_order_qty` — the compras manager cannot see whether a PO is already on the way
- No `safety_stock_units` — the reorder point cannot be computed without this

**What was added 2026-05-11:** The route now makes a parallel call to `rpc_abc_xyz_classification()` and joins `abc_class` + `xyz_class` onto each row by `product_id`. Products not present in the ABC/XYZ RPC receive `abc_class: null, xyz_class: null`. The `/preocupaciones/desabastecimiento` page uses this to compute `emergency_qty` via the `SAFETY_STOCK_DAYS` cell lookup (same lookup table as order-plan route and capital-congelado page).

---

### 4.5 `/api/kpis/abc-xyz/route.ts` — Full Diagnosis

**Calls:** `rpc_abc_xyz_classification()` Supabase RPC.  
**Returns per row:** `product_id, product_name, sku, category, total_revenue, cumulative_revenue_pct, abc_class, demand_cv, xyz_class, observation_days, statistical_confidence, current_stock, avg_daily_demand, lead_time_days, unit_cost, supplier_name`  
**Key data available:** `abc_class` + `xyz_class` → policy cell → safety stock days. This is all the data needed to compute the reorder point.

---

### 4.6 The FURGO_M3 = 122 Constant — ✅ CONFIRMED 2026-05-11

CARVAJAL and REYMA both deliver in furgón 53 pies (53-foot trailer, 122 m³). Confirmed by user 2026-05-11.

All WARNING code comments replaced with confirmed notes. The UI disclaimer ("pendiente confirmación con proveedor") removed from all four locations. Gate #2 in `_qci/pre-production-requirements.md` marked ✅ RESOLVED 2026-05-11.

---

### 4.7 Sidebar State (`FearsSidebar.tsx`) — Full Diagnosis

**COMPRAS section in sidebar:**
```
Inicio Compras    → /compras              subtitle: "Resumen del silo de Compras"
Forecast Compras  → /compras/forecast     subtitle: "Feb & Mar 2026 — 23 SKUs"   ← correct (confirmed 2026-05-11, gate #8)
Programación      → /poc/programacion     subtitle: "Carvajal y Reyma"            ← DISABLED (gate #9, 2026-05-11)
```

The subtitle "Feb & Mar 2026 — 23 SKUs" is correct and intentional — confirmed 2026-05-11 (gate #8). Do not update it.

Programación is disabled as of 2026-05-11: both sidebar entries and the `/compras` nav card render as non-interactive `<div>` with `opacity-40 cursor-not-allowed`. Navigation re-enabled only after gate #9 is resolved (live run generation, delivery date per line, furgones totals, supplier UoM display).

The Hot List and Hold List are in the OPERACIONES section of the sidebar, not COMPRAS — which means the compras manager (CAN_VIEW_COMPRAS role) has to navigate away from their section to see what's at risk. This is a navigation architecture problem (gate #7 in pre-production-requirements.md — estimated 30 minutes to fix).

**Hot List and Hold List belong in COMPRAS too.** A compras manager cannot do their job without knowing what's urgent (Hot List answers "order now") and what to avoid over-ordering (Hold List answers "don't order more of these"). Placing them only in OPERACIONES is a UX mistake.

---

## 5. PLAN TO CLOSE THE GAPS — PRIORITIZED, WITH MATH

### Priority 1 — ~~Fix the Forecast Page~~ SUPERSEDED by gate #8 (2026-05-11)

**Original problem statement:** Two hardcoded date strings make the entire page useless.

**Resolution (gate #8, confirmed 2026-05-11):** The Feb & Mar 2026 dates are intentional and correct — these are the blind test months. Decision makers have real Feb & Mar 2026 outcomes on their screens and are evaluating this system's forecasts against them. The hardcoded fetch calls, title, subtitle, CSV filename, and sidebar subtitle are all correct as-is. No code change is needed for the months.

**What Priority 1 should focus on instead:** Adding "Cantidad recomendada" column and per-supplier totals (see Priority 2 / Priority 3 below) — this is what makes the forecast page prescriptive rather than merely descriptive. The page already shows the right months; what it lacks is the recommended order quantity output.

---

### Priority 2 — Add "Cantidad Recomendada" Column to Forecast Page — ✅ DONE 2026-05-11

**The formula:**

```
safety_stock_days = CELL_POLICY[abc_class + xyz_class].safetyStock (days)
safety_stock_units = avg_daily_demand × safety_stock_days

target_stock = (avg_daily_demand × lead_time_days) + safety_stock_units + (avg_daily_demand × lead_time_days)
            = avg_daily_demand × (2 × lead_time_days) + safety_stock_units
```

Simplified: target_stock = enough to cover one full lead time of demand + safety stock on top.

```
cantidad_recomendada_raw = max(0, target_stock − current_stock)
cantidad_recomendada = ceil(cantidad_recomendada_raw / packing_multiple) × packing_multiple
```

Where `packing_multiple`:
- FARDO10 = 10 units
- FARDO05 = 5 units
- FARDO04 = 4 units
- FARDO20 = 20 units
- CAJA40 = 40 units
- Anything not matched = 1 (no rounding)

**Worked example — SKU 77205001 (Bandeja Bio 2P Foam, CARVAJAL, stock_uom FARDO10):**

Assume from March 3 snapshot:
- avg_daily_demand = 4,211 units/day (126,335 units / 30 days)
- lead_time_days = 21 days (CARVAJAL import lead time — confirm with client)
- abc_class = "A", xyz_class = "X" → AX → safety_stock_days = 3
- current_stock = unknown from forecast API (needs join with inventory snapshot)
- packing_multiple = 10 (FARDO10)

Calculation:
```
safety_stock_units = 4,211 × 3 = 12,633 units
target_stock = 4,211 × (2 × 21) + 12,633 = 4,211 × 42 + 12,633 = 176,862 + 12,633 = 189,495 units
cantidad_recomendada_raw = max(0, 189,495 − current_stock)
```
If current_stock = 50,000 units:
```
cantidad_recomendada_raw = 189,495 − 50,000 = 139,495 units
cantidad_recomendada = ceil(139,495 / 10) × 10 = 139,500 units
furgones_recomendados = (139,500 × volume_m3_per_unit) / 122
```
If volume_m3 = 0.0861 (derived from the 89.2 furgones shown for 126,335 units):
```
volume_m3_per_unit = 89.2 × 122 / 126,335 = 10,882.4 / 126,335 = 0.08614 m³/unit
furgones_recomendados = (139,500 × 0.08614) / 122 = 12,016.5 / 122 = 98.5 furgones
```

**How it was built (2026-05-11):**

The forecast page already fetched `/api/kpis/stockout-risk` (for the urgency banner). That route was updated earlier to return `avg_daily_demand`, `current_stock`, `lead_time_days`, `abc_class`, `xyz_class` per SKU. Rather than modifying `/api/forecast/route.ts`, a `riskMap: Map<string, StockoutRisk>` is built from the stockout-risk fetch that was already happening. The `rows` useMemo now takes `riskMap` as a dependency and computes `cantidad_recomendada` per SKU when creating each SkuRow entry.

No API route changes needed. No new DB queries. Zero additional network calls.

---

### Priority 3 — Add Hot List and Hold List to the COMPRAS Sidebar (Effort: Trivial — 30 minutes)

**Problem:** `CAN_VIEW_COMPRAS` role sees Hot List and Hold List only if they ALSO have `CAN_VIEW_OPERACIONES`. A pure compras user cannot reach these pages from their section.

**Fix:** Add Hot List and Hold List as nav items in the COMPRAS section of `FearsSidebar.tsx`:

```typescript
{
  section: 'Compras',
  requiredRoles: CAN_VIEW_COMPRAS,
  items: [
    { name: 'Inicio Compras',        href: '/compras',                          ... },
    { name: 'Hot List',              href: '/preocupaciones/desabastecimiento', ... },
    { name: 'Hold List',             href: '/preocupaciones/capital-congelado', ... },
    { name: 'Forecast de Compras',   href: '/compras/forecast',                 ... },
    { name: 'Programación',          href: '/poc/programacion',                 ... },
  ],
},
```

**Justification:** The Hot List directly answers "what do I need to order NOW?" — the most urgent version of question 1. It is a compras decision tool, not an operations monitoring tool. Placing it only in OPERACIONES fragments the compras manager's workflow.

---

### Priority 4 — Add Emergency Order Quantity to Hot List — ✅ DONE 2026-05-11

**What was built:**

`/api/kpis/stockout-risk/route.ts` now makes two parallel RPC calls (`rpc_stockout_risks` + `rpc_abc_xyz_classification`) and joins `abc_class` + `xyz_class` onto each row by `product_id`. The proper ABC/XYZ approach was used — the 7-day fixed workaround described in the original plan was **not needed**.

Formula implemented in `desabastecimiento/page.tsx`:
```
cell             = abc_class + xyz_class  (e.g. "AX", "BY", "CZ")
safety_stock_days = SAFETY_STOCK_DAYS[cell] ?? 7
rop              = avg_daily_demand × (lead_time_days + safety_stock_days)
emergency_qty    = max(0, ceil(rop − current_stock))
```

`open_order_qty = 0` (snapshot constraint — no live PO data). Emergency qty is an upper bound. "Pedido urgente" column shown only in company-wide view (`!isPerWarehouse`); hidden when a specific bodega is selected.

Column renders red bold when `emergency_qty > 0`; `—` when 0. Included in CSV export.

---

### Priority 5 — Live Purchase Schedule Generation (Effort: Large — 1–2 days)

**Problem:** `purchase_schedule_runs` only contains historical POC runs. The algorithm exists but is not exposed as a live action.

**What needs to happen:**
1. A new API endpoint `POST /api/poc/purchase-schedule/run` that triggers the schedule generation algorithm against the current snapshot
2. The algorithm computes recommendations based on:
   ```
   for each SKU with avg_daily_demand > 0:
     target_stock = avg_daily_demand × max_policy_days + safety_stock_units
     open_orders = sum of pending purchase_order_lines for this SKU (if available)
     recommended_qty = max(0, target_stock − current_stock − open_orders)
     recommended_qty = ceil(recommended_qty / packing_multiple) × packing_multiple
     if recommended_qty > 0:
       recommended_date = today + safety_lead_days (e.g., tomorrow or next business day)
       value = recommended_qty × unit_cost
       furgones = (recommended_qty × volume_m3) / 122
       reasoning = f"Stock actual: {current_stock}. Objetivo: {target_stock} ({max_policy_days}d demanda + {safety_stock_days}d seguridad). Pedido: {recommended_qty} unidades."
   ```
3. Results stored in `purchase_schedule_runs` + `purchase_schedule_lines`
4. The `/poc/programacion` page updated to show the latest live run first (not the oldest historical run)
5. "Generar plan nuevo" button on the page triggers step 1

**Per-supplier grouping output:**
```
CARVAJAL — Semana del 10 al 14 de marzo de 2026:
  SKU 77205001: 139,500 unidades (FARDO10) — Q XXX,XXX — 98.5 furgones
  SKU 77205003:  12,000 unidades (FARDO05) — Q  XX,XXX —  3.2 furgones
  SKU ...
  TOTAL CARVAJAL: XXX,XXX unidades — Q X,XXX,XXX — 102.X furgones
  Furgones: 102 completos + 1 a 20% → considera agregar Q XX,XXX más para completarlo

REYMA — Semana del 10 al 14 de marzo de 2026:
  [same structure]
```

---

### Priority 6 — Confirm FURGO_M3 with Client (Effort: 0 code, 1 conversation)

Before any furgon calculation is shown as production-grade data, confirm with PLASTICENTRO's logistics team:
- What type of truck does CARVAJAL deliver in? Furgón 53 pies (122 m³) or other?
- What type of truck does REYMA deliver in?
- Are there different truck types for different routes?

Until confirmed: keep the `// WARNING: unconfirmed` comment but add a visible disclaimer on the forecast page UI: "Cálculo de furgones basado en furgón 53 pies (122 m³) — pendiente confirmación con proveedor."

---

## 6. IMPLEMENTATION SEQUENCE

| Priority | Feature | Files to change | Effort | Demo impact |
|---|---|---|---|---|
| ~~1~~ | ~~Retrain model for Apr & May 2026 + update 4 hardcoded strings~~ | ~~superseded~~ | ~~Small~~ | ~~superseded by gate #8 — Feb & Mar are correct~~ |
| 2 | Add Hot List + Hold List to COMPRAS sidebar (gate #7) | `FearsSidebar.tsx` | Trivial | High — compras manager reaches their full toolset |
| 3 | ~~Add current_stock + lead_time to forecast API + compute cantidad_recomendada~~ **DONE 2026-05-11** | `compras/forecast/page.tsx` (riskMap from stockout-risk, no API change) | ~~Medium~~ | Done — "Recomendado" metric filter answers "how much to order?" |
| 4 | ~~Add emergency order qty to Hot List~~ **DONE 2026-05-11** | `stockout-risk/route.ts`, `desabastecimiento/page.tsx` | ~~Medium~~ | Done — `emergency_qty` computed via ABC/XYZ parallel call |
| 5 | Live purchase schedule generation (blocked by gate #9) | New API route, `purchase_schedule_runs`, `purchase_schedule_lines`, `/poc/programacion/page.tsx` | Large | Highest — the only page that generates a complete, exportable order plan |
| 6 | Confirm FURGO_M3 with client (gate #2) | No code | None | Risk mitigation |

---

## 7. WHAT BEST-IN-CLASS ACHIEVES THAT THIS PLAN ENABLES

| Capability | Slim4 / Kinaxis benchmark | This plan delivers |
|---|---|---|
| Forward-looking forecast accessible to buyer | ✓ | Priority 1 — Apr & May 2026 forecast visible |
| Recommended order quantity per SKU | ✓ | Priority 3 — Cantidad recomendada column |
| Packing multiple compliance | ✓ | Priority 3 + 5 — ceil(qty / packing_multiple) |
| Per-supplier order summary | ✓ | Priority 3 (supplier totals row) + Priority 5 (programación live) |
| Freight optimization (furgones) | ✓ | Priority 3 — Furgones recomendados column with fill efficiency |
| Emergency order trigger with quantity | ✓ | ✅ DONE 2026-05-11 — emergency_qty on Hot List via ABC/XYZ cell policy |
| Explainability per SKU ("why this quantity?") | ✓ | Priority 5 — reasoning field in schedule lines |
| Export to CSV for supplier negotiation | ✓ | Already done — update needed for correct months |

**What remains post-sale (not in this plan, requires live Odoo sync):**
- Open purchase order deduction from recommended qty (requires live PO data from Odoo)
- Supplier confirmation tracking (requires write-back to Odoo)
- Price break / MOQ from supplier catalog (requires supplier master data)
- Scenario planning: "what if demand spikes 30%?"

---

*All calculations in this document are based on data structures confirmed by direct reading of the codebase. No values are assumed or invented. Placeholder values (current_stock, lead_time_days per supplier) marked explicitly — these must be confirmed from actual Supabase data before implementation.*
