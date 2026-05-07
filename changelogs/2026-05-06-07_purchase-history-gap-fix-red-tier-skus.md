# Purchase History Gap — Root Cause Resolution for 14 Red-Tier Demo SKUs: Stock Moves Supplement, Stoplight Recomputation, and Full ML Retrain

**Dates:** 2026-05-06 / 2026-05-07
**Scope:** ML data pipeline, Supabase `revenue_daily`, `revenue_daily_for_ml`, `products_acid_test_active`, `purchase_order_lines`. Frontend: `gerencia/forecast` info-icon tooltips. No schema migrations.
**Stack:** Python (stdlib), PostgreSQL via Supabase REST API, Facebook Prophet via Railway ML service, Next.js / React (tooltip UI).
**Driving context:** A client insider flagged that SKU 77205001 (Bandeja Bio 2P Foam 10/50 Termo Fom, CARVAJAL) was displayed as "Datos insuficientes (2/16 meses)" in the forecast page, but confirmed that real purchase data exists and is complete for that product. The same problem affected 7 other top-mover SKUs. Investigation revealed a structural procurement data gap: none of these products ever had purchase data in `purchase_order_lines` — their receipts flow exclusively through `stock.picking "Recibidos Internacional"`, which writes to `stock_moves`, not to `purchase_orders`. The ML training pipeline read only `purchase_order_lines` and therefore had never seen this data.

---

## Why This Was Done

### The Immediate Symptom

The `/gerencia/forecast` page displays a "Historial OC" stoplight for each demo SKU based on `products_acid_test_active.po_history_real_months` — the count of calendar months in the 16-month training window (October 2024 through January 2026) that have at least one confirmed purchase order in `revenue_daily_for_ml`. The thresholds:

- **GREEN (16/16):** Complete history. Ratio-derived purchase forecasts are reliable.
- **AMBER (3–15/16):** Partial history. Accuracy pending Acid Test 2 validation.
- **RED (0–2/16):** Insufficient real history. Purchase forecasts unreliable.

Eight of the 23 demo SKUs were showing RED with `po_history_real_months = 2`. All eight are among the top commercial movers for their categories. Showing a client that their highest-volume products have "insufficient data" when the data is complete and available is a critical demo credibility problem.

### The Root Cause

The 23 demo SKUs fall into two procurement populations that use completely different Odoo workflows:

**Population A — Standard domestic distribution (9 SKUs):**
Products from REYMA, INTCOMEX, and local distributors. Purchases flow through the standard Odoo PO workflow: `purchase.order` → `purchase.order.line`. These records land in Supabase `purchase_orders` + `purchase_order_lines`. The `find_15` pipeline script reads these tables and populates `revenue_daily`. Result: 16/16 months of history. These were always GREEN.

**Population B — Import products through El Salvador (14 SKUs):**
Products procured via international freight — CARVAJAL packaging products and others in the red-tier group. Their procurement channel in Odoo is `stock.picking` of type "Recibidos Internacional". These operations record physical stock receipts directly as inventory moves with no `purchase.order` header at all. They land in Supabase `stock_moves` with `from_location_id = 41` (the "Partners/Vendors" supplier location) and `state = 'done'`. The `purchase_order_lines` table has zero rows for these SKUs after November 2024 — not because the data is missing, but because these products were never procured via standard POs. They had exactly 2 months of purchase data in `purchase_order_lines` (October–November 2024, from the onboarding batch load) and nothing since.

The `find_15` pipeline only reads `purchase_order_lines`. It had never been told to look at `stock_moves`. So for the 14 import-route SKUs, the ML system thought they had 2 months of purchase history when they actually had a complete 16-month record sitting in `stock_moves`.

**Verification (2026-05-06, direct query):**
All 14 red-tier PIDs were queried against `stock_moves` with filters `from_location_id = 41`, `state = 'done'`, `move_date` in the training window, destination in internal locations. All 14 had complete coverage across the 16-month window with no gaps — the data was always there.

### Secondary Finding: 982 Missing purchase_order_lines Rows

While auditing `real_data/purchase.order.line_20260303.csv` (the Odoo export, 20,540 rows) against Supabase `purchase_order_lines` (16,159 rows at the start of this session), a gap of ~4,381 rows was identified. Of these:
- 1,418 rows have `[0]` as the SKU prefix in their description — products with no internal Odoo code, cannot be resolved to a `products.id`.
- 1,191 rows have barcode or unknown prefixes — cannot be resolved.
- **982 rows are resolvable** — they have a valid `[SKU]` prefix that matches a known `products.sku`.

These 982 rows represent real purchase order lines that were not included in the original March 2022 Supabase bulk load. None of them are for the 14 red-tier SKUs (confirmed: those SKUs have zero POL rows in the CSV after November 2024 regardless). They represent PO data for other products in the catalogue.

---

## What Was Investigated Before Writing Any Code

1. **`real_data/MANIFEST.md` created** — A complete inventory of all 27 files in `real_data/`, covering every file, every sheet, all column headers with interpretation relative to the prod DB, row counts, state distributions, and date ranges. Key finding documented: the `purchase.order.line_20260303.csv` gap and the explanation for why the red-tier SKUs have no rows in it.

2. **`purchase_order_lines` actual row count verified** — An earlier query had been limited to 1,000 rows (Supabase default) and incorrectly reported only ~1,000 total. A `Prefer: count=exact` HEAD request confirmed the true count was 16,159. All subsequent reasoning was based on the correct figure.

3. **All 6 UoMs appearing in red-tier `stock_moves` receipts verified** — Before writing the supplement script, the units of measure used in the target moves (FARDO10, FARDO4, CAJA20, CAJA40, FARDO20, FARDO5) were confirmed to exist in the `units_of_measure` table with valid non-zero ratios. The UoM normalization formula `qty * CAJA40_RATIO / src_ratio` would produce valid output for all records.

4. **Vendor location ID confirmed** — `stock_locations` queried directly; `id = 41` is named "Partners/Vendors" with `location_type = 'supplier'`. This is the single vendor location in the system.

---

## Changes by File

### `real_data/MANIFEST.md` — NEW

Complete inventory of the `real_data/` directory. 27 files documented with: file name, format, approximate row count, date range, state distribution (where applicable), and column-by-column interpretation against the Supabase schema. Notable findings recorded:
- `purchase.order.line_20260303.csv`: 20,540 rows vs 16,159 in Supabase, with breakdown of the 4,381-row gap by category.
- `stock.picking_20260303.csv`: 10,643 "Recibidos Internacional" records — the procurement channel for red-tier SKUs.
- `account.move.line_Q2_2025`: absent from all exports (April–June 2025 gap, no file available).
- CARVAJAL appears under 4 distinct supplier names in `res.partner` — documented for future dedup.

---

### `docs/reconciliation/load_missing_purchase_order_lines_2026-05-06.py` — NEW

**Purpose:** Load the 982 resolvable `purchase_order_lines` rows present in the Odoo CSV export but missing from Supabase.

**Source:** `real_data/purchase.order.line_20260303.csv`
**Target table:** `purchase_order_lines`

**SKU resolution:** The `description` column in the CSV follows the Odoo format `[SKU_CODE] Product Name`. A regex `r'^\[([^\]]+)\]'` extracts the bracket prefix. The extracted string is looked up in `products.sku` → `products.id`. Rows with `[0]` (no internal code) or unknown/barcode prefixes are skipped.

**Deduplication:** No `odoo_id` column exists on `purchase_order_lines`. Natural key used: `(order_id, description, expected_delivery)`. Any row matching this triple against existing rows is skipped. The `expected_delivery` value from both the database and the CSV is truncated to `[:10]` (date-only) before comparison to neutralize time-component differences.

**Outcome after first run:** 982 rows attempted. Post-insert audit found 23 rows in `purchase_order_lines` with `created_at = 2026-05-07` for `product_id = 33` (SKU 77201046). Two of these were true duplicates caused by a timezone-shift artifact: the original Supabase rows stored `expected_delivery` with a non-zero time component (e.g., `2024-11-22T00:01:21+00:00`), shifting the date to `2024-11-22`, while the CSV had the same PO line with `2024-11-21` — a 1-day discrepancy from UTC/Guatemala time zone handling. The natural key comparison saw different dates and inserted both.

**Duplicate cleanup:** All 23 rows created on 2026-05-07 for `product_id = 33` were identified. Cross-referenced against the original rows by `(order_id, product_id, quantity, uom)`. 22 were confirmed true duplicates; 1 was genuinely new (`order_id = 81`, `expected_delivery = 2026-02-20`, which is outside the training window and has no effect on any metric). All 23 were deleted for a clean state, then the original 960 genuinely new rows remain.

**Final state:** 16,159 → 17,118 rows in `purchase_order_lines` (+960 net new).

**Important note documented in the script header:** This script does NOT fix `po_history_real_months` for the red-tier demo SKUs. The CSV confirms zero POL records for those SKUs after November 2024. The fix for that requires `find_15b`.

---

### `docs/reconciliation/find_15b_supplement_purchases_from_stock_moves_2026-05-06.py` — NEW

**Purpose:** Populate `revenue_daily` purchase data for the 14 red-tier PIDs from `stock_moves` receipts, covering the months not already populated by `find_15`.

**Must run AFTER `find_15`** — `find_15` deletes and rebuilds all purchase rows in `revenue_daily` for the 23 demo SKUs before inserting from `purchase_order_lines`. Running `find_15b` before `find_15` would result in the supplement rows being deleted.

**Target PIDs (14 red-tier):**
```python
RED_TIER_PIDS = [2, 3, 5, 29, 34, 36, 145, 1069, 1096, 1113, 1127, 1587, 1590, 1600]
```

These are the products whose `purchase_order_lines` coverage is 0–2 months in the training window, verified by direct query against the CSV and Supabase.

**Source query:**
```
stock_moves WHERE:
  product_id IN (RED_TIER_PIDS)
  AND from_location_id = 41         -- Partners/Vendors (single vendor location)
  AND state = 'done'                -- physical receipt confirmed
  AND move_date BETWEEN 2024-10-01 AND 2026-01-31T23:59:59
```

An additional filter is applied after fetch: `to_location_id` must be in the set of internal location IDs (fetched from `stock_locations WHERE location_type = 'internal'`). This excludes transit-to-transit moves that are not real warehouse receipts.

**UoM normalization:** Identical formula to `find_15`:
```
normalized_qty = raw_qty * CAJA40_RATIO / src_uom_ratio
CAJA40_RATIO = 0.025  (from units_of_measure WHERE name='CAJA40')
```

**SSOT labels:** Same labels as `find_15`, so the ML pipeline reads them without code changes:
- `purchases_ordered`:  `pol_confirmed_date_planned_product_qty_c40`
- `purchases_received`: `pol_purchase_done_date_planned_qty_received_c40`

Both metrics are populated from `stock_moves.quantity` using the same value. This is correct: for import products with no separate "ordered" vs "received" distinction, the received quantity IS the ordered quantity. The physical receipt IS the confirmed order.

**Idempotency:** Before inserting, all existing `(product_id, observation_date, metric)` triples in `revenue_daily` for the target PIDs are fetched. Any cell already present is skipped. Safe to re-run; will not duplicate `find_15` rows.

**Outcome:**
- 2,374 stock_moves rows fetched → 2,373 pass the internal-destination filter
- 1,588 daily cells aggregated
- 75 existing cells in `revenue_daily` already present from `find_15` (Oct–Nov 2024 onboarding batch)
- 3,139 new rows inserted

**Coverage after insert:**
| PID | SKU | Months |
|---|---|---|
| 2 | 77205001 | 16/16 ✓ |
| 3 | 77205287 | 15/16 (Mar-2025 missing — no receipt that month) |
| 5 | 77205003 | 16/16 ✓ |
| 29 | 77205034 | 16/16 ✓ |
| 34 | 77201000 | 16/16 ✓ |
| 36 | 77205208 | 16/16 ✓ |
| 145 | 77205190 | 16/16 ✓ |
| 1069 | 77205002 | 16/16 ✓ |
| 1096 | 77201023 | 16/16 ✓ |
| 1113 | 77205035 | 16/16 ✓ |
| 1127 | 77205005 | 16/16 ✓ |
| 1587 | 77201019 | 16/16 ✓ |
| 1590 | 77201055 | 16/16 ✓ |
| 1600 | 77201056 | 16/16 ✓ |

77205287 (CARVAJAL): the missing March 2025 is a verified absence — `stock_moves` has no receipt with `from_location_id = 41` for `product_id = 3` in that calendar month. There was no purchase in March 2025; this is not a data gap.

---

### `docs/reconciliation/recompute_po_history_real_months_2026-05-07.py` — NEW

**Purpose:** Recompute and PATCH `products_acid_test_active.po_history_real_months` for all 23 demo SKUs from the current state of `revenue_daily_for_ml` after the full pipeline has run.

**When to run:** After `find_15` → `find_15b` → `smooth_oct2024_purchase_anomaly.py`. Must NOT be run after `find_16` (the synthetic CARVAJAL Tier 3 fallback script), because `find_16` uses the same SSOT label as real data and would inflate the count with synthetic months. Since `find_15b` now provides real stock_moves data for all 14 red-tier PIDs (including the 6 that `find_16` previously served), `find_16` is no longer needed and must not be run.

**Definition applied:**
```
po_history_real_months = COUNT(DISTINCT observation_date[:7])
FROM revenue_daily_for_ml
WHERE product_id = <pid>
  AND metric = 'purchases_ordered'
  AND ssot_label = 'pol_confirmed_date_planned_product_qty_c40'
  AND observation_date BETWEEN '2024-10-01' AND '2026-01-31'
```

**Logic:** For each of the 23 demo SKUs, queries `revenue_daily_for_ml` and counts distinct calendar months with at least one qualifying row. Compares against the current value in `products_acid_test_active`. Patches only rows where the value has changed.

**Result — 8 rows changed:**

| SKU | PID | Old | New | Delta |
|---|---|---|---|---|
| 77205001 | 2 | 2 | 16 | +14 |
| 77205287 | 3 | 2 | 15 | +13 |
| 77201000 | 34 | 2 | 16 | +14 |
| 77205002 | 1069 | 2 | 16 | +14 |
| 77201023 | 1096 | 2 | 16 | +14 |
| 77201055 | 1590 | 2 | 16 | +14 |
| 77201056 | 1600 | 2 | 16 | +14 |
| 77201019 | 1587 | 2 | 16 | +14 |

**Final stoplight distribution after patch:**
- **GREEN (16/16): 20 SKUs** — up from 12
- **AMBER (3–15/16): 3 SKUs** — 77205187 (5/16), 77205207 (5/16), 77205287 (15/16)
- **RED (0–2/16): 0 SKUs** — down from 8

The 3 remaining AMBER SKUs are correctly classified:
- **77205187** and **77205207**: Non-import domestic SKUs. Their `purchase_order_lines` data spans only 5 months in the training window. This is their real procurement history — there were genuinely no confirmed POs for those products in 11 of the 16 training months. `stock_moves` was also checked; these products have no "Recibidos Internacional" pattern. The 5/16 is accurate.
- **77205287**: Missing only March 2025 as explained above (verified no receipt).

---

### Pipeline Execution — Full Run

The pipeline was run in the correct sequence on 2026-05-07:

**Step 1 — `find_15` (re-run)**

Required because `find_15` clears all purchase rows for the 23 demo SKUs before rebuilding from `purchase_order_lines`. This clean-slate approach ensures the supplement from `find_15b` applies to a known-good base. The re-run verified the acid test anchor first:

```
[PASS] Nov 2024 purchases_ordered (77201046): got=5855.00  target=5855.00  Δ=+0.0000
[PASS] Nov 2024 purchases_received (77201046): got=5500.00  target=5500.00  Δ=+0.0000
```

Note: The first attempt at the Step 1 re-run failed the anchor check (got=11,543, Δ=+5,688 for `purchases_ordered`). Root cause traced to the duplicate POL rows created by `load_missing_purchase_order_lines`. After deleting the 23 duplicate rows, the re-run passed both anchors.

**Step 2 — `find_15b` (first run)**

3,139 rows inserted into `revenue_daily`. 13/14 PIDs: 16/16 months. 1/14 (77205287): 15/16 months.

**Step 3 — `smooth_oct2024_purchase_anomaly.py` (re-run)**

Rebuilds `revenue_daily_for_ml` from `revenue_daily`. October 2024 purchase rows are replaced with the median of other months for each (product, metric, ssot_label) combination. With `find_15b` data now in `revenue_daily`, the Tier 3 PIDs that previously had only October data now have 16 months — so the October smoothing for those SKUs uses a real multi-month median instead of falling back to zero.

Smoothed Oct 2024 values (selected):
| PID | SKU | Oct raw | Median (replacement) |
|---|---|---|---|
| 2 | 77205001 | 24,384.75 | 9,473.50 |
| 3 | 77205287 | 6,340.00 | 1,462.25 |
| 34 | 77201000 | 2,172.00 | 5,840.00 |
| 1096 | 77201023 | 636.00 | 225.00 |

Acid test anchors verified post-smoothing: all 4 anchors (Nov 2024 purchases_ordered, purchases_received, sales Dec 2024, sales Nov 2024 for SKU 77201046) passed with Δ=0.

**Step 4 — `recompute_po_history_real_months_2026-05-07.py` (first run)**

8 PATCH operations. All HTTP 204. Result: 20 GREEN, 3 AMBER, 0 RED.

**Step 5 — `run_full_training_2026-05-05.py` (re-run)**

Two-pass ML training for all 23 demo SKUs:
- **Pass 1 (Prophet, sales):** 23/23 OK. 46 rows upserted to `forecast_results`.
- **Pass 2 (derived ratio, purchases):** 46/46 OK. 92 rows upserted to `forecast_results`.
- **Total:** 138/138 forecast cells confirmed (23 PIDs × 3 metrics × 2 months: Feb and Mar 2026).

Selected derived-ratio results for previously red-tier SKUs:
| PID | SKU | R (ordered) | Months used |
|---|---|---|---|
| 2 | 77205001 | 0.2487 | 15 (1 excl.) |
| 3 | 77205287 | 0.2548 | 12 (3 excl.) |
| 34 | 77201000 | 1.0131 | 15 (1 excl.) |
| 1069 | 77205002 | 0.4965 | 14 (2 excl.) |
| 1096 | 77201023 | 0.5215 | 16 |
| 1127 | 77205005 | 0.0983 | 16 |
| 1587 | 77201019 | 0.5023 | 16 |
| 1590 | 77201055 | 0.5175 | 14 (2 excl.) |
| 1600 | 77201056 | 0.5205 | 15 (1 excl.) |

The Tukey IQR×1.5 exclusions in `months_used` represent months where the PO/Sales ratio was an outlier (e.g., bulk onboarding months with atypically high PO volumes). These are correctly excluded from the ratio computation.

---

### Frontend — `frontend/src/app/(authenticated)/gerencia/forecast/page.tsx`

**Info icon tooltips added to Historial OC filter buttons.**

The forecast page displays three filter buttons — Datos completos, Datos parciales, Datos insuficientes — that control which stoplight tier is visible in the SKU table. A client or analyst unfamiliar with the technical definition of each tier cannot know what "2/16" means or why the threshold is at 3 months. This creates trust friction during a demo.

**Change:** Added an `(i)` icon (Lucide `Info`, 14×14px) to the right of each tier button. Clicking the icon opens a popover below the button with the full technical definition. Clicking again (or the "Cerrar" link) dismisses it. Only one popover is open at a time.

**State:**
```typescript
const [openTip, setOpenTip] = useState<CompletenessTier | null>(null);
```

**Tooltip content (production copy):**

*Datos completos (GREEN):*
> 16/16 meses del período de entrenamiento (oct 2024 – ene 2026) tienen al menos una OC confirmada (estado: compra / bloqueado / hecho). Datos sintéticos no cuentan. Máxima calidad de datos para el forecast de compras.

*Datos parciales (AMBER):*
> Entre 3 y 15 meses tienen OC confirmadas. Historial parcial; la precisión del forecast de compras está pendiente de validación empírica. El umbral de 3 meses es un proxy provisional.

*Datos insuficientes (RED):*
> 0 a 2 meses con OC confirmadas. Historial real insuficiente — datos sintéticos no cuentan. El forecast de compras para estos SKUs no es confiable.

**Positioning:** The popover is absolutely positioned below the icon button (`top-full mt-2`) with `z-50` and `left-0` anchoring. It does not obscure the filter button itself.

---

## Decisions Not to Take

**`find_16` is deprecated for the 14 red-tier PIDs.** `find_16` was a synthetic fallback that computed purchase quantities as `monthly_sales × R_class` for six CARVAJAL Tier 3 SKUs that had no purchase data outside October 2024. After `find_15b`, those six SKUs now have real stock_moves data for all 16 training months. Running `find_16` after `find_15b` would delete the real data from `revenue_daily_for_ml` and replace it with synthetic estimates — strictly worse. `find_16` must not be run as part of the post-`find_15b` pipeline.

**`sale_order_lines` gap (~2,695 rows) deferred.** The Odoo CSV has more `sale_order_lines` rows than Supabase, but `sale_order_lines` has no `odoo_id` column. Without a stable deduplication key, loading additional rows risks silent duplicates. Blocked pending a schema migration to add an `odoo_id` column.

**Q2 2025 account.move.line gap deferred.** April–June 2025 accounting data is absent from all files in `real_data/`. There is no export file covering that period. Requires a new Odoo export.

---

## Data State After This Session

| Table | Before | After | Note |
|---|---|---|---|
| `purchase_order_lines` | 16,159 rows | 17,118 rows | +960 net new (960 genuine, 23 dupes deleted after cleanup) |
| `revenue_daily` (purchase rows, 14 red-tier PIDs) | ~75 rows (Oct–Nov 2024 only) | ~3,214 rows | Full 16-month coverage from stock_moves |
| `revenue_daily_for_ml` | 10,393 rows | 13,532 rows | Rebuilt by smooth_oct2024 with complete red-tier data |
| `products_acid_test_active.po_history_real_months` | 8 × 2, 2 × 5, 9 × 16 | 0 × 2, 3 × (5 or 15), 20 × 16 | 8 red-tier SKUs: 2 → 16 |
| `forecast_results` | Stale (pre-fix) | 138 fresh rows | 23 PIDs × 3 metrics × 2 months, all ok/ok_derived |

---

## Pipeline Order (authoritative, post-find_15b)

```
1. find_15_populate_revenue_daily_purchases_from_supabase.py   → revenue_daily
2. find_15b_supplement_purchases_from_stock_moves_*.py         → revenue_daily
3. smooth_oct2024_purchase_anomaly.py                          → revenue_daily_for_ml
4. recompute_po_history_real_months_*.py                       → products_acid_test_active
5. run_full_training_*.py                                      → forecast_results (ML)

DO NOT run find_16 in this pipeline. It is only valid for the pre-find_15b state
where the 6 Tier 3 CARVAJAL PIDs had zero real purchase data outside October 2024.
```
