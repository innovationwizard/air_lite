# Changelog: Fix Ventas Endpoints — SSOT Alignment

**Date:** 2026-03-05
**Author:** Claude Opus 4.6
**Scope:** `api-node/src/routes/ventas.ts`, new Prisma migration
**Status:** Code complete, pending deploy

---

## Summary

Three ventas API endpoints (`/resumen`, `/tendencia`, `/productos-top`) were returning incorrect financial metrics because they queried `sales_partitioned` — a table sourced from Odoo sale orders (tax-inclusive, with UoM conversion). The Odoo SSOT dashboard reports **tax-exclusive invoiced revenue** and **selling-UoM quantities** from posted invoices. This change aligns the API with the SSOT.

---

## Problem

Audited against Odoo dashboard (frozen 03/03/2026) for January 2026. Example — SKU 77205001 (BANDEJA 2P TERMO FOM BIO 10/50):

| Metric | API (before) | SSOT (Odoo) | Error |
|--------|-------------|-------------|-------|
| Venta Neta | Q2,838,792 | Q2,382,307 | +19.2% (tax-inclusive) |
| Cantidad | 452,730 | 42,545 | 10.6x (UoM ratio multiplication) |
| Margen | Q2,582,790 | Q325,977 | wildly inflated |

**Root causes:**
1. `total_price = unit_price * quantity` is a generated column using Odoo's tax-inclusive unit price (Q65 includes 12% IVA)
2. `SUM(quantity * uom_ratio)` converts FARDO10 (ratio=10) to base FARDOs, inflating count ~10x
3. Source is `sales_partitioned` (all confirmed sale orders) instead of posted invoices

---

## Solution

### New SQL View: `v_invoice_product_sales`

Created via migration `20260305000000_create_invoice_product_sales_view`:

```sql
CREATE VIEW v_invoice_product_sales AS
SELECT
  aml.id          AS line_id,
  p.product_id,   p.sku,   p.product_name,
  p.cost          AS product_cost,
  am.invoice_date,
  am.partner_name AS client_name,
  aml.quantity    AS invoiced_quantity,       -- selling UoM, no ratio
  (aml.credit - aml.debit) AS net_revenue,   -- tax-exclusive by construction
  aml.cost_center
FROM account_move_lines aml
JOIN account_moves am ON aml.move_id = am.id
JOIN products p ON p.sku = aml.product_sku
WHERE aml.gl_account_code LIKE '400.%'       -- VENTAS accounts only
  AND am.state = 'Publicado'                  -- posted invoices only
  AND am.invoice_date IS NOT NULL
  AND aml.product_sku IS NOT NULL;
```

**Design rationale:**
- Plain VIEW (not materialized) — always reflects current data, zero refresh overhead
- INNER JOIN on `products` — excludes unknown SKUs that would produce NULL cost/margin
- Encodes SSOT business rules (GL account filter, state filter, net revenue formula) in one canonical place
- Existing indexes on `account_moves(invoice_date)` and `account_move_lines(gl_account_code, product_sku)` provide query performance

### Endpoint Changes in `ventas.ts`

#### `/resumen` (lines 61-75)

| Before | After |
|--------|-------|
| `SUM(s.total_price)` | `SUM(v.net_revenue)` |
| `SUM(s.quantity * s.uom_ratio)` | `SUM(v.invoiced_quantity)` |
| `AVG(s.total_price)` | `SUM(v.net_revenue) / NULLIF(COUNT(*), 0)` |
| `(SUM(total_price) - SUM(qty * cost)) / SUM(total_price)` | `(SUM(net_revenue) - SUM(invoiced_qty * cost)) / SUM(net_revenue)` |
| Source: `sales_partitioned JOIN products` | Source: `v_invoice_product_sales` |

#### `/tendencia` (lines 116-134)

| Before | After |
|--------|-------|
| `DATE(s.sale_datetime)` | `DATE(v.invoice_date)` |
| `SUM(s.total_price)` | `SUM(v.net_revenue)` |
| `SUM(s.quantity * s.uom_ratio)` | `SUM(v.invoiced_quantity)` |
| `COUNT(DISTINCT s.sale_id)` | `COUNT(*)` |
| Source: `sales_partitioned` | Source: `v_invoice_product_sales` |

#### `/productos-top` (lines 179-195)

| Before | After |
|--------|-------|
| `SUM(s.total_price)` | `SUM(v.net_revenue)` |
| `SUM(s.quantity * s.uom_ratio)` | `SUM(v.invoiced_quantity)` |
| `SUM(s.total_price - s.quantity * p.cost)` | `SUM(v.net_revenue - v.invoiced_quantity * v.product_cost)` |
| `ORDER BY SUM(s.total_price)` | `ORDER BY SUM(v.net_revenue)` |
| Source: `products JOIN sales_partitioned` | Source: `v_invoice_product_sales` |

---

## Not Changed

| Endpoint / Area | Reason |
|----------------|--------|
| `/riesgo-agotamiento` | Forward-looking demand forecast — order data is the correct source |
| `/oportunidades-venta` | Inventory planning — `quantity * uom_ratio` gives physical base units for stock comparison |
| BI handlers (`gerencia.ts`, `finanzas.ts`, etc.) | Same bugs exist but are separate scope; the view is now available for them to adopt |
| `invoice_revenue_by_product` matview | Still used by gerencia + financial queries for monthly aggregations |
| Frontend | Response field names and types are unchanged — no breaking changes |
| `schema.prisma` | Prisma doesn't model SQL views; all queries use `$queryRaw` |

---

## Verification

After deploy, query the API for January 2026 and compare to SSOT:

```bash
TOKEN=$(curl -s -X POST https://api.airefill.app/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"gerencia","password":"<password>"}' | jq -r '.data.accessToken')

curl -s "https://api.airefill.app/api/v1/ventas/productos-top?fechaInicio=2026-01-01&fechaFin=2026-01-31&limite=14" \
  -H "Authorization: Bearer $TOKEN" | jq '.data.productos[] | select(.sku == "77205001")'
```

**Expected for SKU 77205001:**
- `ventas_totales`: ~Q2,395,595 (within ~0.6% of SSOT Q2,382,307 — gap = credit notes not in export)
- `unidades_vendidas`: ~44,625 (within ~4.9% of SSOT 42,545 — same credit note gap)
- `margen_contribucion`: positive, in the Q300K range (vs SSOT Q325,977)

---

## Files Changed

```
NEW  api-node/prisma/migrations/20260305000000_create_invoice_product_sales_view/migration.sql
MOD  api-node/src/routes/ventas.ts  (3 queries rewritten: /resumen, /tendencia, /productos-top)
```

---

## Known Residual Gap (~0.6%)

The Odoo `account.move` export only included "Factura" (invoice) document type. Credit notes ("Nota de crédito de cliente") were not exported. These would reduce both revenue and quantity, closing the remaining ~Q13K / ~2,080 unit gap for SKU 77205001. **Action item:** re-export `account.move` from Odoo including credit note types and reload.
