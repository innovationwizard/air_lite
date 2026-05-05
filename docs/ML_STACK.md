# ML Stack — Technical Reference

**Last updated:** 2026-04-29

---

## Overview

Air Lite's forecasting system is a cloud-native ML pipeline built on Facebook Prophet for demand and a ratio-derived model for purchase planning. It runs on Railway (ML service) + Supabase (PostgreSQL) + Next.js (frontend), processes 18 months of production data across 23 SKUs, and produces daily demand forecasts with 80% confidence intervals.

---

## Infrastructure

| Layer | Technology | Notes |
|-------|-----------|-------|
| ML Service | Python 3.11 / Flask 3.x / Gunicorn | Deployed on Railway |
| Database | Supabase PostgreSQL | Production + local dev via supabase-cli |
| Frontend | Next.js 14 / TypeScript / React | API routes proxy ML calls |
| Auth | Supabase JWT | Row-level security enforced |
| ML Containerization | Docker (python:3.11-slim + CmdStan) | CmdStan compiled at image build time for Stan-based Prophet sampling |
| Config | Railway env vars → Flask; `.env.local` → Next.js | Separate keys for public/service roles |

---

## ML Models

### Model 1 — Prophet (Sales Demand)

**Algorithm:** Facebook Prophet — Bayesian additive decomposition with Stan MCMC.

**Why Prophet for sales:** Sales observations have 75–97% daily non-zero density per SKU. That density supports Prophet's decomposition into trend + weekly seasonality + yearly seasonality without producing degenerate confidence intervals.

**Configuration:**

```python
Prophet(
    yearly_seasonality = training_months >= 12,  # enabled only with sufficient history
    weekly_seasonality = True,                   # invoice patterns are clearly weekday-biased
    daily_seasonality  = False,                  # too noisy at daily granularity
    changepoint_prior_scale = 0.1,               # conservative; prevents overfitting on short windows
    seasonality_prior_scale  = 5.0,              # detects seasonality without amplifying noise
    mcmc_samples = 1_000,                        # Stan-based uncertainty quantification
    interval_width = 0.80,                       # 80% confidence intervals
)
```

**Training window:** 2024-10-01 → 2026-01-31 (intentional cutoff; Feb–Apr 2026 are blind-tested against real values).

**Censorship correction (Census Filter):** Days where `inventory ≤ 0 AND sales = 0` are marked `is_censored = true` in `demand_daily`. Prophet excludes censored days from training and interpolates across gaps, preventing stockout-suppressed zeros from biasing the trend downward. Without this correction, chronic stockout products appear to have low demand when the real constraint was supply.

**Backtest validation:** 14 historical cycles, `training_months` stepped 3→16, predicting each month from Jan 2025 through Feb 2026. Errors (absolute, percentage) stored in `backtest_results` for every product × cycle.

---

### Model 2 — Ratio-Derived Purchase Forecast

**Why not Prophet for purchases:** Purchase orders are event-driven decisions (4.7–16.8% daily non-zero density). At that density, Prophet's additive decomposition produces collapsed or unbounded confidence intervals with no usable signal.

**Algorithm:**

```
forecast_purchases = forecast_sales × R

where R = median(purchases / sales, per-SKU historical)
         with Tukey IQR × 1.5 outlier exclusion
```

The ratio R is computed per SKU, per metric (`purchases_ordered`, `purchases_received`), over the full training window. Days with zero sales are excluded from ratio computation. Outliers above `Q3 + 1.5×IQR` are removed before taking the median.

**Dependency:** Pass 2 reads Pass 1 results from `forecast_results`. The frontend orchestration route enforces sequential execution (Pass 1 fully persisted before Pass 2 reads).

**Status codes:**

| Code | Meaning |
|------|---------|
| `ok` | Prophet trained and predicted successfully |
| `ok_derived` | Purchase forecast derived from sales ratio |
| `insufficient_history` | < 30 non-censored training observations |
| `insufficient_ratio_data` | < 10 non-zero paired (sales, purchases) days |
| `no_sales_forecast` | Pass 1 failed; Pass 2 cannot proceed |
| `training_failed` | Prophet runtime error (logged) |

---

## Data Pipeline

### Stage 1 — Source of Truth

All production data originates from Odoo and is replicated to Supabase. Three distinct SSOT series are tracked per SKU:

| Metric | Odoo Source | Key Constraint | SSOT Label |
|--------|------------|----------------|------------|
| Sales | `account.move.line` (posted invoices, refund sign-inverted) | Invoice date | `aml_income_posted_invoice_refund_neg_invoice_date_c40` |
| Purchases Ordered | `purchase.order.line` | States: `purchase`, `locked`, `done` only (excludes draft, RFQ, cancelled) | `pol_confirmed_date_planned_product_qty_c40` |
| Purchases Received | `purchase.order.line` | State: `done` only; uses `qty_received` | `pol_purchase_done_date_planned_qty_received_c40` |

The purchases SSOT was corrected on 2026-04-28. The previous label (`pol_all_states_*`) included 319 cancelled POs (300,823 units never received), inflating historical purchase volumes and distorting the derived-ratio calculation. The corrected label restricts to confirmed states only, consistent with the 2,422 locked POs in production.

---

### Stage 2 — Inventory Reconstruction

**Function:** `reconstruct_inventory_daily()` — PostgreSQL recursive CTE in `supabase/migrations/20260322000002_reconstruction_functions.sql`.

**Method:** Starts from the `stock.quant` snapshot dated 2026-03-03 (the most recent full inventory count). Works backward through `stock.move` records, reversing each move (outbound adds back, inbound subtracts) to derive historical `quantity_on_hand` per product per day.

**Output table:** `inventory_daily` — columns: `product_id`, `warehouse_id`, `snapshot_date`, `quantity_on_hand`, `unit_cost`, `inventory_value`.

This reconstruction is what enables the Census Filter: without accurate historical inventory levels, it is impossible to distinguish a true zero-sales day from a stockout-suppressed zero.

---

### Stage 3 — Demand Aggregation & Censorship

**Function:** `aggregate_demand_daily()` — sums `sale_order_lines` by `(product_id, date)`, joins with `inventory_daily`, applies Census Filter.

**Census Filter rule:**

```sql
is_censored = (quantity_on_hand <= 0 AND quantity_sold = 0)
```

**Output table:** `demand_daily` — columns: `product_id`, `demand_date`, `quantity_sold`, `revenue`, `is_censored`, `orders_count`.

---

### Stage 4 — Training Data Preparation

Before model training, `revenue_daily_for_ml` is used (not `demand_daily` directly). This table is a copy of `revenue_daily` with one correction applied: the October 2024 onboarding artifact.

**October 2024 artifact:** During system onboarding, 5–12 historical POs per SKU were bulk-loaded with `date_planned` set to October 2024. This created a single-month spike of 247,379 units that does not reflect real demand. For ML training, the October 2024 rows are replaced with a synthetic row per SKU using the median of the remaining 15 months. The original `revenue_daily` table is left intact as an audit trail.

---

### Stage 5 — Forecast Production & Storage

**Two-pass orchestration** (endpoint: `POST /api/acid-test/forecast/run`):

```
Pass 1 — foreach SKU:
  POST /forecast/revenue-daily {product_id, metric='sales', training_end='2026-01-31', ...}
  → Prophet trains on revenue_daily_for_ml
  → Returns [{date, yhat, yhat_lower, yhat_upper}, ...]
  → Monthly aggregations: yhat_sum, yhat_lower_sum, yhat_upper_sum
  → PERSIST → forecast_results (model_status = 'ok' or 'insufficient_history')

Pass 2 — foreach SKU × {purchases_ordered, purchases_received}:
  POST /forecast/purchases-derived {product_id, metric, ...}
  → READ Pass 1 forecast_results
  → Compute per-SKU Tukey-cleaned ratio R
  → forecast_purchases = forecast_sales × R
  → PERSIST → forecast_results (model_status = 'ok_derived')
```

**Post-processing:** All `yhat < 0` clipped to 0 before persistence.

---

## Key Tables

```
demand_daily
  product_id         FK → products.id
  demand_date        DATE
  quantity_sold      NUMERIC
  revenue            NUMERIC
  is_censored        BOOLEAN    ← Census Filter flag
  orders_count       INT

inventory_daily
  product_id         FK → products.id
  warehouse_id       FK → warehouses.id
  snapshot_date      DATE
  quantity_on_hand   NUMERIC
  unit_cost          NUMERIC
  inventory_value    NUMERIC    = qty × cost

revenue_daily_for_ml
  product_id         FK → products.id
  observation_date   DATE
  metric             TEXT       'sales' | 'purchases_ordered' | 'purchases_received'
  ssot_label         TEXT       formula identifier (human-readable audit trail)
  quantity           NUMERIC
  source_doc_count   INT

forecast_results
  product_id         FK → products.id
  ssot_label         TEXT
  metric             TEXT
  forecast_month     DATE       month-start
  yhat_sum           NUMERIC
  yhat_lower_sum     NUMERIC
  yhat_upper_sum     NUMERIC
  training_start_date DATE
  training_end_date   DATE
  training_points    INT
  nonzero_points     INT
  model_status       TEXT       'ok' | 'ok_derived' | 'insufficient_history' | ...
  computed_at        TIMESTAMP

backtest_runs
  id                 SERIAL PK
  status             TEXT       'running' | 'completed' | 'failed'
  training_start_date DATE
  training_end_date   DATE
  prediction_month   DATE
  products_modeled   INT
  training_duration_ms INT
  error_message      TEXT

backtest_results
  run_id             FK → backtest_runs.id
  product_id         FK → products.id
  predicted_demand   NUMERIC
  actual_demand      NUMERIC
  error_absolute     NUMERIC
  error_percentage   NUMERIC

backtest_savings
  run_id             FK → backtest_runs.id
  storage_savings_gtq    NUMERIC
  purchase_savings_gtq   NUMERIC
  stockout_savings_gtq   NUMERIC
  rotation_improvement_pct NUMERIC
  total_savings_gtq      NUMERIC
  summary_text       TEXT       Spanish-language reasoning

purchase_schedule_runs
  id                 SERIAL PK
  status             TEXT
  training_months    INT
  week_offset        INT
  schedule_week_start DATE
  products_scheduled INT
  total_units        NUMERIC

purchase_schedule_lines
  run_id             FK → purchase_schedule_runs.id
  product_id         FK → products.id
  supplier_name      TEXT       'Carvajal' | 'Reyma'
  recommended_date   DATE
  recommended_qty    NUMERIC
  inventory_level    NUMERIC
  weeks_of_supply    NUMERIC
```

---

## Savings Methodology

Post-backtest, four savings pillars are computed and stored in `backtest_savings`:

| Pillar | Formula | Key Assumption |
|--------|---------|----------------|
| Storage cost reduction | `(actual_holding_cost − optimized_holding_cost)` where optimized = `avg_daily_demand × lead_time/2 + safety_stock` | Annual holding rate applied to monthly delta |
| Unnecessary purchase reduction | `actual_PO_spend − (demand_forecast + safety_stock + MOQ)` | MOQ may force overbuy; accounted for |
| Lost sales prevention | `lost_units × (list_price − cost) × 0.80` | 80% recovery rate — conservative haircut; not all censored demand converts |
| Inventory rotation | `(COGS / avg_inventory) × 12` | Optimized assumes 65% of actual average inventory |

The 0.80 and 0.65 discount factors are intentional conservatism — they reflect that forecasts reduce but do not eliminate uncertainty. Spanish-language reasoning is generated per pillar by `ml/savings/summary_generator.py`.

---

## Weekly Purchase Scheduler

Endpoint: `POST /api/poc/purchase-schedule`

**Algorithm:**
1. Fetch active supplier products (Carvajal via Odoo RPC, Reyma by name pattern).
2. Train Prophet on `demand_daily` for each product (same adaptive config as revenue forecast).
3. Forecast daily demand for the target week.
4. For each product:
   ```
   needed_qty = avg_daily_demand × max_inventory_days − inventory_on_hand
   purchase_qty = max(needed_qty, MOQ)   # MOQ forces up when needed_qty < minimum
   ```
   Ceiling: never stock beyond 14 days of forecast demand.
   Floor: reorder point = 7 days of forecast demand.
5. Return recommendations as `purchase_schedule_lines`.

**Resumability:** The scheduler checks `purchase_schedule_runs` for already-completed week offsets and auto-continues from the last completed cycle. Safety limit: 70 weeks maximum per run.

---

## Source Files

| File | Role |
|------|------|
| `ml/api.py` | Flask endpoints |
| `ml/backtest_engine.py` | Demand forecast + savings calculation |
| `ml/forecast_revenue.py` | Prophet pipeline |
| `ml/forecast_purchases_derived.py` | Ratio derivation with Tukey outlier exclusion |
| `ml/purchase_scheduler.py` | Weekly replenishment |
| `ml/census_filter.py` | In-memory censorship filtering during backtest |
| `ml/product_selector.py` | Top-N ranking by revenue, min observation guard |
| `ml/savings/storage_cost.py` | Storage savings pillar |
| `ml/savings/unnecessary_purchases.py` | Purchase savings pillar |
| `ml/savings/lost_sales.py` | Stockout savings pillar |
| `ml/savings/inventory_rotation.py` | Rotation savings pillar |
| `ml/savings/summary_generator.py` | Spanish-language reasoning per pillar |
| `ml/Dockerfile` | Python 3.11 + CmdStan build |
| `ml/requirements.txt` | prophet, pandas≥2.0, numpy≥1.24, supabase≥2.0, flask≥3.0, gunicorn≥22.0 |
| `supabase/migrations/20260322000002_reconstruction_functions.sql` | Inventory reconstruction + demand aggregation + Census Filter |
| `supabase/migrations/20260322000003_rpc_functions.sql` | KPI RPCs: stockout_risk, abc_xyz_analysis, slow_moving |
| `supabase/migrations/20260330000004_fix_rpc_overloads.sql` | Warehouse capacity + dock saturation RPCs |
| `frontend/src/app/api/acid-test/forecast/run/route.ts` | Two-pass orchestration |
| `frontend/src/app/api/backtest/run/route.ts` | Backtest proxy |
| `frontend/src/app/(authenticated)/backtest/page.tsx` | Backtest dashboard |
| `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx` | Forecast display + furgon conversion |

---

## Known Constraints

**Single seasonal cycle:** Training data covers Oct 2024 → Jan 2026 — exactly one full calendar year. Predictions that align with unusual months (e.g., September 2025 Christmas pre-buy of 63,791 units) may mirror that single observation rather than reflecting a reliable pattern. A 24-month window will resolve this as data accumulates.

**No exogenous features:** Prophet is trained univariately (date + quantity only). Price, promotions, and macroeconomic indicators are not included.

**No bin-packing:** The purchase scheduler outputs quantities per product per day. Truck and container loading optimization (knapsack / bin-packing) is not implemented; furgon counts are computed post-hoc in the UI using a flat 122 m³ standard.

**No async task queue:** All forecasting runs synchronously on Railway (gunicorn, 1 worker, 3600s timeout). Long backtest runs (14 cycles × N products) block the worker for the duration.
