# Step 0 — Executive Summary

**Date:** 2026-04-24
**Ran:** `docs/april_jumpstart/step0_audit/step0_audit.py`
**Findings files:** `0a_scope_findings.md`, `0b_revenue_daily_findings.md`, `0c_forecast_results_findings.md`, `0d_uom_findings.md`

> **Vulnerability gate:** Per [`../_VULNERABILITY_POLICY.md`](../_VULNERABILITY_POLICY.md), the diagnostic chart implementation (plan §6) is paused until the `frontend/` workspace reports zero `npm audit` advisories. As of 2026-04-24 there are 9 standing advisories that require semver-major bumps (next 14→16, eslint-config-next 14→16, jest-environment-jsdom 29→30). The Step 0 read-only audit was permitted because it touches no production traffic; feature work is not.

This document ties the four substeps together, ranks what actually broke vs. what didn't, and rewrites the hypothesis list from `_FORECAST_DEEP_DIVE_APR24.md §2` against concrete evidence.

---

## ⚠️ Self-correction (Rule 1)

The first run of `step0_audit.py` had a pagination bug: offset pagination without a stable `ORDER BY` clause caused PostgREST to silently drop rows for 4 product_ids (2, 3, 5, 33). The initial 0b findings wrongly reported those 4 SKUs as having zero data. Fixed by adding `order=id.asc` to all paginated reads and re-running. **All findings in this summary are from the corrected run.** The uncorrected version is not retained.

---

## TL;DR — what Step 0 actually found

1. **No placeholder rows.** Every one of the 138 (23 SKUs × 3 metrics × 2 months) `forecast_results` cells has `model_status = 'ok'` and a non-zero, trained `yhat_sum`. **Hypothesis H0a is ruled out.**
2. **No data-coverage cliff.** Every SKU × metric has `revenue_daily` rows, with Jan 2026 max observation dates in the 2026-01-23 to 2026-01-30 range (3–8 days short of Jan 31 but within tolerance).
3. **Purchases are lumpy as predicted.** Every SKU shows non-zero days in the low 15–90 range (out of 488 training days) for `purchases_ordered` and `purchases_received` — a ~3–18% density. H1 (reindex-to-zero distorts lumpy series) remains alive, especially for purchases.
4. **8 distinct stock UoMs in the 23-SKU scope.** The existing Forecast a Ciegas total row sums across these 8 UoMs, producing a number with **no unit meaning**. Per `_FORECAST_DEEP_DIVE_APR24.md §3` (UoM policy), this aggregate is mathematically invalid. **This is the structural demo defect that most plausibly explains the insider's "200 vs 40,000 fardos" experience.**
5. **`products.stock_uom_ratio = 1.0` for all 23 SKUs.** A ratio of 1.0 universally means our ingestion pipeline is treating the stock UoM as already-canonical and not applying any Odoo `uom.factor` conversion. Whether that is correct (because SSOT formulas already normalize) or dangerous (because we silently skipped conversion) requires an Odoo-side cross-check (future work, flagged below).

---

## Hypothesis triage — re-ranked against Step 0 evidence

| # | Hypothesis (from v4 plan §2) | Step 0 verdict | Evidence |
|---|---|---|---|
| **H0a** | `insufficient_history` / `training_failed` placeholder row read as forecast | **RULED OUT** | 0c: 138/138 cells `model_status='ok'`; zero placeholder rows. |
| **H0b** | UoM conversion mismatch in revenue_daily normalization | **PROMOTED to top of list** | 0a+0d: 8 distinct stock UoMs in scope. `stock_uom_ratio=1.0` universally. The scope-wide total is meaningless; any aggregate/ratio the insider reads is unit-incoherent. |
| **H0c** | Training signal collapse in late 2025 / early 2026 | **LARGELY RULED OUT** | 0b: every cell has Jan 2026 data; max observation dates cluster 2026-01-23..01-30. Training ends 2026-01-31, so we have 1–8 days of implicit zeros at the very end, which is small. |
| **H0d** | SSOT filter silently excludes some SKU's activity | **NOT TESTED YET** | Requires cross-reference against Odoo live per-SKU. Follow-up needed; moved to post-diagnostic backlog. |
| **H1** | Daily reindex-to-zero distorts lumpy purchase series | **LIKELY LIVE** | 0b: purchases have 15–90 non-zero days per SKU (3–18% density). Prophet fitting with `reindex(freq='D', fill_value=0)` on 3% density under-smooths spikes. |
| H2 | 16 months too thin for yearly seasonality | Not evaluated in Step 0 | Would need a longer history fetch; outside scope. |
| H3 | No holiday regressors | Not evaluated in Step 0 | Semana Santa 2026 = Mar 29–Apr 5. Anyone evaluating a March forecast without a holidays regressor will see systematic error. |
| H4 | Sync lag cutting training data short | **PARTIALLY INVALIDATED** | 0b shows max Jan 2026 dates are 2026-01-23..01-30; no catastrophic sync gap. |
| H5–H9 | Model-tuning variants | Unchanged | Only examine after H0b / H1 are addressed. |

### Net ranking after Step 0

1. **H0b — UoM standardization gap (structural demo defect)**
2. **H1 — Reindex-to-zero on lumpy purchases (model-structure defect)**
3. H0d — SSOT filter per-SKU (unverified)
4. H3 — Holiday regressor missing (Mar 2026 risk)
5. Everything else — deprioritized.

---

## The "200 vs 40,000 fardos" — what Step 0 can and cannot say

**What Step 0 confirms:**
- No single SKU's `forecast_results.yhat_sum` is exactly 200. The smallest is 319.22 (`77201023` / sales / Feb 2026, UoM `FARDO20`). The next smallest sales forecasts are in the 996–1,370 range.
- Historical sales for `77201023`: 13,357 total quantity across 732 rows over 2024-10 → 2026-01. Roughly 800–1,000/month. Forecasting 319/month is a 2.5–3× under-forecast for that SKU individually, not 200×.
- A 200× miss **does not appear at any individual SKU level**.

**What Step 0 implicates:**
- The "200" most plausibly comes from **aggregate read of the mixed-UoM Forecast a Ciegas table**, where the insider either:
  (a) read a single cell whose FARDO20/FARDO10/FARDO4 value looks small next to a mental expectation calibrated in a different unit, or
  (b) read the computed total row and mentally interpreted its unit as "fardos", while the raw number is a meaningless cross-UoM sum.
- Without a known canonical display unit, there is no reconciliation possible. This matches the user's Q2 binding statement: *"It is OUR JOB to standardize uom interpretation and uom display."*

**What Step 0 cannot say without Step 0d-follow-up or user input:**
- Which specific row on the Forecast a Ciegas demo page the insider was looking at when they said "200".
- Whether the insider's "fardos" corresponds to the Odoo `uom.uom` record for, e.g., `FARDO20`, or to a different packaging hierarchy (e.g., Odoo `product.packaging`).

---

## Supporting numerical facts (from substep findings)

**0a — Scope.**
- 23 SKUs: 12 REYMA + 11 CARVAJAL.
- All 23 present in Supabase `products`.
- 8 distinct stock UoMs: `CAJA40` (6), `CAJA20` (5), `FARDO20` (4), `FARDO4` (3), `FARDO10` (2), `FARDO5` (1), `CAJA` (1), `CAJA10` (1).

**0b — `revenue_daily` coverage.**
- 11,812 rows across 69 cells (23 × 3).
- Global date range: 2024-10-01 → 2026-04-17.
- Every cell has data; zero "empty" SKUs.
- Purchases sparsity (nonzero_days in full training window): worst case `77201023`/purchases_received = 20 nonzero days. Best case: sales for most SKUs is ≥ 400 nonzero days.

**0c — `forecast_results`.**
- 138/138 cells `model_status='ok'`.
- Highest forecast: `77205207`/purchases_ordered/Mar = 203,749.17 (CAJA40) — extraordinarily large relative to its sales forecast of 13,969; flag for later cross-metric consistency check (H6).
- Lowest forecast: `77201023`/sales/Feb = 319.22 (FARDO20).
- `77201046` (the reconciled test SKU) forecasts: sales Feb/Mar = 7,565 / 7,055 (CAJA40); purchases_ordered Feb/Mar = 12,886 / 10,416.

**0d — UoM.**
- Every scope SKU has `stock_uom_ratio = 1.0000` — identically. Either the SSOT formulas already normalize all the way to this unit (fine) or we silently skip conversions (dangerous). Requires Odoo-side audit.

---

## Consequences for the diagnostic chart (§4 of the plan)

Step 0 confirms Panel A (ratio bar chart per SKU × metric) is the right default view: it's UoM-safe by construction. Cross-UoM absolute-value aggregates (Panel B scope-wide totals) are out until the UoM policy is remediated.

**Revised chart page priority list:**
1. **Panel A — ratio of forecast to 12-month history mean, per SKU × metric.** Unit-safe. Makes any 10×+ miss unmissable.
2. **Panel C — single-SKU drilldown with native UoM labeled.** Unit-safe.
3. **Panel B — aggregate time series, but split per UoM group.** No cross-UoM sum. For the 23-SKU scope this means 8 small charts, each showing only the SKUs of that UoM. Ugly, but honest.

The existing Forecast a Ciegas "TOTAL" row across 23 SKUs should also be replaced with either (a) a ratio view or (b) per-class totals (REYMA vs CARVAJAL still uses mixed UoMs — also invalid — so (a) is the only correct answer unless we introduce a canonical UoM conversion).

---

## Follow-up queue (post-Step 0, not blocking the diagnostic chart)

1. **Odoo-side UoM audit.** For each of the 23 SKUs, query Odoo live for `product.product.uom_id` and `uom.uom.factor`. Compare against our `products.stock_uom` and `stock_uom_ratio`. Any mismatch is a confirmed H0b instance.
2. **SSOT filter per-SKU audit (H0d).** For one test SKU (not `77201046`, already reconciled), re-derive Nov/Dec 2024 totals from Odoo raw and compare against `revenue_daily`.
3. **H3 holiday regressor scope.** Check Mar 2025 actuals for each SKU. If Mar 2025 shows a Semana-Santa-week spike, add `holidays=Guatemala` to Prophet config.
4. **Package/Fardo conversion table.** Build `products_display_uom` (per §3.2 policy clause 4) that gives each SKU a canonical business-display UoM (likely "fardos" for packaging) and the conversion factor from stock UoM. Populate from Odoo `product.packaging` (9 records) + `product.product.x_studio_empaque` / `x_studio_paquetes` / `x_studio_capacidad` (per Odoo exploration raw).

---

## What Step 0 did NOT touch (per §6 non-goals)

- Did not modify any production data.
- Did not retrain Prophet.
- Did not change any UI.
- Did not add holiday regressors.
- Did not backfill any data.

---

## Meta (Rule 8, production-first)

Every query in `step0_audit.py` is read-only against production Supabase. Zero mock data, zero fabricated findings. The pagination bug I introduced and corrected is documented above (Rule 1). Output files in this directory are the audit trail; they can be re-generated by re-running the script against current production data.

Meta-intent reminder: **we are selling a forecaster.** The next action is the diagnostic chart (plan step 1), gated on the open clarifying questions Q7 (toggle set) and Q9 (placeholder-row UI guard — already invalidated for the 23-SKU scope since none exist).
