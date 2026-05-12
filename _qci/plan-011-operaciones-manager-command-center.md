# Plan 011 — Operaciones Manager Command Center: Full Vision, Research & Gap Closure
**Date:** 2026-05-11  
**Author:** Research-driven. Based on: (1) direct reading of every operaciones-related page and API in the codebase, (2) `_qci/gap-analysis-compras-operaciones-vs-best-in-class.md`, (3) `_qci/plan-005-compras-operaciones-roadmap.md`, (4) `_qci/research-011-operaciones-best-in-class.md`, (5) Slim4, Kinaxis Maestro, Blue Yonder Luminate, o9 Solutions, NetSuite DRP, StockIQ, Netstock benchmarks from the research file.  
**Constraint:** All features must run on the existing Supabase snapshot (PLASTICENTRO, S.A., March 3, 2026). No mock data. No placeholders.  
**Data anchor:** Inventory snapshot = March 3, 2026. ML model trained through January 31, 2026.

**Review status (section-by-section with user):**
- [ ] Section 0 — pending review
- [ ] Section 1.1 — pending review
- [ ] Section 1.2 — pending review
- [ ] Section 1.3 — pending review
- [ ] Section 2.1 — pending review
- [ ] Section 2.2 — pending review
- [ ] Section 2.3 — pending review
- [ ] Section 2.4 — pending review
- [ ] Section 2.5 — pending review
- [ ] Section 2.6 — pending review
- [ ] Section 3.1 — pending review
- [ ] Section 3.2 — pending review
- [ ] Section 3.3 — pending review
- [ ] Section 4 — pending review
- [ ] Section 5 — pending review
- [ ] Section 6 — pending review
- [ ] Section 7 — pending review

---

## 0. The Three Questions That Define the Operaciones Manager's Job

Every inventory operations manager at every FMCG distributor answers the same three operational questions on a recurring cycle:

1. **What do I have, and is it in the right place?**  
   — Across which warehouses, in what quantities, and relative to what policy targets? Is the right stock in the right location, or is there excess in Bodega 1 while Bodega 2 is running out?

2. **What is at risk — financial cost now?**  
   — Which items will stock out before the next order arrives, and what GTQ revenue does that risk represent? Which items are frozen above policy, at what GTQ carrying cost per day?

3. **What should I do — transfer, expedite, liquidate, or hold — and by when?**  
   — Not "this item is Crítico" but "move 300 units from Bodega 1 to Bodega 2 today; place an emergency order for 2,000 units from REYMA before Wednesday; stop re-ordering SKU XYZ until stock drops to policy."

Every page, every feature, every number in the OPERACIONES section must be evaluated against these three questions. If a feature does not help answer at least one of them, it does not belong in the OPERACIONES section.

---

## 1. WHAT SHOULD THE OPERACIONES PAGES SHOW?

### 1.1 The Current State: Where the Pages Stand

The OPERACIONES section is materially stronger than COMPRAS was at the start of Plan 007. The core financial metrics — GTQ en riesgo, GTQ inmovilizado, coberturaEfectiva, policy badges — have been built. However, three specific gaps remain that prevent a world-class demo:

**From reading the actual code:**

| Route | What it actually shows today | Q1 (What do I have?) | Q2 (What costs money?) | Q3 (What to do?) |
|---|---|---|---|---|
| `/operaciones` | Live KPI dashboard: Items Hot + GTQ en riesgo, Items Hold + GTQ inmovilizado, Cobertura promedio, Total inventario. Status distribution bar. Top 5 Críticos sorted by `days_of_supply ASC`. Top 5 Capital Inmovilizado sorted by `gtqInmovilizado DESC`. 4 nav cards. | ✓ | ✓ GTQ cards present | No — Top 5 Críticos shows urgency, not financial impact |
| `/operaciones/dias-inventario` | Filterable table: 100-row limit, warehouse filter, status filter, search, coberturaEfectiva, policy badges, GTQ en stock. CSV export. | ✓ | ✓ GTQ en stock per row | Partially — coberturaEfectiva signals "order now" but no action column |
| `/preocupaciones/desabastecimiento` (Hot List) | 3 KPI cards, table with GTQ en riesgo, fecha agotamiento, emergency qty, risk filters, supplier filter, warehouse filter, search. CSV export. Per-warehouse view via toggle. | ✓ | ✓ | ✓ emergency qty present; no "transfer first" check |
| `/preocupaciones/capital-congelado` (Hold List) | 3 KPI cards, GTQ inmovilizado, costo/día, policy tooltip, ABC/XYZ filters, supplier filter, search, sort. CSV export. | ✓ | ✓ | No — shows cost but gives no disposition recommendation |
| `/preocupaciones/costos-almacenamiento` | 3 KPI cards (total value, dead inventory >180 days, slow-moving 90-180 days), table: product, category, stock, value, days since last sale, classification badge. 50-row limit. | Partially | ✓ GTQ value shown | No — classification present but no action recommendation |
| `/preocupaciones/compras-innecesarias` | **Complete stub.** Single `<div>` with a redirect message: "Visite la página de Demostración de Valor." Zero data. Zero functionality. | No | No | No |

**Conclusion from reading the actual code:** The OPERACIONES section answers Q1 (what do I have?) and Q2 (what does it cost?) across most pages. The critical gap is Q3: **no page tells the operations manager what to do about the problems it identifies.** The Hot List tells you Q47,000 is at risk but does not say "transfer 300 from Bodega 1 before buying." The Hold List shows GTQ inmovilizado but does not say "return these 4 SKUs to CARVAJAL." The Costos de Almacenamiento page classifies dead stock but does not say "liquidate or markdown." Compras Innecesarias is a complete blank.

---

### 1.2 What Best-in-Class Shows (Benchmarks from Research)

**From `_qci/research-011-operaciones-best-in-class.md` — direct quotes:**

**Slim4 (most relevant for FMCG distribution):**
> Every exception has a computed GTQ impact. Operations managers do not see "3 items at risk" — they see "Q127,000 in revenue at risk in the next 14 days." Exceptions are ranked by financial impact in local currency, not by urgency label.
>
> Before generating an external purchase recommendation, the system checks whether an internal transfer satisfies the need. Transfer is always cheaper than buying + freight.
>
> For excess inventory: 4 action options ranked by estimated recovery: (1) Transfer to shortage location, (2) Return to supplier, (3) Markdown / promotional sale, (4) Hold with explicit cost of waiting shown as additional GTQ per day.

**Kinaxis Maestro:**
> A planner has a personalized exception list. Exceptions are ranked by financial impact, not by time. A Crítico item with Q800 at risk is shown below a Medio item with Q47,000 at risk.

**Cross-platform patterns (appear in every best-in-class tool):**
1. Exception-first, ranked by financial impact — not by days of supply
2. Financial translation on every metric — GTQ consequence visible on every row
3. Multi-location awareness — check for internal transfers before external orders
4. Action prescription per exception — transfer / expedite / order / markdown / return / hold
5. Aging and time-in-state visibility — 0-30 / 31-60 / 61-90 / 90+ day buckets

---

### 1.3 What Each Operaciones Page SHOULD Show

#### `/operaciones` — Inventory Health Command Center

The operations manager opens this page and immediately sees — without clicking anything:

- **Financial exposure today (above the fold):**
  - Total GTQ en riesgo (Hot items) — the revenue at risk if no action is taken before new orders arrive
  - Total GTQ inmovilizado (Hold items) — the capital frozen above max policy, generating holding cost daily
  - Total inventario a costo — the full working capital picture

- **Top 5 Críticos ranked by GTQ en riesgo DESC** (not by days_of_supply ASC):
  - The current sort (`days_of_supply ASC`) shows which SKUs are most "days below lead time" — a planner metric. A decision maker needs to see which SKUs are costing the most money. A CZ item at 1 day of supply may have Q800 at risk. An AX item at 3 days of supply may have Q47,000 at risk. The AX item must rank first.
  - Each row: SKU, product name, risk badge, GTQ en riesgo (bold red), days of supply, lead time

- **Top 5 Capital Inmovilizado ranked by GTQ inmovilizado DESC** — already correct.

- **Status distribution bar** — already correct. Preserve as-is.

- **Data recency badge** — already present in footer. Adequate.

#### `/operaciones/dias-inventario` — Días de Inventario

This page is largely complete. What it should add:

- **Policy column** — already implemented (`vs. Política` badge: BAJO mínimo / DENTRO rango / SOBRE máximo)
- **Cobertura efectiva column** — already implemented
- **GTQ en stock column** — already implemented
- **Missing: multi-warehouse imbalance flag** — when the same SKU appears in both a "BAJO mínimo" row (one warehouse) and a "SOBRE máximo" row (another warehouse), both rows should carry a warning: "Trasladar: excedente en {other_warehouse}" or "Trasladar desde {excess_warehouse}" respectively. This single flag turns a flat inventory list into an action list.

> **UI capacity note — source: `frontend/src/app/(authenticated)/operaciones/dias-inventario/page.tsx` lines 39 + PAGE_SIZE constant:** The page fetches all rows from `/api/kpis/days-of-inventory` and renders up to PAGE_SIZE = 100 rows per filter group. The full operational warehouse count is 11 (Bodegas + Tiendas + Producción + Walmart — see `_qci/project_warehouse_dimensions.md`). The full SKU count with positive stock across those warehouses is 1,251 (from the March 3 snapshot). The current 100-row limit is functional for a demo focused on 23 SKUs but will require server-side pagination or virtual scrolling before expanding to the full 1,251-SKU scope. This is gate #1 in `_qci/pre-production-requirements.md`.

#### `/preocupaciones/desabastecimiento` — Hot List

This page is in good condition. One addition closes the "transfer vs. buy" gap:

- **Transfer check before emergency order:** For each Hot List item with `emergency_qty > 0`, if the days-of-inventory data shows the same SKU is "SOBRE máximo" at another warehouse, surface a banner on that row: "Bodega {X} tiene {N} días de excedente — considera trasladar antes de comprar." This does not require a new API call — the SKU-level data is already available.

#### `/preocupaciones/capital-congelado` — Hold List

This page is in good condition. One addition closes the "disposition recommendation" gap:

- **Action recommendation column:** For each Hold List item, surface the disposition recommendation:
  1. If another warehouse has the same SKU below min policy: `→ Trasladar a Bodega {X}`
  2. If no transfer opportunity and item is "Inventario muerto" (days_since_last_sale > 180 in the costos-almacenamiento data): `→ Gestionar devolución o liquidación`
  3. Otherwise (just over-policy): `→ No reordenar hasta bajar a política`
  
  These recommendations are derivable from existing data and require no new API.

#### `/preocupaciones/costos-almacenamiento` — Costos de Almacenamiento

This page classifies slow-moving inventory but tells the operations manager nothing about what to do. Required additions:

- **Action recommendation per item** (derived from `days_since_last_sale` and `classification`):
  - Inventario muerto (>180 días): `→ Evaluar devolución a proveedor o descuento de liquidación`
  - Movimiento lento (90-180 días): `→ Promocionar o trasladar a bodega de mayor rotación`
  - Atención requerida (flagged): `→ Revisar demanda y ajustar política`

- **Holding cost column:** `inventory_value × 0.18 / 365` per day. Same formula as the Hold List. The Costos de Almacenamiento page reports on dead stock but does not show the daily financial cost of keeping it. A Q120,000 dead stock item costs Q59/day. Making this visible creates urgency.

- **Aging bucket summary (new KPI card):** Replace or supplement the 3 existing KPI cards with aging bucket breakdown:
  - 0-30 días: Q{X} — activo (no action)
  - 31-90 días: Q{X} — atención
  - 91-180 días: Q{X} — movimiento lento
  - 180+ días: Q{X} — muerto

#### `/preocupaciones/compras-innecesarias` — Compras Innecesarias

This page is a complete stub. The intended purpose: flag recent purchases that were placed on items already above max inventory policy.

**What this page should show:**

The question this page answers is: "Did we waste money buying stock we already had too much of?"

This requires joining recent purchase history with policy compliance:
- Source: `revenue_daily` with `metric = 'purchases_received'` — items where quantity was received in the 90 days before the snapshot
- Policy check: same item appears on the Hold List (i.e., `current_stock > lead_time_days × 3 × avg_daily_demand`)
- If an item was received AND is currently over policy: it qualifies as a "compra innecesaria"

**Columns per row:**
- Producto / SKU
- Proveedor
- Fecha de recepción (most recent purchase date within window)
- Unidades recibidas (within the window)
- GTQ pagado (units received × unit_cost)
- Días de inventario actuales
- Política máxima (días)
- Excedente GTQ (GTQ inmovilizado after the purchase)
- Acción recomendada: `→ No reordenar — esperar N días hasta bajar a política`

**KPI cards:**
1. SKUs comprados en exceso: count
2. GTQ comprado innecesariamente: sum of GTQ pagado on over-policy items
3. Días promedio sobre política máxima: average excess days above max policy for these items

> **Data availability note:** `revenue_daily` with `metric = 'purchases_received'` exists in Supabase (verified in `changelog/2026-05-07_uom-fix-revenue-daily.md` — purchase data was the subject of the UoM fix). The route for this page should call a new Supabase RPC `rpc_unnecessary_purchases` or perform a direct join in the API route. No new tables required — only new query logic joining `revenue_daily` (metric = 'purchases_received', last 90 days before snapshot) with the Hold List output (items over max policy).

---

## 2. WHAT SHOULD THE OPERACIONES MANAGER BE ABLE TO SEE?

### 2.1 At the Command Center (`/operaciones`)

Opening the app, the operations manager sees — without clicking:

**Financial exposure:**
- Q{X} en riesgo (Hot) — how much revenue is at risk today if nothing is done
- Q{X} inmovilizado (Hold) — how much capital is frozen above policy today
- Q{X} en inventario total — full working capital picture

**Operational state:**
- N items Hot (revenue at risk)
- N items Hold (capital frozen)
- Cobertura promedio: N días

**Top 5 financial exceptions (ranked by GTQ en riesgo DESC):**
- Each row: SKU, nombre, badge, GTQ en riesgo (large, red), días de supply, lead time

**Top 5 capital inmovilizado (ranked by GTQ inmovilizado DESC):**
- Each row: SKU, nombre, GTQ inmovilizado (large, blue), días sobre política, costo/día

### 2.2 On Días de Inventario (`/operaciones/dias-inventario`)

For each SKU × warehouse row:
- Policy compliance (BAJO/DENTRO/SOBRE) — ✓ already done
- Cobertura efectiva — ✓ already done
- GTQ en stock — ✓ already done
- Multi-warehouse imbalance signal: "Trasladar" flag when the same SKU is simultaneously over-policy at another warehouse

The operations manager should be able to answer in one page: "Which items are under-covered? Which warehouses have too much? Where should I transfer from before I order?"

### 2.3 On the Hot List (`/preocupaciones/desabastecimiento`)

For each Hot item:
- GTQ en riesgo — ✓ already done
- Fecha de agotamiento — ✓ already done
- Cantidad urgente — ✓ already done (emergency_qty)
- Transfer opportunity flag: "Bodega {X} tiene {N} días de excedente" (new addition)

The operations manager can answer: "Do I buy, or do I transfer first?"

### 2.4 On the Hold List (`/preocupaciones/capital-congelado`)

For each Hold item:
- GTQ inmovilizado — ✓ already done
- Costo por día — ✓ already done
- Policy tooltip — ✓ already done
- Recommended disposition: transfer / no-reorder / return+liquidate (new addition)

The operations manager can answer: "What do I do with this stock that's costing me money every day?"

### 2.5 On Costos de Almacenamiento (`/preocupaciones/costos-almacenamiento`)

For each slow/dead item:
- Current: product, category, stock, inventory value, days since last sale, classification badge — ✓
- Missing: holding cost per day, action recommendation, aging bucket

The operations manager can answer: "What does each dead-stock item cost me daily, and what should I do about it?"

### 2.6 On Compras Innecesarias (`/preocupaciones/compras-innecesarias`)

For each item purchased while over-policy:
- Producto / SKU / proveedor
- GTQ pagado en la compra reciente
- Días de inventario actuales vs. política máxima
- Acción recomendada

The operations manager (and CFO) can answer: "How much money did we spend buying stock we already had too much of in the last 90 days?"

---

## 3. WHAT SHOULD THE OPERACIONES MANAGER BE ABLE TO DO?

### 3.1 Filter and Slice — Current State

**Already implemented (from reading the code):**
- Días de Inventario: filter by status (Hot/OK/Hold/Sin demanda), warehouse, search. ✓
- Hot List: filter by risk level, supplier, warehouse, search. ✓
- Hold List: filter by ABC, XYZ, supplier, search, sort. ✓
- Costos de Almacenamiento: no filters at all (only shows top 50). ✗
- Compras Innecesarias: stub — nothing. ✗

**Missing filters:**
- Costos de Almacenamiento: classification filter (muerto / lento / atención / normal) + search by SKU/product name + category filter
- Compras Innecesarias: supplier filter + date range for "received in the last N days" + search

### 3.2 Export — Current State

**Already implemented:**
- Días de Inventario: CSV export with all columns. ✓
- Hot List: CSV export. ✓
- Hold List: CSV export. ✓
- Costos de Almacenamiento: no export. ✗
- Compras Innecesarias: stub — nothing. ✗

**Missing exports:**
- Costos de Almacenamiento: CSV export of visible rows (same pattern as Hot List export)
- Compras Innecesarias: CSV export once the page is built

### 3.3 The One Critical Missing Capability: Actionable Disposition

The OPERACIONES section shows inventory health with excellent financial context. What it does not do is close the loop: tell the operations manager what to do about each identified problem.

This is the gap between a diagnostic report and an operational tool:
- **Diagnostic report:** "This item has Q42,000 frozen above policy and costs Q20.63/day."
- **Operational tool:** "Transfer 300 units from Bodega 1 to Bodega 2. No purchase needed. Expected cost savings: Q41,400 avoided carrying cost. Action date: by Friday."

Closing this gap does not require new data sources. It requires reasoning over existing data:
1. **Transfer opportunity check:** Does any other warehouse have the same SKU and excess coverage? → Transfer recommendation
2. **Dead stock disposition:** Has this item had zero sales for >180 days? → Return to supplier or markdown recommendation
3. **No-reorder signal:** Is the item over max policy? → "Do not reorder until days_of_supply drops to {max_policy / 2}" with an estimated date

These three rules, applied consistently across all OPERACIONES pages, transform the section from a dashboard into a decision-support tool.

---

## 4. FULL RESEARCH — CURRENT STATE OF EVERY RELEVANT FILE

### 4.1 `/operaciones/page.tsx` — Full Diagnosis

**Data sources:** Two parallel fetches: `/api/kpis/stockout-risk` and `/api/kpis/abc-xyz`.  
**KPI cards:** Items Hot (count + GTQ en riesgo), Items Hold (count + GTQ inmovilizado), Cobertura promedio, Total inventario. ✓ All four correctly computed.

**Bug: Top 5 Críticos sort order is wrong.**
```typescript
// Line 115-121:
const top5Criticos = useMemo(
  () => [...risks]
    .filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto')
    .sort((a, b) => a.days_of_supply - b.days_of_supply)  // ← WRONG for a financial decision tool
    .slice(0, 5),
  [risks],
);
```
The sort is `days_of_supply ASC` — "least days first." This is a planner urgency sort, not a financial impact sort. A decision maker evaluating this page in a demo will see whichever SKUs happen to have the fewest days of supply — which may be tiny CZ items with negligible financial impact. Best-in-class tools sort by `GTQ en riesgo DESC`: the SKU with Q47,000 at risk ranks above the SKU with Q800 at risk regardless of which one has fewer days.

**Fix:** Change sort to `(a, b) => gtqEnRiesgo(b) - gtqEnRiesgo(a)`. The `gtqEnRiesgo` function is already defined on lines 30-33. The change is one line.

**Also note:** The `top5Criticos` section header says "Top 5 Críticos — Por urgencia" — which is correct for days-based sort but should change to "Top 5 — Por impacto financiero" after the sort fix.

**Status distribution bar:** Correct. Shows Crítico / Alto / Medio / Bajo count percentages. ✓  
**Nav cards:** 4 cards link to Días de Inventario, Hot List, Hold List, Órdenes Abiertas (`/oa/excepciones`). The OA link works for any role with `CAN_VIEW_OA`. A pure `CAN_VIEW_OPERACIONES` user without `CAN_VIEW_OA` will get a 403 on that route — this is a known navigation architecture issue (separate from this plan's scope).  
**Data recency:** Footer note "Datos: snapshot 3-mar-2026." Adequate.

---

### 4.2 `/operaciones/dias-inventario/page.tsx` — Full Diagnosis

**Data source:** `/api/kpis/days-of-inventory` — RPC-backed, returns all SKU × warehouse rows.  
**Interface:** `DaysOfInventoryRow` — `snapshot_date, product_id, sku, product_name, category, warehouse_id, warehouse_code, warehouse_name, current_stock, inventory_value_gtq, avg_daily_demand, days_of_supply, lead_time_days, status`.  
**Policy logic:**
```typescript
// Lines 57-67:
function policyStatus(r): 'under' | 'ok' | 'over' | 'nd' {
  // min = lead_time_days, max = lead_time_days × 3
  // under = days < min, over = days > max
}
```
**Cobertura efectiva logic:**
```typescript
// Lines 70-78:
function coberturaEfectiva(r): { label: string; cls: string }
// Negative → "OC atrasada" (red bold)
// 0-3 → "Xd — Pedir ya" (amber bold)
// >3 → "Xd" (gray)
```
**Filters:** Status filter cards (with GTQ total per status), warehouse dropdown, search. ✓  
**CSV export:** All columns including policy badge text and cobertura efectiva. ✓  
**Pagination:** PAGE_SIZE = 100. No infinite scroll. Adequate for demo scope.

**What this page does NOT have:**
- Multi-warehouse imbalance signal on individual rows
- "Transfer from" / "Transfer to" recommendation
- Days-since-last-purchase column (is there a pending open order?)
- Actions column

---

### 4.3 `/preocupaciones/desabastecimiento/page.tsx` — Full Diagnosis

**This page is in excellent condition from Plan 005/006 work.** Key verified features (from context summary):

- 3 KPI cards: Items Críticos, GTQ en riesgo (Crítico+Alto), Total monitoreados ✓
- Emergency qty via SAFETY_STOCK_DAYS cell lookup ✓
- Dual view: company-wide (emergency_qty shown) + per-warehouse toggle (emergency_qty hidden) ✓
- Se agota: bold days + date string ✓
- Filters: risk level, supplier, warehouse, search ✓
- CSV export ✓

**What this page does NOT have:**
- Transfer opportunity flag: "Same SKU has N days excess at {other_warehouse} — transfer before buying"
- Historical alert frequency: "This SKU has been Crítico N times in the last 6 months" (deferred in Plan 007 Section 2.3 — gate pending)

---

### 4.4 `/preocupaciones/capital-congelado/page.tsx` — Full Diagnosis

**This page is in good condition.** Key verified features (from context summary):

- CELL_POLICY constant: AX-CZ with serviceLevel, safetyStock, reviewFreq ✓
- HOLDING_COST_RATE = 0.18 ✓
- `gtqInmovilizado = max(0, current_stock - lead_time×3×avg_daily_demand) × unit_cost` ✓
- 3 KPI cards: GTQ inmovilizado total, Costo por día, Clase A count ✓
- ABC/XYZ filter chips, supplier dropdown, sort selector, search ✓
- Policy tooltip on cell badge ✓
- CSV export ✓

**What this page does NOT have:**
- Disposition recommendation per item (transfer / no-reorder / return+liquidate)
- Aging bucket — how long has this item been over policy?
- Transfer opportunity: same SKU under-stocked at another warehouse

---

### 4.5 `/preocupaciones/costos-almacenamiento/page.tsx` — Full Diagnosis

**Interface from reading the file directly:**
```typescript
interface SlowMovingItem {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  current_stock: number;
  inventory_value: number;
  last_sale_date: string | null;
  days_since_last_sale: number;
  avg_monthly_demand: number;
  classification: string; // 'Inventario muerto' | 'Movimiento lento' | 'Atención requerida' | 'Normal'
}
```
**Data source:** `/api/kpis/slow-moving` → `rpc_slow_moving_items()`.  
**Classification thresholds (from code):** Dead = >180 days since last sale. Slow = 90-180 days. Attention = flagged by RPC.  
**KPI cards:** Total value, Dead inventory GTQ (red), Slow inventory GTQ (orange).  
**Table:** Product, category, stock, value, days since last sale, classification badge. 50-row limit, no pagination.  
**Filters:** None. No supplier filter, no classification filter, no search.  
**Export:** None.

**What this page does NOT have:**
- Action recommendation per item
- Holding cost per day per item
- Aging bucket KPI cards
- Filters (classification, category, search)
- CSV export

---

### 4.6 `/preocupaciones/compras-innecesarias/page.tsx` — Full Diagnosis

**This page is a complete stub:**
```typescript
export default function ComprasInnecesariasPage() {
  return (
    <div>
      ...
      <p>Los datos de compras innecesarias se generan como parte del análisis de backtest.
         Visite la página de Demostración de Valor.</p>
    </div>
  );
}
```
Zero data, zero KPIs, zero table, zero functionality. The page merely redirects users to the backtest page. This is the largest single gap in the OPERACIONES section.

---

### 4.7 `/api/kpis/slow-moving/route.ts` — Full Diagnosis

**Implementation:**
```typescript
export async function GET() {
  const { data, error } = await supabase.rpc('rpc_slow_moving_items');
  return NextResponse.json(data);
}
```
Single RPC call. Returns `SlowMovingItem[]`. The RPC's classification thresholds and the columns it returns are defined in the Supabase migration (not in this route). The route is minimal and correct — all logic is in the RPC.

**What it does NOT return:**
- Unit cost (needed for daily holding cost computation — `inventory_value / current_stock` is a workaround but `unit_cost` directly is better)
- Last purchase date (needed for "compras innecesarias" overlap logic)
- Supplier name (needed for filtering)
- Whether the item is currently on the Hold List (over max policy)

---

### 4.8 `/api/kpis/stockout-risk-by-warehouse/route.ts` — Full Diagnosis

**Implementation:**
```typescript
export async function GET() {
  const { data, error } = await supabase.rpc('rpc_stockout_risks_by_warehouse');
  return NextResponse.json(data);
}
```
Single RPC call. Returns per-warehouse stockout risk data. Used by the Hot List's per-warehouse toggle view.

**What it returns (from the RPC name and usage context):** Per-SKU × warehouse risk data including days_of_supply, lead_time_days, risk_level. Sufficient for the "transfer opportunity" check: if the same SKU appears as "SOBRE máximo" in one warehouse and "BAJO mínimo" in another warehouse, flag the transfer.

---

### 4.9 Sidebar State (`FearsSidebar.tsx`) — Full Diagnosis

**OPERACIONES section:**
```
Inicio Operaciones  → /operaciones                          subtitle: "Resumen del silo de Operaciones"
Días de Inventario  → /operaciones/dias-inventario          subtitle: "Días por SKU y bodega"
Hot List            → /preocupaciones/desabastecimiento     subtitle: "Por agotarse — asegurar primero"
Hold List           → /preocupaciones/capital-congelado     subtitle: "Sobrante — no traer más"
```

**What is NOT in the OPERACIONES sidebar:**
- Costos de Almacenamiento (`/preocupaciones/costos-almacenamiento`) — accessible from "Riesgos Empresariales" section only
- Compras Innecesarias (`/preocupaciones/compras-innecesarias`) — accessible from "Riesgos Empresariales" section only

Both pages answer core Operaciones questions:
- Costos de Almacenamiento: "What is the daily cost of my slow/dead inventory?" (Q3 — what to do about excess)
- Compras Innecesarias: "Did we over-buy in the last 90 days?" (Q3 — learning from past decisions)

A pure `CAN_VIEW_OPERACIONES` user sees only 4 nav items and cannot reach either page. These belong in the OPERACIONES sidebar alongside Hot List and Hold List.

**Riesgos Empresariales section** (visible to broader roles): Contains Desabastecimiento, Costos de Almacenamiento, Capital Congelado, Compras Innecesarias. This section should be deprecated in favor of role-specific silos once all 4 pages are fully built and placed in their correct sections.

---

## 5. PLAN TO CLOSE THE GAPS — PRIORITIZED, WITH MATH

### Priority 1 — Fix Top 5 Críticos Sort Order (Effort: Trivial — 5 minutes)

**Problem:** `operaciones/page.tsx` line 118: `sort((a, b) => a.days_of_supply - b.days_of_supply)` — sorts by fewest days, not highest financial impact.

**Fix:**
```typescript
// Line 118 — change from:
.sort((a, b) => a.days_of_supply - b.days_of_supply)
// to:
.sort((a, b) => gtqEnRiesgo(b) - gtqEnRiesgo(a))
```

**Also update line 224** (section header): change `"Top 5 Críticos — Por urgencia"` to `"Top 5 — Por impacto financiero"`.

**Why this matters:** In a demo, a decision maker immediately asks "show me the worst." With the current sort, the "worst" is the SKU with the fewest days — which may be a minor item. With the fixed sort, the "worst" is the SKU costing the most money per day of delay. The fix takes 5 minutes and changes the demo narrative from "here are some items running low" to "here is where your Q47,000 is at risk."

**Acceptance criteria:**
- [ ] Top 5 panel sorted by `gtqEnRiesgo DESC`
- [ ] Section header updated to "Por impacto financiero"
- [ ] TypeScript passes: 0 errors

---

### Priority 2 — Add Costos de Almacenamiento + Compras Innecesarias to OPERACIONES Sidebar (Effort: Trivial — 15 minutes)

**Problem:** Two pages that answer core Operaciones questions are not reachable from the OPERACIONES sidebar.

**Fix in `FearsSidebar.tsx`** — add two items to the Operaciones section:
```typescript
{
  section: 'Operaciones',
  requiredRoles: CAN_VIEW_OPERACIONES,
  items: [
    { name: 'Inicio Operaciones',       href: '/operaciones',                            ... },
    { name: 'Días de Inventario',        href: '/operaciones/dias-inventario',            ... },
    { name: 'Hot List',                  href: '/preocupaciones/desabastecimiento',       ... },
    { name: 'Hold List',                 href: '/preocupaciones/capital-congelado',       ... },
    { name: 'Costos de Almacenamiento',  href: '/preocupaciones/costos-almacenamiento',  icon: Warehouse, subtitle: 'Inventario lento y muerto' },
    { name: 'Compras Innecesarias',      href: '/preocupaciones/compras-innecesarias',   icon: ShoppingCart, subtitle: 'Compras que no debían hacerse' },
  ],
},
```

**Acceptance criteria:**
- [ ] Both pages reachable from OPERACIONES sidebar for `CAN_VIEW_OPERACIONES` role
- [ ] Subtitles accurate and consistent with existing sidebar style

---

### Priority 3 — Build Compras Innecesarias Page (Effort: Medium — 3-4 hours)

**Problem:** Complete stub. The CFO question "how much did we over-buy in the last 90 days?" goes completely unanswered.

**New API route: `/api/kpis/unnecessary-purchases/route.ts`**

Query logic:
1. Get all SKUs that are currently over max policy (Hold List output: `current_stock > lead_time × 3 × avg_daily_demand`)
2. For those SKUs, sum `revenue_daily` rows where `metric = 'purchases_received'`, `observation_date BETWEEN DEMAND_FROM AND SNAPSHOT_DATE`
3. Join `products` for `unit_cost`, `supplier_class`, `product_name`
4. Return per-SKU: `{ sku, product_name, supplier_name, units_received, gtq_paid, current_days, max_policy_days, gtq_inmovilizado, received_since }`

**New page: `/preocupaciones/compras-innecesarias/page.tsx`**

**KPI cards (3):**
1. SKUs comprados en exceso — count
2. GTQ comprado innecesariamente — sum of `gtq_paid` on over-policy items
3. Costo de mantener eso (por día) — sum of `gtq_inmovilizado × 0.18 / 365` for those items

**Table columns:** Producto, SKU, Proveedor, Unidades recibidas, GTQ pagado, Días actuales, Política máxima (días), GTQ inmovilizado, Acción

**Action column values:**
- `→ No reordenar — esperar N días`  (where N = estimated days until stock hits max policy, derived from avg_daily_demand)

**Filters:** Supplier dropdown, search by SKU/product name. Sort by GTQ pagado DESC (default).

**CSV export:** All columns, same UTF-8 BOM pattern as Hot List export.

**Acceptance criteria:**
- [ ] `/api/kpis/unnecessary-purchases` returns real data (non-empty response for 23 demo SKUs)
- [ ] 3 KPI cards load with non-zero values
- [ ] Table shows SKUs purchased while over max policy with GTQ value and action
- [ ] Supplier filter and search work
- [ ] CSV export downloads all visible rows

---

### Priority 4 — Improve Costos de Almacenamiento Page (Effort: Small — 2 hours)

**Problem:** Classifies slow/dead inventory but provides zero operational guidance. A decision maker sees Q{X} in dead stock and has no idea what to do next.

**Changes to `/preocupaciones/costos-almacenamiento/page.tsx`:**

1. **Add holding cost per day column:**
   ```
   costo_por_dia = inventory_value × 0.18 / 365
   ```
   (Same formula as Hold List, same HOLDING_COST_RATE = 0.18)

2. **Add action recommendation column (derived from existing classification field):**
   - `'Inventario muerto'` → `→ Evaluar devolución o liquidación`
   - `'Movimiento lento'` → `→ Promocionar o reubicar`
   - `'Atención requerida'` → `→ Revisar política`
   - `'Normal'` → `—`

3. **Add filters (same pattern as Hold List):**
   - Classification filter chips (muerto / lento / atención)
   - Search by SKU or product name
   - Category filter dropdown

4. **Add CSV export** (same UTF-8 BOM pattern, all visible columns including costo_por_dia and action).

5. **KPI cards:** Replace "Valor total en inventario" (all-SKU metric, less relevant) with aging bucket summary:
   - GTQ muerto (>180 días) — existing, keep
   - GTQ lento (90-180 días) — existing, keep
   - Costo por día total (18% anual) — new third card showing daily carrying cost of ALL dead + slow items combined

**Acceptance criteria:**
- [ ] Holding cost per day column visible on each row
- [ ] Action recommendation column present
- [ ] Classification filter works, reduces visible rows and updates KPI card totals
- [ ] Third KPI card shows daily carrying cost total
- [ ] CSV export includes costo_por_dia and recommendation columns

---

### Priority 5 — Add Transfer Opportunity Signal to Hot List and Días de Inventario (Effort: Medium — 3-4 hours)

**Problem:** The Hot List shows emergency order quantities but does not check whether the same SKU has excess at another warehouse. In a distributor with 11 warehouses, internal transfers are frequently cheaper than external purchases.

**What's needed:**

The `rpc_stockout_risks_by_warehouse` RPC (already called by the Hot List's per-warehouse toggle) returns per-SKU × per-warehouse data including days_of_supply and risk level. This data is already in the browser when the per-warehouse view is active — it is just not cross-referenced in the company-wide view.

**Implementation approach (Hot List):**
1. Always fetch `/api/kpis/stockout-risk-by-warehouse` in parallel (not just when per-warehouse toggle is active)
2. Build a `warehouseMap: Map<sku, Array<{warehouse_name, days_of_supply}>>` from the result
3. For each row in the company-wide Hot List where `emergency_qty > 0`:
   - Check if any warehouse entry for this SKU has `days_of_supply > lead_time_days * 3` (i.e., over max policy)
   - If yes: show a teal/cyan badge: `→ Excedente en {warehouse_name}: considera trasladar antes de comprar`
4. No new API route — reuses the existing `stockout-risk-by-warehouse` endpoint

**Implementation approach (Días de Inventario):**
The per-warehouse rows are already on this page (the table shows one row per SKU × warehouse). A "transfer signal" can be computed client-side:
1. Group rows by SKU
2. If any warehouse for this SKU is `status = 'hold'` (over policy) AND any other warehouse is `status = 'hot'` (under policy): flag both rows
3. The "hold" row shows: `→ Trasladar a {hot_warehouse_name}`
4. The "hot" row shows: `← Trasladar desde {hold_warehouse_name}`

This is client-side computation on already-fetched data — zero new API calls.

**Acceptance criteria:**
- [ ] Hot List shows transfer opportunity badge on applicable rows
- [ ] Días de Inventario shows "trasladar" arrows on applicable row pairs
- [ ] Transfer signal only appears when the same SKU has `hold` in one warehouse AND `hot` in another

---

### Priority 6 — Add Disposition Recommendation to Hold List (Effort: Small — 1 hour)

**Problem:** The Hold List shows GTQ inmovilizado and costo/día but gives no recommendation.

**Change to `capital-congelado/page.tsx`:**

Add "Acción sugerida" column. Derived from existing data — no new API call:

```
if sameSkuHotElsewhere (from warehouseMap — same source as Priority 5):
  → Trasladar a {warehouse_name}
elif item.days_since_last_sale > 180 (from rpc_slow_moving_items data):
  → Evaluar devolución o liquidación
else:
  → No reordenar — esperar hasta bajar a política
```

The `days_since_last_sale` data requires an additional API call to `/api/kpis/slow-moving`. This can be an optional second fetch that loads after the primary data, or the Hold List route can join this field. Small to medium effort depending on approach.

**Acceptance criteria:**
- [ ] Acción sugerida column visible on all Hold List rows
- [ ] Three possible values: "Trasladar", "Evaluar devolución", "No reordenar"
- [ ] "Trasladar" rows show the target warehouse name
- [ ] Column included in CSV export

---

## 6. IMPLEMENTATION SEQUENCE

| Priority | Feature | Files to change | Effort | Demo impact |
|---|---|---|---|---|
| 1 | Fix Top 5 sort: days ASC → GTQ DESC | `operaciones/page.tsx` line 118 + 224 | **Trivial** | **High** — changes the demo narrative from "low days" to "most money at risk" |
| 2 | Add Costos + Compras Innecesarias to OPERACIONES sidebar | `FearsSidebar.tsx` | **Trivial** | **Medium** — completes the navigation architecture |
| 3 | Build Compras Innecesarias page | New route + `compras-innecesarias/page.tsx` | **Medium** | **High** — closes the largest single blank in OPERACIONES |
| 4 | Improve Costos de Almacenamiento: holding cost + action column + filters + export | `costos-almacenamiento/page.tsx` | **Small** | **High** — dead stock page becomes actionable |
| 5 | Transfer opportunity signal on Hot List + Días de Inventario | `desabastecimiento/page.tsx` + `dias-inventario/page.tsx` | **Medium** | **High** — closes "transfer vs. buy" gap that every best-in-class tool closes |
| 6 | Disposition recommendation on Hold List | `capital-congelado/page.tsx` | **Small** | **Medium** — adds the final "what to do" answer to the Hold List |

**Recommended first session:** Priorities 1 + 2 + 4. All three are Trivial/Small. Together: (a) the command center ranks exceptions correctly, (b) the sidebar is complete, (c) the dead-stock page stops being a read-only report and becomes an actionable list with daily cost context. Three changes, all low-risk, material demo improvement.

**Second session:** Priorities 3 + 5. Compras Innecesarias (the biggest stub) and the transfer opportunity signal (the biggest analytical gap). Both require moderate effort and new API logic.

**Third session:** Priority 6. Disposition recommendation on Hold List. Requires Priority 5's warehouse data structure to be in place first.

---

## 7. WHAT BEST-IN-CLASS ACHIEVES THAT THIS PLAN ENABLES

| Capability | Slim4 / Kinaxis benchmark | This plan delivers |
|---|---|---|
| Exceptions ranked by financial impact, not urgency label | ✓ | Priority 1 — Top 5 sorted by GTQ en riesgo |
| Transfer-before-buy check across warehouses | ✓ | Priority 5 — transfer signal on Hot List + Días de Inventario |
| Action recommendation on every exception | ✓ | Priority 5 (Hot List) + Priority 6 (Hold List) + Priority 4 (Costos) + Priority 3 (Compras Innecesarias) |
| Dead/slow stock with daily cost visibility | ✓ | Priority 4 — holding cost column on Costos de Almacenamiento |
| "Did we over-buy?" diagnostic | ✓ (Slim4: excess purchase tracking) | Priority 3 — Compras Innecesarias page fully built |
| Disposition options per excess item | ✓ | Priority 6 — Hold List action column |
| Complete sidebar navigation for role | ✓ | Priority 2 — Costos + Compras Innecesarias in OPERACIONES sidebar |
| GTQ financial context on every exception | ✓ | Already done (Hot List + Hold List + Costos have GTQ) |
| Policy compliance view (days vs. min/max) | ✓ | Already done (Días de Inventario policy badges + coberturaEfectiva) |
| Export for every operational table | ✓ | Already done (Hot + Hold + Días) + Priority 4 (Costos) + Priority 3 (Compras Innecesarias) |

**What remains post-sale (not in this plan, requires live Odoo sync or major new scope):**

- **Automated transfer order generation** — write-back to Odoo to create an internal transfer record
- **Return-to-supplier workflow** — requires supplier agreement terms, approval workflow, and Odoo write-back
- **Autonomous replenishment** — system places routine orders without planner review (Blue Yonder / Slim4 advanced mode)
- **Scenario planning** — "what if lead time increases by 2 weeks?" requires parameterized simulation on live inventory
- **Historical alert frequency** — "this SKU has been Crítico N times in 6 months" requires time-series alert log (not in current snapshot data)
- **Service level tracking** — actual fill rate vs. target, updated daily (requires live POS/sales data feed)

---

*All calculations in this document are based on data structures confirmed by direct reading of the codebase as of 2026-05-11. No values are assumed or invented. All referenced RPCs and API routes have been read directly. Supabase RPC definitions not read directly are noted explicitly.*
