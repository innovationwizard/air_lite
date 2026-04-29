# Fix Plan — products_acid_test_active.id vs products.id Mismatch

**Authored:** 2026-04-28  
**Severity:** CRITICAL — ML training data is corrupted. 13 of 23 demo SKUs have zero rows in
`revenue_daily_for_ml`. 8 of the remaining 10 have data but with October 2024 not smoothed.  
**Blocking:** re-running ML training is blocked until Steps 1–3 are complete.

---

## 1. Root Cause

`products_acid_test_active` is a **standalone table** with its own `BIGSERIAL PRIMARY KEY`
(migration `20260423000003_products_acid_test.sql`). Its `.id` column is an auto-increment
sequence that is **entirely unrelated** to `products.id`.

The correct `product_id` for all FK references to `revenue_daily`, `revenue_daily_for_ml`, and
`forecast_results` is `products.id`, which must be resolved via the `products.sku` column
(matching `products_acid_test_active.default_code`).

**Confirmed mismatch table — all 23 SKUs:**

| SKU | products_acid_test_active.id | products.id |
|-----|-----------------------------:|------------:|
| 77205001 | 141 | 2 |
| 77205003 | 142 | 5 |
| 77205207 | 147 | 37 |
| 77205034 | 143 | 29 |
| 77205287 | 105 | 3 |
| 77205208 | 104 | 36 |
| 77205190 | 132 | 145 |
| 77205005 | 153 | 1127 |
| 77205002 | 107 | 1069 |
| 77205035 | 155 | 1113 |
| 77205187 | 163 | 1035 |
| 77201046 | 4 | 33 |
| 77201000 | 1 | 34 |
| 77201055 | 40 | 1590 |
| 77201053 | 39 | 1606 |
| 77201069 | 50 | 469 |
| 77201041 | 3 | 20 |
| 77201014 | 15 | 1366 |
| 77201056 | 41 | 1600 |
| 77201019 | 18 | 1587 |
| 77201038 | 31 | 539 |
| 77201047 | 35 | 1562 |
| 77201023 | 20 | 1096 |

No ID matches. The sets are completely disjoint except for two coincidences:  
- `products_acid_test_active.id=3` (→ SKU 77201041) coincides with `products.id=3` (→ SKU 77205287)  
- `products_acid_test_active.id=20` (→ SKU 77201023) coincides with `products.id=20` (→ SKU 77201041)

These coincidences are why the FK constraint on `revenue_daily_for_ml.product_id REFERENCES products(id)`
did NOT catch the bug at insertion time — the wrong IDs happened to be valid `products.id` values.

---

## 2. Confirmed Damage Assessment

### 2a. revenue_daily — CLEAN

Queried 2026-04-28. All 23 SKUs present, 10,781 rows, correct SSOT labels.  
`revenue_daily` is the source of truth and was never modified by the broken script.

### 2b. revenue_daily_for_ml — CORRUPTED

Queried 2026-04-28. **10 of 23 SKUs present, 5,154 rows.**

| products.id | SKU | Rows | Smoothed? |
|------------:|-----|-----:|-----------|
| 2 | 77205001 | 599 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 3 | 77205287 | 464 | YES — freshly smoothed by last script run |
| 5 | 77205003 | 550 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 20 | 77201041 | 519 | YES — freshly smoothed by last script run |
| 29 | 77205034 | 550 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 33 | 77201046 | 509 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 34 | 77201000 | 499 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 36 | 77205208 | 506 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 37 | 77205207 | 550 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 145 | 77205190 | 408 | **NO** — survived wrong DELETE; Oct 2024 anomaly present |
| 469 | 77201069 | 0 | MISSING — never populated |
| 539 | 77201038 | 0 | MISSING — never populated |
| 1035 | 77205187 | 0 | MISSING — never populated |
| 1069 | 77205002 | 0 | MISSING — never populated |
| 1096 | 77201023 | 0 | MISSING — never populated |
| 1113 | 77205035 | 0 | MISSING — never populated |
| 1127 | 77205005 | 0 | MISSING — never populated |
| 1366 | 77201014 | 0 | MISSING — never populated |
| 1562 | 77201047 | 0 | MISSING — never populated |
| 1587 | 77201019 | 0 | MISSING — never populated |
| 1590 | 77201055 | 0 | MISSING — never populated |
| 1600 | 77201056 | 0 | MISSING — never populated |
| 1606 | 77201053 | 0 | MISSING — never populated |

**What happened mechanically:**

The broken script (`smooth_oct2024_purchase_anomaly.py`) used `products_acid_test_active.id` as
`product_id` for its filter. The view IDs for the 23 SKUs range from 1 to 163.  
When it DELETEd from `revenue_daily_for_ml` with `product_id=in.(1,3,4,...,163)`, only
`product_id=3` and `product_id=20` existed in the table — the other 8 present SKUs (products.ids
2, 5, 29, 33, 34, 36, 37, 145) were NOT in the view.id list so they survived the DELETE unsmoothed.  
When it fetched from `revenue_daily` with the same wrong filter, it only got rows for products.id=3
and products.id=20. All 13 SKUs with products.id > 163 were never fetched, never written.

### 2c. ML Training Pipeline — BROKEN for 21 of 23 SKUs

The training pipeline (`ml/forecast_revenue.py`) correctly resolves `products.id` via the
`products` table. When it queries `revenue_daily_for_ml` for the 13 missing SKUs it finds 0 rows
and returns `model_status='insufficient_history'`. For the 8 present-but-unsmoothed SKUs, Prophet
trains on the October 2024 anomaly as if it were real signal.

### 2d. forecast_results — UNKNOWN UNTIL RE-TRAINING

Any existing `forecast_results` rows produced during the ML training that occurred while
`revenue_daily_for_ml` was corrupted must be considered unreliable and will be overwritten when
training is re-run after this fix.

---

## 3. Codebase-Wide Audit — Every File That Touches products_acid_test_active

### 3.1 Files Confirmed AFFECTED (use view.id as FK)

**`docs/reconciliation/smooth_oct2024_purchase_anomaly.py`**  
The sole writer to `revenue_daily_for_ml`. Three specific bugs:

- **Line 135–136**: fetches `id` from `products_acid_test_active` and stores as `demo_product_ids`.
  ```python
  # BUG
  demo_rows = supa_get_all('/rest/v1/products_acid_test_active?select=id,default_code')
  demo_product_ids = [r['id'] for r in demo_rows]
  ```

- **Line 141**: uses view.ids as `product_id` filter on `revenue_daily`.
  ```python
  # BUG — fetches wrong rows; 21 SKUs return 0 rows; 2 return data for wrong SKU labels
  id_filter = ','.join(str(x) for x in demo_product_ids)
  source_rows = supa_get_all(f'/rest/v1/revenue_daily?...&product_id=in.({id_filter})...')
  ```

- **Lines 226–228**: uses view.ids as `product_id` filter on DELETE from `revenue_daily_for_ml`.
  ```python
  # BUG — only deletes rows for products.id=3 and products.id=20; leaves 8 other SKUs unsmoothed
  supa_request('DELETE', f'/rest/v1/{TARGET_TABLE}?product_id=in.({id_filter})', ...)
  ```

No other line in this script independently introduces the wrong ID — lines 155–218 all derive their
`product_id` values from `r['product_id']` of the already-fetched (already wrong) source rows, so
the downstream INSERT is wrong as a consequence of the three root causes above.

---

### 3.2 Files Confirmed CORRECT (resolve via products.sku)

**`frontend/src/app/api/acid-test/forecast/run/route.ts`**  
Lines 45–64: gets `default_code` from `products_acid_test_active`; resolves `products.id` via
`products.sku`. No view.id is ever used as a FK.  ✓

**`frontend/src/app/api/acid-test/forecast/route.ts`**  
Lines 22–42: gets `default_code` from `products_acid_test_active`; resolves `products.id` via
`products.sku`. No view.id is ever used as a FK.  ✓

**`frontend/src/app/api/superuser/forecast-diagnostic/route.ts`**  
Lines 142–175: gets `default_code` from `products_acid_test_active`; resolves `products.id` via
`products.sku`. `productIds = products.map((p) => p.id)` where `products` is the result of the
`products` table query — correct.  ✓

**`docs/april_jumpstart/step0_audit/step0_audit.py`**  
Line 101: reads `product_template_id, product_product_ids` from `products_acid_test_active` (not
`.id`). Line 123: `supabase_product_id` comes from a separate `products` table lookup. Line 204:
uses `supabase_product_id` (products.id) for all FK references.  ✓

**`docs/reconciliation/find_10_populate_products_acid_test.py`**  
Populates `products_acid_test_active` itself. Does not write to `revenue_daily`,
`revenue_daily_for_ml`, or `forecast_results`. No FK issue.  ✓

**`docs/reconciliation/find_11_extract_top20_full.py`**  
Reads from `products_acid_test_active` for data extraction only (outputs to JSON). No FK writes.  ✓

**`docs/reconciliation/find_13_rerank_full_universe.py`**  
Updates `movement_rank_within_class` and `is_top_10_in_class` within `products_acid_test_active`
itself. No FK writes to other tables.  ✓

**`docs/reconciliation/find_14_extend_top20_to_23.py`**  
Superseded by `find_14b`. Reads from `products_acid_test_active` only to identify which SKUs to
process; writes to `revenue_daily` using hardcoded `SUPA_PID_BY_SKU` map (products.id values).
The hardcoded map is correct. File is no longer executed.  ✓ (but see §5.3 — retire it)

**`docs/reconciliation/find_14b_populate_revenue_daily_3newskus.py`**  
Uses hardcoded `SUPA_PID_BY_SKU` (products.id values). Does not query `products_acid_test_active`
at all. No FK issue.  ✓

**`docs/reconciliation/find_08_populate_revenue_daily_77201046.py`**  
Uses hardcoded `PRODUCT_ID = 33` (verified products.id for SKU 77201046). Does not query
`products_acid_test_active`. No FK issue.  ✓

---

## 4. Fix Plan — Ordered Steps

### Step 1 — Add products_id column to products_acid_test_active (migration)

**Why first:** Creates a machine-verifiable link between the two tables. Future scripts can use
`products_acid_test_active.products_id` directly — no runtime resolution needed, no room for
the ID mismatch to recur.

**File to create:**  
`supabase/migrations/20260428000002_products_acid_test_add_products_id.sql`

```sql
-- Add products_id FK column to products_acid_test_active.
-- Populated from the products table by matching products_acid_test_active.default_code
-- to products.sku. Null-safe: rows whose default_code has no match in products get NULL
-- (those rows are not in scope for revenue_daily or forecast_results).

ALTER TABLE products_acid_test_active
  ADD COLUMN IF NOT EXISTS products_id INT REFERENCES products(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pat_active_products_id
  ON products_acid_test_active(products_id)
  WHERE products_id IS NOT NULL;

-- Backfill: resolve each row's SKU to the corresponding products.id.
UPDATE products_acid_test_active pat
SET    products_id = p.id
FROM   products p
WHERE  p.sku = pat.default_code
  AND  pat.products_id IS NULL;

COMMENT ON COLUMN products_acid_test_active.products_id IS
  'FK to products(id). Resolved by matching default_code to products.sku. NULL if the SKU
   has no entry in the products table (out-of-scope template). Use this column — never
   products_acid_test_active.id — when referencing revenue_daily, revenue_daily_for_ml, or
   forecast_results.';
```

**Apply in Supabase Studio SQL Editor** before running any other step.

**Verification query (run immediately after applying):**
```sql
-- Expect 23 rows with non-null products_id for the demo scope.
SELECT default_code, products_id, supplier_class, movement_rank_within_class
FROM   products_acid_test_active
WHERE  is_top_10_in_class = TRUE
ORDER  BY supplier_class, movement_rank_within_class;

-- Expect 0 rows (no demo SKU should be unresolved).
SELECT default_code
FROM   products_acid_test_active
WHERE  is_top_10_in_class = TRUE
  AND  products_id IS NULL;
```

---

### Step 2 — Fix smooth_oct2024_purchase_anomaly.py

**File:** `docs/reconciliation/smooth_oct2024_purchase_anomaly.py`

Replace lines 132–148 (Step 1 block) with a correct ID resolution:

```python
# ── Step 1: Get the 23 demo product_ids ───────────────────────────────────────
#
# CRITICAL: Use products.id (FK for revenue_daily / revenue_daily_for_ml /
# forecast_results), NOT products_acid_test_active.id which is an unrelated
# auto-increment. Resolve via products.sku matching default_code.

print("Fetching 23 demo SKUs from products_acid_test_active...")
demo_meta = supa_get_all('/rest/v1/products_acid_test_active?select=default_code&is_top_10_in_class=eq.true')
demo_skus = [r['default_code'] for r in demo_meta if r.get('default_code')]
assert len(demo_skus) == 23, f"Expected 23 top demo SKUs, got {len(demo_skus)}"
print(f"  {len(demo_skus)} demo SKUs: {sorted(demo_skus)}")

print("Resolving products.id for each SKU from products table...")
sku_csv = ','.join(demo_skus)
prod_rows = supa_get_all(f'/rest/v1/products?select=id,sku&sku=in.({sku_csv})')
sku_to_pid = {r['sku']: r['id'] for r in prod_rows}

missing = [s for s in demo_skus if s not in sku_to_pid]
if missing:
    raise SystemExit(f"ERROR — {len(missing)} demo SKUs not found in products table: {missing}")

demo_product_ids = [sku_to_pid[s] for s in demo_skus]
print(f"  Resolved {len(demo_product_ids)} products.id values: {sorted(demo_product_ids)}\n")
```

No other lines require changes — the rest of the script derives `product_id` from
`r['product_id']` on revenue_daily rows, which will now be correctly fetched using valid
`products.id` values.

Additionally, add a guard at the top of Step 5 (clear + repopulate) to ensure a full wipe:

```python
# ── Step 5: Clear ALL rows from revenue_daily_for_ml for demo SKUs, then repopulate ─────
# Use products.id values (demo_product_ids) — never view.id. A full wipe ensures no
# stale rows from prior broken runs survive.

print(f"Clearing {TARGET_TABLE} for all 23 demo SKUs (products.ids)...")
status, body = supa_request(
    'DELETE',
    f'/rest/v1/{TARGET_TABLE}?product_id=in.({id_filter})',
    prefer='return=minimal'
)
if status >= 400:
    raise RuntimeError(f"DELETE from {TARGET_TABLE}: HTTP {status}: {body}")
print(f"  Cleared.\n")
```

Since `id_filter` will now be built from the correct `demo_product_ids` (products.id values), the
DELETE will remove all rows for all 23 SKUs before the full re-insert.

---

### Step 3 — Run the fixed script

```bash
cd /Users/jorgeluiscontrerasherrera/Documents/_git/air_lite
python3 docs/reconciliation/smooth_oct2024_purchase_anomaly.py
```

**Expected output (key lines):**

```
Demo SKUs: 23
Resolved 23 products.id values: [2, 3, 5, 20, 29, 33, 34, 36, 37, 145, 469, 539, 1035, 1069, 1096, 1113, 1127, 1366, 1562, 1587, 1590, 1600, 1606]

Rows fetched from revenue_daily: ~10781

Smoothing plan — N (product, metric, ssot_label) combinations will have Oct 2024 replaced:
[table showing all 23 SKUs × purchase metrics]

Output: ~10700 rows (source − dropped Oct purchase rows + N synthetic)

Clearing revenue_daily_for_ml for demo SKUs...
  Cleared.

Inserting ~10700 rows into revenue_daily_for_ml...
  Inserted ~10700 rows.

=== Verification — monthly purchase totals for Oct 2024 ===
  N rows in revenue_daily_for_ml for October 2024 purchases.
  (Expected: N — one synthetic row per smoothed combination)

[PASS] 2024-11 sales            : prod=6466.25  target=6466.25  Δ=+0.0000
[PASS] 2024-12 sales            : prod=6496.50  target=6496.50  Δ=+0.0000
[PASS] 2024-11 purchases_ordered: prod=5855.00  target=5855.0   Δ=+0.0000
[PASS] 2024-11 purchases_received: prod=5500.00 target=5500.0   Δ=+0.0000

Acid Test 1 intact — revenue_daily untouched, perfect score preserved.
```

If any acid test row shows FAIL or any SKU count differs from 23, **stop and investigate before
proceeding to Step 4**.

---

### Step 4 — Verify revenue_daily_for_ml completeness

Run this verification query via Supabase Studio or the Python REST client:

```sql
-- Expect 23 rows, one per demo SKU. All should show rows > 0.
SELECT
  p.sku,
  p.id AS products_id,
  COUNT(ml.id)                                             AS total_rows,
  COUNT(ml.id) FILTER (WHERE ml.metric = 'sales')         AS sales_rows,
  COUNT(ml.id) FILTER (WHERE ml.metric = 'purchases_ordered')   AS po_rows,
  COUNT(ml.id) FILTER (WHERE ml.metric = 'purchases_received')  AS pr_rows,
  -- Verify October 2024 anomaly is smoothed: at most 1 purchase row per SKU for Oct 2024
  COUNT(ml.id) FILTER (
    WHERE ml.metric IN ('purchases_ordered','purchases_received')
      AND ml.observation_date BETWEEN '2024-10-01' AND '2024-10-31'
  )                                                        AS oct_purchase_rows
FROM products_acid_test_active pat
JOIN products p ON p.sku = pat.default_code
LEFT JOIN revenue_daily_for_ml ml ON ml.product_id = p.id
WHERE pat.is_top_10_in_class = TRUE
GROUP BY p.sku, p.id
ORDER BY p.sku;
```

**Pass criteria:**
- 23 rows returned
- `total_rows > 0` for every SKU
- `oct_purchase_rows <= 2` for every SKU (at most 1 synthetic `purchases_ordered` + 1 synthetic
  `purchases_received`)

---

### Step 5 — Re-run ML training for all 23 demo SKUs

Once Step 4 passes, re-run Prophet training via the `acid-test/forecast/run` endpoint:

```bash
# Scope = all 23 top SKUs, training window unchanged
curl -X POST https://<your-app>/api/acid-test/forecast/run \
  -H "Content-Type: application/json" \
  -d '{
    "scope": "top",
    "training_start": "2024-10-01",
    "training_end": "2026-01-31",
    "prediction_end": "2026-03-31",
    "dry_run": false
  }'
```

**Expected summary response:**
```json
{
  "summary": {
    "sku_count": 23,
    "cells_attempted": 69,
    "ok": "<expected high — investigate any failures>",
    "failed": "<expected low>",
    ...
  }
}
```

Any cell with `model_status = 'insufficient_history'` after this run should be investigated —
it means `revenue_daily_for_ml` is still missing rows for that SKU.

---

## 5. Prevention — Structural Safeguards

### 5.1 Naming convention rule (enforced in code review)

**Rule:** No script may use `products_acid_test_active.id` as a `product_id` FK value in any
table. The only correct path is:  
```
products_acid_test_active.default_code → products.sku → products.id
```
After Step 1 is applied:  
```
products_acid_test_active.products_id (direct FK)
```

### 5.2 Use products_acid_test_active.products_id going forward

After Step 1 is applied and the migration verified, all new scripts that need `products.id` from
the scope table must select `products_id`:

```python
# CORRECT — after migration 20260428000002 is applied
demo_rows = supa_get_all(
    '/rest/v1/products_acid_test_active'
    '?select=default_code,products_id'
    '&is_top_10_in_class=eq.true'
    '&products_id=not.is.null'
)
demo_product_ids = [r['products_id'] for r in demo_rows]
```

### 5.3 Retire find_14_extend_top20_to_23.py

`docs/reconciliation/find_14_extend_top20_to_23.py` is superseded by `find_14b`. Add a header
comment marking it retired, or delete the file entirely after confirming `find_14b` is the
canonical replacement.

### 5.4 Consider a CHECK constraint (optional, schema-level guard)

The FK `revenue_daily_for_ml.product_id REFERENCES products(id)` already prevents insertion of
product_ids that do not exist in `products`. However it does not prevent insertion of a valid
`products.id` for the *wrong* SKU (as happened with IDs 3 and 20 coinciding). The correct
enforcement is code-level discipline (§5.1 and §5.2), not a DB constraint, since the DB cannot
know which `products.id` values are "intended."

---

## 6. Files Changed by This Fix Plan

| File | Action | Step |
|------|--------|------|
| `supabase/migrations/20260428000002_products_acid_test_add_products_id.sql` | CREATE | 1 |
| `docs/reconciliation/smooth_oct2024_purchase_anomaly.py` | EDIT lines 132–148, 224–231 | 2 |

No API routes, no frontend pages, no other migration files require changes.

---

## 7. What This Fix Does NOT Change

- `revenue_daily` — untouched; remains the source of truth.
- The acid test verification logic — unchanged.
- All three API routes — already correct; no changes needed.
- The ML training endpoint — already correct; no changes needed.
- `products_acid_test_active` data — only the new column is added; existing rows and
  `movement_rank_within_class` ranking are unchanged.

---

## 8. Risk of This Fix

**Low.** The migration in Step 1 is additive (new nullable column + backfill UPDATE). The script
change in Step 2 replaces a wrong filter with a correct one. The DELETE in Step 5 will wipe
`revenue_daily_for_ml` for all 23 demo SKUs — this is safe because `revenue_daily_for_ml` is
ML-only, never read by any UI page or acid test.

The re-training in Step 5 overwrites `forecast_results` rows via UPSERT, not DELETE, so partial
progress is safe if the training run times out.
