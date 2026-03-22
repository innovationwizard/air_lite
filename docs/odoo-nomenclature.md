# Odoo Nomenclature Conventions

Odoo encodes business metadata into field nomenclature (naming patterns). Beyond UoM in product names, other fields carry structured information that can be parsed programmatically.

## Invoice / Move Number Format

`account_moves.move_number` format: `PREFIX/YEAR/SEQUENCE` (e.g. `FCSJ/2026/00123`)

## Complete Prefix Analysis (verified from prod data, 192,502 total moves)

### FC* — Facturas (Invoices) — INCLUDED in calculations

| Prefix | Location | Revenue (Jan 2026) | cost_center mapping | Has 400.% GL | In view? |
|--------|----------|-------------------|-------------------|-------------|---------|
| `FCSJ` | Bodega central (San José) | Q20,895,961 (79.4%) | NULL (Sin asignar) | Yes | **Yes** |
| `FCZA` | Bodega Zacapa | Q2,041,778 (7.8%) | NULL (Sin asignar) | Yes | **Yes** |
| `FCPE` | Bodega Petén | Q1,736,694 (6.6%) | NULL (Sin asignar) | Yes | **Yes** |
| `FCZ11` | Tienda Zona 11 | Q648,542 (2.5%) | Tienda Z11 | Yes | **Yes** |
| `FCZ09` | Tienda Terminal | Q581,912 (2.2%) | Tienda Terminal | Yes | **Yes** |
| `FCZ17` | Tienda Zona 17 | Q219,168 (0.8%) | Tienda Zona 17 | Yes | **Yes** |
| `FCLT` | Tiendas Z9 La Torre | Q161,515 (0.6%) | Tiendas Z9 La Torre | Yes | **Yes** |
| `FCMIX` | Tienda Mixco | Q28,295 (0.1%) | Tienda Mixco | Yes | **Yes** |

All 8 FC prefixes correctly included — `v_invoice_product_sales` filters on `gl_account_code LIKE '400.%'` which catches all FC* lines that post to revenue accounts.

### Non-FC — Financial entries — CORRECTLY EXCLUDED

| Prefix | Type | GL Accounts | Has 400.% GL | In view? |
|--------|------|-------------|-------------|---------|
| `CHPR` | Cheques Prefechadas (postdated checks) | 112.170 | No | **No** (correct) |
| `NDI*` (variants) | Notas de Débito Interior (bank payments) | 112.xxx | No | **No** (correct) |

These have no revenue GL lines — the `400.%` filter correctly excludes them.

### RFC* — Notas de Crédito — MISSING FROM DATA

| Prefix | Type | Expected GL | Expected behavior | In view? |
|--------|------|-------------|-------------------|---------|
| `RFC*` | Credit notes (returns/refunds) | 400.% (negative) | Negative `credit - debit` reduces revenue & COGS | **No** — 0 entries in entire DB |

**This is the gap.** Zero RFC-prefixed moves exist across all 192,502 records. The Odoo export excluded them entirely. Expected RFC variants (by analogy with FC prefixes): `RFCSJ`, `RFCZA`, `RFCPE`, `RFCZ11`, `RFCZ09`, `RFCZ17`, `RFCLT`, `RFCMIX` — or possibly a single `RFC` prefix for all locations. Needs confirmation from user.

### Impact Summary

| Category | Status | Impact |
|----------|--------|--------|
| FC* invoices (8 prefixes) | Correctly included | Revenue correct for invoices |
| CHPR / NDI* financial | Correctly excluded | No false revenue |
| RFC* credit notes | **Missing from export** | Revenue overstated +Q1.24M (+4.9%), margin understated by 1.85pp |

### How the View Handles Prefixes

`v_invoice_product_sales` does NOT filter by prefix — it uses:
- `gl_account_code LIKE '400.%'` — catches any prefix with revenue GL lines
- `am.state = 'Publicado'` — only posted moves
- No prefix-based filtering

**If RFC entries are loaded into the database, they will automatically be included** — their 400.% GL lines will have negative `credit - debit`, correctly reducing both revenue and COGS. No code changes needed.

### Open Questions
1. Do RFC credit notes use location-specific prefixes (e.g. `RFCSJ`, `RFCZA`) or a single `RFC` prefix for all locations?
2. Are there any other document types beyond FC/RFC/CHPR/NDI that could exist in Odoo (e.g. debit notes to customers, consignment entries)?

## Key Insight: Warehouse breakdown from move_number

The 3 warehouse journals (FCSJ + FCZA + FCPE) account for 93.8% of revenue — this matches the "Sin asignar" cost_center at Q24,687,852. The `cost_center` field only distinguishes retail stores; wholesale/warehouse invoices have NULL cost_center but CAN be split by parsing `move_number`.

## Document Types (from user)

| Prefix pattern | Meaning |
|---------------|---------|
| `FC*` | Factura (Invoice) — revenue-bearing |
| `RFC*` | Nota de crédito (Credit note) — absent from current data |
| `CHPR` | Cheques Prefechadas — financial entry, GL 112.170 |
| `NDI*` | Nota de Débito Interior — bank payment entries, GL 112.xxx |

## Warehouse Codes (from user)

| Code | Location |
|------|----------|
| `SJ` | Bodega central |
| `ZAC` / `ZA` | Bodega Zacapa |
| `PE` | Bodega Petén |
| Others | Tiendas (PT = point of sale) |

## Product UoM in Naming

Product stock UoM is encoded in the `Unidad de medida` field and can be cross-referenced with `units_of_measure` table. Examples:
- `CAJA40` → box of 40 units (ratio=40)
- `FARDO10` → bundle of 10 (ratio=10)
- `FARDO3200` → bundle of 3200 (ratio=3200)

## Credit Note Gap (as of 2026-03-05)

Current Odoo export contains ZERO RFC-prefixed moves — 0 out of 192,502 total. Credit notes are identified by `move_number` prefix (`RFC*`), NOT by a separate column or `move_type` value (all exports have `move_type = 'Factura'`). The original Odoo export simply excluded RFC entries.

Impact on January 2026:
- Revenue overstated by ~Q1.24M (+4.9%) vs SSOT
- Margin understated by ~1.85pp (17.82% vs SSOT 19.67%)
- **Action required:** re-export from Odoo ensuring RFC-prefixed entries are included. Once loaded, `v_invoice_product_sales` will automatically pick them up (RFC lines on 400.% GL accounts have negative `credit - debit`, reducing revenue and COGS).
