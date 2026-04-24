# Plan — Acid Test SSOT Discovery & Validation

**Date created:** 2026-04-23
**Stakes:** Pass these two acid tests or the app is dropped.
**Adheres to:** [_THE_RULES.MD](../../_THE_RULES.MD) — production-first, no assumptions, no mock data, no corner-cutting.

---

## 1. Acid tests (verbatim from user)

### Test 1 — Reproducibility (past, known months)
Be able to reproduce both **total purchases** and **total sales** for a purportedly random SKU for a purportedly random set of months that already exist in Odoo.

**Status:** First trial dramatically failed for SKU 77201046, Nov 2024 / Dec 2024 / Jan 2025. Our `effective_delivered` (6,361 / 6,301) is ~30% off vs CEO's dashboard (6,466.25 / 6,496.50).

### Test 2 — Forecast (future, unseen months)
Be able to **blindly forecast** total purchases and total sales for a purportedly random SKU for **Feb 2026 and Mar 2026** — months for which our Odoo live API does **not** have data, but the CEO has real data in his main dashboard.

**Status:** Not yet attempted. Test env access ends ~Jan 2026; Luis's prod-Odoo dashboard has Feb/Mar 2026.

---

## 2. Cast (correct as of 2026-04-23)

| Role | Name | Function |
|---|---|---|
| **CEO / decision maker** | Luis | Owns the prod-Odoo dashboard. Holder of acid-test ground truth. |
| **Insider supporter (middle mgmt)** | David | Sees CEO's dashboard. Has shared a few totals + filter hypotheses. Helping us prepare. |
| **Internal developer** | Dev | Our side — relays app numbers, builds the fix. |
| **AI assistant** | Claude (this) | Building the SSOT-discovery and replacement scripts. |

### Source: David's transcript (2026-04-23)
[docs/april_jumpstart/DAVID-2026-04-23-CLEAN.txt](../april_jumpstart/DAVID-2026-04-23-CLEAN.txt) — note: transcript labels are reversed (DAVID lines = CEO's voice as relayed by David in the call; INTERLOCUTOR lines = our Dev). User confirmed swap on 2026-04-23.

### Ground-truth datapoints we have (all SKU 77201046)
- **Sales** Nov 2024: **6,466.25** units
- **Sales** Dec 2024: **6,496.50** units
- **Purchases** Nov 2024 ordered: **5,917**
- **Purchases** Nov 2024 received: **5,500**
- **Purchases** all-time total: **8,203**
- App's incorrect sales reading: 5,434 (some month)

These 5 datapoints anchor the trial-and-error.

---

## 3. The reward path

```
Pass Test 1 → Earn David's escalation to Luis
   → Earn Luis's trust to attempt Test 2
   → Pass Test 2 → Win Odoo prod credentials
   → Build the live-sync to prod-Odoo (recurring revenue)
```

Failing either kills the deal "definitely without appeal" (user's words).

---

## 4. Strategy — why trial-and-error

David shared totals but not the exact filter math behind them. We must discover the filter formula by:

1. Pulling raw Odoo live data for SKU 77201046 across all candidate source tables.
2. Computing **every plausible filter combination** for a single (SKU, month, metric).
3. Scoring each combo by `Σ |computed − ground_truth|` over the 5 anchor datapoints.
4. Surfacing top-5 winners for human selection (not auto-pick — too easy to coincidence-fit on 5 points).
5. Validating the chosen formula against secondary signals (per-day distribution, refund handling).
6. Scaling to 20 SKUs × 14 months and persisting as new prod tables.

---

## 5. Trial-and-error matrix

### 5.1 Sales metric — dimensions

| Dimension | Candidate values |
|---|---|
| Source table | `sale.order.line`, `account.move.line`, `stock.move` |
| Date field | `date_order`, `commitment_date`, `effective_date`, `invoice_date`, `move.date`, `account.move.date` |
| Quantity field | `product_uom_qty`, `qty_delivered`, `qty_invoiced`, `account.move.line.quantity`, `stock.move.quantity` |
| State filter (sale.order) | subsets of {`sale`, `done`, `draft`, `cancel`, `sent`, `waiting_for_approval`} |
| State filter (account.move) | subsets of {`posted`, `draft`, `cancel`} |
| Move type (account.move) | `out_invoice` only, `out_invoice` + `out_refund` (refund as negative), all |
| Account filter (aml) | `account_type` ∈ {`income`, `income_other`, all} |
| Variant scope | active only (id=7090), all 3 variants (7090, 1541, 2371) |
| UoM normalization | raw vs normalized to product's stock UoM (CAJA40) |
| Customer-flow filter (stock.move) | only outgoing-to-customer, net of returns, gross |

Approx total combos: ~3 × 6 × 5 × 4 × 3 × 3 × 3 × 2 × 2 × 3 ≈ several thousand. Pruning rules (e.g., "qty_delivered only valid with sale.order.line source") cut to a few hundred.

### 5.2 Purchase metric — dimensions

Symmetric to sales but for the buy side:
- Source: `purchase.order.line`, `account.move.line` (vendor bills), `stock.move` (incoming)
- Date: `date_order`, `date_planned`, `date_approve`, `effective_date`, `invoice_date`, `move.date`
- Quantity: `product_qty`, `qty_received`, `qty_invoiced`, `aml.quantity`, `move.quantity`
- State (purchase.order): {`draft`, `purchase`, `done`, `cancel`}
- State (account.move): {`posted`, `draft`, `cancel`}
- Move type: `in_invoice` only, `in_invoice` + `in_refund`
- Account filter: `account_type` ∈ {`expense`, `cost_of_revenue`, `asset_inventory`, all}
- Stock-move flow: incoming-from-vendor only, net of returns to vendor, gross

David's reported "ordered" (5,917) vs "received" (5,500) suggests separate metrics:
- "Ordered" likely = `purchase.order.line.product_qty` (as ordered) — possibly state-filtered
- "Received" likely = `purchase.order.line.qty_received` OR `stock.move.quantity` (incoming, done state)
- "Total" (8,203) likely = lifetime "received" or lifetime invoiced — needs trial-and-error to disambiguate

### 5.3 Scoring function

For a candidate formula `f`:

```
score(f) = |f(SKU, Nov2024) − 6466.25|        # sales
        + |f(SKU, Dec2024) − 6496.50|         # sales
        + |g(SKU, Nov2024, ordered) − 5917|   # purchase ordered
        + |g(SKU, Nov2024, received) − 5500|  # purchase received
        + |g(SKU, all_time, total) − 8203|    # purchase total
```

Smaller is better. Ties broken by formula simplicity (fewer filters = preferred).

### 5.4 Multi-anchor robustness check

A formula that fits all 5 datapoints exactly may still be coincidence. After picking top-5 by score, manually check:
- Does the formula give monotone monthly behavior consistent with seasonality David / Luis would recognize?
- Does refund handling work (try a known refunded order if any visible)?
- Per-customer breakdown for top-N customers — does revenue split look right?

---

## 6. Execution steps

### Step 1 — Extract `account.move.line` data for SKU 77201046

Pull from Odoo live for the 3 product variants (7090, 1541, 2371):
- All `account.move.line` rows where `product_id IN (...)` — across all time
- Parent `account.move` for each: `id`, `date`, `invoice_date`, `state`, `move_type`, `partner_id`, `name`
- Account info: `account.account` for `id`, `name`, `account_type`
- Persist to `docs/reconciliation/odoo_extract_77201046_invoices_<ts>.json`

### Step 2 — Brute-force SSOT finder for SKU 77201046

Script: `docs/reconciliation/find_07_ssot_finder.py`

Loads:
- The new `odoo_extract_77201046_invoices_<ts>.json` (Step 1)
- The existing `odoo_extract_77201046_latest.json` (sale.order, purchase.order, stock.move data)

Computes:
- Every formula in §5.1 + §5.2 matrix
- Score per §5.3
- Sort ascending

Outputs:
- `docs/reconciliation/find_07_ssot_finder_results.md` (top-50 ranked)
- `docs/reconciliation/find_07_ssot_finder_results.json` (full results for audit)
- Stdout: top-5 + their gap breakdown

**Checkpoint:** present top-5 to user, wait for selection (Checkpoint B from prior message).

### Step 3 — Persist winning formulas as new prod tables

User-selected winning formula(s) → schema additions in prod:

```sql
-- Coexist with existing demand_daily; do not break it.
CREATE TABLE revenue_daily (
  product_id INT REFERENCES products(id),
  ssot_label VARCHAR(50) NOT NULL,   -- e.g. 'aml_income_posted_invoice_date'
  metric VARCHAR(20) NOT NULL,        -- 'sales' | 'purchases_ordered' | 'purchases_received'
  observation_date DATE NOT NULL,
  quantity NUMERIC(15,4) NOT NULL,
  revenue_gtq NUMERIC(15,4),
  source_doc_count INT,
  PRIMARY KEY (product_id, ssot_label, metric, observation_date)
);
```

(Schema TBD; finalize after winning formula is known.)

Migration: `supabase/migrations/20260423000002_revenue_daily_table.sql`.

### Step 4 — Identify top 10 REYMA + top 10 CARVAJAL by Net Sales

**Movement metric (per Checkpoint A):** total revenue = `Σ subtotal` from delivered sale.order.line, all time.

Script: `docs/reconciliation/find_08_top20_movers.py`

Logic:
- Query Odoo live for all `product.product` linked to suppliers tagged Reyma OR Carvajal — by partner name on `product.supplierinfo`, OR via category, OR via a name pattern (need to verify).
- For each, compute total delivered revenue (or use the snapshot's existing `subtotal` data — we already have it in prod).
- Rank descending. Top 10 each = our scope.

**Open question for user before running this step:** how do we identify Reyma vs Carvajal products?
- (a) `product.supplierinfo` join to `res.partner.name LIKE '%Reyma%'` / `'%Carvajal%'`
- (b) Product name contains "REYMA" / "CARVAJAL"
- (c) Manual list from David / [_CHEATSHEET_DAVID_APR23.md](../april_jumpstart/_CHEATSHEET_DAVID_APR23.md)

Will pause to confirm before running.

### Step 5 — Pull all Odoo live data for the 20 SKUs

Script: `docs/reconciliation/find_09_extract_top20.py`

Same extraction shape as `replace_04_extract_from_odoo.py` but:
- 20 product.products (parameterized)
- Same downstream tables (sale.order.line, account.move.line, purchase.order.line, stock.move, parents, FK targets)

Output: 20 JSON files or one consolidated JSON.

### Step 6 — Apply winning formula to 20 SKUs × 14 months

Script: `docs/reconciliation/find_10_populate_revenue_daily.py`

For each (SKU, ssot_label, metric, month) cell:
- Compute aggregate per winning formula
- INSERT INTO `revenue_daily`

Periods: Nov 2024, Dec 2024, all 12 months of 2025. Total cells: 20 × 14 × ~3 metrics = ~840 rows.

### Step 7 — Gap report tool

Script: `docs/reconciliation/find_11_gap_report.py`

CLI/API for spot-checking:
- Input: SKU + month
- Output: prod's number per each ssot_label, side-by-side
- Optionally: a Vercel page that lets Luis/David click through SKUs and months

This is what we'd send David BEFORE the next call so he can pre-validate.

### Step 8 — Forecast Feb/Mar 2026

Once Test 1 is provably passable on the 20 SKUs:
- Use the winning SSOT to build training data for Prophet
- Train on Oct 2024 → Jan 2026 (the ~17 months we have)
- Predict Feb 2026 + Mar 2026 per SKU
- Persist predictions to a new `forecast_results` table tagged with SSOT label and run timestamp
- Hand to David / Luis for validation against prod-Odoo dashboard

### Step 9 — Reward conversion

If Test 2 passes → request Odoo prod credentials → build live-sync to prod-Odoo (out of scope of this plan; covered by [_ODOO_EXPLORATION_PLAN.md](../../_ODOO_EXPLORATION_PLAN.md) Phase 3).

---

## 7. Persistence strategy in prod

Per user direction, multiple coexisting calculations are allowed during discovery:

| Table | Source | Purpose |
|---|---|---|
| `demand_daily` (existing) | `sale.order.line` SSOT contract from `SSOT_VALIDATION.md` | DON'T break — current app reads this |
| `revenue_daily` (new) | one row per (SKU, ssot_label, metric, day) | Side-by-side comparison of multiple formulas |
| `forecast_results` (new, Step 8) | Prophet outputs per SSOT formula | Test 2 deliverable |

After winning SSOT is locked in (post-Test-1, post-Test-2), `demand_daily` can be migrated to the winner's logic — but that's a separate plan.

---

## 8. Decisions locked from user (2026-04-23)

1. SKU scope (Step 4): top 10 REYMA + top 10 CARVAJAL by **Net Sales** (≈ total revenue).
2. Period scope: Nov 2024, Dec 2024, all 12 months of 2025 = 14 months total.
3. Acid Test 2 prediction window: Feb 2026 + Mar 2026.
4. Variant scope: all 3 product.product per SKU when applicable (active + archived).
5. Trial-and-error result review: present top-5 to user (not auto-pick).
6. Persist multiple SSOT calculations side-by-side in prod.
7. Live Odoo data is the source of truth — replace prod from live, do not trust the 2026-03-03 CSV snapshot.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Brute-force overfits to 5 datapoints by coincidence | Manual top-5 review (Checkpoint B). Cross-check against per-day pattern, refund handling, per-customer split. |
| Winning formula for SKU 77201046 doesn't generalize to other 19 SKUs | Validate top winners against ANY other ground truth we can solicit from David before scaling. |
| Top 10 REYMA/CARVAJAL identification is wrong (e.g. by name vs supplier link) | Cross-check with [_CHEATSHEET_DAVID_APR23.md](../april_jumpstart/_CHEATSHEET_DAVID_APR23.md) which lists 36 Carvajal+Reyma SKUs already. |
| Odoo live test env account.move.line access denied | Verified accessible per [_ODOO_EXPLORATION_RESULTS.md](../../_ODOO_EXPLORATION_RESULTS.md) — `account.move.line` is in the 15 Solicitud models, all readable. |
| Prophet retrain takes hours per SKU on Railway | Cap at top-20 SKUs initially. ML service /backtest/run already supports this. |
| Forecast Feb/Mar 2026 wildly wrong even on correct SSOT | Two months is short — Luis may understand seasonal noise. We position this as a **directional** forecast, not point-perfect. |
| Demo / call schedule slips while we're discovering SSOT | Daily snapshots of progress in `docs/reconciliation/` so any handover is loss-less. |

---

## 10. Files this plan will produce (forecast)

| Phase | File | Purpose |
|---|---|---|
| Plan | [PLAN_ACID_TEST_SSOT_DISCOVERY.md](PLAN_ACID_TEST_SSOT_DISCOVERY.md) | This document |
| Step 1 | `find_06_extract_invoices_77201046.py` | Pull aml/account data |
| Step 1 | `odoo_extract_77201046_invoices_<ts>.json` | Raw extract |
| Step 2 | `find_07_ssot_finder.py` | Brute-force scorer |
| Step 2 | `find_07_ssot_finder_results.md` | Top-50 ranking (for review) |
| Step 2 | `find_07_ssot_finder_results.json` | Full audit |
| Step 3 | `supabase/migrations/20260423000002_revenue_daily_table.sql` | Schema |
| Step 4 | `find_08_top20_movers.py` | SKU shortlist |
| Step 4 | `top20_sku_list.md` | Final list (after user review) |
| Step 5 | `find_09_extract_top20.py` + extracts | 20-SKU data pull |
| Step 6 | `find_10_populate_revenue_daily.py` | Apply winning formula |
| Step 7 | `find_11_gap_report.py` | Spot-check tool |
| Step 8 | `find_12_forecast_feb_mar_2026.py` | Test 2 deliverable |

---

## 11. What this plan does NOT do

- Does NOT change `demand_daily` semantics yet. The existing app continues to work.
- Does NOT delete the SKU 77201046 sale.order.line replacement done earlier today (still useful as the operational/delivery baseline, separate from David's view).
- Does NOT request Odoo prod credentials. That's the reward, not a prerequisite.
- Does NOT build the live-sync incremental — that's [_ODOO_EXPLORATION_PLAN.md](../../_ODOO_EXPLORATION_PLAN.md) Phase 3 territory.
- Does NOT touch other tables (`customers`, `suppliers`) FK semantics — that's [PLAN_FIX_PRODUCTS_ODOO_ID.md](PLAN_FIX_PRODUCTS_ODOO_ID.md) territory.
