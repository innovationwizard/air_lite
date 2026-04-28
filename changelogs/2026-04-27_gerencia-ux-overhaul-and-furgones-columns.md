# Gerencia Pages — UX Overhaul, Data Source Realignment & Furgones Conversion Columns

**Date:** 2026-04-27
**Scope:** Three Gerencia pages (`/gerencia/validacion`, `/gerencia/gap-report`, `/gerencia/forecast`) plus the forecast API and the navigation sidebar. No database schema changes.
**Stack:** Next.js 15 App Router, TypeScript, Tailwind CSS, Supabase (PostgreSQL).
**Driving context:** Demo preparation for a key decision maker. The insider's primary mental model is furgones (53-foot trailers), not units — every forecast number must be expressible as a truck count to be credible and actionable.

---

## Why This Was Done

Two categories of problems needed to be fixed before the demo:

**1. UX problems that broke trust**
- Month selection was a dropdown. Decision makers do not use dropdowns to navigate time — they scan and click. Replaced across all three pages with a persistent block of labeled buttons, grouped by year.
- Column headers used abbreviations ("Ord.", "Rec.", "unid") that introduced ambiguity. Insider rule: no abbreviations in user-facing text.
- Internal nomenclature ("Acid Test 1", "Acid Test 2", "Gap Report", "Clase") was leaking into the UI. Replaced with clean business language.

**2. Data source problems that broke credibility**
- The Validación Histórica page was calling the ML backtesting API (`/api/gerencia/validacion`), which returns data only when a training run exists for that month. This caused months without a recent run to appear empty (grayed out), making the page unreliable and confusing.
- The blind-test boundary (January 2026 cap) was not enforced — navigation buttons existed for Feb/Mar 2026, which return zero because those are the months being blind-tested. Showing zero looks like missing data; it had to be hidden.

**3. Missing business dimension**
- The forecast table showed units per SKU per month per metric, but the decision maker's question is: "How many trucks does this represent?" Without furgones columns, the numbers are hard to act on.

---

## Changes by File

### `frontend/src/app/(authenticated)/gerencia/validacion/page.tsx`

**Complete rewrite of the page component.**

**Before:**
- Data source: `/api/gerencia/validacion` — an ML-run-based API that only returns data when a Prophet training run exists for the selected time window.
- Time navigation: a `<select>` dropdown over a flat list of month strings.
- Table columns: included forecast values, backtest values, and percentage error columns alongside historical actuals.
- Title: "Validación Histórica — Gerencia".

**After:**
- Data source: `/api/acid-test/gap-report?action=report&scope=top&from=…&to=…` — the same raw Odoo API that the Gap Report page uses. This API reads directly from `revenue_daily` (synced from Odoo) without any ML dependency, so every month with Odoo data is always populated.
- Time navigation: a static grid of month buttons grouped by year (2024, 2025, 2026), rendered from a hardcoded constant `MONTH_NAV`. Default selection: January 2025.
- Table columns: six columns only — Producto, Proveedor, Ventas (unidades), Ventas (GTQ), Compras (unidades), Recibido (unidades). All forecast and backtest columns removed.
- Title: "Validación Histórica" (suffix "— Gerencia" removed).

**Blind-test boundary enforcement:**

```typescript
// Data is intentionally capped at Jan 2026 — Feb/Mar/Apr are blind-test months.
const MAX_MONTH = '2026-01';

const MONTH_NAV: Record<string, string[]> = {
  '2024': ['2024-01','2024-02',...,'2024-12'],
  '2025': ['2025-01','2025-02',...,'2025-12'],
  '2026': ['2026-01'],
};
```

February, March, and April 2026 are deliberately excluded from the navigation. They are the months for which the ML model made blind predictions, and real values can now be verified against those predictions. Showing them as zero in the historical page would be misleading — they are not missing, they are withheld by design.

**New interface (replaces ML-dependent run interfaces):**

```typescript
interface GapRow {
  sku: string;
  product_name: string;
  supplier_class: string;
  sales_qty: number;
  sales_revenue_gtq: number;
  purchases_ordered_qty: number;
  purchases_received_qty: number;
}
```

---

### `frontend/src/app/(authenticated)/gerencia/gap-report/page.tsx`

**Major refactor — navigation, naming, collapsible card, and language.**

**Time navigation:**
- Removed: year-preset toggle buttons ("2024", "2025", "2026-YTD"), `fromMonth` / `toMonth` date range inputs, and the "Todo" all-time button.
- Added: identical month-button grid to Validación Histórica. Same `MONTH_NAV` constant, same `MAX_MONTH = '2026-01'`, same default of January 2025. The two pages now navigate time in exactly the same way.
- Month labels use full Spanish names (Enero, Febrero, …) instead of abbreviations (Ene, Feb, …).

**Naming and language:**
- Page title: "Reporte de Discrepancias — Acid Test 1" → **"Auditoría de Discrepancias"**. "Acid Test 1" is internal nomenclature; "auditoría" is what the action actually is.
- "Clase" → **"Proveedor"** in the supplier filter label and table header. "Clase" referred to `supplier_class` in the database — that internal field name was leaking into the UI.
- "Todas" → **"Todos"** (grammatical agreement with "proveedores").
- "Compras Ord" → **"Compras (unidades)"**, "Compras Rec" → **"Recibido (unidades)"** — no abbreviations.

**Collapsible "Cómo usar" card:**
- The how-to box was always visible, consuming significant vertical space above the table.
- Replaced with a collapsible card (default: collapsed) controlled by `comoUsarOpen` state and a `ChevronDown` / `ChevronUp` icon. Users who understand the page are not forced to scroll past the explanation on every visit.

**Instruction text:**
- Updated to remove references to "Acid Test", "SSOT", and other internal terms. Text now explains the purpose in plain business language: verify that what the system shows matches what can be verified independently in Odoo.

---

### `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx`

**Multiple enhancements: naming, sorting, metadata columns, and furgones conversion columns.**

**Naming:**
- Page-level "Cómo leer esto" section: removed "Acid Test 2 — " prefix.
- Filter label: "Clase:" → **"Proveedor:"**
- "Todas" → **"Todos"**

**Row sorting:**
- Before: rows sorted alphabetically by SKU code.
- After: rows sorted by `supplier_class` first (CARVAJAL before REYMA alphabetically), then by `movement_rank_within_class` ascending (rank 1 = highest-velocity SKU in class). This places the most commercially important products at the top of each supplier group.

**Stock unit badge:**
- Each SKU row now displays a small monospaced badge below the product name showing `stock_uom` (e.g., `CAJA40`, `FARDO20`). This makes the meaning of each unit column unambiguous — the reader can see at a glance that "1,200" means 1,200 FARDO20, not 1,200 individual items.

**m³ / unidad column:**
- Displays `volume_m3` (cubic meters per stock unit) from the `products` table, formatted to 4 decimal places.
- Source: already populated in Supabase `products` for all 23 top SKUs — no DB changes required.
- Purpose: reference value for understanding how much physical space one stock unit occupies.

**m³ / furgón column:**
- Displays `FURGO_M3 / volume_m3` — how many stock units fit in one furgón.
- Constant defined at top of file:

```typescript
// Furgón capacity used for m³/furgón calculations.
// WARNING: exact unit type per supplier (Carvajal / Reyma) is NOT confirmed.
// Using furgon_53 (53-foot trailer) as a demo approximation only.
const FURGO_M3 = 122;
```

The 122 m³ figure is the industry-standard capacity for a 53-foot trailer (furgon_53). Exact capacity per supplier has not been confirmed — the comment records this uncertainty explicitly.

**Furgones conversion columns (6 new columns):**

The core addition of this session. The decision maker's verbatim framing (2026-04-27):

> "¿Cuántos furgones me representan? Si me está diciendo 40 mil fardos: ¿Cuándo tiene que entrar cada furgón? ¿El lunes cuántos furgones de cada producto deben entrar? ¿El martes, cuántos furgones? Si llega el lunes y no entran los furgones que estábamos esperando, ¿cómo se reajusta eso?"

Three new column groups added, each with Feb 26 / Mar 26 sub-columns:

| Column Group | Color | Formula |
|---|---|---|
| Furgones — Ventas | Darker green | `(sales_units × volume_m3) / 122` |
| Furgones — Compras Ordenadas | Darker blue | `(ordered_units × volume_m3) / 122` |
| Furgones — Compras Recibidas | Darker purple | `(received_units × volume_m3) / 122` |

No abbreviations in column headers ("Compras Ordenadas" not "Compras Ord.", "Compras Recibidas" not "Compras Rec.").

**Helper function added:**

```typescript
function fmtFurgo(units: number | null | undefined, volume_m3: number | null | undefined): string {
  if (units == null || volume_m3 == null || volume_m3 === 0) return '—';
  return ((units * volume_m3) / FURGO_M3).toFixed(1);
}
```

Displays 1 decimal place. Returns `—` if either input is null (some SKUs may lack volume data) or if volume is zero (prevents division by zero).

**Totals row — aggregate furgones:**

The TOTAL row in `<tfoot>` computes aggregate furgones correctly by summing per-SKU contributions:

```typescript
const furgoSum = (unitsKey: keyof SkuRow) =>
  visible.reduce((a, r) => {
    const units = Number(r[unitsKey] ?? 0);
    const vol = r.volume_m3;
    if (vol == null) return a;
    return a + (units * vol) / FURGO_M3;
  }, 0);
```

This is mathematically correct: `Σ (units_i × volume_m3_i) / FURGO_M3`. The alternative — summing unit totals first and then multiplying by an average volume — would be wrong because each SKU has a different `volume_m3`. SKUs with missing `volume_m3` are excluded from the furgones total (they cannot be converted) but their units still appear in the unit totals.

---

### `frontend/src/app/api/acid-test/forecast/route.ts`

**API enrichment — three new fields threaded through the response.**

The forecast page needed `stock_uom`, `volume_m3`, and `movement_rank_within_class` per SKU. These were not previously returned by the API.

**Products query expanded:**

```typescript
const { data: supaProducts } = await supabase
  .from('products')
  .select('id, sku, stock_uom, volume_m3')  // stock_uom and volume_m3 added
  .in('sku', Array.from(skuSet));
```

**New lookup maps:**

```typescript
const skuToUom    = new Map((supaProducts ?? []).map((p) => [p.sku, p.stock_uom]));
const skuToVolume = new Map((supaProducts ?? []).map((p) => [p.sku, p.volume_m3]));
```

**Enriched response shape:**

```typescript
const enriched = finalRows.map((r) => ({
  ...r,
  sku:                         productIdToSku.get(r.product_id) ?? null,
  product_name:                skuMeta.get(...)?.representative_name ?? null,
  supplier_class:              skuMeta.get(...)?.supplier_class ?? null,
  movement_rank_within_class:  skuMeta.get(...)?.movement_rank_within_class ?? null,  // added
  stock_uom:                   skuToUom.get(...)    ?? null,                          // added
  volume_m3:                   skuToVolume.get(...) ?? null,                          // added
}));
```

No database schema changes required. All three fields were already populated for the 23 top SKUs in production.

---

### `frontend/src/components/layout/FearsSidebar.tsx`

**Navigation sidebar copy — three text changes.**

| Location | Before | After |
|---|---|---|
| Gap Report nav item label | "Gap Report" | "Auditoría de Discrepancias" |
| Gap Report nav item subtitle | "App vs Odoo lado a lado" | "Puedes verificar cada cifra tú mismo" |
| Validación nav item subtitle | "Sistema vs compradores vs realidad" | "Cifras cuadran con Odoo" |

The new subtitles are written in the voice of the product's value proposition, not in the voice of the engineering team describing what the page does.

---

## Design Decisions Recorded

**Why `MAX_MONTH = '2026-01'` is hardcoded, not computed:**

The original implementation used a `lastCompleteMonth()` function that calculated the most recent full month based on today's date. This was replaced with a hardcoded constant because the cutoff is not a date calculation — it is a product decision. February, March, and April 2026 are the blind-test window. Navigation buttons for those months must not exist in the historical pages regardless of what today's date is.

**Why the Validación Histórica page switched APIs:**

The ML backtesting API ties every data row to a training run. A month with no recent run returns no data, which is indistinguishable from "no data exists." The raw Odoo API (`rpc_acid_gap_report`) has no such dependency — it reads `revenue_daily` directly. For a page whose purpose is to show verifiable historical actuals, the ML-independent API is strictly correct.

**Why furgones totals are computed per-SKU and summed (not averaged):**

Each SKU has a different `volume_m3`. Summing unit totals first and applying a single volume factor would produce a wrong number. The correct aggregate is: for each SKU, compute `units × volume_m3 / FURGO_M3`, then sum across SKUs. SKUs with null volume are excluded from the furgones aggregate (they cannot be converted) but are not excluded from the unit totals.

---

## What This Does NOT Include

- **Daily/weekly furgón receiving schedule:** The decision maker's full vision includes a per-day, per-SKU truck arrival schedule with real-time rebalancing when actual arrivals deviate from plan. That is not implemented here. This session implements only the monthly furgones conversion (immediate demo need).
- **Confirmed furgón capacity per supplier:** `FURGO_M3 = 122` is an industry standard for furgon_53. Carvajal and Reyma's exact unit type has not been confirmed. The constant and its uncertainty are documented in a code comment and must be validated before using furgón counts in a purchasing commitment.
- **Database columns for ML training:** The user noted that `volume_m3` and `stock_uom` should be available for ML training. Both are already populated for the 23 top SKUs. If additional SKUs are added to training in the future, those fields must be populated before training runs.
