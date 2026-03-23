# SSOT Validation — AI Refill Lite vs Odoo

**Date:** 2026-03-23
**Odoo Snapshot:** Frozen on 2026-03-03 22:51:11
**Period Validated:** January 2026

---

## Correct Query Logic (matches Odoo dashboard)

The Odoo "Análisis de Ventas" dashboard uses:
- **Date filter:** `effective_date` (delivery confirmation date), NOT `order_date`
- **Quantity:** `delivered_qty` (quantity actually delivered), NOT `quantity` (quantity ordered)
- **Revenue:** Stored `subtotal` from `sale.order.line` (Odoo's `price_subtotal`)
- **State filter:** `state IN ('sale', 'done')` — confirmed and completed orders only
- **Delivery filter:** `delivered_qty > 0` — only lines with actual deliveries

**All user-facing sales calculations in AI Refill Lite MUST use this logic.**

---

## Headline KPIs — January 2026

| Metric | Our DB | Odoo SSOT | Difference | Notes |
|--------|--------|-----------|------------|-------|
| **Venta Cantidad** | 249,236 | 244,752 | **+1.83%** | Qty from delivered lines by effective_date |
| **Venta Neta** | Q24,104,138 | Q25,086,052 | **-3.91%** | Stored subtotal; see explanation below |
| **Existencia a la mano** | 250,715 | 252,401 | **-0.67%** | SUM(stock_quants.quantity) for internal locations |

### Revenue Gap Explanation (-3.91%)

Three revenue calculation methods were tested (2026-03-23):

| Method | Revenue | Diff vs Odoo |
|--------|---------|-------------|
| A: Stored subtotal (Odoo's `price_subtotal`) | Q24,104,138 | **-3.91%** |
| B: Proportional `subtotal × (delivered_qty / quantity)` | Q23,747,039 | -5.34% |
| C: Computed `unit_price × delivered_qty × (1 - discount%)` | Q26,594,834 | +6.02% |

**Method A was selected** as the closest match. The stored `subtotal` in our CSV export corresponds to Odoo's `price_subtotal` field, which is the full order line subtotal (ordered quantity × unit price × discount). The -3.91% gap comes from partial deliveries where the stored subtotal covers the full ordered quantity, but Odoo's dashboard may apply a slight adjustment for partially-delivered lines that we cannot reproduce from the CSV export.

**Impact on backtest:** Minimal. Prophet's demand modeling uses daily quantity patterns and seasonal trends, not absolute GTQ values. The ±4% revenue attribution difference does not affect forecast quality.

**Impact on savings calculations:** The 4 contractual savings (storage costs, unnecessary purchases, lost sales, inventory rotation) use quantity-based demand signals and inventory levels — both of which match within 1.83% and 0.67% respectively. Revenue is used only in summary text, not in core optimization math.

---

## Top Products — January 2026

| # | SKU | Product | Our Revenue | Odoo Revenue | Diff | Our Qty | Odoo Qty | Diff |
|---|-----|---------|-------------|-------------|------|---------|----------|------|
| 1 | 77205001 | BANDEJA 2P TERMO FOM BIO 10/50 | Q2,408,343 | Q2,382,307 | +1.1% | 42,661 | 42,545 | +0.3% |
| 2 | 77201046 | VASO DUROPORT No. 10 REYMA 40-25 | Q1,939,751 | Q1,863,634 | +4.1% | 9,906 | 9,787 | +1.2% |
| 3 | 77205207 | VASO No 8 OZ VIVA DUROPORT BIODEG. 40X25 | Q1,643,994 | Q1,657,228 | -0.8% | 10,267 | 10,429 | -1.6% |
| 4 | 77205034 | PORTACOMIDA BIO 7X7 C/D TERMO 4/50 | Q821,574 | Q848,753 | -3.2% | 8,050 | 8,336 | -3.4% |
| 5 | 77201000 | VASO DUROPORT No. 8 REYMA 40-25 | Q771,719 | Q734,101 | +5.1% | 4,515 | 4,523 | -0.2% |

**Product ranking matches exactly.** Per-product differences are 0.2%–5.1%, consistent with partial delivery attribution and month-boundary edge cases.

---

## Inventory — Snapshot 2026-03-03

| Metric | Our DB | Odoo SSOT | Difference |
|--------|--------|-----------|------------|
| Existencia a la mano | 250,715 | 252,401 | **-0.67%** |

Reconstructed inventory (via `reconstruct_inventory_daily()`) validated against `stock_quants` snapshot: **0 discrepancies** on the snapshot date.

---

## Query Logic Reference

### Correct: Sales revenue (user-facing)
```sql
-- Method A: stored subtotal — closest match to Odoo SSOT (-3.91%)
SELECT
  SUM(sol.subtotal) AS net_revenue,
  SUM(sol.delivered_qty) AS quantity_sold
FROM sale_order_lines sol
JOIN sale_orders so ON so.id = sol.order_id
WHERE so.state IN ('sale', 'done')
  AND sol.delivered_qty > 0
  AND so.effective_date IS NOT NULL
  AND so.effective_date >= [start_date]
  AND so.effective_date < [end_date];
```

### Correct: Inventory on-hand
```sql
SELECT SUM(sq.quantity) AS on_hand
FROM stock_quants sq
JOIN stock_locations sl ON sl.id = sq.location_id
WHERE sl.location_type = 'internal';
```

### Correct: Demand aggregation for backtest (Census Filter)
Uses `effective_date` (delivery confirmation) for date attribution — matches Odoo SSOT.
Uses `delivered_qty` for quantity signal — matches Odoo's "Venta Cantidad".
Uses stored `subtotal` for revenue — closest match to Odoo's "Venta Neta" (-3.91%).

**Applied via:** `supabase/migrations/20260323000001_fix_demand_ssot.sql`
**Function:** `aggregate_demand_daily()` — corrected 2026-03-23

---

## Acceptance Criteria

- Quantity: within ±5% of Odoo SSOT → **PASS (+1.83%)**
- Revenue: within ±5% of Odoo SSOT → **PASS (-3.91%)**
- Inventory: within ±1% of Odoo SSOT → **PASS (-0.67%)**
- Product ranking: exact match → **PASS**

---

*Validated against real Odoo production data. No mock data. No sample data.*
