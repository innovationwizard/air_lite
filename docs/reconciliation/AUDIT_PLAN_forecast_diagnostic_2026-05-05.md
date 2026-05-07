# Forecast Diagnostic — Deep Audit Plan
**Date:** 2026-05-05  
**Scope:** `/superuser/forecast-diagnostic` — all three panels  
**Status:** DEAL BREAKER. Client is seeing incomplete and wrong data in the app. This must be resolved completely before the next demo.

---

> **STATUS: ROOT CAUSE RESOLVED — 2026-05-07**
>
> The underlying purchase data gap that fed the bugs described in this audit plan has been fully closed. The 14 red-tier demo SKUs that were showing zero purchase history (and therefore zero purchase forecasts) now have 15–16 months of real data in `revenue_daily_for_ml`, sourced from `stock_moves` receipts. The ML pipeline has been re-trained; 138/138 forecast cells are populated with non-zero, real-data-derived values.
>
> **Where the purchase data fix lives:**
> - `docs/reconciliation/find_15b_supplement_purchases_from_stock_moves_2026-05-06.py` — reads `stock_moves` vendor→internal receipts for 14 red-tier PIDs, inserts into `revenue_daily`
> - `docs/reconciliation/recompute_po_history_real_months_2026-05-07.py` — patches `products_acid_test_active.po_history_real_months`; stoplight result: 20 GREEN / 3 AMBER / 0 RED
>
> **UI bugs** (BUG-1, BUG-2, BUG-3, BUG-6) described in this plan were fixed in the `forecast-diagnostic` module repair session (see git log around commits `bd6a135` and `369135e`).
>
> **Full data pipeline record:** [`changelogs/2026-05-06-07_purchase-history-gap-fix-red-tier-skus.md`](../../changelogs/2026-05-06-07_purchase-history-gap-fix-red-tier-skus.md)
>
> The audit plan below is preserved as-written — it documents the root cause investigation and the acceptance criteria that were met.

---

---

## 0. Executive Summary of Confirmed Bugs (from source code)

Before any investigation, two bugs are confirmed by reading the code alone. They explain the majority of what is visible in the screenshots.

### BUG-1 — CRITICAL — All purchase forecasts forced to 0

**File:** `frontend/src/app/api/superuser/forecast-diagnostic/route.ts`  
**Lines:** 330, 334 (repeated for `purchases_ordered` and `purchases_received`)

```typescript
// CURRENT (WRONG):
purchases_ordered: fOrd && fOrd.model_status === 'ok' ? num(fOrd.yhat_sum) : 0,
purchases_received: fRec && fRec.model_status === 'ok' ? num(fRec.yhat_sum) : 0,
```

Every purchase forecast row in `forecast_results` has `model_status = 'ok_derived'`, not `'ok'`. This condition is NEVER true for purchases. Every `yhat_sum` is silently forced to 0.

**Downstream effects — exactly what appears in the screenshots:**
- Panel B: Compras Ordenadas and Compras Recibidas forecast lines flat at 0 for Feb–Mar 2026, across every UoM bucket.
- Panel A: `ratio = forecastMean / history12m`. With forecastMean = 0, ratio = 0. `ratioBucket(0)` returns `'gray'`. On a log scale, 0 = −∞. Bars are never rendered. This is why NO Compras Ordenadas or Compras Recibidas bars appear in Panel A.
- Panel C (77201000 drilldown): `forecast (prom.) = 0` for both purchase metrics, despite `forecast_results` holding yhat_sum = 1,417 (Feb) and 1,810 (Mar) for pid=34.

**Fix:**
```typescript
// CORRECT:
purchases_ordered: fOrd && ['ok', 'ok_derived'].includes(fOrd.model_status) ? num(fOrd.yhat_sum) : 0,
purchases_received: fRec && ['ok', 'ok_derived'].includes(fRec.model_status) ? num(fRec.yhat_sum) : 0,
// Same fix for lower/upper bounds on lines 331–332 and 335–336.
```

---

### BUG-2 — MEDIUM — Historical source is `revenue_daily`; forecast was trained on `revenue_daily_for_ml`

**File:** `route.ts` line 87  
```typescript
.from('revenue_daily')  // reads ALL ssot_labels, not filtered
```

The ML model was trained exclusively on `revenue_daily_for_ml` (SSOT `pol_confirmed_date_planned_product_qty_c40` — confirmed POs only, Oct 2024 anomaly smoothed). Panel A ratios and Panel B historical lines use raw `revenue_daily` which:

1. Contains the old SSOT `pol_all_states_date_planned_product_qty_c40` (cancelled + draft POs included), inflating historical purchase quantities.
2. Contains the Oct 2024 onboarding spike in its raw form (not smoothed).
3. May accumulate multiple SSOT-label rows for the same product+metric+date if the table was populated more than once, double-counting quantities.

The ratio `forecast / history` in Panel A is therefore comparing apples (confirmed-PO-trained forecast) to oranges (all-states historical sum). For RED-tier SKUs where historical confirmed POs are 0 outside Oct–Nov 2024, the all-states `revenue_daily` may show 0 too, making the ratio undefined — causing missing bars.

**Fix:** Replace `revenue_daily` with `revenue_daily_for_ml` as the history source, and add `ssot_label` filtering per metric to avoid cross-label accumulation.

---

### BUG-3 — LOW — Panel A bar colors encode tier, not metric

**File:** `page.tsx` panelAOption, lines 157–168

All three metric series use `BUCKET_COLOR[ratioBucket(r)]` for bar color:
- Ratio in 0.5–2.0 range → green (`#10b981`)
- Ratio = 0 (purchase bug) → gray (not rendered on log scale)

The legend shows blue for Ventas, green for Compras Ordenadas, gold for Compras Recibidas — but actual bars are all the same green. When Ventas and Compras Ordenadas both fall in the green tier, their bars are visually identical and indistinguishable. The user cannot tell which metric the bar belongs to.

---

## 1. Panel-by-Panel Observations and Verification Checklist

### Panel A — Ratio: forecast / promedio histórico (12 m)

**What is visible in screenshots (Todas class, no filter):**
- Only 12 REYMA SKUs (77201xxx) appear on X axis. Zero CARVAJAL SKUs (77205xxx).
- Only Compras Ordenadas (green) bars appear for ~10 of the 12 SKUs.
- Ventas (blue) bars are not visually distinguishable (same green color as Compras, see BUG-3).
- Compras Recibidas (gold) bars are completely absent (BUG-1).
- SKUs 77201000 and 77201023 show no bars at all.
- Two SKUs (77201069) also appear barless.

**Audit checklist for Panel A:**

| # | Check | Method | Expected | Pass/Fail |
|---|-------|--------|----------|-----------|
| A1 | Are all 23 demo SKUs present on X axis (no class filter)? | Load page with no filter, count X-axis labels | 23 SKUs | ? |
| A2 | Are all 11 CARVAJAL SKUs (77205xxx) present? | Inspect X axis labels | 11 bars visible | ? |
| A3 | After BUG-1 fix: do Compras Ordenadas and Compras Recibidas bars appear? | Redeploy fix, reload page | Green/yellow/red bars for all SKUs with ratio > 0 | ? |
| A4 | After BUG-3 fix: are Ventas bars visually distinct from Compras bars? | Redeploy fix, reload page | Different colors per metric | ? |
| A5 | Do 77201000, 77201069, 77201023 show Ventas bars? | Inspect after fix | Green bar at expected ratio | ? |
| A6 | Are ratio values numerically correct for each SKU? | Cross-reference with Panel C table for each SKU | Within ±1% of forecast_mean / history_12m_mean | ? |
| A7 | Does revenue_daily (or for_ml post-fix) produce the same 12m mean as what the ML model saw? | Query revenue_daily_for_ml directly and compare to Panel C table | Must match | ? |

**Root cause investigation for 77201000, 77201069, 77201023 missing bars:**

Query to run:
```sql
SELECT metric, COUNT(*) as days, SUM(quantity) as total_qty
FROM revenue_daily
WHERE product_id IN (34, 469, 1096)
  AND observation_date >= '2025-02-01'
  AND observation_date <= '2026-01-31'
GROUP BY product_id, metric
ORDER BY product_id, metric;
```
If sales quantity is 0 or absent for any of these pids in `revenue_daily`, history12m.sales = 0, ratio.sales = null, and no bar renders. Compare same query on `revenue_daily_for_ml`.

---

### Panel B — Per-UoM time series buckets

**What is visible in screenshots:**

| Bucket | SKUs | Sales histórico | Sales forecast | PO histórico | PO forecast |
|--------|------|----------------|---------------|-------------|-------------|
| CAJA20 (5 SKUs) | 77201041, 77201055, 77201056, 77201014, 77201019 | ✓ correct | ✓ upward ~7.5–10K | ✓ Oct spike | **ZERO — BUG-1** |
| CAJA40 (4 SKUs) | 77201000, 77201046, 77201047, 77201053 | ✓ correct | ✓ ~13–15K | ✓ Oct spike ~23K | **ZERO — BUG-1** |
| CAJA (1 SKU) | 77201069 | ✓ correct | ✓ ~1.5–2K | ✓ tiny values | **ZERO — BUG-1** |
| CAJA10 (1 SKU) | 77201038 | ✓ correct | ✓ ~1.1–1.3K | ✓ ~100–550 | **ZERO — BUG-1** |
| FARDO20 (1 SKU) | 77201023 | ✓ correct | ✓ ~275–390 | ✓ Oct spike only | **ZERO — BUG-1** |

All five purchase forecast collapse to 0 — entirely explained by BUG-1.

**Expected purchase forecast values post-fix (from forecast_results, 2026-05-05 training run):**

CAJA20 bucket (sum of 5 SKUs, CAJA40 → CAJA20 conversion required):
- pid 20 (77201041, CAJA40 stored): purchases_ordered Feb=808, Mar=1,078
- pid 1366 (77201014, CAJA40 stored): purchases_ordered Feb=858, Mar=1,361
- pid 1590 (77201055, CAJA40 stored): purchases_ordered Feb=1,758, Mar=2,208
- pid 1600 (77201056, CAJA40 stored): purchases_ordered Feb=1,560, Mar=2,306
- pid 1587 (77201019, CAJA40 stored): purchases_ordered Feb=625, Mar=908

> **OPEN QUESTION — UoM conversion in Panel B:**
> `forecast_results.yhat_sum` is stored in the normalized CAJA40 unit used by `revenue_daily_for_ml`. Panel B Y axis is labeled in the native stock UoM (CAJA20, CAJA40, etc.). The route.ts code does NOT apply any UoM conversion before summing — it sums `f.purchases_ordered` (from `forecastMean.purchases_ordered`) which is already the raw yhat_sum.
>
> If `revenue_daily` quantities are in the same normalized unit as `revenue_daily_for_ml`, the comparison is consistent. If not, there will be a scale mismatch between historical bars and forecast bars in Panel B even after BUG-1 is fixed.
>
> **Audit step B8 below verifies this.**

**Audit checklist for Panel B:**

| # | Check | Method | Expected |
|---|-------|--------|----------|
| B1 | After BUG-1 fix: do purchase forecast lines appear above 0? | Redeploy, reload | Non-zero dashed lines for Feb–Mar 2026 |
| B2 | Are all 11 CARVAJAL UoM buckets shown (no class filter)? | Count buckets in panel | Additional buckets for 77205xxx SKUs |
| B3 | Does the Oct 2024 spike in historical PO line match expected values? | Compare to `revenue_daily_for_ml` Oct 2024 quantities | Consistent magnitude |
| B4 | Does the CAJA20 purchase forecast sum match expected (~3,800–8,800 CAJA40 equivalent)? | Panel B values vs forecast_results | Within UoM conversion tolerance |
| B5 | Are purchase received forecast lines also visible and non-zero? | After BUG-1 fix | Non-zero dashed purple lines |
| B6 | Is the "Fin entren." vertical marker correctly placed at 2026-01? | Visual inspection | Dashed line at Jan 2026 |
| B7 | Does historical data for 2026-02 and 2026-03 appear in histórico series? | Inspect — any data beyond 2026-01 | NONE — those are blind-test months |
| B8 | Do `revenue_daily` quantities match `revenue_daily_for_ml` quantities for the training window? | Direct DB query comparing both tables for same product+metric+month | Should match for correct SSOT labels |

---

### Panel C — SKU Drilldown (77201000 shown)

**What is visible in screenshot for 77201000 (Vaso Blanco 8oz Duroport, pid=34, REYMA, CAJA40):**

| Métrica | Historia 12m (prom.) | Forecast (prom.) | Ratio | model_status |
|---------|---------------------|-----------------|-------|-------------|
| Ventas | 5,430 | 3,972 | 0.732× (green) | ok |
| Compras Ordenadas | 0 | **0** | — | ok_derived |
| Compras Recibidas | 0 | **0** | — | ok_derived |

- Historia 12m = 0 for purchases is CORRECT. pid=34 (77201000) is RED-tier with only 2 months of confirmed POs (Oct + Nov 2024). The 12-month window (Feb 2025 – Jan 2026) has 0 confirmed POs. This is real.
- Forecast = 0 for purchases is WRONG due to BUG-1. Actual `forecast_results` values: purchases_ordered Feb=1,417, Mar=1,810 CAJA40.
- After BUG-1 fix: forecast_mean = (1,417 + 1,810) / 2 = 1,613 CAJA40. ratio = 1,613 / 0 = undefined (null). Still no ratio bar in Panel A for this SKU — because history12m = 0 for purchases. This is CORRECT behavior: ratio is undefined when there is no historical baseline.
- Ventas forecast 0.732× is in the green zone (0.5–2.0). Acceptable.
- Red triangle markers for purchases in Panel C chart: these appear because `forecast_status.purchases_ordered = 'ok_derived'` ≠ `'ok'`. The symbol switches to triangle and the color switches to red when status ≠ 'ok'. This is a design decision that treats `ok_derived` as a warning — which is reasonable, but should be documented/explained in the UI.

**Audit checklist for Panel C:**

| # | Check | Method | Expected |
|---|-------|--------|----------|
| C1 | After BUG-1 fix: does purchases_ordered forecast (prom.) show 1,613 CAJA40 for 77201000? | Reload post-fix | 1,613 (or nearest rounded value) |
| C2 | Does the chart show non-zero dashed lines for purchases in Feb–Mar 2026 for 77201000? | Visual inspection | Two data points visible above 0 |
| C3 | Does Ventas ratio 0.732× hold after any data source fix? | Compare before/after | Stable |
| C4 | For a GREEN-tier SKU (e.g. 77201046, pid=33, R=1.2877): do all three metrics show non-zero forecast in Panel C? | Select 77201046 in drilldown | purchases_ordered Feb≈9,742, Mar≈9,085 |
| C5 | Is the 12m history mean for Ventas reading from the same data the model was trained on? | Compare revenue_daily vs revenue_daily_for_ml for pid=34, metric=sales, 2025-02 to 2026-01 | Must match within rounding |
| C6 | Does `ok_derived` status map to a red triangle? Is this the correct UX for a VALID derived forecast? | Design review | Should distinguish 'ok_derived' (valid) from 'error' (invalid). Triangle may be misleading. |
| C7 | Are all 23 SKUs available in the drilldown selector? | Count options in `<select>` | 23 options |
| C8 | For each SKU, does the history start at 2024-10 and extend to 2026-01? | Visual inspection across multiple SKUs | 16 months of history |

---

## 2. Data Integrity Verification Queries

These queries must be run against production Supabase before closing any bug.

### Q1 — Verify purchase forecast values exist in forecast_results

```python
# Expected: 23 rows per metric per month = 46 rows per metric = 92 total purchase rows
supa('GET', '/rest/v1/forecast_results'
     '?metric=in.(purchases_ordered,purchases_received)'
     '&training_end_date=eq.2026-01-31'
     '&forecast_month=in.(2026-02-01,2026-03-01)'
     '&select=product_id,metric,forecast_month,yhat_sum,model_status'
     '&order=product_id.asc,metric.asc')
# Verify: all 92 rows have model_status='ok_derived' and yhat_sum > 0 (for most PIDs)
```

### Q2 — Verify revenue_daily vs revenue_daily_for_ml agreement for sales

```sql
-- Run on Supabase SQL editor
SELECT 
    rd.product_id,
    TO_CHAR(DATE_TRUNC('month', rd.observation_date::date), 'YYYY-MM') AS month,
    SUM(rd.quantity) AS revenue_daily_qty,
    SUM(rdml.quantity) AS revenue_daily_for_ml_qty,
    SUM(rd.quantity) - SUM(rdml.quantity) AS diff
FROM revenue_daily rd
JOIN revenue_daily_for_ml rdml 
    ON rdml.product_id = rd.product_id 
    AND rdml.observation_date = rd.observation_date
    AND rdml.metric = 'sales'
WHERE rd.metric = 'sales'
  AND rd.product_id IN (2,3,5,20,29,33,34,36,37,145,469,539,1035,1069,1096,1113,1127,1366,1562,1587,1590,1600,1606)
  AND rd.observation_date >= '2024-10-01'
  AND rd.observation_date <= '2026-01-31'
GROUP BY rd.product_id, month
ORDER BY diff DESC NULLS LAST
LIMIT 20;
```

Expected: diff ≈ 0 for all rows (same SSOT, same data). Any large positive diff indicates revenue_daily has extra rows (duplicate SSOT labels).

### Q3 — Verify revenue_daily does not double-count across ssot_labels

```sql
SELECT product_id, metric, COUNT(DISTINCT ssot_label) AS label_count
FROM revenue_daily
WHERE product_id IN (2,3,5,20,29,33,34,36,37,145,469,539,1035,1069,1096,1113,1127,1366,1562,1587,1590,1600,1606)
GROUP BY product_id, metric
ORDER BY label_count DESC;
```

Expected: 1 ssot_label per product+metric. If any row shows > 1, the diagnostic is double-counting.

### Q4 — Verify missing SKU data in revenue_daily for Panel A

```sql
-- For SKUs that showed no bars in Panel A (77201000, 77201069, 77201023)
SELECT product_id, metric, 
       COUNT(*) AS days, 
       SUM(quantity) AS total,
       MIN(observation_date) AS first_date,
       MAX(observation_date) AS last_date
FROM revenue_daily
WHERE product_id IN (34, 469, 1096)
GROUP BY product_id, metric
ORDER BY product_id, metric;
```

### Q5 — Verify Panel C 12m mean calculation

For pid=34 (77201000), history12m.sales should equal the average of Feb 2025 – Jan 2026 from revenue_daily:
```sql
SELECT AVG(monthly_sum) AS twelve_month_avg
FROM (
    SELECT DATE_TRUNC('month', observation_date::date) AS month, SUM(quantity) AS monthly_sum
    FROM revenue_daily
    WHERE product_id = 34
      AND metric = 'sales'
      AND observation_date >= '2025-02-01'
      AND observation_date <= '2026-01-31'
    GROUP BY 1
) m;
-- Expected: ≈ 5,430 (matches Panel C table)
```

---

## 3. Fix Priority and Sequence

| Priority | Bug | File | Line(s) | Fix Description |
|----------|-----|------|---------|-----------------|
| 1 — IMMEDIATE | BUG-1: `model_status === 'ok'` kills all purchases | `route.ts` | 330–338 | Change to `['ok', 'ok_derived'].includes(status)` for all purchase fields (yhat_sum, lower, upper) |
| 2 — HIGH | BUG-2: `revenue_daily` vs `revenue_daily_for_ml` mismatch | `route.ts` | 87 | Switch historical read to `revenue_daily_for_ml`. Add ssot_label filter per metric. |
| 3 — MEDIUM | BUG-3: Panel A bar colors undifferentiated | `page.tsx` | panelAOption | Use metric color (not tier color) for bar fill. Encode tier via border or opacity. OR keep tier color and make bars distinguishable by pattern/border. |
| 4 — INVESTIGATE | Missing SKUs 77201000, 77201069, 77201023 in Panel A | DB query Q4 | n/a | Run Q4. If revenue_daily has no data, root cause is DB population. |
| 5 — INVESTIGATE | Missing CARVAJAL from screenshots | Page inspection | n/a | Confirm if user had class=REYMA filter. If not, run Q4 for CARVAJAL PIDs. |
| 6 — DESIGN | `ok_derived` shown as red triangle in Panel C | `page.tsx` | 313 | `ok_derived` is a valid, expected status for purchases. Use a different symbol (e.g., diamond, circle) with a note, not a red triangle which implies error. |

---

## 4. Acceptance Criteria

This audit is complete and the deal-breaker issue is resolved when ALL of the following are true:

1. **Panel A** shows ratio bars for ALL 23 SKUs, for ALL 3 metrics (Ventas, Compras Ordenadas, Compras Recibidas), with no class filter applied.
2. **Panel A** purchase ratios are non-zero for every SKU that has non-zero historical purchase data.
3. **Panel B** purchase forecast lines (dashed) show non-zero values for Feb and Mar 2026 for every UoM bucket.
4. **Panel B** purchase forecast magnitude is consistent with Panel B historical magnitude — the ratio is not > 10× in either direction without a known explanation.
5. **Panel C** shows non-zero `forecast (prom.)` for purchases on every SKU where `model_status = ok_derived` and `yhat_sum > 0` in `forecast_results`.
6. **Panel C** does not display red triangles for `ok_derived` status (valid derived forecast is not an error).
7. **Data source** for historical lines in Panels B and C is `revenue_daily_for_ml` — the exact same table the ML model was trained on.
8. **No double-counting** of SSOT labels in historical aggregation (Q3 returns 1 per product+metric).
9. **All 23 SKUs** are present in the Panel C drilldown selector.

---

## 5. Files to Modify

- `frontend/src/app/api/superuser/forecast-diagnostic/route.ts` — BUG-1 (immediate), BUG-2 (data source)
- `frontend/src/app/(authenticated)/superuser/forecast-diagnostic/page.tsx` — BUG-3 (colors), BUG-6 (triangle symbol)

---

## 6. Deal-Breaker Note

> The client is getting tired of seeing incomplete data and WRONG data in the app.  
> If we cannot make this work, **THIS IS A DEAL BREAKER.**  
>
> BUG-1 alone makes every purchase forecast display incorrect across the entire app.  
> The fix is a single line change in `route.ts`. It must be deployed before the next client interaction.  
> BUG-2 and BUG-3 are secondary but must be resolved before any formal presentation of the forecast diagnostic to decision makers.
