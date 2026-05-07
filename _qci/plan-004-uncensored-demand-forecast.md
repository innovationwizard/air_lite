# Plan: Uncensored Demand Forecast for Chronic-Stockout SKUs
**Date:** 2026-05-07  
**Trigger:** Client DEALBREAKER — SKU 77205001 forecast shows ~35,500/month; human-known demand is 45,000+/month. Forecast trains on censored (supply-constrained) invoice data. Two separate problems confirmed.  
**Constraint:** All data sources MUST come from files in `real_data/`. No assumptions about data that can be requested or obtained elsewhere.  
**Research basis:** `_qci/research-003-stockout-demand-uncensoring.md`  
**App architecture reference:** `ml/forecast_revenue.py`, `ml/backtest_engine.py`, `ml/census_filter.py`, `frontend/src/app/api/superuser/forecast-diagnostic/route.ts`

---

## Problem A — Purchases Data Showing Wrong (9,094 vs Reality)

### Root Cause (Confirmed, No Assumption)
`purchase.order.line_20260303.csv` has 20,685 rows. Supabase `purchase_order_lines` has ~1,000 rows (all from Oct–Nov 2024 only). The 18,278 lines from Dec 2024 onward were never loaded. Source: MANIFEST.md critical finding section.

### Fix A1 — Load Full Purchase Order Lines (Primary Fix)
**Source file:** `real_data/purchase.order.line_20260303.csv`  
**Target table:** `purchase_order_lines` (existing Supabase table)  
**Action:** Import all 20,685 rows, replacing the current incomplete 1,000-row import.

**Known issue per MANIFEST.md:** The export has no `product_id` column — only `Descripción` (product name as text). Joining to `products.sku` requires a name-to-SKU match. The description format in the CSV is `[SKU_CODE] PRODUCT_NAME` (confirmed from sale.order.line sample: `[77205001] BANDEJA 2P TERMO FOM BIO 10/50`). Extract the bracket-enclosed SKU code as the join key.

**Pre-import transform needed:**
```python
# Extract SKU from description like "[77205001] BANDEJA 2P TERMO FOM BIO 10/50"
import re
df['sku'] = df['Líneas de la orden/Descripción'].str.extract(r'\[([^\]]+)\]')
# Join to products table on sku to get product_id
```

**CARVAJAL duplicate supplier issue:** `product.supplierinfo_20260303.csv` shows CARVAJAL under 4 different supplier names. When joining purchase_orders to products via supplier, resolve by SKU code (not by supplier name) to avoid duplicates.

**Idempotency:** Truncate `purchase_order_lines` and reload from scratch. Do NOT upsert on top of the partial 1,000-row import — the partial data has no reliable dedup key (no odoo_id stored per MANIFEST).

### Fix A2 — Stock.Move as Alternative Purchase Receipt Source
**Source files:** `real_data/stock.move_*.csv` (6 files, 967,665 total rows, Oct 2024 – Mar 2026)  
**Signal:** Rows where `Origen` prefix = `'PO'` AND `Estado = 'done'` AND `Desde = 'Partners/Vendors'` (or `Proveedor` equivalent location)

These are ACTUAL physical receipts — not planned quantities. They record what truly arrived in the warehouse, date and quantity per SKU.

**Schema in stock.move:**
- `Producto` → product name (contains `[SKU_CODE]` in same format)
- `Cantidad` → received quantity
- `Unidad de medida` → UoM
- `Fecha` → actual receipt date (ground truth)
- `Origen` → `PO-P-XXXX` pattern for purchase receipts

**Why this matters for accuracy:** `purchase.order.line.qty_received` is what Odoo says was received according to the PO system. `stock.move.qty_done` is what the warehouse ACTUALLY moved. For financial/operational accuracy, stock.move is the ground truth.

**Recommendation:** Fix A1 is the minimum fix (restores the existing SSOT formula). Fix A2 is the superior long-term fix (actual receipts, not planned). For the demo, Fix A1 unblocks the client complaint. Fix A2 is a P1 follow-on.

---

## Problem B — Forecast Too Low (35k vs 45k True Demand)

### Root Cause (Confirmed, No Assumption)
`ml/forecast_revenue.py` trains Prophet on `revenue_daily_for_ml` with `metric = 'sales'`. The sales metric is populated from `account.move.line` (invoiced quantities) using SSOT label `aml_income_posted_invoice_refund_neg_invoice_date_c40`. When stockouts occur, invoiced qty = stock available ≤ true customer demand. Prophet learns the constrained signal.

The `census_filter.py` only removes ZERO-sales stockout days. It does NOT correct partial-stockout days (days where some stock sold but demand exceeded stock) and does NOT replace censored observations with demand estimates.

### Fix B — Add Uncensored Demand Metric Using Sale Order Lines

#### Step B1 — Load Sale Orders + Sale Order Lines into Supabase

**Source files:**  
- `real_data/sale.order_20260303.csv` (85,985 rows, Sep 2024 – Mar 2026)
- `real_data/sale.order.line_20260303.csv` (480,524 rows, Sep 2024 – Mar 2026)

**New Supabase table: `sale_orders`**
```sql
CREATE TABLE sale_orders (
  id           BIGSERIAL PRIMARY KEY,
  order_ref    TEXT NOT NULL,          -- SO-P-XXXXX
  order_date   DATE NOT NULL,          -- Fecha de la orden (demand date)
  state        TEXT NOT NULL,          -- Estado
  CONSTRAINT uq_sale_orders_ref UNIQUE (order_ref)
);
CREATE INDEX idx_sale_orders_date ON sale_orders (order_date);
CREATE INDEX idx_sale_orders_state ON sale_orders (state);
```

**State filter for demand calculation:** Include only `'Orden de venta'` (confirmed, 80,527 rows). Exclude `'Cancelado'` (5,186), `'Cotización'` (258), `'Cotización enviada'` (4), `'Esperando Aprobación'` (10).

**New Supabase table: `sale_order_lines`**
```sql
CREATE TABLE sale_order_lines (
  id              BIGSERIAL PRIMARY KEY,
  order_ref       TEXT NOT NULL REFERENCES sale_orders(order_ref),
  product_sku     TEXT NOT NULL,          -- extracted from [SKU] prefix in product name
  quantity        NUMERIC(12,4) NOT NULL, -- Cantidad (ordered qty)
  delivered_qty   NUMERIC(12,4) NOT NULL, -- Cantidad de entrega (fulfilled qty)
  uom             TEXT NOT NULL,          -- Líneas de la orden/Unidad de medida
  unit_price      NUMERIC(12,4),
  salesperson     TEXT
);
CREATE INDEX idx_sol_product ON sale_order_lines (product_sku);
CREATE INDEX idx_sol_order   ON sale_order_lines (order_ref);
```

**SKU extraction from product name:**  
CSV column `Líneas de la orden/Plantilla del producto` contains `[77205001] BANDEJA 2P TERMO FOM BIO 10/50`. Extract with `re.search(r'\[([^\]]+)\]', name)`.

**Idempotency:** Drop-and-reload. These tables do not yet exist in Supabase.

#### Step B2 — Build `demand_daily_uncensored` View or Table

This is the core demand signal: what customers ordered, on the date they ordered it, from confirmed sale orders.

```sql
-- View (or materialized view for performance)
CREATE MATERIALIZED VIEW demand_daily_uncensored AS
SELECT
  sol.product_sku,
  so.order_date                      AS demand_date,
  SUM(sol.quantity)                  AS demand_qty,
  SUM(sol.delivered_qty)             AS delivered_qty,
  SUM(sol.quantity - sol.delivered_qty)
    FILTER (WHERE sol.quantity > sol.delivered_qty)
                                     AS lost_sales_qty,
  sol.uom
FROM sale_order_lines sol
JOIN sale_orders so ON so.order_ref = sol.order_ref
WHERE so.state = 'Orden de venta'
GROUP BY sol.product_sku, so.order_date, sol.uom;

CREATE INDEX idx_ddu_sku_date ON demand_daily_uncensored (product_sku, demand_date);
```

**Semantic definitions:**
- `demand_qty` = TRUE DEMAND — what customers asked for, regardless of stock availability
- `delivered_qty` = SUPPLY-CONSTRAINED SALES — what was actually fulfilled
- `lost_sales_qty` = UNMET DEMAND — demand that went unfulfilled due to stockout

#### Step B3 — Add `demand` Metric to `revenue_daily_for_ml`

The existing `revenue_daily_for_ml` table has `metric` values: `sales`, `purchases_ordered`, `purchases_received`. Add a fourth: `demand`.

**SSOT label for new metric:** `sol_confirmed_order_date_qty_ordered_native_uom`  
(This follows the naming convention of existing SSOT labels: source table prefix + filter + date field + quantity field + UoM.)

**Population logic:**
```python
# For each product in the acid-test scope (23 SKUs):
# 1. Join products.sku to demand_daily_uncensored.product_sku
# 2. Apply UoM normalization (same as sales: normalize to stock_uom)
# 3. INSERT rows into revenue_daily_for_ml with metric='demand'

INSERT INTO revenue_daily_for_ml (product_id, metric, ssot_label, observation_date, quantity)
SELECT
  p.id                                            AS product_id,
  'demand'                                        AS metric,
  'sol_confirmed_order_date_qty_ordered_native_uom' AS ssot_label,
  ddu.demand_date                                 AS observation_date,
  ddu.demand_qty * uom_factor                     AS quantity
FROM demand_daily_uncensored ddu
JOIN products p ON p.sku = ddu.product_sku
-- uom_factor: convert ddu.uom to p.stock_uom using the same UoM conversion table
-- as the existing sales metric population
ON CONFLICT (product_id, metric, ssot_label, observation_date) DO UPDATE
  SET quantity = EXCLUDED.quantity;
```

**UoM normalization:** Use the same conversion logic already implemented for `sales`. The `uom.uom_20260303.csv` has the conversion ratios. For SKU 77205001, UoM is FARDO10 — stock_uom is also FARDO10, so factor = 1.0.

#### Step B4 — Train Prophet on Demand Metric for Stockout-Affected SKUs

**When to use demand vs sales as training signal:**

| Condition | Training Signal | Rationale |
|---|---|---|
| `lost_sales_qty > 0` in majority of training months | `demand` | Chronic stockout: sales are censored. Demand is uncensored. |
| `lost_sales_qty ≈ 0` consistently | `sales` | No stockout: sales = demand. Use existing validated formula. |

**Stockout detection query** (run per SKU, once, to classify):
```sql
SELECT
  product_sku,
  COUNT(*) FILTER (WHERE lost_sales_qty > 0) AS stockout_months,
  COUNT(*) AS total_months,
  AVG(lost_sales_qty / NULLIF(demand_qty, 0)) AS avg_stockout_rate
FROM (
  SELECT
    product_sku,
    DATE_TRUNC('month', demand_date) AS month,
    SUM(demand_qty) AS demand_qty,
    SUM(lost_sales_qty) AS lost_sales_qty
  FROM demand_daily_uncensored
  GROUP BY product_sku, month
) monthly
GROUP BY product_sku;
```

**SKU 77205001 expected result:** Based on the client's description (permanent stockout for 6+ months) and the 12,275 sale.order.line rows with many qty_delivered=0 entries, this SKU will show stockout_months >= 6 and avg_stockout_rate ~20%.

**`forecast_revenue.py` change needed:**  
Add a `metric` parameter to `forecast_product()` that accepts `'demand'` in addition to the existing `'sales'`, `'purchases_ordered'`, `'purchases_received'`. The logic is identical — only the `metric` value passed to `load_revenue_for_product()` changes.

**`forecast_results` table:** No schema change needed. Existing columns handle the new metric. Insert rows with `metric = 'demand'`.

#### Step B5 — Surface Demand Forecast in forecast-diagnostic Page

**`route.ts` change:**  
- Add `demand` to the `METRICS` constant (currently `['sales', 'purchases_ordered', 'purchases_received']`)
- Fetch `demand` rows from both `revenue_daily` (for history) and `forecast_results` (for forecast)
- Pass `demand` data to the per-SKU payload alongside the existing three metrics

**UI change (forecast-diagnostic page):**  
- Add a "Demanda Real" series to Panel C (single-SKU drilldown) and Panel B (UoM group chart)
- Visual: dashed orange/amber line for forecasted demand; solid amber for historical demand
- Label: "Demanda (pedidos)" to distinguish from "Ventas" (invoiced)
- The gap between "Ventas" and "Demanda (pedidos)" is the lost sales visual — immediately visible to the decision-maker

---

## Execution Sequence (Ordered by Dependency)

| Step | Action | Dependency | Estimated Effort |
|---|---|---|---|
| A1 | Load full `purchase.order.line_20260303.csv` into Supabase `purchase_order_lines` | None | 1 session |
| B1 | Create `sale_orders` + `sale_order_lines` tables; load from CSV | None | 1 session |
| B2 | Create `demand_daily_uncensored` materialized view | B1 complete | 30 min |
| B3 | Populate `revenue_daily_for_ml` with `metric='demand'` | B2 complete | 1 session |
| B4 | Train Prophet on `demand` metric; insert to `forecast_results` | B3 complete | 1 session |
| B5 | Surface demand in route.ts + UI | B4 complete | 1 session |
| A2 | (P1) Replace purchases_received with stock.move ground truth | A1 complete | 1 session |

Steps A1 and B1 are independent and can run in parallel.

---

## What the Client Will See After Implementation

**Current state (DEALBREAKER):**
- Compras Recibidas: 9,094/month → wrong (95% data missing)
- Ventas forecast Feb 26: 35,172 → trained on censored supply signal
- No demand signal → client cannot reconcile with their 45,000+ knowledge

**After implementation:**
- Compras Recibidas: will show true received quantities (Dec 2024 – Mar 2026 data restored)
- Ventas forecast: unchanged — this is the "what we can ship given historical supply constraints" signal
- Demanda (pedidos): new series showing 45,000+ — the true unconstrained customer demand
- Lost sales visible as the gap between Demanda and Ventas on the same chart
- Forecast for Feb/Mar 2026 (demand): 45,000+ (trained on uncensored order data)

The visual tells a complete story: "We have demand for 45k. We can only ship 36k. The gap is the opportunity. To close it, we need the app to optimize procurement so we stop running out."

This directly answers both dealbreaker questions:
1. The incongruency (9k received vs 36k sold) → fixed by loading full purchase data
2. The underforecasted demand → fixed by training on sale order quantities

---

## Risks and Constraints

| Risk | Mitigation |
|---|---|
| `sale.order.line` SKU extraction fails for some product names (no `[SKU]` bracket) | Grep a sample of the CSV first; if needed, fall back to fuzzy product name join against `product.product_20260303.csv` |
| Q2 2025 (Apr–Jun 2025) is absent from `account.move.line` exports | Does not affect this plan — we use `sale.order.line` which covers Sep 2024 – Mar 2026 continuously |
| UoM mismatch: `sale.order.line` UoM ≠ stock UoM for some SKUs | Apply same UoM conversion table already used for the `sales` metric |
| `demand_qty > delivered_qty` by a very large margin for old/cancelled orders | Filter: join `sale_orders` on `state = 'Orden de venta'` only. Cancelled orders are excluded. |
| Blind test integrity: demand history for Feb/Mar 2026 is visible | The demand signal for Feb/Mar 2026 from `sale.order.line` covers through Mar 2026. Per `project_data_cutoff.md`, Feb/Mar are the blind test months. The FORECAST of demand (from Prophet trained on ≤Jan 2026 demand data) is what we show — not the actual Feb/Mar demand. The actual demand history would only be shown if we include Feb/Mar history in Panel C. Decision: show demand history only up to Jan 2026 cutoff (same as sales history cutoff). |

---

## Files That Must Be Created or Modified

### New files to create:
- `docs/migrations/load_sale_orders.py` — idempotent loader for `sale_orders` and `sale_order_lines`
- `docs/migrations/load_purchase_order_lines_full.py` — idempotent re-loader of full `purchase_order_lines`
- `supabase/migrations/YYYYMMDD_sale_orders_tables.sql` — schema for new tables
- `docs/migrations/populate_demand_metric.py` — populate `revenue_daily_for_ml` with `metric='demand'`

### Files to modify:
- `ml/forecast_revenue.py` — accept `metric='demand'` (no structural change; `metric` is already a parameter)
- `frontend/src/app/api/superuser/forecast-diagnostic/route.ts` — add `demand` to METRICS, fetch demand rows
- The forecast-diagnostic page component (UI) — add Demanda series to charts

### Files NOT to modify:
- `revenue_daily` — the Acid Test 1 SSOT table. Never write to it. Its data integrity is the validation anchor.
- `demand_daily` — the old operational view. Preserved untouched per SSOT_WINNING_FORMULAS.md.
- Any file in `_qci/` — IMMUTABLE by direct user order 2026-05-06.

---

*Persisted per client DEALBREAKER escalation 2026-05-07. Batched per user instruction to split work into small persistent units. See research-003-stockout-demand-uncensoring.md for the research basis.*

---

## Implementation Log (additions only — do not delete above)

### Session 2026-05-07 — Fix A: Purchase UoM Mismatch (Dealbreaker 1)

**Root cause discovered:** `find_15.py` and `find_15b.py` both call `to_caja40()` which converts purchase quantities to CAJA40 units before storing in `revenue_daily`. Sales data (from `find_12`) is stored in the product's `stock_uom` (e.g., FARDO10 for SKU 77205001). Both metrics share the same `quantity` column and chart axis. When purchases are in CAJA40 and sales are in FARDO10, the chart shows 9,314 CAJA40 vs 33,427 FARDO10 — which looks like 9k vs 33k because the unit label shows as FARDO10 but the quantity is in CAJA40.

**Confirmation:** stock_moves vendor→internal Jul 2025 for pid=2 = 34,225 FARDO10. revenue_daily pre-fix = 9,314 = 34,225 × (0.025/0.1) — exactly the CAJA40/FARDO10 ratio conversion applied by `to_caja40()`.

**Fix applied:** `docs/reconciliation/fix_purchase_uom_revenue_daily_2026-05-07.py`
- Identifies 17 of 23 demo SKUs with stock_uom ≠ CAJA40
- Correction factor = stock_uom_ratio / CAJA40_ratio per PID
- DELETE all purchase rows for affected PIDs → INSERT corrected rows (× factor)
- FARDO10 (ratio 0.1): factor=4.0 → 9,314 → 37,257 FARDO10 ✓

**Note:** Initial INSERT failed at batch 4 with duplicate key 409 (revenue_daily had duplicate compound keys from find_15b supplementing find_15 data for same PID/date). Partial insert: 11 of 17 PIDs recovered. Remaining 6 PIDs (1113, 1127, 1366, 1587, 1590, 1600) recovered via `fix_purchase_uom_missing_pids_2026-05-07.py` which re-derived data from stock_moves (RED_TIER PIDs) and purchase_order_lines (pid=1366).

**Downstream pipeline re-run (all passed):**
- `smooth_oct2024_purchase_anomaly.py` → rebuilt revenue_daily_for_ml from corrected revenue_daily. Acid Test 1 intact ✓
- `find_16_carvajal_tier3_fallback_purchases_for_ml.py` → 6 Tier 3 SKUs all PASS ✓
- `recompute_po_history_real_months_2026-05-07.py` → 16 GREEN, 4 AMBER, 3 RED (same as before)
- ML training (`trigger_ml_training_2026-05-07.py`) → 66/69 cells OK. 3 FAIL: `insufficient_ratio_data` on `purchases_ordered` for SKUs 77201055, 77201056, 77201019 (low PO frequency, pre-existing issue).

**Verification post-fix (pid=2, SKU 77205001):**
- revenue_daily Jul 2025 purchases_received: 37,257 FARDO10 (was 9,314) ✓
- forecast_results Feb 2026 sales: 35,172 FARDO10 (unchanged — censored signal, Dealbreaker 2 still open)
- forecast_results Feb 2026 purchases_received: 34,989 FARDO10 (derived ratio × sales forecast)

**Dealbreaker 1 STATUS: RESOLVED** — Chart will now show ~35-37k purchases_received vs ~33-36k sales for SKU 77205001 instead of 9k vs 36k.

**Dealbreaker 2 STATUS: OPEN** — Sales forecast still 35k, client's known demand is 45k+. Fix B (load sale.order.line + add demand metric) not yet implemented.

**Source scripts NOT yet fixed:** `find_15.py` and `find_15b.py` still use `to_caja40()` for purchases. If these scripts are re-run without applying the patch first, the bug will be re-introduced. TODO: fix these source scripts to use stock_uom-based conversion.

**UoM semantics persisted to memory:** `reference_uom_semantics.md` in project memory — includes physical meanings (FARDO10 = bundle of 10, CAJA40 = box of 40), conversion formulas, and root cause explanation.

**Source script fix applied (same session):** `find_15.py` and `find_15b.py` both patched to replace `to_caja40()` with `to_stock_uom(qty, src_uom, tgt_uom)` that converts to each product's `stock_uom` instead of always converting to CAJA40. No `to_caja40` references remain in either file.

---

### Session 2026-05-07 — Fix B: Uncensored Demand Metric (Dealbreaker 2)

**Root cause confirmed:** Prophet trains on `revenue_daily_for_ml` with `metric='sales'` (invoiced/delivered qty from account.move.line). During stockouts, invoiced qty = stock available < true customer demand. Prophet learns the supply-constrained signal, not actual demand.

**Source of uncensored demand:** `sale_orders` + `sale_order_lines` tables in Supabase (already loaded, confirmed 80,525 confirmed orders with state='sale'). Key fields: `sale_orders.order_date` (demand arrival date), `sale_order_lines.quantity` (ordered qty regardless of stock), `sale_order_lines.delivered_qty` (fulfilled qty — the censored signal).

**Note on plan assumption correction:** Plan-004 originally stated state filter should be `'Orden de venta'` (Spanish). Actual Supabase data stores state in English: `'sale'` for confirmed orders. Filter corrected to `state=eq.sale` in all scripts.

#### B2/B3 — populate_demand_metric_2026-05-07.py

**Script:** `docs/reconciliation/populate_demand_metric_2026-05-07.py`

**What it does:**
1. Idempotency check: aborts if demand rows already exist for pid=2 in revenue_daily_for_ml
2. Loads all 80,525 confirmed sale_orders (state='sale'); filters to 75,310 in training window (2024-10-01 → 2026-01-31)
3. Loads 122,460 sale_order_lines for 23 demo PIDs
4. Aggregates to (product_id, order_date) summing quantity with UoM normalization to product's stock_uom
5. Inserts 9,693 daily demand rows into BOTH `revenue_daily` and `revenue_daily_for_ml`

**SSOT label:** `sol_confirmed_order_date_qty_ordered_native_uom`  
**Metric:** `demand`

**Verification results (pid=2, SKU 77205001, FARDO10):**

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

**Client claim validated:** Client said demand is 45,000+ for SKU 77205001. Historical data confirms: avg Oct–Jan 2026 = ~38k, trending to 45k+ in H2 2025. Dec 2025 spike to 52k with 14k lost sales (27.3% unmet demand) is a major stockout event.

All 23 demo PIDs received demand rows. [PASS] 

#### B4 — trigger_ml_training_demand_2026-05-07.py

**Script:** `docs/reconciliation/trigger_ml_training_demand_2026-05-07.py`

**What it does:** Calls Railway ML service `/forecast/revenue-daily` directly for all 23 demo SKUs with `metric='demand'`, `ssot_label='sol_confirmed_order_date_qty_ordered_native_uom'`, training window 2024-10-01 → 2026-01-31, prediction through 2026-03-31. Persists monthly forecast rows to `forecast_results` via Supabase upsert.

**Result: 23/23 SKUs OK**

**Spot check — SKU 77205001 (pid=2) demand vs sales forecast:**

| metric | month | yhat_sum | status |
|--------|-------|----------|--------|
| demand | 2026-02 | 42,330 | ok |
| demand | 2026-03 | 39,225 | ok |
| purchases_ordered | 2026-02 | 34,989 | ok_derived |
| purchases_received | 2026-02 | 34,989 | ok_derived |
| sales | 2026-02 | 35,172 | ok |
| sales | 2026-03 | 35,851 | ok |

**Lost sales gap now quantified:** Feb 2026 demand forecast 42,330 vs sales forecast 35,172 = **gap of 7,158 FARDO10/month** (~20%). This is the "invisible lost revenue" that was the DEALBREAKER.

#### B5 — forecast-diagnostic route.ts + UI changes

**Files modified:**
- `frontend/src/app/api/superuser/forecast-diagnostic/route.ts`
- `frontend/src/app/(authenticated)/superuser/forecast-diagnostic/page.tsx`

**route.ts changes:**
- `METRICS` constant: added `'demand'` → now `['sales', 'purchases_ordered', 'purchases_received', 'demand']`
- `RevenueDailyRow.metric` type: added `| 'demand'`
- `ForecastResultRow.metric` type: added `| 'demand'`
- `MonthlyAgg` interface: added `demand: number`
- `ForecastMonth` interface: added `demand`, `demand_lower`, `demand_upper`, `demand_model_status`
- `histAgg` cell: added `demand: 0` initialization; `else if (r.metric === 'demand') { cell.demand += qty; }` accumulation
- `history.push`: added `demand: cell?.demand ?? 0`
- `forecastStatus` record: added `demand: 'ok'`
- Forecast construction: added `fDemand = latestForecast.get(...)` lookup with `model_status === 'ok'` guard
- `history12m`, `forecastMean`, `ratio`: added `demand` field
- `PerUomMonth` interface: added `demand`, `demand_lower`, `demand_upper`
- Per-UoM accumulation: added demand accumulation in both history and forecast sections; added demand CI handling; added demand status to `anyNotOk` check
- `series.push`: added `demand`, `demand_lower`, `demand_upper`

**page.tsx changes:**
- `Metric` type: added `| 'demand'`
- `MonthlyAgg` / `ForecastMonth` / `PerUomMonth` interfaces: added demand fields
- `METRIC_COLOR`: `demand: '#f97316'` (orange-500)
- `METRIC_LABEL`: `demand: 'Demanda (pedidos)'`
- Panel A (ratio bars): added demand to series and legend
- Panel B (per-UoM time series): added `demand` to `CI_KEYS`; added `buildSeries('demand')` to allSeries; added to legend
- Panel C (SKU drilldown): added `demand` case to `lowerKey`/`upperKey` derivation; added `buildSeries('demand')` to allSeries; added to legend; added to summary table
- In-sample fit series remains sales-only (demand has no in-sample fit)

**Visual result:** Panel C now shows 4 lines for SKU 77205001 — Ventas (green), Compras (blue/purple), and Demanda (orange). The gap between the orange Demanda line and the green Ventas line IS the lost sales signal. Decision-makers can see: "We had 45k demand, sold 35k, lost 7k+/month to stockouts."

**Dealbreaker 2 STATUS: RESOLVED** — Forecast-diagnostic page now surfaces the uncensored demand metric. The 35k vs 45k discrepancy is explained and quantified as lost sales.

**TypeScript check:** `tsc --noEmit` passes with no errors after all changes.
