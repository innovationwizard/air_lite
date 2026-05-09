# Stoplight Regression Incident — Root Cause, Fix, and Permanent Guard

**Date:** 2026-05-08  
**Scope:** ML data pipeline, Supabase `revenue_daily`, `revenue_daily_for_ml`, `products_acid_test_active`. No frontend changes. No schema migrations.  
**Stack:** Python (stdlib), PostgreSQL via Supabase REST API, Facebook Prophet via Railway ML service.  
**Severity:** P0 — demo-blocking. Client-visible stoplight regressed from 20 GREEN / 3 AMBER / 0 RED to 16 GREEN / 4 AMBER / 3 RED between the 2026-05-07 session and this session.

---

## What the Client Saw

The `/gerencia/forecast` page "Historial OC" stoplight:

| State | Expected (2026-05-06) | Actual (2026-05-08 morning) |
|-------|----------------------|------------------------------|
| Datos completos (GREEN) | 20 | 16 |
| Datos parciales (AMBER) | 3 | 4 |
| Datos insuficientes (RED) | 0 | **3** |

Three top-mover SKUs — 77201019, 77201055, 77201056 — were showing "Datos insuficientes" with 0/16 months of purchase history. These SKUs had complete 16-month records and were GREEN the day before.

---

## Root Cause Diagnosis

Diagnosis was done via direct Supabase query checking month coverage per PID in both `revenue_daily` and `revenue_daily_for_ml`.

### The 5 PIDs with broken data at time of detection:

| PID | SKU | stock_uom | revenue_daily months | rdml months | rdml data source | stoplight |
|-----|-----|-----------|---------------------|-------------|------------------|-----------|
| 1113 | 77205035 | FARDO4 | 8 | 16 | find_16 synthetic | GREEN (masked) |
| 1127 | 77205005 | FARDO4 | 0 | 15 | find_16 synthetic | AMBER ← was GREEN |
| 1587 | 77201019 | CAJA20 | 0 | 0 | nothing | RED ← was GREEN |
| 1590 | 77201055 | CAJA20 | 0 | 0 | nothing | RED ← was GREEN |
| 1600 | 77201056 | CAJA20 | 0 | 0 | nothing | RED ← was GREEN |

**stock_moves had complete 16-month real data for all 5 PIDs throughout.** The underlying source data was never lost. Only the pipeline state was broken.

---

## The Two Compounding Failures

### Failure 1 — Pipeline ordering: `smooth` ran before the recovery was complete

The 2026-05-07 UoM fix pipeline ran `fix_purchase_uom_revenue_daily_2026-05-07.py` which DELETE'd purchase rows for 17 PIDs from `revenue_daily` and attempted to re-insert the UoM-corrected versions. The re-insert failed at batch 4 (HTTP 409 duplicate key). Recovery script `fix_purchase_uom_missing_pids_2026-05-07.py` was run — but it only partially succeeded:

- pid=1113: 8 months written to `revenue_daily` (Oct 2024 – May 2025 only)
- pid=1127, 1587, 1590, 1600: 0 months written to `revenue_daily`

`smooth_oct2024_purchase_anomaly.py` was then run while `revenue_daily` was still in this broken state. The smooth script reads `revenue_daily` as its source of truth and rebuilds `revenue_daily_for_ml` from it. It correctly read the broken state and faithfully propagated the broken data to `revenue_daily_for_ml`. After smooth ran, `revenue_daily_for_ml` had 0 purchase months for 4 of the 5 PIDs.

Even if the recovery script had subsequently written correct data to `revenue_daily`, smooth was not re-run after it — so `revenue_daily_for_ml` was never updated.

**The invariant violated:** `smooth` must only run after `revenue_daily` is fully correct for all target PIDs. Running it against incomplete data propagates the incompleteness to `revenue_daily_for_ml`, where ML training reads it.

### Failure 2 — `find_16` was re-run, which is explicitly prohibited

The 2026-05-06-07 changelog pipeline section states verbatim:

> **"DO NOT run find_16 in this pipeline. It is only valid for the pre-find_15b state where the 6 Tier 3 CARVAJAL PIDs had zero real purchase data outside October 2024."**

`find_16_carvajal_tier3_fallback_purchases_for_ml.py` ran anyway, after smooth. This script:

1. Writes synthetic ratio-based purchase estimates directly to `revenue_daily_for_ml` for 6 CARVAJAL Tier 3 PIDs (5, 29, 36, 145, 1113, 1127).
2. Does NOT write to `revenue_daily` — it bypasses the source of truth entirely.
3. DELETEs existing non-October purchase rows for those 6 PIDs from `revenue_daily_for_ml` before inserting synthetic ones.

Effect of running find_16 in this session:
- PIDs 1113 and 1127: find_16 replaced their (already-0-due-to-broken-smooth) rdml rows with synthetic data. For 1113: 16 synthetic months → GREEN in stoplight (masking the revenue_daily=8 discrepancy). For 1127: 15 synthetic months (October 2024 excluded from synthetic calc) → AMBER.
- PIDs 1587, 1590, 1600: NOT in find_16's TIER3_PIDS list. find_16 never touched them. They remained at 0 months → RED.

find_16's synthetic masking of 1113 and 1127 made the problem harder to see — the stoplight showed 3 RED instead of 5 RED, and the 2 that were masked appeared fine on the surface while their `revenue_daily` data was incomplete or absent.

---

## Fix Applied

### Step 1 — `docs/reconciliation/fix_revenue_daily_5_pids_2026-05-08.py` (NEW)

Re-derives purchase quantities from `stock_moves` for all 5 affected PIDs and UPSERTs them to `revenue_daily`.

**Source:** `stock_moves WHERE from_location_id=41 AND state='done' AND move_date IN training_window AND to_location_id IN internal_locations`

**UoM normalization:** `to_stock_uom(qty, src_uom, pid_stock_uom[pid])` — the corrected formula from the 2026-05-07 UoM fix session. Never converts to CAJA40.

**Upsert, not insert:** Uses `POST /rest/v1/revenue_daily?on_conflict=product_id,ssot_label,metric,observation_date` with `Prefer: resolution=merge-duplicates`. This was the missing piece in the original recovery script — plain INSERT fails with 409 when a row already exists from a partial prior run.

**Result:**
```
pid=1113  sku=77205035  months=16/16  total=30,895.0 FARDO4   OK
pid=1127  sku=77205005  months=16/16  total=34,629.0 FARDO4   OK
pid=1587  sku=77201019  months=16/16  total=17,393.0 CAJA20   OK
pid=1590  sku=77201055  months=16/16  total=37,594.0 CAJA20   OK
pid=1600  sku=77201056  months=16/16  total=22,939.0 CAJA20   OK
[PASS] All 5 PIDs now have 16-month purchase coverage in revenue_daily.
```

### Step 2 — `smooth_oct2024_purchase_anomaly.py` re-run

Rebuilds `revenue_daily_for_ml` from the now-correct `revenue_daily`. All 5 PIDs now flow through correctly.

**Acid Test 1 verification (all 4 anchors Δ=0):**
```
[PASS] 2024-11 purchases_ordered  : got=5855.00  target=5855.0  Δ=+0.0000
[PASS] 2024-11 purchases_received : got=5500.00  target=5500.0  Δ=+0.0000
[PASS] 2024-11 sales              : got=6466.25  target=6466.25 Δ=+0.0000
[PASS] 2024-12 sales              : got=6496.50  target=6496.5  Δ=+0.0000
```

### Step 3 — `recompute_po_history_real_months_2026-05-07.py` re-run

4 rows patched:
```
77201019  pid=1587   0 → 16  HTTP 204  ← CHANGED
77201055  pid=1590   0 → 16  HTTP 204  ← CHANGED
77201056  pid=1600   0 → 16  HTTP 204  ← CHANGED
77205005  pid=1127  15 → 16  HTTP 204  ← CHANGED

Final: Green (16/16): 20  Amber (3-15): 3  Red (0-2): 0
```

**Stoplight restored to 20 GREEN / 3 AMBER / 0 RED.**

### Step 4 — `trigger_ml_training_2026-05-07.py` re-run

**69/69 OK** — an improvement over the previous 66/69. The 3 SKUs that previously failed with `insufficient_ratio_data` (77201019, 77201055, 77201056) now have full 16-month purchase history and produce valid ratio forecasts.

```
Pass 1 (Prophet, sales):    23/23 OK
Pass 2 (derived purchases): 46/46 OK
Total: 69/69 OK, 0 FAIL
```

---

## Permanent Guard Added to find_16

`find_16_carvajal_tier3_fallback_purchases_for_ml.py` now raises a `RuntimeError` at module level — before any imports are used, before any network calls are made. The script cannot run at all:

```python
raise RuntimeError(
    "find_16 is PROHIBITED after find_15b has been applied.\n"
    "Running this script deletes real stock_moves purchase data from\n"
    "revenue_daily_for_ml and replaces it with synthetic estimates.\n"
    "Incident 2026-05-08: caused stoplight regression 20/3/0 → 16/4/3.\n"
    "Fix: docs/reconciliation/fix_revenue_daily_5_pids_2026-05-08.py\n"
    "If you genuinely need the pre-find_15b fallback behavior, remove this\n"
    "guard explicitly and document why in the commit message."
)
```

The docstring was also updated with the full deprecation warning, incident reference, and the prohibition reasoning.

---

## Authoritative Pipeline Order (post-2026-05-08)

```
1. find_15_populate_revenue_daily_purchases_from_supabase.py   → revenue_daily
2. find_15b_supplement_purchases_from_stock_moves_*.py         → revenue_daily
3. smooth_oct2024_purchase_anomaly.py                          → revenue_daily_for_ml

   *** DO NOT RUN find_16 — it raises RuntimeError ***

4. populate_demand_metric_2026-05-07.py                        → revenue_daily + revenue_daily_for_ml
5. recompute_po_history_real_months_*.py                       → products_acid_test_active
6. trigger_ml_training_2026-05-07.py                           → forecast_results (sales + purchases)
7. trigger_ml_training_demand_2026-05-07.py                    → forecast_results (demand)
```

**Critical ordering rules:**
- `smooth` MUST run AFTER both `find_15` and `find_15b` have successfully completed and their output is verified in `revenue_daily`.
- `smooth` MUST NOT run while `revenue_daily` has 0 months for any of the 14 red-tier PIDs.
- `find_16` MUST NOT run under any circumstances in this pipeline (raises RuntimeError).
- `populate_demand` and `recompute` are independent of each other and can run in either order.

---

## Data State After Recovery

| Table / Field | Before fix | After fix |
|---|---|---|
| `revenue_daily` purchases for pid=1113 | 8 months | 16 months |
| `revenue_daily` purchases for pid=1127 | 0 months | 16 months |
| `revenue_daily` purchases for pid=1587 | 0 months | 16 months |
| `revenue_daily` purchases for pid=1590 | 0 months | 16 months |
| `revenue_daily` purchases for pid=1600 | 0 months | 16 months |
| `revenue_daily_for_ml` purchases for pid=1127 | 15 months (synthetic) | 16 months (real) |
| `revenue_daily_for_ml` purchases for pid=1587 | 0 months | 16 months (real) |
| `revenue_daily_for_ml` purchases for pid=1590 | 0 months | 16 months (real) |
| `revenue_daily_for_ml` purchases for pid=1600 | 0 months | 16 months (real) |
| `products_acid_test_active.po_history_real_months` | 16/4/3 | **20/3/0** |
| `forecast_results` (sales + purchases) | 66/69 OK | **69/69 OK** |
