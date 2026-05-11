# Plan 008 — Order Plan Panel: `/compras` Command Center
**Date:** 2026-05-11  
**Scope:** 23 demo SKUs (12 REYMA + 11 CARVAJAL) — `is_top_10_in_class = true` in `products_acid_test_active`  
**Feature:** Add "Plan de compras esta semana" panel to `/compras` page  
**Answers question:** "CARVAJAL: Q X — X furgones / REYMA: Q X — X furgones" (currently absent from the page — confirmed by reading `compras/page.tsx` line 1–238)  
**Status:** ✅ COMPLETE — verified live 2026-05-11. Panel renders with real data: CARVAJAL 4/11 SKUs Q 690,007 5.6 furgones · REYMA 11/12 SKUs Q 5,095,937 34.8 furgones · 3 SKUs excluidos (lead_time = 0 en Odoo).

---

## 0. What This Panel Must Show

```
Plan de compras — esta semana
┌────────────────────────────────────────────────────────────────┐
│  CARVAJAL   7 de 11 SKUs   Q 1,234,567   45.3 furgones   →    │
│  REYMA      4 de 12 SKUs   Q   345,678   12.1 furgones   →    │
└────────────────────────────────────────────────────────────────┘
Stock: snapshot 3-mar-2026 · Política ABC/XYZ · Furgón 53 pies (122 m³, sin confirmar)
```

- **"N de M SKUs":** N = SKUs where `qty_recommended > 0`, M = total SKUs in supplier class
- **"Q X":** Sum of `qty_recommended × unit_cost` across all SKUs with `qty_recommended > 0`
- **"X furgones":** Sum of `(qty_recommended × volume_m3) / 122` across same SKUs
- **"→":** Link to `/compras/forecast` for per-SKU drill-down

---

## 1. Data Sources — What Exists, What Is Missing

### 1.1 What each existing API returns (verified by reading source files)

**`/api/kpis/abc-xyz` → `rpc_abc_xyz_classification()`**  
Returns per SKU: `product_id, sku, abc_class, xyz_class, current_stock, avg_daily_demand, lead_time_days, unit_cost, supplier_name`  
Source: `frontend/src/app/api/kpis/abc-xyz/route.ts` line 10  
Used in `compras/page.tsx` interface `AbcXyzItem` (lines 20–28), but `abc_class` and `xyz_class` are NOT declared in that interface — they are returned by the RPC but stripped by the interface. They will need to be added.

**`/api/kpis/stockout-risk` → `rpc_stockout_risks()`**  
Returns per SKU: `product_id, sku, current_stock, avg_daily_demand, days_of_supply, lead_time_days, risk_level, unit_price, supplier_name`  
NOT used for this feature — `unit_cost` (not `unit_price`) is needed for GTQ calculation, and `unit_cost` only comes from the ABC/XYZ RPC.

**`/api/forecast` → reads `forecast_results` + enriches with `products_acid_test_active` + `products`**  
Returns per forecast row: `sku, supplier_class, stock_uom, volume_m3, yhat_sum, forecast_month, metric, ...`  
Source: `frontend/src/app/api/forecast/route.ts` lines 22–79  
NOT suitable for this feature directly — it returns many rows per SKU (one per month × metric). Would need deduplication to get just `supplier_class` and `volume_m3` per SKU.

### 1.2 Missing data for the order plan calculation

| Column | Needed for | Available from |
|---|---|---|
| `supplier_class` | Group by CARVAJAL / REYMA | `products_acid_test_active.supplier_class` |
| `volume_m3` | Furgones calculation | `products.volume_m3` |
| `abc_class` | Safety stock days lookup | `rpc_abc_xyz_classification` (returned but not declared in current interface) |
| `xyz_class` | Safety stock days lookup | `rpc_abc_xyz_classification` (returned but not declared in current interface) |
| `unit_cost` | GTQ value calculation | `rpc_abc_xyz_classification` (already in `AbcXyzItem`) |
| `current_stock` | Recommended qty formula | `rpc_abc_xyz_classification` (already in `AbcXyzItem`) |
| `avg_daily_demand` | Target stock calculation | `rpc_abc_xyz_classification` (already in `AbcXyzItem`) |
| `lead_time_days` | Target stock calculation | `rpc_abc_xyz_classification` (already in `AbcXyzItem`) |

**Conclusion:** All needed data exists in Supabase. No new RPC or migration required. A new API route must join `rpc_abc_xyz_classification`, `products_acid_test_active`, and `products`.

---

## 2. Formula — Order Recommendation per SKU

Source of constants:
- `CELL_POLICY` safetyStock values: read from `frontend/src/app/(authenticated)/preocupaciones/capital-congelado/page.tsx` lines 45–54
- `FURGO_M3 = 122`: read from `frontend/src/app/(authenticated)/compras/forecast/page.tsx` line 11 (WARNING: unconfirmed with client — see Section 5)
- UoM `Proporción` values: read from `real_data/uom.uom_20260303.csv`

### 2.1 Safety stock days by ABC/XYZ cell

```typescript
const SAFETY_STOCK_DAYS: Record<string, number> = {
  AX: 3,  AY: 7,  AZ: 14,
  BX: 5,  BY: 10, BZ: 14,
  CX: 7,  CY: 10, CZ: 14,
};
const DEFAULT_SAFETY_STOCK_DAYS = 7; // fallback when abc_class or xyz_class is null
```

### 2.2 Packing multiple from stock_uom

All quantities in the system are stored in `stock_uom` units (e.g., FARDO10, CAJA40). The UoM CSV (`uom.uom_20260303.csv`) confirms: `Proporción = 1 / packing_multiple` for each UoM. Since quantities are already in pack units, **ordering requires whole-number quantities** (you cannot order 2.7 FARDO10).

```typescript
// Round up to nearest integer — you cannot order a fractional pack unit
function roundToPack(qty: number): number {
  return Math.ceil(qty);
}
```

No complex packing-multiple lookup is needed for the 23 demo SKUs because all stock quantities (`current_stock`, `avg_daily_demand`) are already expressed in `stock_uom` units.

**Verification required before implementation:** Confirm via `rpc_abc_xyz_classification` that `current_stock` and `avg_daily_demand` for the 23 demo SKUs are in `stock_uom` units, not in individual pieces. This is consistent with how the existing compras/forecast page uses these values (line 238: `(units * vol) / FURGO_M3` treats the RPC output as pack units).

### 2.3 Per-SKU order recommendation formula

```
safety_stock_days  = SAFETY_STOCK_DAYS[abc_class + xyz_class] ?? DEFAULT_SAFETY_STOCK_DAYS
safety_stock_units = avg_daily_demand × safety_stock_days

target_stock = avg_daily_demand × (2 × lead_time_days) + safety_stock_units
             = avg_daily_demand × (2 × lead_time_days + safety_stock_days)

qty_raw          = max(0, target_stock - current_stock)
qty_recommended  = ceil(qty_raw)                          // whole pack units only
gtq_value        = qty_recommended × unit_cost            // unit_cost in GTQ per stock_uom unit
furgones         = (qty_recommended × volume_m3) / 122   // volume_m3 per stock_uom unit
```

### 2.4 Worked example — SKU 77205001

From `rpc_abc_xyz_classification` (values to be verified at runtime — these are illustrative):
- `abc_class = 'A'`, `xyz_class = 'X'` → `safety_stock_days = 3`
- `avg_daily_demand = 4,211` (FARDO10/day)
- `lead_time_days = 21`
- `current_stock = 50,000` (FARDO10)
- `unit_cost = Q 85.00` (per FARDO10 — **must verify against RPC**)
- `volume_m3 = 0.8614` (per FARDO10 — from `products` table)
- `supplier_class = 'CARVAJAL'`

Calculation:
```
safety_stock_units = 4,211 × 3 = 12,633 FARDO10
target_stock       = 4,211 × (2 × 21 + 3) = 4,211 × 45 = 189,495 FARDO10
qty_raw            = max(0, 189,495 - 50,000) = 139,495 FARDO10
qty_recommended    = ceil(139,495) = 139,495 FARDO10  (already integer)
gtq_value          = 139,495 × Q 85.00 = Q 11,857,075
furgones           = (139,495 × 0.8614) / 122 = 120,173 / 122 = 984.2 furgones
```

> ⚠ The `unit_cost` value of Q 85.00 is **not from the real data** — it is illustrative only. The actual value comes from `rpc_abc_xyz_classification` at runtime.

---

## 3. Implementation Plan — Two Files

### Step 1: Create `/api/kpis/order-plan/route.ts`

**File to create:** `frontend/src/app/api/kpis/order-plan/route.ts`

**What it does:**
1. Queries `products_acid_test_active` where `is_top_10_in_class = true` → `default_code` (sku), `supplier_class`
2. Queries `products` for those SKUs → `sku`, `volume_m3`
3. Calls `rpc_abc_xyz_classification()` → `sku`, `abc_class`, `xyz_class`, `current_stock`, `avg_daily_demand`, `lead_time_days`, `unit_cost`
4. Joins all three on `sku` / `default_code`
5. For each SKU: computes `safety_stock_days`, `target_stock`, `qty_recommended`, `gtq_value`, `furgones`
6. Skips SKUs where `avg_daily_demand` is 0 or null, or `lead_time_days` is null (cannot compute)
7. Aggregates by `supplier_class`
8. Returns:

```typescript
interface SupplierOrderSummary {
  supplier_class: string;
  sku_count_total: number;       // total SKUs in this supplier_class
  sku_count_with_order: number;  // SKUs where qty_recommended > 0
  total_gtq: number;             // sum of qty_recommended × unit_cost
  total_furgones: number;        // sum of (qty_recommended × volume_m3) / 122
  data_gaps: number;             // SKUs skipped due to null avg_daily_demand or lead_time_days
}

// Response shape:
{
  suppliers: SupplierOrderSummary[];
  snapshot_date: '2026-03-03';   // hardcoded — the inventory snapshot date
  furgo_m3: 122;                 // so the frontend can show the caveat
  furgo_confirmed: false;        // always false until confirmed with client
}
```

**Constants defined in this file:**
```typescript
const FURGO_M3 = 122; // WARNING: unconfirmed with client — 53-foot trailer approximation
const SAFETY_STOCK_DAYS: Record<string, number> = {
  AX: 3, AY: 7, AZ: 14,
  BX: 5, BY: 10, BZ: 14,
  CX: 7, CY: 10, CZ: 14,
};
const DEFAULT_SAFETY_STOCK_DAYS = 7;
```

**Error handling:**
- If `rpc_abc_xyz_classification` returns an error: return HTTP 500 with structured error
- If `products_acid_test_active` query fails: return HTTP 500
- If a SKU has no matching row in the RPC: exclude it from the calculation, increment `data_gaps`
- If `volume_m3` is null for a SKU: set `furgones = null` for that SKU, exclude from furgones total

---

### Step 2: Modify `/compras/page.tsx`

**File to modify:** `frontend/src/app/(authenticated)/compras/page.tsx`

**Changes required:**

#### 2a. Add new interface and state

```typescript
interface SupplierOrderSummary {
  supplier_class: string;
  sku_count_total: number;
  sku_count_with_order: number;
  total_gtq: number;
  total_furgones: number;
  data_gaps: number;
}

// Add to component state (line ~59):
const [orderPlan, setOrderPlan] = useState<SupplierOrderSummary[]>([]);
const [orderPlanGaps, setOrderPlanGaps] = useState<number>(0);
```

#### 2b. Add third parallel fetch (modify existing Promise.all at line ~62)

```typescript
Promise.all([
  fetch('/api/kpis/stockout-risk').then((r) => r.json()),
  fetch('/api/kpis/abc-xyz').then((r) => r.json()),
  fetch('/api/kpis/order-plan').then((r) => r.json()),
])
  .then(([riskData, abcData, planData]) => {
    setRisks(Array.isArray(riskData) ? riskData : []);
    setAbcItems(Array.isArray(abcData) ? abcData : []);
    setOrderPlan(planData?.suppliers ?? []);
    setOrderPlanGaps(planData?.suppliers?.reduce((s: number, x: SupplierOrderSummary) => s + (x.data_gaps ?? 0), 0) ?? 0);
    setLoading(false);
  })
  .catch(() => setLoading(false));
```

#### 2c. Add new panel between KPI cards and Top 5 exceptions (after line ~134)

```tsx
{/* Order Plan Panel */}
{!loading && orderPlan.length > 0 && (
  <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
      <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
        <Truck className="w-4 h-4 text-emerald-500" />
        Plan de compras — esta semana
      </h2>
      <Link href="/compras/forecast" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
        Ver detalle <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
    <div className="divide-y divide-gray-50">
      {orderPlan.map((s) => (
        <div key={s.supplier_class} className="px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
              s.supplier_class === 'REYMA'
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-sky-100 text-sky-800'
            }`}>
              {s.supplier_class}
            </span>
            <span className="text-sm text-gray-600">
              {s.sku_count_with_order} de {s.sku_count_total} SKUs
            </span>
          </div>
          <div className="flex items-center gap-6 text-right">
            <div>
              <p className="text-sm font-semibold text-gray-900">{fmtGTQ(s.total_gtq)}</p>
              <p className="text-xs text-gray-400">valor pedido</p>
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-700">{s.total_furgones.toFixed(1)}</p>
              <p className="text-xs text-gray-400">furgones</p>
            </div>
          </div>
        </div>
      ))}
    </div>
    <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex items-center gap-2">
      <span className="text-[10px] text-gray-400">
        Stock: snapshot 3-mar-2026 · Política ABC/XYZ
      </span>
      <span className="text-[10px] text-amber-600">
        ⚠ Furgones: furgón 53 pies (122 m³) — pendiente confirmación con proveedor
      </span>
      {orderPlanGaps > 0 && (
        <span className="text-[10px] text-red-500">
          · {orderPlanGaps} SKU{orderPlanGaps > 1 ? 's' : ''} excluidos (datos insuficientes)
        </span>
      )}
    </div>
  </div>
)}
```

---

## 4. Known Gaps and Verification Requirements

### 4.1 Must verify before implementation

| Item | Where to verify | Risk if wrong |
|---|---|---|
| `unit_cost` in `rpc_abc_xyz_classification` is per `stock_uom` unit (not per individual piece) | Run the RPC, check against known purchase prices | GTQ values wrong by up to 40× if it's per piece (e.g., CAJA40) |
| `current_stock` and `avg_daily_demand` in the RPC are in `stock_uom` units | Run the RPC, cross-reference with compras/forecast page display | Order quantities wrong by up to 40× |
| `lead_time_days` is populated for all 23 demo SKUs | Run the RPC | SKUs with null lead_time_days are excluded from the panel (data_gaps counter) |
| `abc_class` and `xyz_class` are returned by `rpc_abc_xyz_classification` for all 23 SKUs | Run the RPC | Falls back to DEFAULT_SAFETY_STOCK_DAYS = 7; safe but less precise |

### 4.2 Known limitations in this plan

1. **No open PO deduction:** If there are open purchase orders for a SKU, `qty_recommended` will be overstated by the open order quantity. The snapshot data does not include real-time open PO status. This is acceptable for the demo scope.

2. **`FURGO_M3 = 122` unconfirmed:** Same caveat as in `compras/forecast/page.tsx` line 11. The panel must show a visible disclaimer (included in the UI design above). Do not remove the disclaimer.

3. **Static snapshot date:** `current_stock` reflects March 3, 2026. The panel footer must always display this date so the compras manager knows the stock figures are not real-time.

4. **Supplier deduplication:** CARVAJAL registers as 3 legal entities in `purchase.order` (`CARVAJAL EMPAQUES CENTROAMERICA S.A.`, `CARVAJAL EMPAQUES S.A. DE C.V.`, `DISTRIBUIDORA CARVAJAL EMPAQUES`). In this plan, grouping is by `products_acid_test_active.supplier_class` (values: `'CARVAJAL'`, `'REYMA'`) — not by supplier name from the PO table. No deduplication issue for the 23-SKU demo scope.

---

## 5. Files to Create / Modify

| Action | File | Lines changed |
|---|---|---|
| CREATE | `frontend/src/app/api/kpis/order-plan/route.ts` | ~90 lines |
| MODIFY | `frontend/src/app/(authenticated)/compras/page.tsx` | ~50 lines (new interface, new state, extend Promise.all, new JSX panel) |

---

## 6. Out of Scope for This Plan

- Updating the stale `forecast_month` hardcoded strings in `compras/forecast/page.tsx` (that is Plan 007 Priority 1)
- Adding Hot List / Hold List to the COMPRAS sidebar (Plan 007 Priority 3)
- Per-SKU drill-down from this panel (the `→` link routes to `/compras/forecast` which already has per-SKU detail)
- Live reorder point computation in the panel (the panel shows "order recommended today based on current stock" — not "days until ROP breach")
