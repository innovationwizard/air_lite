# Purchase Scheduling POC — Carvajal & Reyma

**Date:** 2026-03-24
**Client request:** "Con datos reales de Carvajal y Reyma. Pedirles que nos demuestren cómo la IA armaría la programación de furgones de una semana específica respetando la política de 2 semanas de inventario máximo."
**Scope:** Weekly purchase schedule optimizer with 14-day max inventory constraint

---

## What Was Built

### Database
- `purchase_schedule_runs` table: training window, target week, totals, status
- `purchase_schedule_lines` table: per-product, per-day recommendations with Spanish reasoning
- `get_supplier_products_for_schedule()` RPC: Carvajal products via product_suppliers table
- `get_reyma_products_for_schedule()` RPC: Reyma products identified by name pattern (no PO linkage)

### ML Engine (Railway)
- `purchase_scheduler.py`: Prophet-based weekly demand forecasting + purchase optimization
  - Trains Prophet per product using historical demand (Census Filter applied)
  - Forecasts daily demand for target week
  - Calculates optimal purchase quantities: reorder when inventory < 7 days, fill to 14-day ceiling
  - Spanish reasoning text per recommendation line
- `/backtest/purchase-schedule-all` endpoint with resume capability (skips already-completed cycles)
- Gunicorn timeout increased from 600s to 3600s to accommodate full pre-computation

### Frontend
- `/poc/programacion` page with:
  - Week timeline selector (61 clickable week buttons)
  - KPI cards: weeks analyzed, avg products/week, total units, total value
  - Supplier breakdown (Carvajal vs Reyma with per-supplier totals)
  - Daily purchase table: product, supplier badge, quantity, UOM, value, days of supply before/after
  - Expandable per-product reasoning in Spanish
  - Methodology section explaining the AI approach
- `/api/poc/purchase-schedule` route: list runs + get run detail with joined product data
- Sidebar: "POC Cliente" section with Truck icon

### Data
- Carvajal: 31 products with demand data (linked via product_suppliers)
- Reyma: 63 products with demand data (identified by product name containing "REYMA")
- Total: ~78-94 qualifying products per cycle (varies by training window)

---

## Pre-computation Results

| Metric | Value |
|--------|-------|
| Total weeks computed | 61 |
| Failed cycles | 0 |
| Date range | Jan 1, 2025 → Mar 3, 2026 |
| Total units recommended | 2,310,734 |
| Total value recommended | GTQ 217,520,574 |
| Avg products with orders/week | 43 |
| Avg computation time/week | ~18 seconds |
| Total computation time | ~18 minutes |

### Gunicorn Timeout Issue
First pre-computation attempt hit 600s timeout at week 35. Fixed by:
1. Increasing gunicorn timeout to 3600s in Dockerfile CMD
2. Adding resume capability to `/backtest/purchase-schedule-all` (checks completed runs, starts from next offset)
3. Second run completed remaining 26 cycles without issue

---

## Purchase Scheduling Algorithm

```
For each product in target week:
  1. avg_daily_demand = Prophet forecast / 7
  2. max_inventory_ceiling = avg_daily_demand × 14 days
  3. reorder_point = avg_daily_demand × 7 days

  For each day (Mon-Sun):
    4. projected_inventory = previous_day_inventory - today's_forecasted_demand
    5. IF projected_inventory < reorder_point:
         order_qty = max_inventory_ceiling - projected_inventory
         (never exceed 14-day ceiling)
    6. Update inventory with purchase
```

**Policy enforced:** Inventory never exceeds 14 days of forecasted demand (2-week maximum).
**Reorder trigger:** When inventory drops below 7 days of supply.

---

*Real PLASTICENTRO data. Real Carvajal and Reyma products. No mock data. No simulations.*
