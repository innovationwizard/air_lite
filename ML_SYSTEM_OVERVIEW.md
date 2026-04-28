# ML System Overview — AI Refill Lite
_Last updated: 2026-04-27_

---

## 1. What It Trains On

**Algorithm:** Facebook Prophet — one model per product, univariate time series.

**Primary data source:** Odoo (multi-table). Three distinct metrics, each with its own SSOT formula validated against the CEO dashboard:

| Metric | Odoo Source | Key Formula Detail |
|--------|-------------|-------------------|
| Sales | `account.move.line` | Income account, posted invoices/refunds, `invoice_date` |
| Purchases Ordered | `purchase.order.line` | All PO states, `date_planned` (not `date_order`), `product_qty` |
| Purchases Received | `purchase.order.line` | purchase/done states only, `date_planned`, `qty_received` |

Refunds count as negative quantities in both GTQ and units.

**Historical window:**
- Full span available: 2024-10-01 → 2026-03-03 (~18 months)
- Minimum per product: 30 non-censored observations
- Backtest cycles: 14 total (3–16 training months, predicting Jan 2025 → Feb 2026)
- Yearly seasonality enabled only when training_months ≥ 12

**Census Filter (critical innovation):**
Days where `inventory ≤ 0 AND sales = 0` are marked `is_censored = true` in `demand_daily`. These are stockout-suppressed demand (dead zeros, not true zeros). Prophet excludes these days during training and interpolates through them, widening confidence intervals during the gaps. Implemented at the SQL aggregation layer in `supabase/migrations/20260322000002_reconstruction_functions.sql`.

**Product selection:**
- Top N products ranked by total revenue in the training window (default: top 100)
- Must have ≥ 30 non-censored days to qualify
- Coverage metric tracks what % of total revenue is captured by the selected set

**Key tables:**
- `demand_daily` — product_id, demand_date, quantity_sold, revenue, is_censored, orders_count
- `inventory_daily` — product_id, warehouse_id, snapshot_date, quantity_on_hand, unit_cost, inventory_value (reconstructed backward from a `stock.quant` snapshot dated 2026-03-03)
- `revenue_daily` — product_id, observation_date, quantity, ssot_label, metric (sales / purchases_ordered / purchases_received)

---

## 2. What It Forecasts

Two parallel systems run independently:

### A) Demand Forecasting (Backtest Engine)
- **Target:** daily units per product
- **Horizon:** 1 full calendar month ahead
- **Granularity:** daily + monthly aggregations
- **Used for:** the 4-pillar savings backtest dashboard

### B) Revenue Forecasting (SSOT system)
- **Target:** daily GTQ per product per metric (sales / ordered / received)
- **Horizon:** 1–3+ months (configurable)
- **Aligned to:** CEO dashboard SSOT formulas

### C) Purchase Schedule (Replenishment)
- **Target:** weekly purchase recommendations per supplier (Carvajal / Reyma)
- **Horizon:** next 7 days after training window
- **Policy constraints:** inventory must not exceed 14 days of forecasted demand; reorder triggers below 7 days

**Prediction output format:**
```json
{
  "status": "ok | insufficient_history | training_failed",
  "daily": [{"date": "2025-02-01", "yhat": 125.5, "yhat_lower": 95.2, "yhat_upper": 168.3}],
  "monthly": [{"month": "2025-02", "yhat_sum": 3450.0, "yhat_lower_sum": 2910, "yhat_upper_sum": 4200}],
  "training_points": 90,
  "nonzero_points": 47
}
```

Confidence intervals default to 80%. Negative predictions are clipped to 0.

---

## 3. What It Optimizes

No global loss function. The system quantifies four contractual savings pillars by comparing actual historical behavior vs. what AI-guided behavior would have produced:

| Pillar | Metric | Approach |
|--------|--------|----------|
| Storage cost reduction | GTQ/month | `actual_inventory_value × annual_holding_rate / 12` vs. optimized level |
| Avoid unnecessary purchases | GTQ/month | Actual PO value minus what was needed given forecast + safety stock |
| Prevent lost sales (stockouts) | GTQ margin/month | `lost_units × (list_price - cost)`; applies a conservative 80% prevention rate |
| Inventory turnover improvement | Annual ratio | COGS / avg_inventory_value × 12; optimized assumes 65% of actual avg inventory |

Each pillar is calculated independently and surfaced as a GTQ savings figure per backtest cycle.

**Prophet hyperparameters:**
- `changepoint_prior_scale = 0.1` (conservative; prevents overfit on short windows)
- `seasonality_prior_scale = 5.0` (moderate; detects seasonality without noise amplification)
- `yearly_seasonality` = true only if training_months ≥ 12
- `weekly_seasonality` = always true (clear weekday/weekend invoice patterns)
- `daily_seasonality` = false (too noisy at daily granularity)
- Uncertainty: 1,000 MCMC draws (Stan)

**Holdout validation:** Actual demand is loaded and compared against predictions. Results stored in `backtest_results`: product_id, predicted_demand, actual_demand, error_absolute, error_percentage.

---

## 4. Trade-offs the System Handles

### Stockout vs. Overstock
| Parameter | Value | Effect |
|-----------|-------|--------|
| Safety stock | Z = 1.65 × demand_std × √lead_time | 95% service level; higher Z = fewer stockouts, more holding cost |
| Reorder point | 7 days of forecasted demand | Below this, a purchase is triggered |
| Max inventory ceiling | 14 days of avg daily demand | Hard cap to prevent overstocking |
| MOQ (min order qty) | Per product_supplier record | May force overbuy; rounds up needed_qty |

### Supplier Constraints
- Local suppliers (Carvajal / Reyma): ~5-day lead time
- Imports (Colombia / Mexico / China): ~90-day lead time — fundamentally different reorder dynamics
- `date_planned` used (not `date_order`) because David's dashboard tracks expected arrival, not PO submission date
- All PO states (draft, sent, to_approve, purchase, done, cancel) counted in "ordered" — empirically matches the business view

### Data Quality Trade-offs
- The 80% stockout-prevention rate is a conservative haircut acknowledging that not all censored demand would have converted to sales
- UoM normalization: all quantities converted to stock UoM before aggregation to prevent mixed-unit sums
- Product archival: only active products modeled, but historical demand of archived SKUs is preserved

### Volume vs. Units
- Optimization focuses on units (demand forecast, safety stock, inventory levels)
- Volume tracked separately for warehouse capacity and truck loading context
- These two layers are **not yet connected** (see Section 6)

---

## 5. Model Architecture

**Framework:** Facebook Prophet (Bayesian additive regression model with decomposable trend + seasonality + holidays components)

**Per-product pipeline:**
1. Load & prepare — query `demand_daily` (or `revenue_daily`), filter censored days, reindex to full date range with zero-fill
2. Validate — require ≥ 30 total rows and ≥ 10 non-zero rows; return `insufficient_history` otherwise
3. Configure — adapt seasonality settings based on training_months
4. Train — `Prophet(**config).fit(df[['ds', 'y']])` via Stan MCMC
5. Predict — `model.make_future_dataframe(periods=N)` → `model.predict()`
6. Post-process — clip yhat < 0 to 0
7. Aggregate — roll daily predictions up to monthly sums

**No ensemble, no feature engineering.** Single Prophet model per product. No xgboost, statsmodels, SARIMA, or regression. No exogenous features (price, promotions, macro indicators).

**Backward inventory reconstruction:** Starting from a `stock.quant` snapshot (2026-03-03), `stock.move` records are reverse-applied day by day (outgoing adds, incoming subtracts) to generate `inventory_daily` back to 2024-10-01.

---

## 6. Truck Loading & Volume Optimization — Current State and Gap

This is the client's #1 pain point (per `_AI_Refill_Lite_Path_Forward_2026-04-21.md`). Below is a full accounting of what exists and what is missing.

---

### What Exists

#### Volume data in the database
- `products.volume_m3` (NUMERIC 12,6) — m³ per stock unit
- `products.height_m`, `width_m`, `length_m` (NUMERIC 8,4) — physical dimensions
- `warehouses.capacity_m3` — Central bodega seeded at 10,007.28 m³; other warehouses (Zacapa, Petén, Zona 11) left NULL pending field measurements

#### RPC: `rpc_oa_warehouse_space(p_warehouse_id INT DEFAULT NULL)`
Source: `supabase/migrations/20260330000004_fix_rpc_overloads.sql`

Returns:
```
warehouse_id, warehouse_name, max_capacity_m3,
occupied_m3, incoming_m3, available_m3, post_arrival_m3,
saturation_pct, products_without_volume, alert_level
```

Calculations:
- `occupied_m3 = SUM(qty_on_hand × volume_m3)` from `inventory_daily`
- `incoming_m3 = SUM((ordered_qty - received_qty) × volume_m3)` from purchase order lines
- `available_m3 = max_capacity_m3 - occupied_m3`
- `post_arrival_m3 = max_capacity_m3 - occupied_m3 - incoming_m3`
- Alert levels: `sin_configurar` / `rojo` (>95% occupied or incoming exceeds capacity) / `amarillo` (>80%) / `verde`

#### RPC: `rpc_oa_reception_saturation(p_date DATE, p_warehouse_id INT)`
Source: same migration file

Returns dock congestion by day:
```
scheduled_date, total_trucks, total_unload_hours,
available_dock_hours, saturation_pct, is_saturated, trucks[]
```

- `available_dock_hours = num_docks × work_hours`
- Flags `is_saturated` when total unload hours exceed available dock hours
- **Alerts but does not reschedule or optimize**

#### Forecast a Ciegas — Furgon Columns (display only)
Page: `/gerencia/forecast`  
Source: `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx`  
Added: 2026-04-27

Shows 6 furgon conversion columns (Feb + Mar 2026, per metric):
- Furgones — Ventas: `(sales_units × volume_m3) / 122`
- Furgones — Compras Ordenadas: `(ordered_units × volume_m3) / 122`
- Furgones — Compras Recibidas: `(received_units × volume_m3) / 122`

```typescript
// WARNING: exact unit type per supplier (Carvajal / Reyma) is NOT confirmed.
// Using furgon_53 (53-foot trailer) as a demo approximation only.
const FURGO_M3 = 122;
```

The 122 m³ figure is an industry standard for a 53-foot trailer. **Supplier-specific capacities are unconfirmed.** All furgon calculation happens client-side in React — nothing server-side.

This page answers: "the business moved ~Y furgons of volume this month." It is **backwards-looking and display-only**, not a planning tool.

#### `odoo_probe_trucks.py`
Source: `ml/odoo_probe_trucks.py`

A diagnostic script that probes Odoo's `stock.picking` model (outbound delivery orders) for truck/loading field population. It discovered these fields exist in Odoo's schema:

| Odoo Field | Meaning |
|-----------|---------|
| `x_studio_placa` | License plate |
| `x_studio_vehculo` | Vehicle |
| `x_studio_camin` | Truck |
| `x_studio_bultos` | Number of packages |
| `x_studio_ruta_departamentales` | Departmental route |
| `x_studio_zona` | Zone |
| `x_studio_inicio_carga` | Load start time |
| `x_studio_terminacin_carga` | Load end time |
| `x_studio_fecha_y_hora_salida_dulgon` | Departure datetime |
| `weight`, `amount_volume` | Standard Odoo volume/weight fields |

**Finding: ~0% populated on the test environment.** The fields exist in Odoo's schema but operations is not filling them in. None of these fields have been synced to Supabase or exposed in the app. The probe is diagnostic infrastructure only.

---

### The Gap — Full Map

**The purchase scheduler outputs:** "buy 2,000 FARDO20 on Wednesday"  
**The warehouse space calculator outputs:** "that's 25 m³, fits in your 10,007 m³ bodega"  
**The forecast page outputs:** "this month's purchases represent ~18 furgons of volume"

**None of this answers the client's actual question:**

> "¿Cuántos furgones de cada producto deben entrar el lunes? ¿El martes? Si un furgón no llega el lunes como se esperaba, ¿cómo se rebalancea?"

| Layer | Status | Output | Gap |
|-------|--------|--------|-----|
| Demand forecasting | ✅ Built | Daily demand per product | — |
| Purchase scheduling | ✅ Built | "Buy X units on date Y" per product | No truck assignment |
| Bin-packing / truck manifest | ❌ Not built | — | Everything |
| Dock scheduling | ⚠️ Partial | Saturation alerts | Does not reschedule or optimize |
| Supplier dispatch | ❌ Not built | — | No communication loop |
| Delay rebalancing | ❌ Not built | — | No feedback into Hot List or next cycle |

**Specific missing pieces:**

1. **Bin-packing algorithm** — given purchase_scheduler output (qty per SKU) + `volume_m3` per SKU, pack into minimum number of trucks without exceeding 122 m³ capacity. No knapsack logic exists anywhere.

2. **Truck type routing** — supplier-specific truck types are unconfirmed. No logic assigns truck types based on load volume or route constraints. Reyma and Carvajal may have different vehicle types.

3. **Arrival schedule optimization** — purchase scheduler outputs daily purchase quantities but no "truck A arrives Monday 8am, truck B Wednesday 4pm." No demand-pacing logic ties into the dock saturation RPC (it alerts but doesn't trigger rescheduling).

4. **Delay rebalancing** — if a truck is late, nothing propagates that impact back to Hot List priorities or forward into the next scheduling cycle.

5. **Volume as a planning constraint** — products have `volume_m3` and warehouses have `capacity_m3`, but purchase recommendations don't check "will this fit?" before recommending. The furgon count shown in the UI is computed post-hoc, not used as a constraint during planning.

6. **Odoo field population** — the `x_studio_placa`, `x_studio_bultos`, and route fields need to actually be filled in by operations staff before they can be used as feedback or ground-truth for optimization.

---

### What Bridging This Would Require

| Missing piece | What needs to be built |
|---------------|----------------------|
| Bin-packing | Knapsack algorithm: purchase_scheduler output + volume_m3 → truck manifests |
| Truck type confirmation | Confirm furgon capacity per supplier (not assumed 122 m³) |
| Arrival scheduling | Map packed trucks to dock time slots respecting `rpc_oa_reception_saturation` |
| Rebalancing | Late truck → propagate to Hot List priorities + re-run next scheduling cycle |
| Odoo field population | Operations must populate `x_studio_placa`, `bultos`, route fields for feedback loop |

A new function — something like `schedule_truck_loads(purchase_lines, truck_types, constraints)` — would sit between `purchase_scheduler.py` and the reception dock scheduler, taking recommended purchase quantities and outputting a truck manifest:

```json
{
  "truck_id": "ABC123",
  "truck_type": "furgon_53",
  "load_date": "2026-05-05",
  "arrival_time": "08:00",
  "contents": [
    {"sku": "FARDO20-001", "qty": 800, "volume_m3": 12.4},
    {"sku": "CAJA40-007", "qty": 200, "volume_m3": 6.8}
  ],
  "total_volume_m3": 19.2,
  "furgon_count": 1
}
```

---

## 7. Downstream Usage Summary

| Endpoint / Page | Users | What it delivers |
|-----------------|-------|-----------------|
| `/backtest` dashboard | Superuser, Gerencia | 4 savings pillars × 14 backtest cycles; Spanish-language summaries |
| `/api/poc/purchase-schedule` | Compras, Operations | Weekly replenishment recommendations per supplier |
| `/forecast/revenue-daily` | Gerencia, Finance | Daily + monthly revenue predictions aligned to CEO dashboard |
| `/gerencia/forecast` | Gerencia | "Forecast a Ciegas" — top 23 SKUs with furgon volume conversion (display only) |
| Hot List / Hold List | Operations | Stockout risk rankings; ABC/XYZ classification; slow-moving item flags |
| `rpc_oa_warehouse_space()` | OA module | Warehouse capacity saturation with alert level |
| `rpc_oa_reception_saturation()` | OA module | Dock congestion by day (alerts only, no rescheduling) |

---

## 8. Key Source Files

| File | Purpose |
|------|---------|
| `ml/backtest_engine.py` | Core demand forecast + savings calculation engine |
| `ml/forecast_revenue.py` | Revenue-daily Prophet pipeline |
| `ml/purchase_scheduler.py` | Weekly replenishment recommendations |
| `ml/odoo_probe_trucks.py` | Diagnostic: inventories truck fields in Odoo |
| `ml/api.py` | Flask API routes |
| `ml/savings/*.py` | Per-pillar savings calculators (storage, purchases, stockouts, rotation) |
| `supabase/migrations/20260322000002_reconstruction_functions.sql` | Inventory + demand aggregation; Census Filter implementation |
| `supabase/migrations/20260322000003_rpc_functions.sql` | KPI RPCs (stockout risk, ABC/XYZ, slow-moving) |
| `supabase/migrations/20260330000004_fix_rpc_overloads.sql` | `rpc_oa_warehouse_space()` + `rpc_oa_reception_saturation()` |
| `supabase/migrations/20260422000005_warehouse_capacity.sql` | Central warehouse capacity seed: 10,007.28 m³ |
| `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx` | "Forecast a Ciegas" with furgon conversion columns |
| `frontend/src/app/(authenticated)/poc/programacion/page.tsx` | Purchase scheduling POC (61 pre-computed weeks) |
| `frontend/src/app/(authenticated)/oa/recepcion/page.tsx` | Reception scheduling (furgon_53 truck type, dock assignment) |
| `_AI_Refill_Lite_Path_Forward_2026-04-21.md` | Roadmap; names truck/container loading as client's #1 pain (Path B) |
| `changelogs/2026-04-27_gerencia-ux-overhaul-and-furgones-columns.md` | Furgon column design rationale and FURGO_M3=122 caveat |
