# UI Polish — Drill-Down, Search Filters & Temporal Context

**Date:** 2026-05-12  
**Scope:** 5 files modified, 0 new API routes, 0 SQL migrations.  
**Stack:** Next.js 14, TypeScript (strict, 0 errors), Tailwind CSS.  
**Trigger:** Demo-readiness polish session — tooltip overflow, missing (i) descriptors, missing temporal context on KPI cards, non-interactive distribution bar, no SKU/name search on Excepciones page.

---

## Summary of All Changes

| Category | Items |
|---|---|
| Bug fixes | 1 |
| UI additions (tooltips, labels, search) | 4 |
| Files modified | 5 |
| New API routes | 0 |
| TypeScript errors | 0 |

---

## 1 — Fix: Forecast Tooltip Overflow

**File:** `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx`

**Problem:** The purchase-history tooltip (triggered by the `ⓘ` icon on each SKU row) was positioned at `rect.bottom + 6` unconditionally. For rows near the bottom of the viewport — the most common case given the table scroll position — the 340 px tooltip overflowed below the visible area and was clipped.

**Fix (two parts):**

### Part 1 — Flip logic in `handleHistoryTipClick`

```typescript
// Before
const top = rect.bottom + 6;

// After
const tooltipHeight = 340; // 12 months × ~20px + header + padding
const spaceBelow = window.innerHeight - rect.bottom - 8;
const top = spaceBelow >= tooltipHeight
  ? rect.bottom + 6
  : Math.max(8, rect.top - tooltipHeight - 6);
```

When `spaceBelow < 340`, the tooltip opens **above** the row instead of below. `Math.max(8, …)` prevents it from escaping the top edge on very short viewports.

### Part 2 — Viewport-safe max-height on the tooltip div

```tsx
style={{
  position: 'fixed',
  top: tipPos.top,
  left: tipPos.left,
  zIndex: 9999,
  maxHeight: 'calc(100vh - 16px)',
  overflowY: 'auto',
}}
```

Ensures that even when the tooltip cannot fully fit (e.g. a screen with fewer than 340 px of vertical space), it scrolls internally instead of escaping the viewport.

---

## 2 — Feature: (ⓘ) Info Tooltips on KPI Cards — Panel de Compras

**File:** `frontend/src/app/(authenticated)/compras/page.tsx`

**Problem:** The 4 top KPI cards (Excepciones activas, GTQ en riesgo, GTQ inmovilizado, Cobertura promedio) had no explanation of what the number means or how it is calculated. A decision maker seeing "Q 34,752,949" with no context cannot interpret or act on it.

**Pattern used:** Same `relative group inline-block` + `hidden group-hover:block` hover tooltip pattern already established on the ROP alert cards in the same file.

Each card title row was wrapped in a `flex items-center gap-1` div, and a `<Info>` icon added next to it:

```tsx
<div className="flex items-center gap-1">
  <p className="text-xs text-{color}-700 font-medium">{title}</p>
  <div className="relative group inline-block">
    <Info className="w-3 h-3 text-{color}-400 cursor-help" />
    <div className="absolute z-10 hidden group-hover:block bottom-full left-1/2
                    -translate-x-1/2 mb-2 w-64 bg-gray-900 text-white text-xs
                    rounded-lg p-3 shadow-lg pointer-events-none">
      {description}
    </div>
  </div>
</div>
```

### Tooltip copy per card

| Card | Tooltip text |
|---|---|
| Excepciones activas | SKUs con nivel de urgencia Crítico o Alto. Incluye riesgo de desabasto, exceso de stock y compras sin justificación de demanda. |
| GTQ en riesgo | Valor en quetzales de las ventas proyectadas que se perderían si no se emiten órdenes de compra para los SKUs en desabasto crítico o alto. |
| GTQ inmovilizado | Capital en quetzales atrapado en inventario que supera la política de stock máximo. Representa liquidez que podría liberarse reduciendo compras futuras. |
| Cobertura promedio | Promedio de días de stock disponible en todos los SKUs activos, considerando la demanda diaria promedio de los últimos 90 días. |

`Info` was already imported from `lucide-react`. No import changes needed.

---

## 3 — Feature: Temporal Context Labels on KPI Cards

**File:** `frontend/src/app/(authenticated)/compras/page.tsx`

**Problem:** All 4 KPI cards showed numbers with no indication of what time period they represented. A decision maker cannot evaluate "Q 11,023,165" without knowing if it reflects yesterday's stock or a months-old snapshot.

**Fix:** A 4th line added to each card below the subtitle, in `text-[10px]` size and a very light tint of the card's accent color (near-invisible but present on hover/reading):

| Card | Temporal label | Rationale |
|---|---|---|
| Excepciones activas | `al 3-mar-2026` | Stock snapshot date |
| GTQ en riesgo | `proyección desde 3-mar-2026` | Forward projection from snapshot; different from a point-in-time value |
| GTQ inmovilizado | `al 3-mar-2026` | Stock snapshot date |
| Cobertura promedio | `demanda prom. últ. 90d` | Derived from 90-day demand window (Dec 3, 2025 – Mar 3, 2026), not a snapshot point |

```tsx
<p className="text-[10px] text-red-300 mt-1">al 3-mar-2026</p>
```

---

## 4 — Remove: "Demostración de Valor" Card

**File:** `frontend/src/app/(authenticated)/compras/page.tsx`

Removed the navigation card pointing to `/backtest` ("Cuánto habrías ahorrado si hubieras tenido AI Refill el último año"). The card was removed from the navigation array. `ShoppingCart` icon import cleaned up as it was no longer referenced anywhere in the file.

---

## 5 — Feature: Distribution Bar Drill-Down — Operaciones

**Files:**
- `frontend/src/app/(authenticated)/operaciones/page.tsx`
- `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx`

**Problem:** The "Distribución de inventario" stacked bar (Crítico / Alto / Medio / Bajo) was read-only. A decision maker could see the proportions but could not navigate to the underlying items for any tier.

### `operaciones/page.tsx` — bar segments become links

Each color segment changed from a plain `<div>` to a `<Link>` pointing to `/preocupaciones/desabastecimiento?risk={level}`:

```tsx
// Before
<div className="bg-red-500" style={{ width: `...` }} title="Crítico: 322" />

// After
<Link
  href="/preocupaciones/desabastecimiento?risk=critico"
  className="bg-red-500 hover:brightness-110 transition-[filter] cursor-pointer"
  style={{ width: `...` }}
  title="Crítico: 322 — ver en Hot List"
/>
```

The legend labels below the bar were also converted to `<Link>` with the same `href` and `hover:text-gray-800` feedback. `Link` was already imported in the file.

### `desabastecimiento/page.tsx` — reads `?risk=` URL param on mount

Added `useSearchParams` to read the initial filter from the URL and pre-apply it:

```typescript
const [riskFilter, setRiskFilter] = useState<string | null>(() => {
  const p = searchParams.get('risk');
  return p && ['critico', 'alto', 'medio', 'bajo'].includes(p) ? p : null;
});
```

The allowlist `['critico', 'alto', 'medio', 'bajo']` prevents arbitrary values from being injected via URL.

**Suspense boundary required:** `useSearchParams` requires the component to be wrapped in `<Suspense>`. The component was renamed from `DesabastecimientoPage` to `DesabastecimientoInner`, and a new default export wraps it:

```tsx
export default function DesabastecimientoPage() {
  return (
    <Suspense>
      <DesabastecimientoInner />
    </Suspense>
  );
}
```

`Suspense` added to the `react` import. `useSearchParams` added from `next/navigation`.

---

## 6 — Feature: SKU + Product Name Search — Reporte de Excepciones

**File:** `frontend/src/app/(authenticated)/oa/excepciones/page.tsx`

**Problem:** The Excepciones page had warehouse and supplier filters but no way to search for a specific product. With 98 Hot items and 246 Hold items, finding a single SKU required manual scrolling.

**Implementation:**

New `search` state:
```typescript
const [search, setSearch] = useState('');
```

Filter applied to both lists after existing supplier filter:
```typescript
const q = search.trim().toLowerCase();

const hotList = hotRaw
  .filter((i) => supplierFilter === 'all' || i.supplier_name === supplierFilter)
  .filter((i) => !q || i.sku.toLowerCase().includes(q) || i.product_name.toLowerCase().includes(q));

const holdList = holdRaw
  .filter((i) => supplierFilter === 'all' || i.supplier_name === supplierFilter)
  .filter((i) => !q || i.sku.toLowerCase().includes(q) || i.product_name.toLowerCase().includes(q));
```

Search input added to the filters row with a `Search` icon (added to the `lucide-react` import):

```tsx
<div className="relative ml-2">
  <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
  <input
    type="text"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    placeholder="SKU o nombre de producto…"
    className="border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm bg-white w-64
               focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
  />
</div>
```

**Behavior:** The search is a case-insensitive substring match on both `sku` and `product_name` simultaneously. It stacks with warehouse and supplier filters. The KPI count cards (`Total Hot`, `Total Hold`) already consume the filtered lists, so they update live as the user types.

---

## Files Changed (Complete List)

| File | Change |
|---|---|
| `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx` | Fix tooltip overflow — flip above row when space below is insufficient; add max-height + overflow-y fallback |
| `frontend/src/app/(authenticated)/compras/page.tsx` | Add (ⓘ) hover tooltips to 4 KPI cards; add temporal labels; remove Demostración de Valor card; clean up `ShoppingCart` import |
| `frontend/src/app/(authenticated)/operaciones/page.tsx` | Convert distribution bar segments and legend labels to `<Link>` with `?risk=` param |
| `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx` | Read `?risk=` URL param on mount via `useSearchParams`; add Suspense boundary |
| `frontend/src/app/(authenticated)/oa/excepciones/page.tsx` | Add SKU + product name search input; stack with existing supplier/warehouse filters |

---

## TypeScript Verification

`npx tsc --noEmit` passed clean (0 errors) after all changes.
