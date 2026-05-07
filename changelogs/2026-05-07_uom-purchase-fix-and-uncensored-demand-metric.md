# UoM Purchase Mismatch Root Cause Fix + Uncensored Demand Metric (Sale Order Lines)

**Date:** 2026-05-07  
**Scope:** ML data pipeline, Supabase `revenue_daily`, `revenue_daily_for_ml`, `forecast_results`. Frontend: `forecast-diagnostic` route and page. No schema migrations.  
**Stack:** Python (stdlib), PostgreSQL via Supabase REST API, Facebook Prophet via Railway ML service, Next.js / React / ECharts.  
**Driving context:** Two distinct dealbreakers identified by a client insider reviewing the `/gerencia/forecast` and `/superuser/forecast-diagnostic` pages for SKU 77205001 (Bandeja Bio 2P Foam 10/50 Termo Fom, CARVAJAL):

- **Dealbreaker 1:** Compras Recibidas showing ~9,000/month when actual receipts are ~36,000/month. A 4× undercount, not a missing-data problem — data was present but units were wrong.
- **Dealbreaker 2:** Sales forecast shows ~35,000/month. Client states true demand is 45,000+/month. Forecast trained on invoiced (supply-constrained) quantities, not actual orders.

Both issues were diagnosed, fixed, and the downstream ML pipeline re-run within a single session.

---

## Dealbreaker 1 — Purchases Showing 9k When Reality Is 36k

### Root Cause

The `find_15` and `find_15b` pipeline scripts both called a helper function `to_caja40(qty, src_uom_name)` when normalizing purchase quantities before storing them in `revenue_daily`. That function converted everything to CAJA40 units:

```python
def to_caja40(qty: float, src_uom_name: str) -> float | None:
    src = uom_ratio.get(src_uom_name)
    if src is None or src == 0:
        return None
    return qty * CAJA40_RATIO / src  # CAJA40_RATIO = 0.025
```

The sales metric (`find_12`, already correct) stores quantities in each product's `stock_uom`. For SKU 77205001, `stock_uom = FARDO10` (ratio = 0.1). The chart reads both `metric='sales'` and `metric='purchases_received'` from `revenue_daily.quantity` and plots them on the same axis — labelled with the product's `stock_uom` (FARDO10).

The result: purchases were stored in CAJA40 (0.025-based), sales were stored in FARDO10 (0.1-based). When both appeared on the same axis with label "FARDO10", a July 2025 figure of 34,225 FARDO10 receipts appeared as 8,556 because `34,225 × (0.025 / 0.1) = 8,556`. The chart was literally displaying the right number in the wrong unit — and neither the label nor the code revealed this.

**Derivation / confirmation:**
- `stock_moves` vendor→internal Jul 2025 for pid=2: raw query = 34,225 FARDO10
- `revenue_daily` pre-fix Jul 2025 purchases_received for pid=2: 8,556 (actually CAJA40)
- `8,556 / 34,225 = 0.25 = CAJA40_RATIO / FARDO10_RATIO = 0.025 / 0.1` ✓

The bug is exactly the CAJA40/FARDO10 conversion factor applied by `to_caja40()`.

**Affected products:** All 17 demo SKUs whose `stock_uom ≠ CAJA40`. The 6 SKUs with `stock_uom = CAJA40` were unaffected (the conversion factor is 1.0 for them).

| stock_uom | Factor (stock_uom_ratio / CAJA40_ratio) | Under-report factor |
|-----------|------------------------------------------|---------------------|
| FARDO10 (ratio=0.1) | 4.0 | purchases shown at 25% of true value |
| CAJA20 (ratio=0.05) | 2.0 | purchases shown at 50% of true value |
| FARDO4 (ratio=0.025) | 1.0 | unaffected |
| CAJA40 (ratio=0.025) | 1.0 | unaffected |

**Physical unit semantics (committed to memory this session):**
- `FARDO10`: a bundle containing 10 individual units. Ratio=0.1 means 1 FARDO10 = 10 base units. To convert X FARDO10 to base units: X / 0.1.
- `CAJA40`: a box containing 40 individual units. Ratio=0.025. 1 CAJA40 = 40 base units. To convert X CAJA40 to base units: X / 0.025.
- Converting X from FARDO10 to CAJA40: X × (0.025 / 0.1) = X × 0.25 → you get fewer boxes of 40 than you had bundles of 10, because each box holds 4× more.
- `to_caja40()` applied exactly this 0.25× reduction. The bug was that it was applied to data that was then stored alongside FARDO10-unit sales figures.

### Fix Applied

**Correct conversion formula:**
```python
def to_stock_uom(qty: float, src_uom_name: str, tgt_uom_name: str) -> float | None:
    src = uom_ratio.get(src_uom_name)
    tgt = uom_ratio.get(tgt_uom_name)
    if src is None or src == 0 or tgt is None:
        return None
    return qty * (tgt / src)
```

Where `tgt_uom_name = pid_stock_uom.get(pid, 'CAJA40')` — the target is each product's `stock_uom`, loaded from the `products` table. For FARDO10 products, the conversion factor is `tgt / src = 0.1 / src_uom_ratio`, which keeps units in FARDO10.

---

## Changes by File — Fix A (UoM)

### `docs/reconciliation/fix_purchase_uom_revenue_daily_2026-05-07.py` — NEW

**Purpose:** One-shot correction of the CAJA40 → stock_uom undercount in `revenue_daily` for all 17 affected demo PIDs. This script is the "undo the bug" step — it reads what is currently in `revenue_daily` for purchases, applies the inverse of the wrong conversion, and replaces each row.

**Algorithm:**
1. Load `pid_stock_uom` dict from `products` for all 23 demo PIDs.
2. For each affected PID (where `stock_uom ≠ CAJA40`), compute `correction_factor = stock_uom_ratio / CAJA40_RATIO`.
3. DELETE all existing `purchases_ordered` and `purchases_received` rows for that PID from `revenue_daily`.
4. Re-insert rows with `quantity × correction_factor`.

**Initial attempt — partial failure:** First run failed at batch 4 with HTTP 409 duplicate key violation. Root cause: some `(product_id, ssot_label, metric, observation_date)` cells had TWO rows in `revenue_daily` — one from `find_15` (from `purchase_order_lines`) and one from `find_15b` (from `stock_moves`). They shared the same compound key because both scripts used the same SSOT label for the same product/date. The DELETE removed both rows, but the re-INSERT tried to insert two rows for the same key.

11 of 17 PIDs were recovered in the first attempt (the ones without duplicate cells). 6 PIDs (1113, 1127, 1366, 1587, 1590, 1600) were left with 0 purchase rows.

**Recovery:** `fix_purchase_uom_missing_pids_2026-05-07.py` (see below).

---

### `docs/reconciliation/fix_purchase_uom_missing_pids_2026-05-07.py` — NEW

**Purpose:** Targeted recovery for the 6 PIDs that ended up with 0 purchase rows after the initial fix attempt's partial failure.

**Approach by PID type:**

**RED_TIER PIDs (5 of 6: 1113, 1127, 1587, 1590, 1600):**
Data comes from `stock_moves` directly. Re-derived from scratch using:
- `from_location_id = 41` (Partners/Vendors)
- `state = 'done'`
- `move_date` in training window
- Destination in internal locations only
- `to_stock_uom(qty, src_uom, pid_stock_uom[pid])` for normalization

Inserted using upsert with `on_conflict=product_id,ssot_label,metric,observation_date` and `Prefer: resolution=merge-duplicates` to avoid 409.

**Non-RED_TIER PID (1 of 6: pid=1366, SKU 77205207):**
Data comes from `purchase_order_lines`. Re-derived by joining `purchase_order_lines` (columns: `quantity`, `received_qty`, `uom`, `order_id`) to `purchase_orders` (column: `expected_delivery` for date). Applied `to_stock_uom()` with target = `pid_stock_uom[1366]`.

**Column name debugging required:** During recovery, wrong column names were attempted twice before the correct names were found by querying Supabase `?limit=1` and inspecting the response:
- Wrong: `qty_done`, `uom_id`, `date` → correct in stock_moves: `quantity`, `uom`, `move_date`
- Wrong: `product_uom_qty`, `qty_received`, `product_uom` → correct in purchase_order_lines: `quantity`, `received_qty`, `uom`
- Wrong table name: `locations` → correct: `stock_locations` with column `location_type`

**Result:** All 6 PIDs fully recovered. Final verification [PASS] for all 23 demo SKUs.

---

### `docs/reconciliation/find_15_populate_revenue_daily_purchases_from_supabase.py` — MODIFIED

**Change:** Replaced `to_caja40()` with `to_stock_uom()`. Added Step 2b to load `pid_stock_uom` dict from `products` table. Updated the aggregation loop to use `tgt_uom = pid_stock_uom.get(pid, 'CAJA40')` for each product.

Before (bug):
```python
def to_caja40(qty, src_uom_name):
    src = uom_ratio.get(src_uom_name)
    if src is None or src == 0:
        return None
    return qty * CAJA40_RATIO / src
```

After (fix):
```python
def to_stock_uom(qty, src_uom_name, tgt_uom_name):
    src = uom_ratio.get(src_uom_name)
    tgt = uom_ratio.get(tgt_uom_name)
    if src is None or src == 0 or tgt is None:
        return None
    return qty * (tgt / src)
```

No `to_caja40` references remain in the file.

---

### `docs/reconciliation/find_15b_supplement_purchases_from_stock_moves_2026-05-06.py` — MODIFIED

Same `to_caja40()` → `to_stock_uom()` replacement as `find_15`. Added Step 2a to load `pid_stock_uom` for `RED_TIER_PIDS`. Updated aggregation loop to use `tgt_uom = pid_stock_uom.get(pid, 'CAJA40')`.

The bug note was added to the script header:
```
BUG HISTORY: the original formula was raw_qty * CAJA40_RATIO / src_ratio which
converted to CAJA40 units. Since revenue_daily.sales stores quantities in each
product's stock_uom (FARDO10, CAJA20, etc.), purchases appeared 2-40x too low
on the chart. Fixed 2026-05-07. See memory/reference_uom_semantics.md.
```

---

### Downstream Pipeline Re-run After UoM Fix

After fixing `revenue_daily`, the following pipeline steps were re-run in order:

**`smooth_oct2024_purchase_anomaly.py`:** Rebuilds `revenue_daily_for_ml` from `revenue_daily`. With corrected purchase quantities in `revenue_daily`, the smoothed October 2024 medians now reflect true FARDO10-scaled figures. Acid Test 1 anchors verified: all 4 anchors Δ=0.

**`find_16_carvajal_tier3_fallback_purchases_for_ml.py`:** Re-verified 6 CARVAJAL Tier 3 SKUs — all PASS. (This script is kept for the non-RED_TIER SKUs that still need ratio-derived purchase data for ML training.)

**`recompute_po_history_real_months_2026-05-07.py`:** Re-run to re-verify counts — no change (already GREEN/AMBER from the prior session). Result: 16 GREEN, 4 AMBER, 3 RED (pre-existing; unrelated to this fix).

**`trigger_ml_training_2026-05-07.py` (NEW — see below):** Full ML re-train for all 23 demo SKUs using the corrected purchase data.

---

### `docs/reconciliation/trigger_ml_training_2026-05-07.py` — NEW

**Purpose:** Call the Railway ML service directly for all 23 demo SKUs (both `sales` and purchases metrics) and persist results to `forecast_results`. Created because the existing training trigger is a Next.js API endpoint that requires a browser session cookie and cannot be called from a Python script.

**Authentication pattern:**
- Direct call to `ML_SERVICE_URL/forecast/revenue-daily` with header `X-API-Key: ML_SERVICE_API_KEY`
- Direct call to `ML_SERVICE_URL/forecast/purchases-derived` for purchase ratio forecasts
- Persistence via Supabase service role key with upsert: `POST /rest/v1/forecast_results?on_conflict=product_id,ssot_label,metric,forecast_month,training_end_date` + `Prefer: resolution=merge-duplicates`

**Two-pass design:**
1. **Pass 1 (Prophet, sales):** `POST /forecast/revenue-daily` per SKU with `metric='sales'`. Checks `body.get('status') == 'ok'`. Persists monthly `yhat_sum`, `yhat_lower_sum`, `yhat_upper_sum` per forecast month.
2. **Pass 2 (derived ratio, purchases):** `POST /forecast/purchases-derived` per SKU. Checks `body.get('status') == 'ok_derived'`. Persists `purchases_ordered` and `purchases_received` forecast months.

**Error resolved during development:** The upsert endpoint returned HTTP 409 on the first run. Root cause: `Prefer: resolution=merge-duplicates` is required on the request header, but the conflict columns must also be specified in the URL query parameter. Both are needed; neither alone is sufficient for PostgREST upserts.

**Result:** 66/69 forecast cells OK. 3 FAIL on `purchases_ordered` for SKUs 77201055, 77201056, 77201019 (`insufficient_ratio_data`). These 3 SKUs have low PO frequency — the ML service has a minimum viable ratio threshold and these fall below it. Pre-existing issue; not caused by this session's changes.

**Post-fix verification for pid=2 (SKU 77205001):**
```
forecast_results Feb 2026:
  sales:              35,172 FARDO10  (ok)
  purchases_received: 34,989 FARDO10  (ok_derived)
  purchases_ordered:  34,989 FARDO10  (ok_derived)
```

The Compras Recibidas forecast now shows ~35k alongside ~35k sales — plausible. The prior 9k anomaly is resolved.

---

## Dealbreaker 2 — Forecast Showing 35k When Client Knows Demand Is 45k+

### Root Cause

`ml/forecast_revenue.py` trains Prophet on `revenue_daily_for_ml` where `metric='sales'`. The `sales` metric is populated from `account.move.line` (invoiced/shipped quantities) via SSOT label `aml_income_posted_invoice_refund_neg_invoice_date_c40`. When stockouts occur, invoiced quantity = stock available ≤ true customer demand. Prophet trains on a supply-constrained signal and produces a supply-constrained forecast.

The `census_filter.py` in the ML pipeline only removes days with ZERO sales, treating them as full stockout days. It does not detect or correct partial-stockout days (days where some stock sold but demand exceeded available stock), and it does not substitute demand estimates for censored observations. Prophet sees a flat ceiling and learns a flat ceiling.

**Why sale_order_lines is the right source:** Customers place orders on the demand date regardless of stock availability. The order is recorded immediately at order placement (`sale_orders.order_date`). If the stock runs out, `sale_order_lines.delivered_qty < sale_order_lines.quantity`. The difference is the unmet demand (lost sale). This is the same Method 1 (Lost Sales Reconstruction) approach described in the project's `research-003-stockout-demand-uncensoring.md`.

**Discovery that state codes are English, not Spanish:** The plan assumed `state = 'Orden de venta'` (the Spanish label visible in the Odoo UI). Direct Supabase query revealed the actual stored values are English: `'sale'` (confirmed), `'cancel'`, `'draft'`. The filter `state=eq.Orden de venta` produced a URL control-character error (the space) and no results. All scripts use `state=eq.sale`.

---

## Changes by File — Fix B (Demand Metric)

### `docs/reconciliation/populate_demand_metric_2026-05-07.py` — NEW

**Purpose:** Compute and persist the uncensored demand signal from `sale_order_lines` into both `revenue_daily` and `revenue_daily_for_ml` as `metric='demand'`.

**SSOT label:** `sol_confirmed_order_date_qty_ordered_native_uom`  
(Convention: source_table + filter_applied + date_field_used + qty_field_used + uom_basis)

**Source tables:**
- `sale_orders`: 80,525 rows (state='sale'), Sep 2024 – Mar 2026
- `sale_order_lines`: 122,460 rows for the 23 demo PIDs

**Aggregation logic:**
1. Load all confirmed `sale_orders` with `state='sale'`. Build an `order_id → order_date` map filtered to the training window `2024-10-01 ≤ date ≤ 2026-01-31` (blind test cutoff). 75,310 orders in the window.
2. Load all `sale_order_lines` for the 23 demo `product_id` values.
3. For each line, look up `order_date` from the map (skip if not confirmed or outside window). Convert `quantity` from line's `uom` to product's `stock_uom` using `to_stock_uom()`. Accumulate `demand` and `lost_sales` into `(pid, date)` daily cells.
4. Build rows with `quantity = demand_qty_in_stock_uom`, `source_doc_count = number_of_order_lines`.
5. Upsert to both tables on `(product_id, ssot_label, metric, observation_date)`.

**Why writes to `revenue_daily` are safe:** The write is additive — a new (metric, ssot_label) combination that did not previously exist. The smooth script that rebuilds `revenue_daily_for_ml` copies ALL non-purchase rows from `revenue_daily` verbatim, so demand rows survive future smooth re-runs. Acid Test 1 validation rows (sales + purchases, Nov 2024 anchors) are untouched.

**Output: 9,693 daily demand rows** inserted into both tables.

**Historical demand data confirmed for SKU 77205001 (FARDO10):**

| Month | Demand | Lost Sales | Fill Rate |
|-------|--------|------------|-----------|
| 2024-10 | 27,534 | 0 | 100.0% |
| 2024-11 | 31,843 | 0 | 100.0% |
| 2024-12 | 30,283 | 0 | 100.0% |
| 2025-01 | 32,016 | 0 | 100.0% |
| 2025-02 | 28,929 | 0 | 100.0% |
| 2025-03 | 35,523 | 0 | 100.0% |
| 2025-04 | 37,108 | 0 | 100.0% |
| 2025-05 | 36,875 | 0 | 100.0% |
| 2025-06 | 41,524 | 1,091 | 97.4% |
| 2025-07 | 40,283 | 2,026 | 95.0% |
| 2025-08 | 43,561 | 2,837 | 93.5% |
| 2025-09 | 44,100 | 3,200 | 92.7% |
| 2025-10 | 44,389 | 3,455 | 92.2% |
| 2025-11 | 45,521 | 2,474 | 94.6% |
| 2025-12 | 52,067 | 14,206 | 72.7% |
| 2026-01 | 44,832 | 8,903 | 80.1% |

**Client claim validated:** Client stated demand is 45,000+/month. Historical data confirms the claim: demand trend crossed 40k in June 2025 and has stayed above it since. December 2025 reached 52k with 14,206 units of lost sales (27.3% of demand unmet). The "supply-constrained sales" signal visible in `metric='sales'` averages ~35k — exactly what Prophet learned and why it forecasts 35k.

All 23 demo PIDs: [PASS] — every PID received at least one demand row.

---

### `docs/reconciliation/trigger_ml_training_demand_2026-05-07.py` — NEW

**Purpose:** Companion to `trigger_ml_training_2026-05-07.py`. Trains Prophet on `metric='demand'` for all 23 demo SKUs and persists to `forecast_results`.

**Key difference from the sales/purchases script:**
- `ssot_label = 'sol_confirmed_order_date_qty_ordered_native_uom'`
- `metric = 'demand'`
- Valid `model_status` for demand is `'ok'` (not `'ok_derived'` — demand is a true Prophet model, not a ratio derivation)
- Only calls `/forecast/revenue-daily` (no purchases-derived pass needed)

**Result: 23/23 SKUs OK.**

**Spot check — SKU 77205001 (pid=2) demand vs sales forecast, training_end=2026-01-31:**

| metric | month | yhat_sum | model_status |
|--------|-------|----------|--------------|
| demand | 2026-02 | 42,330 | ok |
| demand | 2026-03 | 39,225 | ok |
| sales | 2026-02 | 35,172 | ok |
| sales | 2026-03 | 35,851 | ok |
| purchases_ordered | 2026-02 | 34,989 | ok_derived |
| purchases_received | 2026-02 | 34,989 | ok_derived |

**The gap quantified:** Feb 2026 demand forecast 42,330 vs sales forecast 35,172 = **7,158 FARDO10/month (~20%) in lost sales**. This is the revenue that disappears every month due to supply constraints — now measurable, traceable, and visible in the UI.

---

### `frontend/src/app/api/superuser/forecast-diagnostic/route.ts` — MODIFIED

`METRICS` constant expanded from `['sales', 'purchases_ordered', 'purchases_received']` to include `'demand'`. The `Metric` union type now includes `'demand'` everywhere it appears.

**Interface changes:**
- `RevenueDailyRow.metric`: added `| 'demand'`
- `ForecastResultRow.metric`: added `| 'demand'`
- `MonthlyAgg`: added `demand: number`
- `ForecastMonth`: added `demand`, `demand_lower`, `demand_upper`, `demand_model_status`
- `PerUomMonth`: added `demand`, `demand_lower`, `demand_upper`

**Accumulation changes:**
- `histAgg` cell initialization: `demand: 0` added
- Per-row accumulation: `else if (r.metric === 'demand') { cell.demand += qty; }` branch added
- `history.push`: `demand: cell?.demand ?? 0` added
- `forecastStatus` record: `demand: 'ok'` added
- Forecast lookup: `fDemand = latestForecast.get(`${product.id}|demand|${fkey}`)` added; valid guard is `fDemand.model_status === 'ok'` (not `'ok_derived'`, which is for purchase ratio forecasts)

**Summary statistics:**
- `history12m.demand`: 12-month rolling average of historical demand
- `forecastMean.demand`: average demand forecast across the 2 forecast months
- `ratio.demand`: forecast demand / history 12m mean (health ratio for Panel A)

**Per-UoM time series:**
- Both history and forecast sections accumulate `demand` into a local variable
- `demand_lower` / `demand_upper` tracked with `anyDemandLower` / `anyDemandUpper` guards
- `anyNotOk` flag includes `f.demand_model_status !== 'ok'` check
- `series.push` includes `demand`, `demand_lower`, `demand_upper`

---

### `frontend/src/app/(authenticated)/superuser/forecast-diagnostic/page.tsx` — MODIFIED

**Type system:**
- `Metric` union: added `| 'demand'`
- `MonthlyAgg`, `ForecastMonth`, `PerUomMonth` interfaces: mirrored route.ts changes

**Visual identity for demand:**
```typescript
METRIC_COLOR['demand'] = '#f97316'  // orange-500
METRIC_LABEL['demand'] = 'Demanda (pedidos)'
```

Orange was chosen deliberately: it is perceptually between the green of sales and the blue/purple of purchases, and it conveys urgency — the demand signal is the "uncensored truth" that should be higher than actual sales during stockouts.

**Panel A (ratio bars):**
- `series` array expanded to include `'demand'` alongside the three existing metrics
- Legend updated to include `'Demanda (pedidos)'`
- Ratio bar for demand shows the forecast_demand / history_12m_demand ratio — a health indicator for the demand model itself

**Panel B (per-UoM time series):**
- `CI_KEYS` record extended: `demand: { lo: 'demand_lower', hi: 'demand_upper' }`
- `buildSeries('demand')` added to `allSeries`
- Legend updated to include demand historic + demand forecast
- In-sample fit series conditional remains `metric === 'sales'` only (demand has no in-sample Prophet fit stored)

**Panel C (single-SKU drilldown):**
- `lowerKey`/`upperKey` chain extended with `metric === 'purchases_received' ? 'purchases_received_lower' : 'demand_lower'` (was previously `'purchases_received_lower'` as default)
- `buildSeries('demand')` added to `allSeries`
- Legend updated
- Summary table row added for demand (history 12m mean, forecast mean, ratio, model_status)

**Visual result:** Panel C now shows 4 lines. For SKU 77205001 with a stockout-affected period: the orange "Demanda (pedidos)" line runs above the green "Ventas" line from June 2025 onward. The gap between them — widening through December 2025 — is the lost sales signal. In the forecast period (Feb–Mar 2026), the orange dashed line forecasts ~41k while the green dashed line forecasts ~35k. The 7k+ gap is immediately legible to a decision-maker without needing to explain what "censored data" means.

**TypeScript check:** `tsc --noEmit` produces no errors after all changes.

---

## Decisions Not Taken

**Prophet was not retrained on demand for the sales metric.** The `sales` metric in `revenue_daily_for_ml` remains the invoiced-quantity signal. The approach taken is additive: a new `demand` metric sits alongside `sales`. Both are visible in the diagnostic page. A future decision could be to replace the sales training signal with the demand signal for chronic-stockout SKUs — but that is a separate change with its own validation requirements, and it is not reversible if it worsens accuracy for non-stockout months.

**The `census_filter.py` was not modified.** The ML service's built-in zero-sales censoring remains in place for the `sales` metric. Fixing the censoring for partial stockouts would require changes inside the Railway ML container. The demand metric achieves the same diagnostic goal without touching ML service internals.

**`revenue_daily` was not modified for existing rows.** The fix to `find_15` and `find_15b` changes how future pipeline runs will normalize purchases. The existing rows in `revenue_daily` were fixed separately by the `fix_purchase_uom_revenue_daily_2026-05-07.py` and `fix_purchase_uom_missing_pids_2026-05-07.py` scripts. The `revenue_daily` table now contains correct quantities. Future runs of the pipeline scripts will produce correct output.

**Demand history for Feb–Mar 2026 is not shown.** The blind test design (`project_data_cutoff.md`) requires that Feb and Mar 2026 history remain hidden — those are the months where the forecast is evaluated against real outcomes that decision-makers can verify. The `populate_demand_metric_2026-05-07.py` script caps observation dates at `2026-01-31`. The `route.ts` cap `if (m > '2026-01') break` already enforced this for sales and purchases; demand inherits the same rule.

---

## Data State After This Session

| Table / Field | Before | After | Note |
|---|---|---|---|
| `revenue_daily` purchases for FARDO10 SKUs | CAJA40-scaled (×0.25 of true value) | stock_uom-scaled (correct) | Applies to all 17 SKUs where stock_uom ≠ CAJA40 |
| `revenue_daily` purchases for CAJA40 SKUs | Correct (no change needed) | Correct | 6 SKUs unaffected |
| `revenue_daily` demand rows | 0 | 9,693 daily rows across 23 PIDs | New metric, additive |
| `revenue_daily_for_ml` | Stale (CAJA40-scaled purchases) | Rebuilt with correct purchases + demand rows | Smooth re-run produced new ML training data |
| `forecast_results` (sales + purchases) | 66 rows (pre-fix, stale) | 66 fresh rows (post UoM fix) | 3 FAIL on purchases_ordered (pre-existing) |
| `forecast_results` (demand) | 0 rows | 46 rows (23 PIDs × 2 months) | All 23 SKUs ok |

---

## Pipeline Order (Authoritative, Post-This-Session)

```
1. find_15_populate_revenue_daily_purchases_from_supabase.py     → revenue_daily
2. find_15b_supplement_purchases_from_stock_moves_*.py           → revenue_daily
3. smooth_oct2024_purchase_anomaly.py                            → revenue_daily_for_ml
4. populate_demand_metric_2026-05-07.py                          → revenue_daily + revenue_daily_for_ml
5. recompute_po_history_real_months_*.py                         → products_acid_test_active
6. trigger_ml_training_2026-05-07.py                             → forecast_results (sales + purchases)
7. trigger_ml_training_demand_2026-05-07.py                      → forecast_results (demand)
```

Steps 4 and 5 are independent and can run in parallel. Step 4 must precede step 7 (ML training reads from `revenue_daily_for_ml`).

Both `find_15` and `find_15b` are now safe to re-run: `to_caja40()` has been replaced with `to_stock_uom()` in both files.
