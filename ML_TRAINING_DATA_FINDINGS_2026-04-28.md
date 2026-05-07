# ML Training Data Structure — Findings 2026-04-28

**Scope:** Production database analysis for the 23-SKU demo sample.
**Purpose:** Validate or refute two hypotheses about sales and purchase training data structure, and identify root causes of forecast inaccuracies reported by the insider on 2026-04-28.
**Data source:** All numbers queried directly from production Supabase. No assumptions.

---

> **SUPERSEDED — 2026-05-07**
>
> The purchase data situation described in this document — specifically the analysis of SKU 77205001 (pid=2) showing R=0.0162 derived from 2 onboarding months — has been resolved. The complete purchase history for that SKU and 13 others was found in `stock_moves` and loaded into `revenue_daily` via `find_15b`. The R value for SKU 77205001 is now 0.2487 computed from 15 months of real data.
>
> The sales analysis (Hypothesis 1 — zero-sale days, day-of-week breakdown, density metrics) remains valid and unchanged.
>
> **How the purchase gap was found and fixed:** [`changelogs/2026-05-06-07_purchase-history-gap-fix-red-tier-skus.md`](changelogs/2026-05-06-07_purchase-history-gap-fix-red-tier-skus.md)
>
> **Where current purchase coverage data lives:** `docs/reconciliation/recompute_po_history_real_months_2026-05-07.py` output — 20 GREEN / 3 AMBER / 0 RED across 23 demo SKUs.

---

## Context

The Forecast a Ciegas page displays Prophet ML predictions for February and March 2026, trained on `revenue_daily` from 2024-10-01 to 2026-01-31 (488 calendar days). The insider reported:

1. **Ventas Feb + Mar 2026 for SKU 77205001 are ~20% below real values.**
2. **Compras Ordenadas Mar 2026 for SKU 77205001 (63,639 units) is impossibly large** — the insider's words: "That amount of product is impossible to fit. The decision makers will immediately dump the project."

---

## Hypothesis 1 — Sales: Zero-sale days are expected stochastic behavior

### Hard Data

`forecast_results`, metric = `sales`, all 23 SKUs, 488 training days:

| Statistic | Value |
|---|---|
| Nonzero sale days — minimum across 23 SKUs | 366 / 488 (75.0%) |
| Nonzero sale days — maximum across 23 SKUs | 471 / 488 (96.5%) |
| Nonzero sale days — median across 23 SKUs | 434 / 488 (88.9%) |
| SKUs with density below 50% | 0 of 23 |
| SKUs with density above 80% | 21 of 23 |

Day-of-week breakdown for SKU 77205001, zero-sale days vs. sale days over 488 training days (`revenue_daily`, metric = `sales`):

| Day | Sale days | Zero days |
|---|---|---|
| Monday | 68 | 1 |
| Tuesday | 70 | 0 |
| Wednesday | 68 | 2 |
| Thursday | 67 | 3 |
| Friday | 68 | 2 |
| Saturday | 67 | 3 |
| **Sunday** | **59** | **10** |

### Finding

**Hypothesis confirmed.** All 23 SKUs sell on 75–97% of calendar days. Zero-sale days for SKU 77205001 cluster heavily on Sundays (10 of 21 zero days). The zeros are not data gaps — they are real days without sales transactions. This is normal stochastic retail behavior. Prophet is an appropriate model for this data density and structure.

---

## Hypothesis 2 — Purchases: One monthly purchase, with at most a second extraordinary purchase when a stockout is imminent. Three in the same month is extremely rare; four does not occur.

### Hard Data

`forecast_results`, metrics = `purchases_ordered` and `purchases_received`, all 23 SKUs, 488 training days:

| Metric | Nonzero days range | Density range | Median density |
|---|---|---|---|
| purchases_ordered | 23 – 82 of 488 | 4.7% – 16.8% | 9.8% |
| purchases_received | 16 – 66 of 488 | 3.3% – 13.5% | 7.0% |

Distribution of PO document count per month per SKU across all 23 SKUs, training window 2024-10 through 2026-01 (343 total month-SKU observations, queried from `revenue_daily.source_doc_count`):

| PO docs in month | Occurrences | % of total |
|---|---|---|
| 1 | 71 | 20.7% |
| 2 | 86 | 25.1% |
| **1–2 subtotal** | **157** | **45.8%** |
| 3 | 68 | 19.8% |
| 4 | 43 | 12.5% |
| 5 | 22 | 6.4% |
| 6 | 14 | 4.1% |
| 7 | 12 | 3.5% |
| 8 | 10 | 2.9% |
| 9–14 | 9 | 2.6% |
| 17 | 1 | 0.3% |
| **3+ subtotal** | **186** | **54.2%** |

Per-month detail for SKU 77205001 (product_id=2), queried from `revenue_daily`, metric = `purchases_ordered`:

| Month | Days w/ PO activity | Total PO docs | Total qty ordered |
|---|---|---|---|
| 2024-10 | 9 | 12 | 45,303 |
| 2024-11 | 6 | 8 | 61,318 |
| 2024-12 | 4 | 4 | 55,237 |
| 2025-01 | 3 | 3 | 45,633 |
| 2025-02 | 5 | 5 | 44,908 |
| 2025-03 | 4 | 4 | 42,926 |
| 2025-04 | 3 | 4 | 36,243 |
| 2025-05 | 3 | 4 | 43,500 |
| 2025-06 | 4 | 4 | 36,864 |
| 2025-07 | 3 | 3 | 40,084 |
| 2025-08 | 4 | 6 | 35,077 |
| 2025-09 | 4 | 5 | 63,791 |
| 2025-10 | 12 | 14 | 51,023 |
| 2025-11 | 8 | 10 | 47,205 |
| 2025-12 | 6 | 12 | 58,267 |
| 2026-01 | 4 | 5 | 57,322 |

### Finding

**Hypothesis refuted as stated by the data.** 54.2% of month-SKU observations contain 3 or more PO document records. The maximum observed is 17 PO documents in a single month. The 1–2 PO pattern holds for only 45.8% of observations.

**Required qualification before acting on this finding:**

The `source_doc_count` column counts Odoo document records, not necessarily distinct purchase decisions. The SSOT label for `purchases_ordered` is `pol_all_states_date_planned_product_qty_c40` — this explicitly includes **all purchase order states**: draft, confirmed, cancelled, and done. A single purchase decision that was drafted, amended, and reconfirmed in Odoo produces multiple document records. Whether the inflated counts represent real additional purchase decisions or Odoo document lifecycle events (amendments, cancellations, reissues) **cannot be determined from `revenue_daily` alone** without querying `purchase.order.line` directly with state filtering.

---

## Forecast Results — Confidence Interval Evidence

Queried from `forecast_results`, product_id = 2 (SKU 77205001), `computed_at = 2026-04-24`:

| Metric | yhat_lower Feb | yhat Feb | yhat_upper Feb | yhat_lower Mar | yhat Mar | yhat_upper Mar |
|---|---|---|---|---|---|---|
| sales | 11,031 | 35,172 | 63,427 | 9,798 | 35,851 | 67,050 |
| purchases_ordered | **0** | 41,896 | **263,418** | **0** | 63,639 | **308,845** |
| purchases_received | **0** | 31,997 | **215,285** | **0** | 54,887 | **259,597** |

The lower confidence bound for both purchase metrics is zero. The upper bounds are 5×–7× the yhat point estimate. The model is signaling extreme uncertainty in its own purchase predictions. The UI currently displays only `yhat_sum`, making the prediction appear precise when the model's own interval spans zero to 300,000+ units. For sales the interval is narrow and meaningful.

---

## Root Cause Summary

### Root Cause 1 — Prophet is receiving structurally incompatible input for purchase metrics (supported by hard data)

Purchase orders are event-driven, intermittent phenomena. At 4.7%–16.8% nonzero density across all 23 SKUs, the daily training series for purchases looks like:

```
0, 0, 0, 0, 0, 0, 0, [spike], 0, 0, 0, 0, 0, 0, [spike], 0, 0, 0 ...
```

Prophet is a decomposable additive model designed for continuous or near-continuous time series. It fits trend + weekly seasonality + yearly seasonality to the input. With 83–96% of the purchase series being zeros, it is fitting those components to a structurally incompatible signal. The confidence intervals collapsing to [0, 300,000+] are the model's own output confirming it has no reliable signal.

### Root Cause 2 — Single seasonal cycle in the training window (supported by hard data)

`training_start_date = 2024-10-01`. The window contains exactly one full calendar year. The September 2025 value of 63,791 units ordered (confirmed by the insider as Christmas stocking pre-buy) is the only September data point in the training set. There is no second September to calibrate against. The March 2026 prediction of 63,639 units matches September 2025 almost exactly. How the model arrived at this value from its trend + seasonality components cannot be determined from `forecast_results` alone — that table stores only the aggregated monthly output, not the decomposed daily components.

### Root Cause 3 — SSOT label `pol_all_states` inflated purchase training data (confirmed 2026-04-28)

The `purchases_ordered` metric was populated under SSOT label `pol_all_states_date_planned_product_qty_c40`, which included all PO states: `draft`, `solicitud de cotización`, `purchase`, `locked`, `done`, and `cancel`. The correct DEMO-scope definition of a Purchase Order (confirmed 2026-04-28) is `state IN ('purchase', 'locked', 'done')` only.

**Impact:** training data included cancelled POs (319 records, 300,823 units ordered, 0 received) and unconfirmed RFQs (`solicitud de cotización`, 29 POs, 7,987 units, 0 received). The model learned purchase patterns that included volume that was never committed and never arrived. This directly inflates `yhat_sum` predictions for `purchases_ordered`.

**Required action:** re-populate `revenue_daily` for all 23 demo SKUs using `state IN ('purchase', 'locked', 'done')` and re-run ML training. The SSOT label has been renamed to `pol_confirmed_date_planned_product_qty_c40` to reflect the corrected filter.

---

## What This Does NOT Explain

The ~20% undercount on Ventas is not explained by any of the above. Sales data is dense (75–97% nonzero), Prophet is appropriate for it, and the acid test showed 0% differential on historical months. The 20% gap between the Feb/Mar 2026 predictions and the insider's known actual values is a model accuracy problem on a metric where the model structure is sound. The cause — whether business growth acceleration, demand shift, or another factor — cannot be evaluated from the data available here. Feb/Mar 2026 actuals are in the blind-test window and are not in the training tables.

---

## Open Questions Requiring External Input

1. Does `source_doc_count` in `revenue_daily` count distinct PO headers, PO lines, or Odoo document state transitions? The answer determines whether the 54.2% frequency of 3+ docs/month represents real purchase frequency or Odoo lifecycle noise.

2. ~~What Odoo PO states does the current SSOT formula include?~~ **Resolved 2026-04-28.** DEMO scope definition confirmed: `state IN ('purchase', 'locked', 'done')`. `draft`, `solicitud de cotización`, `cancel`, and `to approve` are excluded. `revenue_daily` must be re-populated and ML re-trained.

3. Is there purchase order history in Odoo prior to October 2024 that has not been loaded into `revenue_daily`? Extending the training window to 2–3 years would give Prophet multiple September data points to calibrate against before yearly seasonality is projected forward.

---

## Purchase Order State Lifecycle — Production Data (2026-04-28)

Queried from `purchase_orders` (3,253 rows) and `purchase_order_lines` (16,159 rows) in production Supabase. Chronological lifecycle with branches.

```
[draft]  ─────────────────────────────────────────────────► [cancel]
  4 POs │ 2,061 ordered │ 150 received (7.3%)                272 POs
  RFQ created, not yet sent to supplier                      300,823 ordered
                                                             0 received (0.0%)
        │
        ▼
[solicitud de cotización]  ───────────────────────────────► [cancel]
  29 POs │ 7,987 ordered │ 0 received (0.0%)
  Spanish Odoo localization of state 'sent'.
  RFQ submitted to supplier, awaiting confirmation.
        │
        ▼
[purchase]  ──────────────────────────────────────────────► [cancel]
  167 POs │ 874,984 ordered │ 584,901 received (66.8%)
  Confirmed purchase order. Goods arriving.
        │
        ▼
[locked]
  2,422 POs │ 2,332,970 ordered │ 1,684,619 received (72.2%)
  Most common state (74.5% of all POs). PO manually locked
  to prevent further edits, typically after delivery processing.
        │
        ▼
[done]
  34 POs │ 79,549 ordered │ 25,167 received (31.6%)
  Terminal state. Low receipt ratio (31.6%) is unexplained
  from available data — meaning of 'done' vs 'locked' in this
  specific Odoo 17 configuration requires direct investigation.
```

### Confirmed facts about states (2026-04-28)

**`to approve` — permanently excluded.**
This state has never been used by the company in DEMO or PROD. They have no plans to use it in the future. It does not appear in the production `purchase_orders` table. It is removed from all SSOT formulas, state maps, and documentation.

**`sent` — does not appear as a raw value in production.**
The Spanish Odoo localization stores this state as `solicitud de cotización` ("request for quotation"). All code and documentation updated to reflect the actual stored value.

**`locked` — not previously accounted for in SSOT formulas.**
With 2,422 POs (74.5% of all records), `locked` is by far the most common state. It was absent from the original SSOT state lists (`draft, sent, to approve, purchase, done, cancel`). Whether `locked` was already included in `revenue_daily` training data under the `pol_all_states` label depends on what states the Odoo XML-RPC sync actually captured — this cannot be determined without re-running the sync script against the current Odoo instance.

### Decision resolved — `solicitud de cotización` (sent / RFQ) — 2026-04-28

**Excluded from DEMO scope.** 29 POs, 7,987 units ordered, 0 received. An RFQ submitted to the supplier but not yet confirmed is not a Purchase Order. Excluded alongside `draft` and `cancel`.

PROD scope decision: pending. To be confirmed when PROD Odoo access is restored.
