# Forecast a Ciegas — Deep Dive Plan

**Date:** 2026-04-24 (v4 — meta-intent corrected)
**Author:** Claude (under `_THE_RULES.MD`)
**Contract:** This document is a *plan*, not an implementation. No code has been changed. Every claim about current behavior is sourced from the repo at HEAD; every claim about causes is labeled a hypothesis, not a fact.

> **Commercial meta-intent (binding, read first):** We are selling a forecaster. The goal of this plan is to sell the forecaster. A forecaster off by 200× cannot be sold. Every item below is judged against this sentence; anything that does not serve the sale is cut.

> **Vulnerability gate (binding, read second):** Per [`_VULNERABILITY_POLICY.md`](./_VULNERABILITY_POLICY.md), no feature in this plan ships while there is an open `npm audit` advisory against the affected workspace. The dependency-hardening pass that resolves outstanding advisories is part of *this plan's* execution order, not a follow-up. As of 2026-04-24, this means the `next@14 → 16` major bump is the active work item; the diagnostic chart resumes after.

---

## 🔒 IMMUTABLE CONSTRAINT — HIGHEST IMPORTANCE

This plan must at all times remain anchored to the following two quotes from our insider supporter. They are ground truth for what the demo audience actually sees and what the business reality is. **Do not dilute, paraphrase, or deprioritize them.**

> **Quote 1 — triage signal:**
> *"Venta — unidades y valores están ok*
> *Compra — unidades están ok*
> *Proyección está muy mal"*

> **Quote 2 — magnitude signal (added 2026-04-24, highest importance):**
> *"Venta 40,000 fardos*
> *Y la proyección dice 200"*

**Operational interpretation (explicit, to prevent later drift):**
- Historical sales units and revenue values reconcile — our SSOT formulas for the past are trusted by the insider.
- Historical purchase units reconcile — same for purchases.
- The forecast reads **≈ 200** where the real expectation is **≈ 40,000 fardos**. That is a **200× under-forecast**, not a tuning miss.
- A 200× miss is categorically **not** a model-hyperparameter problem. It is a structural failure: a scope gap, a UoM gap, a near-zero-trend collapse, or a read-the-wrong-row bug. Any plan or fix that starts with "tune Prophet" is wrong by construction.

---

## 🔒 RESOLVED INPUTS FROM USER (2026-04-24 follow-up)

These are answers to the v2 clarifying questions. They become design constraints and are immutable for this plan.

| # | Question (v2) | User's answer | Binding implication for this plan |
|---|---|---|---|
| **Q1** | Which SKU(s) behind the 40,000-vs-200? | *"All included in Forecast a Ciegas."* | The diagnostic must cover **all 23 SKUs** in `products_acid_test_active.is_top_10_in_class=true`. We do not single out one SKU. The chart must make the bad cell(s) surface themselves from the 23. |
| **Q2** | Is "200" in the same unit as 40,000? What is 1 fardo in our stock UoM? | *"It is OUR JOB to standardize uom interpretation and uom display."* | UoM handling is a **product requirement, not a question**. We own the full pipeline: detect native UoM per SKU, convert to a canonical display unit, never aggregate across incompatible UoMs. See §3 (UoM Standardization Policy). |
| **Q3** | Which month(s) does the 40,000 reference? | *"All months for which data is available in odoo live."* | The chart's history horizon is **the full range of months present in `revenue_daily`**, not just the training window. Forecast horizon remains Feb + Mar 2026. |
| **Q4** | Is the insider comparing against an external reference? | *"If we had these info, we would not need this plan at all!!!"* | Fair pushback — question struck. The diagnostic must be **self-contained**: detect wrong forecasts without any external ground-truth document. The "ratio vs history-mean" panel (§4.5) is the self-contained detector. |

**Still open (from v2):** Q5–Q9 from v2 are renumbered in §5 below. Most become actions I take myself in step 0 rather than questions for the user.

---

## 1. What "Forecast a Ciegas" actually does today (established facts)

Sources:
- [ml/forecast_revenue.py](ml/forecast_revenue.py)
- [frontend/src/app/api/acid-test/forecast/run/route.ts](frontend/src/app/api/acid-test/forecast/run/route.ts)
- [supabase/migrations/20260423000002_revenue_daily.sql](supabase/migrations/20260423000002_revenue_daily.sql)
- [supabase/migrations/20260423000007_forecast_results.sql](supabase/migrations/20260423000007_forecast_results.sql)

| Aspect | Current behavior |
|---|---|
| Training source | `revenue_daily` (daily aggregates per product × ssot_label × metric) |
| Scope | 23 SKUs where `products_acid_test_active.is_top_10_in_class = true` (12 REYMA + 11 CARVAJAL) |
| Metrics forecast | `sales`, `purchases_ordered`, `purchases_received` |
| Training window default | **2024-10-01 → 2026-01-31** (~488 days, ~16 months) |
| Prediction window default | **2026-02-01 → 2026-03-31** (Feb + Mar) |
| Model | Prophet, one fit per (SKU × metric) → 69 independent fits for scope=`top` |
| Prophet config | `yearly_seasonality` enabled iff training ≥ 365 days; `weekly_seasonality=True`; `daily_seasonality=False`; `changepoint_prior_scale=0.1`; `seasonality_prior_scale=5.0`; `uncertainty_samples=1000` |
| **Data shaping (key)** | `load_revenue_for_product` reindexes to a complete daily range and **fills missing days with `0`** ([ml/forecast_revenue.py:87-88](ml/forecast_revenue.py#L87)) — uniformly for all three metrics |
| Insufficient-history gate | If `nonzero_points < 10` → status=`insufficient_history`; row is still UPSERTed with `yhat_sum=0` and `forecast_month` = a **placeholder month** = `${predictionEnd.slice(0, 7)}-01` ([frontend/src/app/api/acid-test/forecast/run/route.ts:119](frontend/src/app/api/acid-test/forecast/run/route.ts#L119)) |
| Post-processing | `yhat`, `yhat_lower`, `yhat_upper` clipped to ≥ 0; monthly forecast = **sum of daily yhats**; monthly CI = **naive sum of daily bounds** |
| No calendar regressors | No holiday/Semana-Santa/school-year regressors configured |
| Storage | `forecast_results` keyed by (product, ssot, metric, forecast_month, training_end_date) |
| **UoM handling today** | `revenue_daily.quantity` is *claimed* to be normalized to the product's stock UoM ([migration comment, line 60-61](supabase/migrations/20260423000002_revenue_daily.sql#L60)). Normalization correctness is **not currently audited** anywhere in this pipeline. |

---

## 2. Hypothesis space — why forecasts are off by orders of magnitude

### 2.0 Why the reframe

Quote 1 alone ("muy mal") is consistent with model-tuning failures.

Quote 2 (200× under-forecast) **eliminates most tuning hypotheses from the top of the list**. No reasonable Prophet configuration under-forecasts by 200× when historical input is 40,000 fardos/month. A 200× miss requires one of:
- The training signal for this cell **did not contain 40,000 fardos** (scope, filter, or UoM bug upstream of Prophet).
- The forecast produced is **not** the model's prediction but a **placeholder zero-row** stored on `insufficient_history` or `training_failed`.
- The trend collapsed to near-zero late in training and post-clipping sum rounded to 200.
- The forecast was produced in a different UoM than the display and the display did not convert.

Tuning hypotheses remain on the list (§2.2) but only become relevant after structural causes are ruled out.

### 2.1 Structural hypotheses — top priority

**H0a. `insufficient_history` / `training_failed` placeholder row is being read as a forecast.**
Severity: HIGH. Likelihood: HIGH.
- Code path ([frontend/src/app/api/acid-test/forecast/run/route.ts:114-129](frontend/src/app/api/acid-test/forecast/run/route.ts#L114)): when `nonzero_points < 10` or fit raises, the run-route writes a row with `yhat_sum = 0`, `model_status = 'insufficient_history'`, `forecast_month` = `${predictionEnd.slice(0, 7)}-01`.
- The default `predictionEnd = '2026-03-31'` → placeholder `forecast_month = '2026-03-01'`. So insufficient-history placeholders for BOTH Feb AND Mar land on the **March** row, Feb gets no row, and the forecast read-endpoint does not filter by `model_status` ([frontend/src/app/api/acid-test/forecast/route.ts](frontend/src/app/api/acid-test/forecast/route.ts)).
- **Falsifiable check:** `SELECT product_id, metric, model_status, yhat_sum, training_points, nonzero_points FROM forecast_results WHERE training_end_date = (latest) ORDER BY yhat_sum ASC LIMIT 20;` — if tiny-yhat rows carry `model_status != 'ok'`, H0a is confirmed.
- **Note on "200" vs "0".** If the placeholder row literally stores 0 and the insider saw 200, either (a) a different cell is at fault (yhat came back tiny-but-nonzero from Prophet on collapsed data → H0c), (b) a display layer is multiplying or offsetting, or (c) the figure was approximate. All three are tested by the chart.

**H0b. UoM conversion mismatch in the revenue_daily normalization step.**
Severity: HIGH. Likelihood: MEDIUM (constrained by Quote 1's aggregate-historical reconciliation).
- The SSOT formulas claim to normalize `quantity` to the product's stock UoM. The normalization correctness is **not audited**.
- Quote 1 says historical units reconcile — but that reconciliation was done on a **single test SKU (77201046)** (see [docs/reconciliation/_RECONCILE_77201046_NOV2024.md](docs/reconciliation/_RECONCILE_77201046_NOV2024.md) if present, or the ssot_finder_results artifact). Aggregate units over many SKUs can reconcile to the CEO dashboard even if some individual SKUs' UoM conversions are wrong, as long as the errors cancel.
- Per user's Q2 answer: UoM handling is our job. See §3 for the standardization policy. H0b remains as a diagnostic hypothesis — the check is:
- **Falsifiable check:** for each of the 23 SKUs, compare `SELECT SUM(quantity) FROM revenue_daily WHERE product_id = ? AND metric='sales' AND observation_date BETWEEN '2024-11-01' AND '2024-11-30'` against the source Odoo records for November 2024. Any SKU whose unit total disagrees with its Odoo source has a UoM or filter bug.

**H0c. The training signal for some SKU(s) collapsed in late 2025 / early 2026.**
Severity: HIGH. Likelihood: HIGH.
- Prophet's trend reads the last training weeks heavily. If `revenue_daily` has partial or zero data for late 2025 or Jan 2026 (sync lag, SSOT filter edge case, supplier/journal hand-off), reindex-to-zero presents Prophet with a steep recent drop. Trend plunges, forecast clips at zero, monthly sum ends tiny.
- **Falsifiable check:** per SKU, `SELECT DATE_TRUNC('month', observation_date) AS m, SUM(CASE WHEN quantity > 0 THEN 1 ELSE 0 END) AS nonzero_days, SUM(quantity) FROM revenue_daily WHERE product_id = ? AND metric = 'sales' GROUP BY m ORDER BY m` — look for month-to-month cliffs, especially late 2025 and Jan 2026.

**H0d. SSOT filter silently excludes activity for some SKUs.**
Severity: HIGH. Likelihood: MEDIUM.
- The winning sales SSOT filters `account_type='income' AND state='posted' AND move_type IN ('out_invoice','out_refund')`. If some SKU's activity lives on a different journal (returns, POS, internal transfers, credit memos with a non-matching move_type), the formula misses it. Aggregate historical reconciliation doesn't catch this if it's a per-SKU issue.
- **Falsifiable check:** for each SKU, run the SSOT query against Odoo live and cross-reference against an unfiltered product-level query. Any SKU with significant activity outside the SSOT filter needs that filter widened.

Note: hypothesis **H0e** from v2 (SKU not in scope) is **removed** — Q1 confirms the issue is within the 23-SKU Forecast a Ciegas scope.

### 2.2 Original tuning hypotheses (demoted — only relevant after §2.1 is cleared)

As a group, **below** §2.1 in priority. Ranked within the group unchanged.

- **H1.** Daily reindex-to-zero distorts lumpy purchase series. **Check:** count non-zero days for one SKU × purchases.
- **H2.** 16 months is thin for yearly seasonality to stabilize. **Check:** coverage of `revenue_daily` before 2024-10 — directly addressed by the "history horizon = all available months" Q3 constraint, which will expose the coverage.
- **H3.** No Guatemala holiday regressors (Semana Santa hits March). **Check:** compare Mar 2025 vs Mar 2024 actuals (if Mar 2024 is in coverage).
- **H4.** Training data coverage gap to Jan 31 2026. **Check:** `MAX(observation_date)` per SSOT × metric. Compounds with H0c.
- **H5.** Prophet changepoint overfit to late-2025 noise.
- **H6.** No cross-metric consistency (sales vs ordered vs received drift independently).
- **H7.** Naive daily CI summation compresses the interval.
- **H8.** Pool-of-one fragility — no hierarchical borrowing across similar SKUs.
- **H9.** UoM edge cases inside `products` (archived variants, pack-size changes) — partially subsumed by the UoM policy in §3.

---

## 3. UoM standardization policy (binding — per user's Q2 answer)

Per the user: *"It is OUR JOB to standardize uom interpretation and uom display."* This section is the policy. It is binding on every surface that displays forecast or history numbers.

### 3.1 The problem

- Each SKU has a **stock UoM** recorded in `products.uom_id` (or equivalent Odoo field). That UoM is the granularity at which we count inventory.
- The CEO and insider reason in **business units** — "fardos" for these packaging products. A fardo is a packaging construct; it may not equal the stock UoM.
- `revenue_daily.quantity` is claimed to be in stock UoM. Unaudited.
- Aggregating across SKUs in stock UoM is **only meaningful if those SKUs share a UoM**. Summing 1,000 units of a SKU whose UoM is CAJA40 with 1,000 units of a SKU whose UoM is "each" produces a number with no business meaning.

### 3.2 Policy decisions (binding)

1. **Single SKU → display in the SKU's stock UoM, with the UoM name explicitly shown** next to every number ("8,450 CAJA40", never bare "8,450").
2. **Multiple SKUs in the same UoM → sum is allowed, UoM label shown.**
3. **Multiple SKUs spanning different UoMs → no cross-UoM summation of absolute quantities.** Instead, display one of:
   - (a) a **ratio** (forecast ÷ 12-month history average) per SKU, then average the ratios (dimensionless),
   - (b) a **GTQ revenue** aggregate for the `sales` metric (monetary, UoM-invariant),
   - (c) **separate sub-totals** per UoM bucket (e.g., "Total REYMA CAJA40: X" and "Total CARVAJAL fardos: Y" in parallel).
4. **"Fardo" as display unit:** if the business prefers to see fardos on the demo surface, we maintain a `products_display_uom` table (or an extension on `products_acid_test_active`) that records, per SKU, the business display UoM and the conversion factor from stock UoM. This table is populated and audited before any surface renders fardos. Until then, we display stock UoM.
5. **Conversion happens at the edge** (API response formatting), not deep inside analytics. The raw tables remain in stock UoM. This preserves auditability.
6. **Every forecast and history number in the API response carries an explicit `uom` field.** Consumers (the chart page) render the label from that field — never hardcoded.

### 3.3 Aggregation rule cheat-sheet

| Surface | Absolute quantity | Ratio / index | GTQ revenue |
|---|---|---|---|
| Single-SKU drilldown (chart) | ✅ in SKU's stock UoM, label shown | ✅ | ✅ for sales |
| Multi-SKU same UoM (chart) | ✅ sum, UoM label shown | ✅ | ✅ for sales |
| Multi-SKU mixed UoM (chart) | ❌ do not render | ✅ default view | ✅ for sales |
| Forecast a Ciegas table (existing gerencia page) | Must verify all 23 SKUs share a UoM class; if not, split or move to ratio view |

### 3.4 Falsification / audit plan

- **Step 0d (see §6):** run `SELECT p.sku, p.uom_id, u.name FROM products p JOIN uom_uom u ON p.uom_id = u.id WHERE p.sku IN (<23>)`. Group by UoM. If all 23 share a UoM, the existing Forecast a Ciegas total row is safe. If not, the existing total row is unsafe and this plan must also fix it.
- Note: adapt the join/table names to whatever our supabase schema actually is — I have not verified `uom_uom` exists in our Supabase. Step 0d will determine the correct query.

---

## 4. Diagnostic chart page (deliverable for this iteration)

### 4.1 Purpose (sharpened by all three quotes + Q1/Q3/Q4)

One visual that makes 200× errors **impossible to miss**, across **all 23 SKUs**, over **all months for which data exists**, with **no dependence on an external ground-truth document**. The chart's job is to turn Quote 2 into a picture and to expose the broken cells from the 23.

### 4.2 Route, auth, scope

- **Path:** `/superuser/forecast-diagnostic`
- **Auth:** `CAN_VIEW_SYSTEM` (superuser only). Server-side middleware + client guard.
- **Not linked from the gerencia demo sidebar** (already filtered by `GERENCIA_DEMO_SECTIONS` in [FearsSidebar.tsx](frontend/src/components/layout/FearsSidebar.tsx#L273)).

### 4.3 Data shape (widened horizon per Q3)

New endpoint: `GET /api/superuser/forecast-diagnostic`

```jsonc
{
  "scope": { "sku_count": 23, "metrics": ["sales", "purchases_ordered", "purchases_received"] },
  "uom_groups": [
    { "uom": "CAJA40", "skus": ["77201046", ...] },
    { "uom": "fardo",  "skus": [...] }
  ],
  "history": [
    { "month": "2024-01", "per_uom": { "CAJA40": { "sales": 12345, ... }, "fardo": { ... } }, "sales_gtq": 456789 },
    ...
    { "month": "2026-01", ... }
  ],
  "forecast": [
    {
      "month": "2026-02",
      "per_uom": { "CAJA40": { "sales": 13000, "sales_lower": 11000, "sales_upper": 15000, ... } },
      "sales_gtq": ...,
      "status_counts": { "ok": 20, "insufficient_history": 2, "training_failed": 1 }
    },
    { "month": "2026-03", ... }
  ],
  "per_sku": [
    {
      "sku": "77201046",
      "uom": "CAJA40",
      "history": [ { "month": "2024-01", "sales": 123, "purchases_ordered": 100, "purchases_received": 98 }, ... ],
      "forecast": [
        { "month": "2026-02", "sales": 130, "sales_lower": 100, "sales_upper": 160,
          "sales_model_status": "ok", "purchases_ordered_model_status": "ok", "purchases_received_model_status": "ok" },
        { "month": "2026-03", ... }
      ],
      "history_12m_mean_sales": 134,
      "forecast_mean_sales": 0.7,
      "ratio_sales": 0.0052,   // the diagnostic — red if outside [0.1, 10]
      "ratio_purchases_ordered": 0.8,
      "ratio_purchases_received": 0.85
    }
  ],
  "training_end_date": "2026-01-31",
  "history_start_month": "<from revenue_daily MIN(observation_date)>",
  "history_end_month": "<from revenue_daily MAX(observation_date)>",
  "generated_at": "..."
}
```

- `history` aggregated from `revenue_daily`, grouped by UoM (never summed across UoMs per §3).
- `forecast` aggregated from `forecast_results` (latest `training_end_date` per cell), grouped by UoM, **only `model_status='ok'` rows count toward the sum**. The `status_counts` surfaces the others.
- `per_sku` always included (needed for the SKU drilldown and the ratio panel).
- `sales_gtq` carried through — UoM-invariant, safe to sum across SKUs.
- Endpoint is read-only.

### 4.4 Chart library — recommendation with honest tradeoffs (D3 included)

Short version: **ECharts** (`echarts` + `echarts-for-react`). User already approved in a prior turn.

| Option | Bundle | Level | Interactivity out of box | Fit for deep analytics | Verdict |
|---|---|---|---|---|---|
| **Apache ECharts** | ~150 KB tree-shaken | High-level (JSON config) | dataZoom, brush, crosshair tooltip, markArea/markLine, legend toggle, PNG export, WebGL for large series | Battle-tested in financial/time-series analytics | **Recommended.** Fastest time-to-insight. Config travels between developers and agents. |
| **D3** (`d3`) | ~80 KB tree-shaken | Primitive (scales, shapes, selections) | Nothing out of the box; you implement zoom/brush/tooltip/legend yourself | Unmatched flexibility — any viz is possible | Use **when ECharts cannot express what you need** (custom networks, uncommon projections). Not the right default for time-series + forecast overlays. |
| **Visx** | ~50–150 KB per module | Middle (D3 scales/shapes + React components) | Same as D3 — compose yourself | D3 power with React ergonomics | Solid compromise if team is D3-native. Still slower per chart than ECharts. |
| **Plotly.js** | ~800 KB | High-level | Equivalent to ECharts | Gold standard for exploratory DS | Alternative. Heavier bundle. |
| **Recharts** (installed) | ~40 KB | High-level | Basic zoom; no brush, no range slider, no markArea natively | Sufficient for trivial charts | Keep for trivial charts. Insufficient for this diagnostic and for future deep analytics. |

**Why not D3 specifically:**
1. **Dev time per chart.** D3 is a toolkit, not a chart library. A forecast-vs-history chart with crosshair tooltip + zoom slider + training divider + CI band is ~600 lines in D3 vs. ~80 lines of ECharts config. Iteration compounds.
2. **Maintenance burden.** D3 charts are bespoke code that drifts. ECharts config is declarative and diffable.
3. **Team/agent leverage.** ECharts config travels well between developers and LLM agents; D3 code is specialist.
4. **D3 strengths are orthogonal.** D3 wins for novel visualizations (custom network layouts, geo projections, unusual encodings) — none on our near-term roadmap.
5. **Not mutually exclusive.** ECharts uses D3-derived concepts under the hood. If we ever need a truly custom viz, we drop D3 in for that one chart and keep ECharts for the other 95%.

**Caveat:** if a team member is D3-native, a single chart can be faster for them in D3. The case for ECharts is about lifecycle, not any one chart.

### 4.5 Chart spec (what to render)

Three stacked panels on one page, driven by a single endpoint response:

**Panel A — "Gap detector" (ratio bar chart, default view).**
One horizontal bar per SKU × metric = 23 × 3 = 69 bars, grouped by SKU.
- Value = `forecast_mean / history_12m_mean`.
- Color: green if in `[0.5, 2.0]`, yellow if in `[0.1, 0.5] ∪ [2.0, 10]`, **red if outside `[0.1, 10]`**. A 200× miss → ratio 0.005 → red, unmissable.
- Tooltip shows the two means and the `model_status`.
- This panel is the **self-contained** detector per Q4 — requires no external ground truth.

**Panel B — "Aggregate over time" (line chart, per-UoM-group).**
One line chart per UoM group (typically one or two charts total once step 0d resolves the UoM landscape).
- X axis: month (full history horizon per Q3, extending through Mar 2026).
- Y axis: quantity in that UoM (labeled) OR a secondary GTQ axis if the group is sales.
- Three series: `sales`, `purchases_ordered`, `purchases_received`.
- History: solid line. Forecast: dashed continuation, same color. CI band on `sales`.
- Vertical `markLine` at `training_end_date` labeled "Fin de entrenamiento".
- Red triangle annotation at any forecast point where `status_counts.insufficient_history > 0` or `status_counts.training_failed > 0`.
- If the `uom_groups` array has more than one entry, Panel B renders one chart per group side-by-side (or stacked). **No cross-UoM sum.**

**Panel C — "SKU drilldown" (line chart, one SKU at a time).**
Dropdown selector showing all 23 SKUs with their UoM.
- Same chart shape as Panel B but for one SKU.
- Y axis labeled with that SKU's UoM.
- Red triangle if the selected SKU's forecast has `model_status != 'ok'` for any metric × month.
- This is where the debugger goes after Panel A flags a bad SKU.

**Global:** Class toggle `Todas | REYMA | CARVAJAL` at the top. Applies to all three panels.

**Explicit non-rendering:** if the endpoint returns `uom_groups.length > 1` and a consumer tries to sum across UoMs anywhere on the page, that render path throws. No silent cross-UoM aggregation.

### 4.6 Non-goals (for this iteration)

- Not changing the forecast pipeline.
- Not retraining Prophet.
- Not adding holiday regressors.
- Not backfilling data.
- Not changing the existing Forecast a Ciegas page — except as a fast-follow if §3.4's audit shows cross-UoM summation in the current total row is unsafe.

---

## 5. Clarifying questions remaining

Q1–Q4 resolved in the block above. The rest:

**Q5 (self-answerable by me).** For each SKU in the 23, what is `model_status` for Feb 2026 and Mar 2026 in `forecast_results`? I'll answer this as step 0c. No user action needed.

**Q6 (self-answerable by me).** `revenue_daily` completeness: `MAX(observation_date)` per SSOT × metric; first date with data; per-month non-zero-day counts. I'll answer as step 0b.

**Q7.** Chart-page toggle set. My proposal in §4.5: `Todas | REYMA | CARVAJAL` class toggle **plus** 23-SKU drilldown dropdown **plus** metric toggle. Confirm or override.

**Q8 (confirmed earlier turn).** Add `echarts` + `echarts-for-react` to [frontend/package.json](frontend/package.json). User approved. Exact versions pinned at install.

**Q9.** If step 0c finds that placeholder-row behavior (H0a) is the proximate cause of the 200× miss, is it OK to also gate the **existing Forecast a Ciegas** display so rows with `model_status != 'ok'` render as "—" with a footnote, instead of showing a number? (This is a small UX change to the demo surface, guarded strictly behind the diagnosis.)

---

## 5b. Vulnerability gate (binding, precedes §6)

Per [`_VULNERABILITY_POLICY.md`](./_VULNERABILITY_POLICY.md), no feature work in §6 begins until `npm audit` reports zero advisories against `frontend/`.

| # | Step | Status (2026-04-24) |
|---|---|---|
| V1 | `npm audit fix` for compatible auto-fixes (7 advisories cleared) | **Done** |
| V2 | `next@^14.2.18 → ^15.5.15` (revised from 16 — 15.5.15 fixes all 5 production CVEs without forcing React 19) | **Done** |
| V3 | `eslint-config-next@^14.2.x → ^15.5.15` | **Done** |
| V4 | `jest-environment-jsdom@^29 → ^30.3.0` | **Done** |
| V5 | `npm run build` + `npm test` regression check after V2–V4 | **Done — both pass** |
| V6 | Re-run `npm audit`; confirm zero advisories | **Done — 0 advisories** |

**Migration breaking changes addressed during V5:**
- `cookies()` from `next/headers` is now async → `src/lib/supabase/server.ts` made async; callers in `src/lib/auth/server.ts` and `src/app/auth/callback/route.ts` updated to `await`.
- Dynamic route `params` is now a `Promise<...>` → `src/app/api/backtest/[runId]/route.ts` and `.../savings/route.ts` updated to await `params`.
- `postcss` bundled inside `next` was still on 8.4.31 (vulnerable); added `overrides: { "postcss": "^8.5.10" }` in `package.json` to force the fixed version transitively.
- `forecast-diagnostic/route.ts` paginator helper refactored from one over-generic function to two per-table helpers (cleaner under Next 15's stricter Supabase query-builder typing).

§6 (the diagnostic chart implementation) does not begin until V6 reports clean.

## 6. Execution order (after §5 residual questions and §5b gate)

| # | Step | Produces |
|---|---|---|
| **0a** | List the 23 SKUs with their `sku`, `representative_name`, `supplier_class`, `movement_rank_within_class` from `products_acid_test_active`. Single source of truth for the diagnostic scope. | Scope snapshot (input for every subsequent query). |
| **0b** | `revenue_daily` coverage audit: for each of 3 metrics × each of the 23 SKUs, `MIN/MAX(observation_date)`, per-month `SUM(quantity)`, per-month non-zero-day count. Writes a short findings note to this same folder (v3.1). | Evidence for/against H0c and H2, and the true `history_start_month` for the chart. |
| **0c** | `forecast_results` audit: for each SKU × metric × (Feb 2026, Mar 2026), `model_status`, `yhat_sum`, `training_points`, `nonzero_points`. Append to findings note. | Direct test of H0a; identifies every placeholder-row cell. |
| **0d** | `products.uom_id` audit for the 23 SKUs. Enumerate distinct UoMs in scope. Cross-reference with `products_acid_test_active.representative_name` to confirm packaging category. Append to findings note. | Direct input to §3 policy execution; resolves whether the existing Forecast a Ciegas total row is UoM-safe. |
| **0e** | If 0b–0d produce evidence that **changes the root-cause ranking** in §2, revise this plan before going further. | Plan v4 (only if warranted). |
| 1 | Add `echarts` + `echarts-for-react` to frontend deps. Pin exact versions. | Library available. |
| 2 | Implement `GET /api/superuser/forecast-diagnostic` per §4.3, including `per_sku`, `uom_groups`, `ratio_*`, and `status_counts`. | Read-only endpoint. |
| 3 | Implement `/superuser/forecast-diagnostic` page per §4.5 — Panel A first (highest diagnostic value), then Panels B and C. | Diagnostic chart live. |
| 4 | Review Panel A: every SKU × metric with a red ratio becomes a named debug target. | Triage list. |
| 5 | For each triage target, drilldown in Panel C + cross-reference with the 0b–0d findings note. Identify the **single root cause** per target (it may be the same cause for many targets). | Root-cause list. |
| 6 | Propose the **targeted fix** (one root cause first, in isolation) in a follow-up plan doc. No multi-root-cause shotgun fixes. | Next plan. |

---

## 7. Risks and rules compliance

- **Rule 1 (don't lie, don't assume).** Every cause in §2 is labeled a hypothesis. Every unverified claim is tagged. The UoM claim ("normalized to stock UoM") in the migration comment is explicitly flagged as unaudited (§1 table, §3.1, §3.4 step 0d).
- **Rule 6 (read attachments first).** `_THE_RULES.MD` was read before v1 of this plan and re-read for v3. Q2's pushback on UoM is implemented as §3 (binding policy), not as a clarifying question the user has to answer repeatedly.
- **Rule 7 (my context, not generic).** User answers to Q1–Q4 are folded in as binding constraints (the "Resolved inputs" block). The plan has no generic time-series-forecasting advice — every statement is tied to `forecast_revenue.py`, `forecast_results`, or the 23-SKU acid-test scope.
- **Rule 8 (production-first).** No mock data anywhere. The diagnostic endpoint reads production tables. The chart renders what the database contains. Steps 0a–0d are production-read-only.
- **Rule 5 (no corners).** ECharts is an investment, honestly justified against D3 / Visx / Plotly / Recharts. UoM standardization (§3) is a product requirement, not a shortcut.
- **Conflict-resolution order: truth > provided facts > production safety > best practices > completeness > speed.** If step 0b–0d produces evidence that contradicts anything in §1 or §2, this plan gets revised (step 0e) before implementation begins.
- **Challenge rule.** If at any point the direction becomes "retune Prophet to fix the 200× miss", the correct response is **no**. A 200× miss is not a Prophet tuning problem. The root cause lives in §2.1 structural hypotheses or §3 UoM policy.

---

## 8. Meta-intent

**We are selling a forecaster. The meta-intent is to sell the forecaster. We cannot sell anything at all if our forecaster is off by 200×.**

Every item in this plan is in service of that one sentence. The diagnostic chart, the UoM policy, the hypothesis triage, the execution order — all exist to get the forecaster to a state where the demo audience stops saying "proyección está muy mal" and starts saying yes.

Nothing in this plan is a research project, a refactor, or a quality-of-life improvement. If any step stops serving the sale, it is cut.
