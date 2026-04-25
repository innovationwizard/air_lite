# Step 0d — UoM Audit

**Run:** 2026-04-24T20:34:42Z


Per §3 of the plan, cross-SKU aggregation in absolute quantity is only safe when all SKUs share a stock UoM. This substep enumerates what each of the 23 acid-test SKUs carries in Supabase's `products` table.

## Per-SKU UoM

| SKU | class | representative_name | stock_uom | stock_uom_ratio | supabase_odoo_id | supabase_active |
|---|---|---|---|---|---|---|
| `77205001` | CARVAJAL | Bandeja Bio 2P Foam "10/50 Termo Fom | `FARDO10` | 1.0000 | 9790 | True |
| `77205003` | CARVAJAL | Bandeja Bio N1 Duroport ¨5/50 Termo Fom | `FARDO5` | 1.0000 | 9282 | True |
| `77205207` | CARVAJAL | Vaso Bio 8oz Duroport ¨40/25 Viva | `CAJA40` | 1.0000 | 8824 | True |
| `77205034` | CARVAJAL | Portacomida Bio 7x7 C/D Duroport ¨4/50 Termo Fom | `FARDO4` | 1.0000 | 8697 | True |
| `77205287` | CARVAJAL | Bandeja Bio N2 Duroport ¨10/50 Viva | `FARDO10` | 1.0000 | 9247 | True |
| `77205208` | CARVAJAL | Vaso Bio 10oz Duroport ¨40/25 Viva | `CAJA40` | 1.0000 | 8893 | True |
| `77205190` | CARVAJAL | Bandeja Bio N2 Duroport ¨20/25 Viva | `FARDO20` | 1.0000 | 9222 | True |
| `77205005` | CARVAJAL | Portacomida Bio 8x8 C/D Duroport ¨4/50 Termo Fom | `FARDO4` | 1.0000 | 9727 | True |
| `77205002` | CARVAJAL | Plato Bio N6 Duroport ¨20/25 Termo Fom | `FARDO20` | 1.0000 | 8681 | True |
| `77205035` | CARVAJAL | Portacomida Bio 7x7 Liso Negro Duroport ¨4/50 Term | `FARDO4` | 1.0000 | 8728 | True |
| `77205187` | CARVAJAL | Plato Bio N6 Duroport ¨20/25 Viva | `FARDO20` | 1.0000 | 8668 | True |
| `77201046` | REYMA | Vaso Blanco 10oz Duroport ¨40/25 Reyma | `CAJA40` | 1.0000 | 9764 | True |
| `77201000` | REYMA | Vaso Blanco 8oz Duroport ¨40/25 Reyma | `CAJA40` | 1.0000 | 8867 | True |
| `77201055` | REYMA | Vaso Plástico 12oz Plástico ¨20/50 Reyma | `CAJA20` | 1.0000 | 8896 | True |
| `77201053` | REYMA | Vaso Plástico 16oz Plástico ¨40/25 Reyma | `CAJA40` | 1.0000 | 8832 | True |
| `77201069` | REYMA | Film 0 12"x2000´ Plástico 0 Reyma | `CAJA` | 1.0000 | 9172 | True |
| `77201041` | REYMA | Envase Blanco 16oz Duroport ¨20/25 Reyma | `CAJA20` | 1.0000 | 9117 | True |
| `77201014` | REYMA | Tapa P/Envase 16 y 32oz Plástico ¨20/25 Reyma | `CAJA20` | 1.0000 | 8747 | True |
| `77201056` | REYMA | Vaso Plástico 8oz Plástico ¨20/50 REYMA | `CAJA20` | 1.0000 | 9776 | True |
| `77201019` | REYMA | Vaso Plástico 10oz Plástico ¨20/50 Reyma | `CAJA20` | 1.0000 | 8825 | True |
| `77201038` | REYMA | Contenedor Termoformado 6x6 Duroport ¨1/500 Reyma | `CAJA10` | 1.0000 | 9055 | True |
| `77201047` | REYMA | Vaso Blanco 12oz Duroport ¨40/25 Reyma | `CAJA40` | 1.0000 | 8855 | True |
| `77201023` | REYMA | Plato Foam N8 Hondo Duroport ¨20/25 Reyma | `FARDO20` | 1.0000 | 8671 | True |

## Distinct UoM bucket distribution

| stock_uom | SKU count | SKUs |
|---|---|---|
| `CAJA40` | 6 | `77205207`, `77205208`, `77201046`, `77201000`, `77201053`, `77201047` |
| `CAJA20` | 5 | `77201055`, `77201041`, `77201014`, `77201056`, `77201019` |
| `FARDO20` | 4 | `77205190`, `77205002`, `77205187`, `77201023` |
| `FARDO4` | 3 | `77205034`, `77205005`, `77205035` |
| `FARDO10` | 2 | `77205001`, `77205287` |
| `FARDO5` | 1 | `77205003` |
| `CAJA` | 1 | `77201069` |
| `CAJA10` | 1 | `77201038` |

## Insights & possibilities

- **Scope contains 8 distinct stock UoMs.** Per §3 policy, cross-SKU absolute-quantity sums are NOT safe here. The existing Forecast a Ciegas total row is mathematically meaningless until remediated. UoM groups: `FARDO10` (2), `FARDO5` (1), `CAJA40` (6), `FARDO4` (3), `FARDO20` (4), `CAJA20` (5), `CAJA` (1), `CAJA10` (1).

**Out-of-scope for this step (to be answered by future work):** whether `stock_uom` is in fact the Odoo `uom_id` name string (e.g. `CAJA40`) or a display-level name, and whether `stock_uom_ratio` correctly reflects the Odoo `uom.uom.factor` or is a no-op `1.0`. A future Odoo-side audit (using the explorer in `ml/odoo_explorer.py`) can compare.
