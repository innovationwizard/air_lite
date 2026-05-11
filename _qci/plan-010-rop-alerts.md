# Plan 010 — Reorder Point Alerts: Pedir HOY / Pedir esta semana
**Date:** 2026-05-11  
**Scope:** 23 demo SKUs (`is_top_10_in_class = true` in `products_acid_test_active`)  
**Feature:** Two new KPI cards on `/compras` — "Pedir HOY" and "Pedir esta semana"  
**Answers question:** How many SKUs need an order placed TODAY vs. within the next 7 days?

---

## 0. What to Build

```
[4-card KPI grid — existing]

┌────────────────────────────────┬────────────────────────────────┐
│  Pedir HOY                     │  Pedir esta semana             │
│                                │                                │
│  5 SKUs           [ℹ]          │  8 SKUs           [ℹ]          │
│  Stock ya bajo ROP             │  Romperán ROP en ≤ 7 días      │
└────────────────────────────────┴────────────────────────────────┘

[Order Plan Panel — existing]
[Top 5 Exceptions — existing]
```

- **Pedir HOY** (red): SKUs where `current_stock ≤ ROP` — order should already have been placed.
- **Pedir esta semana** (amber): SKUs where `current_stock > ROP` but `current_stock − avg_daily_demand × 7 ≤ ROP` — will breach within 7 calendar days.
- The two counts are **mutually exclusive** — a SKU is in exactly one category.
- SKUs with `lead_time_days = 0` or `avg_daily_demand = 0` are excluded from both counts (same rule as order-plan panel).
- Tooltip on each card explains the definition. Pattern: `group-hover:block` CSS (same as `capital-congelado/page.tsx` lines 331–342).

---

## 1. Data Sources

All data is **already fetched** by `/api/kpis/order-plan/route.ts`. No new DB queries needed.

| Value | Source in existing route |
|---|---|
| `avg_daily_demand` | `revenue_daily` (metric=sales, 90-day window before snapshot) — same signal as order-plan qty calc |
| `current_stock` | `rpc_abc_xyz_classification` |
| `lead_time_days` | `rpc_abc_xyz_classification` |
| `abc_class`, `xyz_class` | `rpc_abc_xyz_classification` |

**Why `revenue_daily` for demand (not `rpc_abc_xyz_classification`)?**  
The blind test covers Feb/Mar/Apr 2026 — decision makers have real outcomes on their screens. The `revenue_daily` demand signal uses posted invoices (`account.move.line`, SSOT label `aml_income_posted_invoice_refund_neg_invoice_date_c40`) — the same financial view the CEO's dashboard uses. This is the most accurate pre-snapshot demand signal and the one already validated to zero gap for the anchor SKU (77201046, Nov/Dec 2024). The `rpc_abc_xyz_classification`'s demand window was broken until Plan 009 fixed it; `revenue_daily` has been clean from the start.

---

## 2. Formulas

```
safety_stock_days  = SAFETY_STOCK_DAYS[abc_class + xyz_class] ?? DEFAULT_SAFETY_STOCK_DAYS (7)
rop                = avg_daily_demand × (lead_time_days + safety_stock_days)

-- Eligibility: exclude SKUs where lead_time_days = 0 OR avg_daily_demand = 0
-- (These cannot produce a meaningful ROP.)

is_order_today     = current_stock ≤ rop
is_order_this_week = current_stock > rop
                     AND (current_stock − avg_daily_demand × 7) ≤ rop
```

`SAFETY_STOCK_DAYS` is identical to the constant in `order-plan/route.ts` (sourced from `capital-congelado/page.tsx` lines 45–54):

```
AX:3  AY:7  AZ:14
BX:5  BY:10 BZ:14
CX:7  CY:10 CZ:14
```

**Mutual exclusivity:** `is_order_today` takes precedence. If `current_stock ≤ rop`, the SKU is HOY regardless of the 7-day window.

---

## 3. Implementation — Two Files

### Step 1: Extend `/api/kpis/order-plan/route.ts`

Add `rop_alerts` computation inside the existing SKU loop (Step 5 of the route). No new DB calls. Extend the return value.

**New response shape:**
```typescript
{
  suppliers: SupplierOrderSummary[];
  rop_alerts: {
    order_today: number;      // SKUs where current_stock ≤ ROP (eligible only)
    order_this_week: number;  // SKUs where current_stock > ROP but breaches in ≤7 days
  };
  snapshot_date: '2026-03-03';
  furgo_m3: 122;
  furgo_confirmed: false;
}
```

**Changes inside the route (Step 5 loop):**
```typescript
// Initialize before the loop:
let ropToday = 0;
let ropThisWeek = 0;

// Inside the loop, after computing avg / currentStock / leadTime:
if (avg > 0 && leadTime > 0) {
  const ssDay = SAFETY_STOCK_DAYS[abcClass + xyzClass] ?? DEFAULT_SAFETY_STOCK_DAYS;
  const rop = avg * (leadTime + ssDay);
  if (currentStock <= rop) {
    ropToday += 1;
  } else if (currentStock - avg * 7 <= rop) {
    ropThisWeek += 1;
  }
}
```

**Add to return value:**
```typescript
rop_alerts: { order_today: ropToday, order_this_week: ropThisWeek },
```

---

### Step 2: Update `compras/page.tsx`

**2a. Extend `SupplierOrderSummary` — no change needed** (rop_alerts is on the root response, not per-supplier).

**2b. Add state for rop_alerts (alongside existing orderPlan state):**
```typescript
const [ropAlerts, setRopAlerts] = useState<{ order_today: number; order_this_week: number } | null>(null);
```

**2c. Read from existing planData fetch (no new fetch):**
```typescript
setRopAlerts(planData?.rop_alerts ?? null);
```

**2d. Add 2-card urgency row between KPI cards and Order Plan panel:**

```tsx
{/* ROP Alert Cards */}
{!loading && ropAlerts !== null && (
  <div className="grid grid-cols-2 gap-4">
    {/* Pedir HOY */}
    <div className="bg-red-50 border border-red-100 rounded-xl p-4 relative">
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-red-700 font-medium">Pedir HOY</p>
        <div className="relative group inline-block">
          <Info className="w-3 h-3 text-red-400 cursor-help" />
          <div className="absolute z-10 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg">
            SKUs donde el stock actual ya está por debajo del punto de reorden.<br/>
            El pedido debería haberse emitido ya.
          </div>
        </div>
      </div>
      <p className="text-3xl font-bold text-red-700 mt-1">{ropAlerts.order_today}</p>
      <p className="text-xs text-red-500 mt-0.5">Stock ≤ punto de reorden</p>
    </div>

    {/* Pedir esta semana */}
    <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 relative">
      <div className="flex items-center gap-1.5">
        <p className="text-xs text-amber-700 font-medium">Pedir esta semana</p>
        <div className="relative group inline-block">
          <Info className="w-3 h-3 text-amber-400 cursor-help" />
          <div className="absolute z-10 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg">
            SKUs que romperán su punto de reorden en los próximos 7 días calendario,<br/>
            basado en la demanda promedio diaria.
          </div>
        </div>
      </div>
      <p className="text-3xl font-bold text-amber-700 mt-1">{ropAlerts.order_this_week}</p>
      <p className="text-xs text-amber-500 mt-0.5">Rompen ROP en ≤ 7 días</p>
    </div>
  </div>
)}
```

**2e. Add `Info` to lucide-react import** (`Info` is already imported in other pages; must be added to `compras/page.tsx` import line).

---

## 4. Verification Requirements

After implementation:

1. Both counts must be ≥ 0 and ≤ 20 (23 SKUs − 3 with zero lead_time).
2. `order_today + order_this_week` must be ≤ 20 (mutually exclusive, subset of eligible SKUs).
3. Hover over the ℹ icon on each card: tooltip must appear with correct definition text.
4. If `order_today = 0` and `order_this_week = 0`: cards still render (zero is a valid signal — means all 20 eligible SKUs have sufficient stock for the next 7 days).

---

## 5. Files to Create / Modify

| Action | File | Changes |
|---|---|---|
| MODIFY | `frontend/src/app/api/kpis/order-plan/route.ts` | Add rop counters inside existing loop; extend return value (~10 lines) |
| MODIFY | `frontend/src/app/(authenticated)/compras/page.tsx` | Add state, read from existing fetch, add 2-card JSX section, add Info to import (~25 lines) |

---

## 6. Out of Scope

- Per-SKU drill-down from the ROP cards (links to `/compras/forecast` which has per-SKU detail — same as Order Plan panel)
- Emergency order quantity computation (Plan 007 Priority 4 — Hot List)
- ROP breach date ("runs out June 12" format) — not in scope for command center KPI cards
