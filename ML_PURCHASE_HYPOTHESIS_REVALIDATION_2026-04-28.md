# Purchase Hypothesis Re-Validation — 2026-04-28

**Scope:** Production database analysis for the 23-SKU demo sample.
**Purpose:** Re-evaluate the insider's purchase frequency hypothesis using the corrected DEMO-scope PO definition confirmed on 2026-04-28. The previous finding in `ML_TRAINING_DATA_FINDINGS_2026-04-28.md` used `pol_all_states` (all PO states including cancelled and unconfirmed RFQs). This file repeats the analysis using only confirmed purchase orders.
**Data source:** Production Supabase `purchase_orders` and `purchase_order_lines` tables, queried directly. No assumptions.

---

## Hypothesis Being Tested

> For all 23 SKUs included in the DEMO sample, our client makes ONE monthly purchase as per their human forecasts, with the occasional second extraordinary purchase when they see a stockout approaching. Three in the same month is extremely rare; four does not occur.

---

## Corrected PO Definition (DEMO scope — confirmed 2026-04-28)

`purchase.order.state IN ('purchase', 'locked', 'done')`

**Excluded and why:**
- `draft` — not yet sent to supplier; not a purchase order
- `solicitud de cotización` (Odoo Spanish for `sent`) — RFQ submitted to supplier but not confirmed; not a purchase order
- `cancel` — cancelled; not a purchase order
- `to approve` — never used by the company in DEMO or PROD; no plans to use it

**Production PO universe:** 2,701 confirmed POs (states `purchase`, `locked`, `done`) out of 3,253 total records.

---

## Hard Data

### Scope

- Training window: 2024-10-01 to 2026-01-31 (16 calendar months)
- SKUs: 23 (all `is_top_10_in_class = true` from `products_acid_test_active`)
- Source tables: `purchase_orders` joined to `purchase_order_lines` on `order_id`
- Filter: `state IN ('purchase', 'locked', 'done')` on `purchase_orders`; variant match on `purchase_order_lines.product_id`
- Confirmed POL rows matching 23 demo SKUs in training window: **444**
- Distinct (product, month) observations with at least one confirmed PO: **137 of 368 possible** (16 months × 23 SKUs = 368 maximum)

The remaining 231 SKU-months (62.8%) had zero confirmed purchase orders in the training window. This is expected for a wholesale distributor — not every SKU receives a PO every month.

### Distribution of Confirmed PO Count per SKU per Month

Across the 137 observed SKU-month pairs:

| Confirmed POs in month | Occurrences | % of total |
|---|---:|---:|
| 1 | 42 | 30.7% |
| 2 | 35 | 25.5% |
| **1–2 subtotal** | **77** | **56.2%** |
| 3 | 22 | 16.1% |
| 4 | 10 | 7.3% |
| 5 | 8 | 5.8% |
| 6 | 7 | 5.1% |
| 7 | 4 | 2.9% |
| 8 | 4 | 2.9% |
| 9 | 2 | 1.5% |
| 10 | 1 | 0.7% |
| 12 | 2 | 1.5% |
| **3+ subtotal** | **60** | **43.8%** |

**Maximum observed:** 12 confirmed POs in a single SKU-month (SKU 77201046, January 2026).

---

## Comparison With Previous Finding (All States)

The previous finding in `ML_TRAINING_DATA_FINDINGS_2026-04-28.md` used `pol_all_states`, which included `draft`, `solicitud de cotización`, and `cancel` records. That query returned 343 observed SKU-month pairs with this distribution:

| Docs in month | All-states % | Confirmed-only % | Change |
|---|---:|---:|---|
| 1–2 | 45.8% | 56.2% | +10.4 pp |
| 3+ | 54.2% | 43.8% | −10.4 pp |

Removing cancelled POs and unconfirmed RFQs reduces 3+ occurrences from 54.2% to 43.8%. The corrected filter improves the picture but the core finding does not change: 3+ confirmed purchase orders in a single month is not rare.

---

## Finding

**Hypothesis partially supported, partially refuted by hard data.**

**Supported:** The 1–2 PO pattern holds for 56.2% of non-zero observations — a majority. For months with any PO activity at all, the most common outcome is 1 or 2 confirmed purchase orders.

**Refuted (first claim):** "Three in the same month is extremely rare." With the corrected PO definition, 3 confirmed POs in a month occurs in 22 of 137 observations (16.1%). One-in-six is not "extremely rare."

**Refuted (second claim):** "Four does not occur." With the corrected PO definition, 4+ confirmed POs in a single month occurs in 38 of 137 observations (27.7%), with a maximum of 12 in one month.

---

## October 2024 Anomaly

October 2024 shows 5–12 confirmed POs for multiple SKUs simultaneously. This is the single largest concentration of high-frequency PO months in the training window. The pattern is present across CARVAJAL and REYMA SKUs simultaneously.

**Possible explanations (not yet validated — require external input):**

1. **Data loading artifact:** If historical purchase orders were bulk-loaded into Odoo in October 2024 using `date_planned = import date`, multiple POs with different intended delivery dates could all land on October 2024 dates. This would inflate the training signal for that month without reflecting real October purchase behavior.

2. **Exceptional business event:** October 2024 may be the first month of Odoo usage, with a large backlog of historical POs entered simultaneously. Similar to Root Cause 2 in the training data findings — a one-time event that the model has no second data point to calibrate against.

3. **End-of-year inventory build:** Some distributors pre-buy heavily in October for Q4 demand. Would need David's confirmation.

**Action required:** Confirm with the client whether October 2024 represents normal purchase behavior or a system onboarding artifact before using this data for ML training.

---

## Implication for ML Training

The confirmed purchase frequency (1–12 POs per month, median likely 1–2) is still structurally incompatible with Prophet regardless of whether the hypothesis holds exactly. Even under the corrected definition:

- Daily purchase data remains sparse: confirmed POs spread across 444 POL rows over 488 training days and 23 SKUs.
- At the individual SKU level, nonzero purchase days remain well below 20% density.
- Root Cause 1 from `ML_TRAINING_DATA_FINDINGS_2026-04-28.md` — Prophet receiving structurally incompatible input — is not changed by the state filter correction.

The corrected filter will reduce inflated `yhat_sum` values for `purchases_ordered` (removing the signal from 319 cancelled POs and 7,987 units of unconfirmed RFQs). But it does not address the fundamental model-data mismatch.

---

## Open Questions

1. **October 2024 anomaly:** Is this a data loading artifact or real business behavior? Determines whether those months should be in the training window.

2. **`locked` state and `date_planned`:** The `locked` state is the most common (74.5% of confirmed POs, 2,422 records). When Odoo locks a PO, does it modify `date_planned`? If so, training data dates may not reflect when the client actually expected delivery.

3. **12 POs in one month (SKU 77201046, January 2026):** This is the maximum in the dataset and falls at the very end of the training window. Is this normal or a data anomaly? Direct investigation of those PO records is required.

---

## Source

Queried directly from production Supabase on 2026-04-28. Joins: `purchase_orders` (filtered by state and date range) → `purchase_order_lines` (filtered by `product_id` against `products_acid_test_active` variant IDs). Results grouped by `(product_id, month)` with COUNT(DISTINCT order_id) as the PO count per cell.
