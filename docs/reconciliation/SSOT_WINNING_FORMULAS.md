# SSOT Winning Formulas — Acid Test 1 (SKU 77201046)

**Locked in:** 2026-04-23 by user confirmation after brute-force search.
**Anchor datapoints (CEO Luis's dashboard, relayed by David):**

| Anchor | Target | Reproduced? |
|---|---:|---:|
| Sales Nov 2024 | 6,466.25 | ✅ exact (Δ 0.00) |
| Sales Dec 2024 | 6,496.50 | ✅ exact (Δ 0.00) |
| Purchases Nov 2024 ordered | 5,917 | ✅ exact (Δ 0.00) |
| Purchases Nov 2024 received | 5,500 | ✅ exact (Δ 0.00) |
| Purchases all-time total | 8,203 | ❌ test env shows 8,124 (Δ 79, ~1%) — likely needs prod env |

4/5 anchors hit exactly from the Odoo test env. The 5th is suspected to require prod env data (1–2 PO lines exist in prod but not in test env).

---

## Formula 1 — SALES

**SSOT label:** `aml_income_posted_invoice_refund_neg_invoice_date_c40`

**Source table:** `account.move.line`

**Filters:**
- `account.account.account_type = 'income'`
- `account.move.state = 'posted'`
- `account.move.move_type IN ('out_invoice', 'out_refund')`
- `account.move.line.product_id IN (variant_ids)` — all variants for the SKU's `default_code`

**Date field for grouping:** `account.move.invoice_date` (fallback `account.move.date` when `invoice_date` is null — equivalent on posted invoices in this dataset)

**Quantity:** `account.move.line.quantity`, normalized to product's stock UoM (CAJA40 for SKU 77201046).

**Refund handling:** `out_refund` quantity counted as **negative** (`qty *= -1`).

**Revenue (GTQ):** `SUM(price_subtotal)`, with refunds also negative.

**Pseudo-SQL** (against Odoo via XML-RPC then INSERT to Supabase):
```sql
SELECT
  product_id,
  invoice_date AS day,
  SUM(quantity * sign) AS quantity,         -- sign = -1 for out_refund, +1 otherwise
  SUM(price_subtotal * sign) AS revenue,
  COUNT(DISTINCT move_id) AS source_doc_count
FROM account_move_line aml
JOIN account_move m ON m.id = aml.move_id
JOIN account_account a ON a.id = aml.account_id
WHERE a.account_type = 'income'
  AND m.state = 'posted'
  AND m.move_type IN ('out_invoice', 'out_refund')
  AND aml.product_id IN (variant_ids)
GROUP BY product_id, invoice_date;
```

---

## Formula 2 — PURCHASES_ORDERED

**SSOT label:** `pol_all_states_date_planned_product_qty_c40`

**Source table:** `purchase.order.line`

**Filters:**
- **No state filter** — `draft`, `sent`, `to approve`, `purchase`, `done`, `cancel` ALL counted
- `purchase.order.line.product_id IN (variant_ids)`

**Date field for grouping:** `purchase.order.date_planned` (when delivery is expected — NOT `date_order`)

**Quantity:** `purchase.order.line.product_qty`, normalized to CAJA40.

**Pseudo-SQL:**
```sql
SELECT
  product_id,
  date_planned::date AS day,
  SUM(product_qty * uom_factor_to_stock) AS quantity,
  COUNT(DISTINCT order_id) AS source_doc_count
FROM purchase_order_line pol
JOIN purchase_order po ON po.id = pol.order_id
WHERE pol.product_id IN (variant_ids)
GROUP BY product_id, day;
```

**Why `date_planned` not `date_order`:** verified empirically. Nov 2024 by `date_order` gives 8,395 (wrong); by `date_planned` gives 5,917 (matches David's 5,917 exactly). Operationally this makes sense — David tracks "what should arrive in November," not "what we placed orders for in November."

**Why all states (including draft and cancel):** verified empirically. Filtering to `purchase` + `done` only loses 62 units in Nov 2024 (5,855 vs target 5,917). This is counterintuitive — likely David's dashboard counts cancelled-but-once-planned POs as "ordered". Worth confirming with David before scaling.

---

## Formula 3 — PURCHASES_RECEIVED

**SSOT label:** `pol_purchase_done_date_planned_qty_received_c40`

**Source table:** `purchase.order.line`

**Filters:**
- `purchase.order.state IN ('purchase', 'done')` (other states have qty_received = 0 anyway, so equivalent results)
- `purchase.order.line.product_id IN (variant_ids)`

**Date field:** `purchase.order.date_planned` (same logic as ordered)

**Quantity:** `purchase.order.line.qty_received`, normalized to CAJA40.

**Pseudo-SQL:**
```sql
SELECT
  product_id,
  date_planned::date AS day,
  SUM(qty_received * uom_factor_to_stock) AS quantity,
  COUNT(DISTINCT order_id) AS source_doc_count
FROM purchase_order_line pol
JOIN purchase_order po ON po.id = pol.order_id
WHERE pol.product_id IN (variant_ids)
  AND po.state IN ('purchase', 'done')
GROUP BY product_id, day;
```

---

## What's NOT yet validated (open follow-ups)

1. **Purchases all-time total of 8,203** — gap of 79 units (~1%). Hypothesis: 1–2 PO lines in prod-Odoo not in test-Odoo. Cannot verify without prod credentials.
2. **Generalization to other 19 SKUs** — formulas are derived from SKU 77201046 only. Top-20 movers are next on plan to validate.
3. **The "all states" finding for purchases_ordered** — feels wrong; want David's confirmation that cancelled POs really are counted in "ordered". Could also be coincidence of the Nov 2024 dataset (no cancelled POs in Nov for this SKU happen to be excluded from his number).
4. **Refund handling on purchases** — David didn't mention `in_refund`. Current Formula 2/3 don't subtract returns to vendors. May need to add later.

---

## Persisted in prod

**Table:** `revenue_daily` (added by [supabase/migrations/20260423000002_revenue_daily.sql](../../supabase/migrations/20260423000002_revenue_daily.sql))

**Population script:** [find_08_populate_revenue_daily_77201046.py](find_08_populate_revenue_daily_77201046.py) (idempotent, re-runnable)

**Rows for SKU 77201046:** ~700 daily rows across 3 metrics (covers all data since 2024-09).

**Coexists with `demand_daily`** — the OLD operational view (sale.order.line + effective_date + delivered_qty + sale/done) is preserved untouched. No app-facing breakage.
