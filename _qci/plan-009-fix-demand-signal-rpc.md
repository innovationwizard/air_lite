# Plan 009 — Fix Demand Signal: Three Broken RPCs

**Date:** 2026-05-11  
**Scope:** `rpc_stockout_risks`, `rpc_abc_xyz_classification`, `rpc_stockout_risks_by_warehouse`  
**Trigger:** `/compras` command center shows Excepciones activas = 0, GTQ en riesgo = —, Cobertura promedio = — despite real stockout risk existing in the data. GTQ inmovilizado figure (Q 15,099,815) is also incorrect. REYMA shows 11/12 instead of 12/12 in the order plan panel.

---

## 0. Executive Summary

All three RPCs compute `avg_daily_demand` using `demand_daily WHERE demand_date >= CURRENT_DATE - INTERVAL '30 days'`. The inventory snapshot is from 2026-03-03. Today is 2026-05-11. The 30-day moving window now covers April 11 – May 11, 2026 — a period for which `demand_daily` has no rows. Every product returns `avg_demand = 0`.

**Downstream consequences:**
1. `rpc_stockout_risks` and `rpc_stockout_risks_by_warehouse`: the WHERE clause `COALESCE(avg_demand, 0) > 0` filters out every product → 0 rows returned → all Hot List KPIs show 0/—.
2. `rpc_abc_xyz_classification`: `avg_daily_demand = 0` for all 980 rows → GTQ inmovilizado formula collapses to `current_stock × unit_cost` (treats ALL inventory as excess) → massively overstated Q 15M figure.

**Fix:** One new migration. Replace `CURRENT_DATE - INTERVAL '30 days'` with a snapshot-anchored 90-day window derived from `MAX(snapshot_date) FROM inventory_daily`. This is a constant change — no API routes, no TypeScript changes needed.

**Secondary issue (REYMA 11/12):** One REYMA SKU has `products.cost = 0` or NULL, causing the order-plan route to skip it. Requires a Supabase query to identify which SKU, then a `products` table update.

---

## 1. Root Cause Analysis

### 1.1 Primary root cause: stale `CURRENT_DATE`-relative demand window

**Affected code — `rpc_stockout_risks`** (`20260508000001_rpc_stockout_risks_add_financial.sql`, lines 57–61):
```sql
LEFT JOIN LATERAL (
  SELECT AVG(dd.quantity_sold) AS avg_demand
  FROM demand_daily dd
  WHERE dd.product_id = p.id
    AND dd.is_censored = false
    AND dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'   -- ← BROKEN
) dem ON true
```

**Affected code — `rpc_abc_xyz_classification`** (`20260508000002_rpc_abc_xyz_add_inventory_fields.sql`, `recent_demand` CTE, lines 75–82):
```sql
recent_demand AS (
  SELECT
    dd.product_id,
    AVG(dd.quantity_sold) AS avg_demand
  FROM demand_daily dd
  WHERE dd.is_censored = false
    AND dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'   -- ← BROKEN
  GROUP BY dd.product_id
)
```

**Affected code — `rpc_stockout_risks_by_warehouse`** (`20260508000003_rpc_stockout_risks_by_warehouse.sql`, `demand_30d` CTE, lines 46–54):
```sql
demand_30d AS (
  SELECT
    dd.product_id,
    AVG(dd.quantity_sold) AS avg_demand
  FROM demand_daily dd
  WHERE dd.is_censored = false
    AND dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'   -- ← BROKEN
  GROUP BY dd.product_id
)
```

**Why it broke:** These functions were written and deployed in early May 2026. At that time, `CURRENT_DATE - 30 days` = ~April 5, 2026. The `demand_daily` table's most recent data is from the March 3, 2026 snapshot — already 33 days behind. The window was marginal from day one and will never self-heal as long as the snapshot is static.

**Correct anchor:** `MAX(snapshot_date) FROM inventory_daily` is the authoritative, data-driven cutoff. It's already used correctly in both the `latest_snap` CTE and `current_inventory` CTE within `rpc_abc_xyz_classification`. The demand window should use the same anchor.

### 1.2 Secondary effect: GTQ inmovilizado is overstated

`rpc_abc_xyz_classification` returns `avg_daily_demand = 0` for all rows.

The GTQ inmovilizado formula, computed client-side in `capital-congelado/page.tsx`:
```typescript
function gtqInmovilizado(item: AbcXyzItem): number {
  const maxTarget = Math.max(0, item.lead_time_days * 3) * item.avg_daily_demand;
  return Math.max(0, item.current_stock - maxTarget) * item.unit_cost;
}
```

When `avg_daily_demand = 0`:
```
maxTarget = lead_time_days × 3 × 0 = 0
gtqInmovilizado = max(0, current_stock - 0) × unit_cost = current_stock × unit_cost
```

**Every product's entire stock is classified as excess.** This produces the Q 15,099,815 figure on screen — which is likely the total GTQ value of all stock across all active products, not the capital above policy maximum. The real GTQ inmovilizado (stock over 3× lead-time target) is a subset of this number and will only be computed correctly once `avg_daily_demand` is non-zero.

The same formula is used in the `/compras` command center for the "GTQ inmovilizado" KPI card. That card is also wrong for the same reason.

### 1.3 REYMA 11/12 discrepancy

The order-plan route (`api/kpis/order-plan/route.ts`, line 123) skips a SKU when:
```typescript
if (avg === 0 || unitCost === 0) continue;
```

The Python pre-implementation simulation showed 12/12 REYMA SKUs. The deployed API returns 11/12. One REYMA SKU has `products.cost = 0` or NULL in the Supabase `products` table. This is an Odoo data quality issue (cost not set for that product in the source system).

**Cannot identify which SKU without querying Supabase.** The diagnostic query is documented in Section 3.3 below.

### 1.4 What is working correctly

- `rpc_abc_xyz_classification` revenue ranking (ABC classes A/B/C): correct — uses `demand_daily.revenue` with no date filter; data exists for all time.
- `rpc_abc_xyz_classification` XYZ classification (CV of demand): correct — uses `demand_daily.quantity_sold` with no date filter.
- `current_stock` in both RPCs: correct — uses `MAX(snapshot_date)` correctly.
- `lead_time_days` and `unit_cost` in both RPCs: correct.
- Order plan panel (CARVAJAL/REYMA): `avg_daily_demand` is computed correctly in the route, bypassing the broken RPC field.

---

## 2. Impact Assessment

| Visible symptom | Root cause | Affected pages |
|---|---|---|
| Excepciones activas = 0 | `rpc_stockout_risks` returns 0 rows (demand=0 filters all products) | `/compras`, `/preocupaciones/desabastecimiento` |
| GTQ en riesgo = — | Same — no rows to aggregate | `/compras`, `/preocupaciones/desabastecimiento` |
| Cobertura promedio = — | Same — no `days_of_supply` values | `/compras` |
| Top 5 Excepciones panel absent | Same — `top5` array is empty | `/compras` |
| GTQ inmovilizado overstated (Q ~15M) | `avg_daily_demand = 0` makes ALL stock appear excess | `/compras`, `/preocupaciones/capital-congelado` |
| Hold List GTQ figures wrong | Same | `/preocupaciones/capital-congelado` |
| Per-warehouse Hot List empty | `rpc_stockout_risks_by_warehouse` returns 0 rows (same bug) | `/preocupaciones/desabastecimiento` warehouse filter |
| REYMA 11/12 instead of 12/12 | One REYMA SKU has `products.cost = 0` | `/compras` order plan panel |

---

## 3. Fix Design

### 3.1 Fix the demand window in all three RPCs — new migration

**Migration file:** `supabase/migrations/20260511000001_fix_rpc_demand_signal.sql`

**Approach:** Replace `CURRENT_DATE - INTERVAL '30 days'` with a snapshot-anchored 90-day window. The anchor is `MAX(snapshot_date) FROM inventory_daily` — the same source already used in the `latest_snap` CTE of `rpc_abc_xyz_classification`. Using `MAX(snapshot_date)` makes the functions self-adapting: if a newer snapshot is ever loaded, the demand window automatically shifts.

**Why 90 days instead of 30:**
- 30 days was already marginal at deploy time (snapshot was 33 days old)
- 90 days is consistent with the order-plan route (`DEMAND_WINDOW_DAYS = 90`)
- 90 days produces a more statistically stable demand estimate (less noise from weekly seasonality)
- For ABC/XYZ use case, 90 days is the minimum recommended window in literature

**For `rpc_stockout_risks` and `rpc_stockout_risks_by_warehouse`:**

Old demand lateral join / CTE:
```sql
WHERE dd.demand_date >= CURRENT_DATE - INTERVAL '30 days'
```

New:
```sql
WHERE dd.demand_date BETWEEN (
  (SELECT MAX(snapshot_date) FROM inventory_daily) - INTERVAL '90 days'
) AND (SELECT MAX(snapshot_date) FROM inventory_daily)
```

The `AVG(dd.quantity_sold)` already computes average daily demand. With 90 days of data, this average is correct.

**For `rpc_abc_xyz_classification` — `recent_demand` CTE:**

Same window change. Additionally, rename the CTE result to reflect 90-day semantics (internal comment only — return column name `avg_daily_demand` stays the same for API compatibility).

**No return type changes.** All three functions keep their current column signatures. The fix is internal only. No TypeScript changes required.

### 3.2 REYMA 11/12 — RESOLVED: correct behavior, no fix required

**Finding (2026-05-11, queried directly against Supabase):**

All 12 REYMA demo SKUs have:
- Non-zero `products.cost` (ranging Q 62.79 to Q 269.33)
- Non-zero `demand_daily.revenue` (ranging Q 1,073,884 to Q 10,171,030)
- Non-zero `revenue_daily.quantity` in the 90-day window

The "11 de 12 SKUs" display is **correct**. One REYMA SKU has sufficient current stock that `target_stock ≤ current_stock`, producing `qty_recommended = 0`. It is counted in `sku_count_total` but not in `sku_count_with_order` — this is the intended behavior of the order plan formula.

The Python pre-implementation simulation's 12/12 result used different lead_time_days values than the RPC returns for that SKU. The deployed API's 11/12 is authoritative.

**No migration or code change needed for this issue.**

### 3.3 No TypeScript route changes needed

The `stockout-risk/route.ts` route is correct — it calls `supabase.rpc('rpc_stockout_risks')` and returns whatever the function returns. Once the migration fixes the function, the route will return the correct non-empty data without modification.

The `abc-xyz/route.ts` route is similarly correct.

The `order-plan/route.ts` route already bypasses the broken `avg_daily_demand` field. After the migration, the RPC will return correct values, but the route's own `revenue_daily` computation is still more reliable and should be kept as-is.

---

## 4. Migration SQL

**File:** `supabase/migrations/20260511000001_fix_rpc_demand_signal.sql`

### 4.1 `rpc_stockout_risks`

```sql
-- ============================================================================
-- Fix rpc_stockout_risks — demand window was CURRENT_DATE-relative (broken)
-- Root cause: demand_daily has no data after 2026-03-03 (snapshot date).
-- CURRENT_DATE - 30 days = April 2026 → 0 demand rows → 0 stockout rows.
-- Fix: anchor demand window to MAX(snapshot_date) FROM inventory_daily.
-- Window extended to 90 days for statistical stability.
-- Plan 009 — 2026-05-11
-- ============================================================================
DROP FUNCTION IF EXISTS rpc_stockout_risks();
CREATE OR REPLACE FUNCTION rpc_stockout_risks()
RETURNS TABLE(
  product_id       INT,
  product_name     VARCHAR,
  sku              VARCHAR,
  category         VARCHAR,
  current_stock    NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply   NUMERIC,
  lead_time_days   INT,
  risk_level       VARCHAR,
  unit_price       NUMERIC,
  supplier_name    VARCHAR
) AS $$
DECLARE
  v_snapshot_date DATE;
  v_demand_from   DATE;
BEGIN
  SELECT MAX(id2.snapshot_date) INTO v_snapshot_date FROM inventory_daily id2;
  v_demand_from := v_snapshot_date - INTERVAL '90 days';

  RETURN QUERY
  SELECT
    p.id                                                      AS product_id,
    p.name                                                    AS product_name,
    p.sku,
    p.category,
    COALESCE(inv.current_qty, 0)                              AS current_stock,
    COALESCE(dem.avg_demand, 0)                               AS avg_daily_demand,
    CASE
      WHEN COALESCE(dem.avg_demand, 0) > 0
      THEN COALESCE(inv.current_qty, 0) / dem.avg_demand
      ELSE 9999
    END                                                       AS days_of_supply,
    COALESCE(ps.lt_days, 30)                                  AS lead_time_days,
    CASE
      WHEN COALESCE(inv.current_qty, 0) <= 0                 THEN 'critico'
      WHEN COALESCE(dem.avg_demand, 0) > 0
        AND (COALESCE(inv.current_qty, 0) / dem.avg_demand)
              < COALESCE(ps.lt_days, 30)                     THEN 'alto'
      WHEN COALESCE(dem.avg_demand, 0) > 0
        AND (COALESCE(inv.current_qty, 0) / dem.avg_demand)
              < COALESCE(ps.lt_days, 30) * 1.5               THEN 'medio'
      ELSE 'bajo'
    END                                                       AS risk_level,
    COALESCE(p.list_price, 0)                                 AS unit_price,
    ps.sup_name                                               AS supplier_name
  FROM products p
  LEFT JOIN LATERAL (
    SELECT SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.product_id = p.id
      AND id.snapshot_date = v_snapshot_date
  ) inv ON true
  LEFT JOIN LATERAL (
    SELECT AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.product_id = p.id
      AND dd.is_censored = false
      AND dd.demand_date BETWEEN v_demand_from AND v_snapshot_date
  ) dem ON true
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days AS lt_days, s.name AS sup_name
    FROM product_suppliers ps2
    JOIN suppliers s ON s.id = ps2.supplier_id
    WHERE ps2.product_id = p.id
    ORDER BY ps2.lead_time_days ASC
    LIMIT 1
  ) ps ON true
  WHERE p.is_active = true
    AND COALESCE(dem.avg_demand, 0) > 0
  ORDER BY days_of_supply ASC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rpc_stockout_risks() TO authenticated, anon, service_role;
```

### 4.2 `rpc_abc_xyz_classification`

Only the `recent_demand` CTE changes. The rest of the function (revenue ranking, XYZ classification, current inventory) is correct and unchanged.

```sql
-- ============================================================================
-- Fix rpc_abc_xyz_classification — avg_daily_demand was always 0
-- Root cause: same CURRENT_DATE - 30 days demand window as rpc_stockout_risks.
-- avg_daily_demand = 0 for all rows caused GTQ inmovilizado to be overstated:
--   max(0, stock - 0) × cost = entire stock × cost (not just excess over policy).
-- Fix: snapshot-anchored 90-day window, same anchor as rpc_stockout_risks.
-- Plan 009 — 2026-05-11
-- ============================================================================
DROP FUNCTION IF EXISTS rpc_abc_xyz_classification();
CREATE OR REPLACE FUNCTION rpc_abc_xyz_classification()
RETURNS TABLE(
  product_id              INT,
  product_name            VARCHAR,
  sku                     VARCHAR,
  category                VARCHAR,
  total_revenue           NUMERIC,
  cumulative_revenue_pct  NUMERIC,
  abc_class               CHAR(1),
  demand_cv               NUMERIC,
  xyz_class               CHAR(1),
  observation_days        BIGINT,
  statistical_confidence  VARCHAR,
  current_stock           NUMERIC,
  avg_daily_demand        NUMERIC,
  lead_time_days          INT,
  unit_cost               NUMERIC,
  supplier_name           VARCHAR
) AS $$
DECLARE
  v_snapshot_date DATE;
  v_demand_from   DATE;
BEGIN
  SELECT MAX(id2.snapshot_date) INTO v_snapshot_date FROM inventory_daily id2;
  v_demand_from := v_snapshot_date - INTERVAL '90 days';

  RETURN QUERY
  WITH revenue_ranked AS (
    SELECT
      p.id AS product_id,
      p.name AS product_name,
      p.sku,
      p.category,
      COALESCE(SUM(dd.revenue), 0) AS total_revenue
    FROM products p
    LEFT JOIN demand_daily dd ON dd.product_id = p.id AND dd.is_censored = false
    WHERE p.is_active = true
    GROUP BY p.id, p.name, p.sku, p.category
    HAVING COALESCE(SUM(dd.revenue), 0) > 0
    ORDER BY total_revenue DESC
  ),
  cumulative AS (
    SELECT
      rr.*,
      SUM(rr.total_revenue) OVER (ORDER BY rr.total_revenue DESC) /
        SUM(rr.total_revenue) OVER () * 100 AS cum_pct
    FROM revenue_ranked rr
  ),
  demand_variability AS (
    SELECT
      dd.product_id,
      CASE
        WHEN AVG(dd.quantity_sold) > 0
        THEN STDDEV(dd.quantity_sold) / AVG(dd.quantity_sold)
        ELSE 0
      END AS cv,
      COUNT(*) AS obs_days
    FROM demand_daily dd
    WHERE dd.is_censored = false
    GROUP BY dd.product_id
  ),
  current_inventory AS (
    SELECT
      id.product_id,
      SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.snapshot_date = v_snapshot_date
    GROUP BY id.product_id
  ),
  -- FIX: was CURRENT_DATE - 30 days; now snapshot-anchored 90-day window
  recent_demand AS (
    SELECT
      dd.product_id,
      AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.is_censored = false
      AND dd.demand_date BETWEEN v_demand_from AND v_snapshot_date
    GROUP BY dd.product_id
  )
  SELECT
    c.product_id,
    c.product_name,
    c.sku,
    c.category,
    c.total_revenue,
    ROUND(c.cum_pct, 2)                                       AS cumulative_revenue_pct,
    CASE
      WHEN c.cum_pct <= 80 THEN 'A'
      WHEN c.cum_pct <= 95 THEN 'B'
      ELSE 'C'
    END::CHAR(1)                                              AS abc_class,
    ROUND(COALESCE(dv.cv, 0), 4)                             AS demand_cv,
    CASE
      WHEN COALESCE(dv.cv, 0) < 0.5 THEN 'X'
      WHEN COALESCE(dv.cv, 0) < 1.0 THEN 'Y'
      ELSE 'Z'
    END::CHAR(1)                                              AS xyz_class,
    COALESCE(dv.obs_days, 0)                                  AS observation_days,
    CASE
      WHEN COALESCE(dv.obs_days, 0) >= 90 THEN 'Alta confianza'
      WHEN COALESCE(dv.obs_days, 0) >= 30 THEN 'Confianza media'
      ELSE 'Datos insuficientes'
    END::VARCHAR                                              AS statistical_confidence,
    COALESCE(ci.current_qty, 0)                               AS current_stock,
    COALESCE(rd.avg_demand, 0)                                AS avg_daily_demand,
    COALESCE(ps.lt_days, 30)                                  AS lead_time_days,
    COALESCE(p.cost, 0)                                       AS unit_cost,
    ps.sup_name                                               AS supplier_name
  FROM cumulative c
  JOIN products p ON p.id = c.product_id
  LEFT JOIN demand_variability dv  ON dv.product_id = c.product_id
  LEFT JOIN current_inventory ci   ON ci.product_id = c.product_id
  LEFT JOIN recent_demand rd       ON rd.product_id = c.product_id
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days AS lt_days, s.name AS sup_name
    FROM product_suppliers ps2
    JOIN suppliers s ON s.id = ps2.supplier_id
    WHERE ps2.product_id = c.product_id
    ORDER BY ps2.lead_time_days ASC
    LIMIT 1
  ) ps ON true
  ORDER BY c.total_revenue DESC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rpc_abc_xyz_classification() TO authenticated, anon, service_role;
```

### 4.3 `rpc_stockout_risks_by_warehouse`

Same fix as `rpc_stockout_risks` — only the `demand_30d` CTE changes.

```sql
-- ============================================================================
-- Fix rpc_stockout_risks_by_warehouse — same stale demand window as above
-- Plan 009 — 2026-05-11
-- ============================================================================
DROP FUNCTION IF EXISTS rpc_stockout_risks_by_warehouse();
CREATE OR REPLACE FUNCTION rpc_stockout_risks_by_warehouse()
RETURNS TABLE(
  product_id       INT,
  product_name     VARCHAR,
  sku              VARCHAR,
  category         VARCHAR,
  warehouse_id     INT,
  warehouse_name   VARCHAR,
  warehouse_code   VARCHAR,
  current_stock    NUMERIC,
  avg_daily_demand NUMERIC,
  days_of_supply   NUMERIC,
  lead_time_days   INT,
  risk_level       VARCHAR,
  unit_price       NUMERIC,
  supplier_name    VARCHAR
) AS $$
DECLARE
  v_snapshot_date DATE;
  v_demand_from   DATE;
BEGIN
  SELECT MAX(id2.snapshot_date) INTO v_snapshot_date FROM inventory_daily id2;
  v_demand_from := v_snapshot_date - INTERVAL '90 days';

  RETURN QUERY
  WITH per_warehouse AS (
    SELECT
      id.product_id,
      id.warehouse_id,
      SUM(id.quantity_on_hand) AS current_qty
    FROM inventory_daily id
    WHERE id.snapshot_date = v_snapshot_date
    GROUP BY id.product_id, id.warehouse_id
    HAVING SUM(id.quantity_on_hand) > 0
  ),
  -- FIX: was demand_30d with CURRENT_DATE - 30 days; now snapshot-anchored
  demand_90d AS (
    SELECT
      dd.product_id,
      AVG(dd.quantity_sold) AS avg_demand
    FROM demand_daily dd
    WHERE dd.is_censored = false
      AND dd.demand_date BETWEEN v_demand_from AND v_snapshot_date
    GROUP BY dd.product_id
  )
  SELECT
    p.id                                                       AS product_id,
    p.name                                                     AS product_name,
    p.sku,
    p.category,
    pw.warehouse_id,
    w.name                                                     AS warehouse_name,
    w.code                                                     AS warehouse_code,
    pw.current_qty                                             AS current_stock,
    COALESCE(d.avg_demand, 0)                                  AS avg_daily_demand,
    CASE
      WHEN COALESCE(d.avg_demand, 0) > 0
      THEN pw.current_qty / d.avg_demand
      ELSE 9999
    END                                                        AS days_of_supply,
    COALESCE(ps.lt_days, 30)                                   AS lead_time_days,
    CASE
      WHEN pw.current_qty <= 0                                 THEN 'critico'
      WHEN COALESCE(d.avg_demand, 0) > 0
        AND (pw.current_qty / d.avg_demand)
              < COALESCE(ps.lt_days, 30)                      THEN 'alto'
      WHEN COALESCE(d.avg_demand, 0) > 0
        AND (pw.current_qty / d.avg_demand)
              < COALESCE(ps.lt_days, 30) * 1.5                THEN 'medio'
      ELSE 'bajo'
    END                                                        AS risk_level,
    COALESCE(p.list_price, 0)                                  AS unit_price,
    ps.sup_name                                                AS supplier_name
  FROM per_warehouse pw
  JOIN products p     ON p.id  = pw.product_id
  JOIN warehouses w   ON w.id  = pw.warehouse_id
  LEFT JOIN demand_90d d ON d.product_id = pw.product_id
  LEFT JOIN LATERAL (
    SELECT ps2.lead_time_days AS lt_days, s.name AS sup_name
    FROM product_suppliers ps2
    JOIN suppliers s ON s.id = ps2.supplier_id
    WHERE ps2.product_id = pw.product_id
    ORDER BY ps2.lead_time_days ASC
    LIMIT 1
  ) ps ON true
  WHERE p.is_active = true
    AND COALESCE(d.avg_demand, 0) > 0
  ORDER BY
    CASE
      WHEN COALESCE(d.avg_demand, 0) > 0 THEN pw.current_qty / d.avg_demand
      ELSE 9999
    END ASC,
    p.name ASC,
    w.name ASC;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION rpc_stockout_risks_by_warehouse() TO authenticated, anon, service_role;
```

---

## 5. Verification Requirements (must check after migration is applied)

| Check | How to verify | Expected result |
|---|---|---|
| `rpc_stockout_risks` returns rows | Call `/api/kpis/stockout-risk` in browser or Supabase SQL editor | Non-empty array; critico/alto items visible |
| Risk levels are plausible | Cross-reference top 3 critico items against `real_data/stock.quant1_20260303.csv` and `real_data/product.supplierinfo_*.csv` | days_of_supply < lead_time_days for 'alto' items |
| `avg_daily_demand` is non-zero | Call `/api/kpis/abc-xyz` and inspect response | No rows with avg_daily_demand = 0 (or at least, meaningful products have non-zero values) |
| GTQ inmovilizado is reduced from Q 15M | Reload `/preocupaciones/capital-congelado` | Total is substantially lower than Q 15,099,815; reflects only stock over 3× lead-time target |
| `/compras` KPI cards show real data | Reload page | Excepciones activas > 0; GTQ en riesgo shows a Q value; Cobertura promedio shows a number of days |
| Per-warehouse Hot List works | Open Hot List, select a specific warehouse | Rows appear for that warehouse |

**Note on REYMA:** REYMA 11/12 is correct behavior (one SKU has adequate stock). No change expected here after the migration.

---

## 6. Known Unknowns — RESOLVED (queried Supabase 2026-05-11)

| Unknown | Status | Finding |
|---|---|---|
| Does `demand_daily` have data for the 90-day window (Dec 2025 – Mar 2026)? | **RESOLVED ✅** | `demand_daily` date range: 2024-10-01 to 2026-03-03. 17,072 rows with `is_censored = false` exist in the target window. The migration fix is validated. |
| Which REYMA SKU has `products.cost = 0`? | **RESOLVED ✅ — premise was wrong** | All 12 REYMA SKUs have non-zero cost (Q 62.79–269.33). The REYMA 11/12 display is correct behavior — see Section 3.2. No cost fix needed. |
| Products with `is_censored = true` for full 90-day window? | **RESOLVED ✅** | All 12 REYMA demo SKUs (checked individually) have demand_daily rows with revenue data. The demand fix using `is_censored = false` will return valid data for the demo scope. |

---

## 7. Files to Create / Modify

| Action | File | Change |
|---|---|---|
| CREATE | `supabase/migrations/20260511000001_fix_rpc_demand_signal.sql` | Fixes all three RPCs — demand window only |
| NO CHANGE | `frontend/src/app/api/kpis/stockout-risk/route.ts` | Correct as-is |
| NO CHANGE | `frontend/src/app/api/kpis/abc-xyz/route.ts` | Correct as-is |
| NO CHANGE | `frontend/src/app/(authenticated)/compras/page.tsx` | Will display correctly once RPCs return real data |
| NO CHANGE | `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx` | Same |
| NO CHANGE | `frontend/src/app/(authenticated)/preocupaciones/capital-congelado/page.tsx` | Same |

---

## 8. Out of Scope for This Plan

- Re-running the ML forecast model for Apr/May 2026 (Plan 007 Priority 1)
- Adding Hot List + Hold List to COMPRAS sidebar (Plan 007 Priority 3)
- Replacing `demand_daily` with `revenue_daily` as the universal demand source for the RPCs — this is a larger architectural decision. The current fix uses `demand_daily` with a corrected window. `demand_daily` has been confirmed to have data for the full 90-day window (17,072 rows, 2025-12-03 to 2026-03-03), so this alternative is not needed.
- Parameterizing snapshot_date on all RPCs — the `DECLARE v_snapshot_date := MAX(...)` approach is robust enough without exposing a parameter.
- Any changes to the ABC/XYZ revenue ranking logic — it is correct.
