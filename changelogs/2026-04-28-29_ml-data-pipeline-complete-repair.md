# ML Data Pipeline — Complete Repair: ID Mismatch, Locked PO Gap, October Anomaly, Tier 3 Fallback, and Derived Purchase Forecast Assessment

**Dates:** 2026-04-28 / 2026-04-29
**Scope:** ML training data pipeline, Supabase migrations, reconciliation scripts, ML architecture assessment. No frontend changes.
**Stack:** Python (stdlib + supabase-py), PostgreSQL via Supabase REST API, Facebook Prophet (assessment only).
**Driving context:** Acid Test 2 preparation — blind forecast of Feb and Mar 2026 for 23 demo SKUs (sales, purchases ordered, purchases received) against the CEO's production Odoo dashboard. Three independent root causes were identified and fixed before ML training could be responsibly triggered.

---

## Why This Was Done

Three compounding problems were blocking Acid Test 2 from being meaningful:

**1. Wrong product IDs silently corrupted the ML training table**
`products_acid_test_active` is a standalone table with its own `BIGSERIAL PRIMARY KEY`. Its `.id` values have no relation to `products.id`, which is the foreign key used by `revenue_daily`, `revenue_daily_for_ml`, and `forecast_results`. All three reconciliation scripts and the ML training pipeline use `products.id`. Any script that used `products_acid_test_active.id` as a `product_id` filter was writing data for the wrong products — or reading from the wrong rows — with no error raised, because the IDs exist in the products table by coincidence.

`smooth_oct2024_purchase_anomaly.py` had been doing exactly this. It fetched `products_acid_test_active.id` values and used them to filter `revenue_daily` reads and `revenue_daily_for_ml` deletes. The result: only 10 of 23 SKUs were ever processed; 2 were smoothed correctly (their IDs coincidentally matched); 8 others survived the wrong DELETE without being smoothed; 13 were completely absent from the ML training table.

**2. 74.5% of confirmed purchase orders were missing from training data**
All Odoo test-environment extracts had zero `locked`-state purchase orders. Production has 2,477 locked POs out of 3,253 total confirmed orders (74.5%). Because `revenue_daily` was populated only from Odoo extracts, purchase quantities in the ML training window were massively understated. Prophet was fitting seasonality to a drastically incomplete signal.

The fix was to bypass the broken Odoo extraction entirely and read `purchase_orders` and `purchase_order_lines` directly from the Supabase production tables, which contain the complete data including all locked POs. The acid test anchor (SKU 77201046, November 2024: purchases_ordered = 5,855.00 CAJA40) was verified against the Supabase tables before any writes, confirming exact alignment.

**3. Six CARVAJAL SKUs had purchase history only in the October 2024 anomaly month**
October 2024 is a known data artifact — bulk PO data was loaded during system onboarding, landing `date_planned` values in October and creating 5–12 simultaneous POs per SKU for that single month. The smoothing script replaces October purchase data with a median across other months. But six CARVAJAL SKUs (77205003, 77205034, 77205208, 77205190, 77205035, 77205005) had purchase orders only in October 2024 in the production Supabase tables. After smoothing, they had zero purchase history outside the anomaly month. The `forecast_purchases_derived` module (the new derived ratio architecture) would return `insufficient_ratio_data` for these SKUs, writing `yhat_sum = 0` to every purchase forecast cell — a guaranteed-wrong zero.

---

## Root Cause Analysis and Documentation

**`docs/reconciliation/FIX_PLAN_PRODUCTS_ID_MISMATCH_2026-04-28.md`** — Created. Full mismatch table for all 23 SKUs (products_acid_test_active.id vs products.id), damage assessment of `revenue_daily_for_ml`, codebase audit confirming only the smoothing script was affected (all API routes were already using the correct resolution path), and five-step fix plan.

**`docs/reconciliation/revenue_daily_monthly_sales_vs_po_2026-04-28.md`** — Created. Live query result: monthly sales vs purchases_ordered for all 23 demo SKUs across the training window (Oct 2024 → Jan 2026). 10,781 rows from `revenue_daily` using the correct `products.id` resolution. Key finding: October 2024 PO/Sales ratio is 1.85× across all SKUs combined; REYMA alone is 4.17×, confirming the anomaly is real and biasing.

---

## Changes by File

### `supabase/migrations/20260428000002_products_acid_test_add_products_id.sql`

**New migration.** Adds an explicit `products_id INT REFERENCES products(id)` column to `products_acid_test_active`, backfilled by matching `default_code` to `products.sku`. A unique partial index prevents duplicate mappings.

This column exists so that future scripts can read the correct FK directly from the view without a separate runtime lookup, eliminating the class of error that caused the ID mismatch in the first place. Applied successfully in Supabase Studio; all 23 demo SKUs resolved, zero nulls after backfill.

```sql
ALTER TABLE products_acid_test_active
  ADD COLUMN IF NOT EXISTS products_id INT REFERENCES products(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pat_active_products_id
  ON products_acid_test_active(products_id)
  WHERE products_id IS NOT NULL;

UPDATE products_acid_test_active pat
SET    products_id = p.id
FROM   products p
WHERE  p.sku = pat.default_code
  AND  pat.products_id IS NULL;
```

---

### `docs/reconciliation/smooth_oct2024_purchase_anomaly.py`

**Three bug fixes in Step 1.** The original script used `products_acid_test_active.id` as a product_id. The fix replaces that block with a two-step resolution: fetch `default_code` from `products_acid_test_active` (filtered to `is_top_10_in_class=eq.true`), then resolve `products.id` via the `products` table using `sku`. A hard assertion on exactly 23 resolved IDs prevents silent partial processing.

**Before (broken):**
```python
# Used products_acid_test_active.id as product_id — wrong table, wrong key
demo_rows = supa_get_all('/rest/v1/products_acid_test_active?select=id,default_code&is_top_10_in_class=eq.true')
demo_product_ids = [r['id'] for r in demo_rows]
```

**After (correct):**
```python
demo_meta = supa_get_all('/rest/v1/products_acid_test_active?select=default_code&is_top_10_in_class=eq.true')
demo_skus = [r['default_code'] for r in demo_meta if r.get('default_code')]
if len(demo_skus) != 23:
    raise SystemExit(f"ERROR — expected 23 top demo SKUs, got {len(demo_skus)}: {demo_skus}")
prod_rows = supa_get_all(f'/rest/v1/products?select=id,sku&sku=in.({",".join(demo_skus)})')
sku_to_pid = {r['sku']: r['id'] for r in prod_rows}
missing = [s for s in demo_skus if s not in sku_to_pid]
if missing:
    raise SystemExit(f"ERROR — {len(missing)} demo SKUs not found in products table: {missing}")
demo_product_ids = [sku_to_pid[s] for s in demo_skus]
```

**Result after fix:** `revenue_daily_for_ml` rebuilt with 11,541 rows across all 23 SKUs, 40 synthetic October rows (one per smoothed product/metric/ssot_label combination), acid test 4/4 PASS.

---

### `docs/reconciliation/find_15_populate_revenue_daily_purchases_from_supabase.py`

**New script.** Reads `purchase_orders`, `purchase_order_lines`, and `units_of_measure` directly from Supabase production tables to populate `purchases_ordered` and `purchases_received` rows in `revenue_daily` for all 23 demo SKUs.

**Why Supabase instead of Odoo:** The Odoo test-environment credentials are revoked. More critically, even with working credentials, the Odoo test environment contained zero `locked`-state POs — meaning 74.5% of production purchase volume was structurally unextractable via any Odoo sync. Supabase `purchase_orders` contains the complete production data including all 2,477 locked orders.

**Key design decisions:**

- **State filter:** `purchase`, `locked`, `done` only. `draft`, `solicitud de cotización`, `cancel`, and `to_approve` are excluded. Confirmed DEMO scope, documented in `ML_SYSTEM_OVERVIEW.md § 4`.
- **Date field:** `purchase_orders.expected_delivery` maps to Odoo `date_planned`. `confirmation_date` and `order_date` were tested and rejected (+42% deviation from acid test targets).
- **UoM normalization:** `normalized_qty = raw_qty × CAJA40_RATIO / ratio_src` where `CAJA40_RATIO = 0.025` from `units_of_measure`. All 203 UoMs loaded at start.
- **SSOT labels:** `pol_confirmed_date_planned_product_qty_c40` for ordered; `pol_purchase_done_date_planned_qty_received_c40` for received. Exact match to the labels in `revenue_daily` and `forecast_results`.
- **Idempotent:** Deletes both SSOT label rows for all 23 PIDs before inserting. Sales rows are never touched.

**Acid test anchor verification (runs on every execution):**

```
[PASS] Nov 2024 purchases_ordered  (77201046): got=5855.00  target=5855.00  Δ=+0.0000
[PASS] Nov 2024 purchases_received (77201046): got=5500.00  target=5500.00  Δ=+0.0000
```

**Result:** 683 rows inserted into `revenue_daily` (376 ordered + 307 received across 23 SKUs). State breakdown of the 3,253 production purchase orders: `locked` 2,477, `purchase` 190, `done` 34, `cancel` 319, `draft` 4, `solicitud de cotización` 229.

---

### `docs/reconciliation/find_16_carvajal_tier3_fallback_purchases_for_ml.py`

**New script.** Appends synthetic purchase rows to `revenue_daily_for_ml` for the 6 CARVAJAL Tier 3 SKUs (77205003, 77205034, 77205208, 77205190, 77205035, 77205005) that have purchase data only in October 2024.

**Architecture:** `revenue_daily_for_ml` is the ML-only clone rebuilt by `smooth_oct2024_purchase_anomaly.py` from `revenue_daily`. The Tier 3 SKUs have no purchase history in `revenue_daily` outside October 2024 — this is a real data condition, not a bug. The fallback is applied at the ML table level, not the source of truth.

**Fallback ratio computation:**
For each non-October training month where a Tier 3 SKU has sales, a synthetic purchase row is inserted:
```
synthetic_qty = monthly_sales_qty × R_class
```
where `R_class` is the Tukey-cleaned (IQR × 1.5) median ratio computed from all CARVAJAL SKUs with usable purchase history outside October 2024.

**Computed ratios (2026-04-29, from production data):**
- `R_ORD = 0.4969` (11 CARVAJAL paired months, Tukey-cleaned)
- `R_RCV = 0.5687` (10 CARVAJAL paired months, Tukey-cleaned)

A sanity-range guard (`0.01 ≤ R ≤ 5.0`) prevents writing obviously wrong values if the source data changes.

**Result:** 180 rows inserted — 15 ordered + 15 received per SKU for the full training window (November 2024 → January 2026). Each Tier 3 SKU now has enough purchase history for `forecast_purchases_derived.py` to compute a ratio and produce a non-zero forecast.

**Pipeline order (must be respected):**
1. `find_15` → populates `revenue_daily`
2. `smooth_oct2024_purchase_anomaly.py` → rebuilds `revenue_daily_for_ml` (clears and repopulates from `revenue_daily`)
3. `find_16` → appends Tier 3 fallback rows to `revenue_daily_for_ml`
4. ML training via `POST /api/acid-test/forecast/run`

`find_16` must always run after `smooth` because `smooth` wipes and rebuilds `revenue_daily_for_ml`. Running `find_16` before `smooth` accomplishes nothing.

---

### `docs/april_ml_refactor/ASSESSMENT_ML_REFACTOR_2026-04-28.md`

**New document.** A comprehensive written assessment of the `docs/april_ml_refactor/` package — three files implementing a derived-ratio purchase forecast method as a replacement for Prophet on purchase metrics.

**Assessment conclusion:**
- The methodology is theoretically correct and empirically necessary. Prophet's Gaussian likelihood is structurally misspecified for data with 4.7–16.8% nonzero daily density (confirmed by 50+ years of intermittent demand literature: Croston 1972, SBC classification 2005, ADIDA 2011, FPP3 textbook, 5 Prophet GitHub issues).
- For the 7 well-instrumented REYMA SKUs (15 usable ratio months each), the improvement is large: current Prophet errors of +1,069% and +1,752% on purchases_ordered for Feb/Mar 2026 would reduce to approximately ±15% using the derived method.
- For the 6 CARVAJAL Tier 3 SKUs, without a fallback the refactor would produce `yhat_sum = 0` — worse than Prophet's wrong-but-nonzero output. The `find_16` fallback script resolves this.
- README contained a factual error: SKU 77205001's ratio is ≈0.017, not 1.17–1.21. Corrected.

**30+ sources cited**, including: Taylor & Letham (2018), Hyndman & Athanasopoulos FPP3, Croston (1972), Nikolopoulos et al. ADIDA (2011), Hoaglin & Iglewicz (1987), Prophet GitHub issues #1442/#1432/#1880, FRED wholesale inventories-to-sales ratio, US Census Bureau Monthly Wholesale Trade Report.

---

### `docs/april_ml_refactor/ML_REFACTOR_README.TXT`

**Corrected.** Replaced the fictitious ratio example for SKU 77205001 (claimed ≈1.17–1.21, producing a February forecast of ≈42,000 CAJA40) with the actual computed ratios for all 23 demo SKUs from production data. Added the mandatory `find_16` step to the deployment sequence. Documented the class-level fallback ratios for all 6 Tier 3 SKUs.

---

## Final State of revenue_daily_for_ml (2026-04-29)

| Dimension | Value |
|---|---|
| Total rows | 10,719 (10,539 from smooth + 180 from find_16 fallback) |
| SKUs covered | 23 of 23 |
| October 2024 purchase anomaly | Smoothed — 31 synthetic rows at per-key median |
| Locked POs included | Yes — 2,477 locked orders included via find_15 |
| Tier 3 CARVAJAL SKUs | All 6 have 15 non-October purchase months via find_16 |
| Acid Test 1 | 4/4 PASS — revenue_daily untouched, source of truth intact |

---

## What Is Still Needed Before Acid Test 2 Can Be Scored

1. **ML service deployment** — `forecast_purchases_derived.py` must be added to `ml/` and the `/forecast/purchases-derived` Flask route must be added to `ml/api.py` and deployed before the updated `route.ts` can run.
2. **ML training run** — `POST /api/acid-test/forecast/run` with `scope=top`, `training_start=2024-10-01`, `training_end=2026-01-31`, `prediction_end=2026-03-31`.
3. **Odoo sync for Feb and Mar 2026** — `revenue_daily` currently has only 61 stub rows for the Feb/Mar 2026 window. A full production Odoo sync is required before the sales metric cells of Acid Test 2 can be scored against Luis's dashboard.
