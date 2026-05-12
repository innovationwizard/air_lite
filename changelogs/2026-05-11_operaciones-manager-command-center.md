# OPERACIONES Manager Command Center — Plan 011

**Date:** 2026-05-11  
**Scope:** 6 pages updated, 1 new API route, 0 new SQL migrations. No mock data. No Odoo dependency.  
**Stack:** Next.js 14, TypeScript (strict, 0 errors), Supabase PostgreSQL, Tailwind CSS.  
**Trigger:** Research against 10 world-class platforms (Slim4, Kinaxis, Blue Yonder, o9, NetSuite, Anaplan, StockIQ, Netstock, Streamline, SAP S/4HANA) documented in `_qci/research-011-operaciones-best-in-class.md`. Gap analysis in `_qci/gap-analysis-compras-operaciones-vs-best-in-class.md`. Implementation plan in `_qci/plan-011-operaciones-manager-command-center.md`.  
**Snapshot anchor:** March 3, 2026 (PLASTICENTRO, S.A.). Demand window: Dec 3, 2025 – Mar 3, 2026 (90 days). Gate #5 compliant throughout: `avg_daily_demand` always sourced from `revenue_daily` with `metric = 'sales'`, never from `rpc_abc_xyz_classification.avg_daily_demand` (known-zero bug).

---

## Summary of All Changes

| Category | Items |
|---|---|
| New API routes | 1 |
| Pages rebuilt (complete rewrite) | 1 |
| Pages with targeted additions | 5 |
| New `_qci/` planning documents | 2 |
| TypeScript errors | 0 |

---

## P1 — Fix Financial Sort: Operaciones Top 5 Panel

**Gap closed:** `operaciones/page.tsx` Top 5 "critical" panel sorted by `days_of_supply ASC`. A SKU with 0 days but tiny demand appeared above a SKU with 1 day and massive demand. Decision makers saw the wrong items first.

**Root cause:** Line 118 used `.sort((a, b) => a.days_of_supply - b.days_of_supply)` instead of sorting by financial impact.

### `operaciones/page.tsx` — targeted fix

```
Before: .sort((a, b) => a.days_of_supply - b.days_of_supply)
After:  .sort((a, b) => gtqEnRiesgo(b) - gtqEnRiesgo(a))
```

`gtqEnRiesgo` was already defined in the file at line 30. No new function needed. Panel header renamed: "Top 5 Críticos — Por urgencia" → "Top 5 — Por impacto financiero" to accurately describe the sort order.

**Formula (unchanged, pre-existing):**
```
max(0, lead_time_days - days_of_supply) × avg_daily_demand × unit_price
```

---

## P2 — Sidebar Completeness: Operaciones Section

**Gap closed:** The OPERACIONES sidebar section showed 4 links (Inicio, Días de Inventario, Hot List, Hold List). Costos de Almacenamiento and Compras Innecesarias were accessible only from the "Riesgos Empresariales" section, hidden from the operaciones role.

### `FearsSidebar.tsx` — targeted addition

Two items appended to the `Operaciones` nav group:

```typescript
{
  name: 'Costos de Almacenamiento',
  href: '/preocupaciones/costos-almacenamiento',
  icon: Warehouse,
  subtitle: 'Inventario lento y muerto',
},
{
  name: 'Compras Innecesarias',
  href: '/preocupaciones/compras-innecesarias',
  icon: ShoppingCart,
  subtitle: 'Compras que no debían hacerse',
},
```

Both `Warehouse` and `ShoppingCart` icons were already imported. No import changes needed. The `CAN_VIEW_OPERACIONES` role guard on the section automatically controls visibility.

---

## P3 — New Page: Compras Innecesarias

**Gap closed:** `preocupaciones/compras-innecesarias/page.tsx` was a redirect stub showing a static message. It contained no data, no table, no business logic.

**Definition:** A purchase is "innecesaria" if the SKU's current stock already exceeded its max policy threshold (`lead_time_days × 3 × avg_daily_demand`) at the time the units arrived, meaning the buyer ordered units the warehouse didn't need.

### New API route: `app/api/kpis/unnecessary-purchases/route.ts`

**Data flow (7 steps):**

1. `products_acid_test_active WHERE is_top_10_in_class = true` → 23 demo SKUs + `supplier_class`
2. `products WHERE sku IN (23 SKUs)` → `product_id ↔ sku` mapping
3. `rpc_abc_xyz_classification()` → `current_stock`, `lead_time_days`, `unit_cost`, `product_name`, `supplier_name` (Gate #5: `avg_daily_demand` from this RPC is NOT used)
4. `revenue_daily WHERE metric = 'sales' AND observation_date IN window` → reliable `avg_daily_demand` (total ÷ 90 days)
5. `revenue_daily WHERE metric = 'purchases_received' AND observation_date IN window` → total units received + latest receipt date per SKU
6. Filter: `avg > 0` (demand signal required) AND `current_stock > lead_time_days × 3 × avg` (currently over max policy)
7. Sort by `gtq_paid DESC` — most costly over-purchase first

**Response shape per item:**
```typescript
{
  sku, product_name, supplier_name,
  units_received: number,          // total received in 90-day window
  gtq_paid: number,                // units_received × unit_cost
  current_days: number | null,     // round(current_stock / avg)
  max_policy_days: number,         // lead_time_days × 3
  gtq_inmovilizado: number,        // (current_stock - maxTarget) × unit_cost
  days_until_policy: number | null, // ceil((current_stock - maxTarget) / avg) — days until stock naturally drops to policy
  received_since: string,          // latest receipt date in window (ISO)
}
```

**Why `gtq_paid ≠ gtq_inmovilizado`:** `gtq_paid` is the cost of all units received in the window. `gtq_inmovilizado` is the cost of the current excess over max policy. The SKU may have sold some units since receipt; the immobilized amount is the relevant operational metric.

### `preocupaciones/compras-innecesarias/page.tsx` — complete rewrite

| Before | After |
|---|---|
| Static redirect message | Full data page with live API fetch |
| No KPI cards | 3 KPI cards: SKUs comprados en exceso (purple), GTQ comprado innecesariamente (red), Costo de mantener/día at 18% annual (orange) |
| No filters | Supplier dropdown, search, "Limpiar filtros" |
| No table | 8-column table: Producto, Proveedor, Uds. recibidas, GTQ pagado (red bold), Días actuales, Política máx., GTQ inmovilizado (blue bold), Acción (purple) |
| No export | CSV export (UTF-8 BOM, honors filters) |

**Acción column logic:**
- `days_until_policy !== null`: "→ No reordenar — esperar {N}d"
- `days_until_policy === null`: "→ No reordenar"

---

## P4 — Upgrade: Costos de Almacenamiento

**Gap closed:** `costos-almacenamiento/page.tsx` showed inventory values but no daily cost of holding that inventory. The KPI "Valor total" gave no actionable urgency signal. No action recommendations per item.

### `preocupaciones/costos-almacenamiento/page.tsx` — targeted additions

**New constant and helper:**
```typescript
const HOLDING_COST_RATE = 0.18; // consistent with backtest and Hold List

function costoPorDia(item: SlowMovingItem): number {
  return (item.inventory_value * HOLDING_COST_RATE) / 365;
}
```

**KPI card change:** "Valor total en inventario" → "Costo por día (18% anual)" — replaced with the sum of daily carrying costs across all filtered problematic items (`Inventario muerto` + `Movimiento lento` + `Atención requerida`). The card background changes to `bg-orange-50` to signal urgency.

**New table column:** "Costo/día" inserted between Valor and Días sin venta. Displayed in orange.

**New table column:** "Acción" as the rightmost column. Color-coded by classification:

```typescript
const CLASS_ACTION: Record<string, string> = {
  'Inventario muerto':  '→ Evaluar devolución o liquidación',
  'Movimiento lento':   '→ Promocionar o reubicar',
  'Atención requerida': '→ Revisar política',
  'Normal':             '—',
};
```

**New filter:** Classification filter chips (3 buttons: Inventario muerto, Movimiento lento, Atención requerida). Toggles individually. "Limpiar filtros" resets all three simultaneously with category and search.

**Table pagination:** 50-row limit → 100-row limit.

**CSV export:** Updated to include `costo_por_dia` and `accion` columns. colSpan: 6 → 8.

---

## P5 — Transfer Opportunity Signal

**Gap closed:** When a SKU was critically low in one warehouse but over-stocked in another, the UI showed no connection between the two facts. The decision maker saw two separate rows with no indication that the problem had an internal solution before a purchase order was needed.

### `preocupaciones/desabastecimiento/page.tsx` — targeted addition (Hot List)

**No new API call.** `warehouseRisks` was already fetched on mount from `/api/kpis/stockout-risk-by-warehouse`.

**New `surplusMap` useMemo:**
```typescript
const surplusMap = useMemo(() => {
  const map = new Map<string, { warehouse_name: string; days_of_supply: number }>();
  for (const wr of warehouseRisks) {
    if (wr.lead_time_days > 0 && wr.days_of_supply > wr.lead_time_days * 3) {
      const existing = map.get(wr.sku);
      if (!existing || wr.days_of_supply > existing.days_of_supply) {
        map.set(wr.sku, { warehouse_name: wr.warehouse_name, days_of_supply: wr.days_of_supply });
      }
    }
  }
  return map;
}, [warehouseRisks]);
```

When multiple warehouses have surplus for the same SKU, the one with the most excess (`days_of_supply` highest) is selected — most actionable transfer source first.

**Badge rendered in the "Pedido urgente" cell (company-wide view only):** when `emergencyQty > 0` AND `surplusMap.has(risk.sku)`:

```
↑ Excedente en {warehouse_name} — trasladar primero
```

Styled: `text-teal-700 bg-teal-50 border border-teal-100`. The badge appears below the emergency quantity number — quantity remains visible so the buyer can act if transfer is not feasible.

### `operaciones/dias-inventario/page.tsx` — targeted addition

**New pure function `buildTransferMap`:**
```typescript
function buildTransferMap(allRows: DaysOfInventoryRow[]) {
  // Scans all rows. Builds sku → { hotWarehouses[], holdWarehouses[] }.
  // Only SKUs that have BOTH hot and hold warehouses are included.
  // Result: Map<string, { hotWarehouses: string[]; holdWarehouses: string[] }>
}
```

**New helper `transferLabel`:**
```typescript
function transferLabel(r, transferMap): string | null {
  if (r.status === 'hot')  return `← Trasladar desde ${t.holdWarehouses[0]}`;
  if (r.status === 'hold') return `→ Trasladar a ${t.hotWarehouses[0]}`;
  return null;
}
```

**New 12th column "Acción"** (updated colSpan: 11 → 12). Hot rows show teal "← Trasladar desde {hold_wh}". Hold rows show teal "→ Trasladar a {hot_wh}". All other rows show "—" in gray. Label is `null` when no cross-warehouse opportunity exists for that SKU.

**CSV export updated** to include the "Acción" column (12th column in all exported rows).

---

## P6 — Disposition Recommendation: Hold List

**Gap closed:** Hold List showed every over-stock item with the same implicit action: "don't reorder." It could not distinguish between three very different situations:
1. The excess should be transferred to a warehouse that needs it urgently
2. The excess is dead stock and should be liquidated or returned
3. The excess is just slow-moving — simply don't reorder

### `preocupaciones/capital-congelado/page.tsx` — targeted additions

**Two new interfaces:**
```typescript
interface SlowMovingItem   { sku: string; classification: string; }
interface WarehouseRiskItem { sku: string; risk_level: string; warehouse_name: string; }
```

**`useEffect` updated:** Now fetches 3 endpoints in parallel:
1. `/api/kpis/abc-xyz` (existing)
2. `/api/kpis/slow-moving` (new)
3. `/api/kpis/stockout-risk-by-warehouse` (new)

**New `deadSkus` useMemo:**
```typescript
Set<string> — SKUs where slow-moving classification === 'Inventario muerto'
```

**New `hotWarehouseMap` useMemo:**
```typescript
Map<sku → warehouse_name> — first warehouse per SKU where risk_level is 'critico' or 'alto'
```

**New `dispositionAction` pure function:**
```typescript
function dispositionAction(sku, deadSkus, hotWarehouseMap): string {
  if (hotWarehouseMap.has(sku)) return `→ Trasladar a ${hotWarehouseMap.get(sku)}`;
  if (deadSkus.has(sku))        return '→ Evaluar devolución o liquidación';
  return '→ No reordenar';
}
```

Priority order is intentional: a transfer opportunity takes precedence over dead-stock disposal — internal redistribution recovers value without a purchase order.

**New 10th column "Acción sugerida"** (updated colSpan: 9 → 10). Color-coded:
- Teal (`text-teal-700`): transfer opportunity — addresses a Hot item simultaneously
- Red (`text-red-700`): dead stock — capital recovery action required
- Purple (`text-purple-700`): standard hold — default "don't reorder" case

**CSV export updated** to include "Acción sugerida" as the 16th column. Calls `dispositionAction(item.sku, deadSkus, hotWarehouseMap)` per row.

---

## Files Changed (Complete List)

### New files
| File | Type | Purpose |
|---|---|---|
| `frontend/src/app/api/kpis/unnecessary-purchases/route.ts` | Next.js API route | Identifies SKUs received in 90-day window that were already over max policy |
| `_qci/research-011-operaciones-best-in-class.md` | Research doc | Benchmarking against 10 platforms; 5 cross-platform patterns; gap table vs. current implementation |
| `_qci/plan-011-operaciones-manager-command-center.md` | Planning doc | 6-priority implementation plan mirroring plan-007 structure |

### Modified files
| File | Change |
|---|---|
| `frontend/src/app/(authenticated)/operaciones/page.tsx` | P1: sort fix — Top 5 by GTQ DESC instead of days ASC |
| `frontend/src/components/layout/FearsSidebar.tsx` | P2: add Costos + Compras Innecesarias to OPERACIONES section |
| `frontend/src/app/(authenticated)/preocupaciones/compras-innecesarias/page.tsx` | P3: complete rewrite from stub |
| `frontend/src/app/(authenticated)/preocupaciones/costos-almacenamiento/page.tsx` | P4: daily cost column, action column, classification filter chips, 100-row limit |
| `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx` | P5: `surplusMap` + teal transfer badge in Pedido urgente cell |
| `frontend/src/app/(authenticated)/operaciones/dias-inventario/page.tsx` | P5: `buildTransferMap` + 12th "Acción" column + CSV update |
| `frontend/src/app/(authenticated)/preocupaciones/capital-congelado/page.tsx` | P6: parallel fetches + `deadSkus` + `hotWarehouseMap` + 10th "Acción sugerida" column + CSV update |

---

## TypeScript Verification

`npx tsc --noEmit` passed clean (0 errors) after all changes.

---

## Key Design Decisions

**Transfer signal uses `days_of_supply > lead_time_days × 3` as the surplus threshold — same as the Hold List "over policy" criterion.**  
Using a different threshold would create inconsistency: a warehouse shown as "OK" in Días de Inventario would appear as a "transfer source" in the Hot List. The boundary is the same calculation in both places.

**Transfer badge on Hot List shows only the warehouse with the highest surplus, not all of them.**  
If two warehouses both have excess, the one with the most days of supply is the best transfer source. Showing multiple warehouse names in a table cell creates noise. The buyer can view Días de Inventario for the full picture.

**Disposition priority in Hold List: transfer > liquidation > no-reorder.**  
A Hold item that has a hot counterpart in another warehouse solves two problems with one transfer. Surfacing the liquidation recommendation only when no transfer is available prevents the buyer from evaluating them as equivalent options — they are not.

**`compras-innecesarias` filters on `current_stock > maxTarget`, not on receipt-date excess.**  
The question is not "did you buy too much on that date?" (which requires hindsight) but "given what you have now and your demand rate, was this purchase unnecessary?" This is the operational question that drives the "don't reorder" action. The receipt-date evaluation would also require a stock snapshot at receipt time, which is not in the current data model.

**`gtq_paid` vs `gtq_inmovilizado` on Compras Innecesarias are intentionally different columns.**  
`gtq_paid` is the sunk cost of the received units. `gtq_inmovilizado` is the live carrying obligation. A buyer needs both: the first to understand the past decision, the second to prioritize which items to stop reordering urgently.

**No new SQL migrations required for Plan 011.**  
All new insights (transfer signals, disposition recommendations) are derived client-side from data already returned by existing API routes. This is intentional: cross-linking between endpoints is a view-layer concern, not a data-layer concern.
