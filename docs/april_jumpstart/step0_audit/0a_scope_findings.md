# Step 0a — Scope Snapshot

**Run:** 2026-04-24T20:34:39Z

**Count:** 23 SKUs (`is_top_10_in_class=true`)


## Scope table

| # | default_code | class | rank | source | representative_name | supa product_id | stock_uom | ratio | active |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `77205001` | CARVAJAL | 1 | SUPPLIER_LINK | Bandeja Bio 2P Foam "10/50 Termo Fom | 2 | FARDO10 | 1.0000 | True |
| 2 | `77205003` | CARVAJAL | 2 | SUPPLIER_LINK | Bandeja Bio N1 Duroport ¨5/50 Termo Fom | 5 | FARDO5 | 1.0000 | True |
| 3 | `77205207` | CARVAJAL | 3 | SUPPLIER_LINK | Vaso Bio 8oz Duroport ¨40/25 Viva | 37 | CAJA40 | 1.0000 | True |
| 4 | `77205034` | CARVAJAL | 4 | SUPPLIER_LINK | Portacomida Bio 7x7 C/D Duroport ¨4/50 Termo Fom | 29 | FARDO4 | 1.0000 | True |
| 5 | `77205287` | CARVAJAL | 5 | SUPPLIER_LINK | Bandeja Bio N2 Duroport ¨10/50 Viva | 3 | FARDO10 | 1.0000 | True |
| 6 | `77205208` | CARVAJAL | 6 | SUPPLIER_LINK | Vaso Bio 10oz Duroport ¨40/25 Viva | 36 | CAJA40 | 1.0000 | True |
| 7 | `77205190` | CARVAJAL | 7 | SUPPLIER_LINK | Bandeja Bio N2 Duroport ¨20/25 Viva | 145 | FARDO20 | 1.0000 | True |
| 8 | `77205005` | CARVAJAL | 8 | SUPPLIER_LINK | Portacomida Bio 8x8 C/D Duroport ¨4/50 Termo Fom | 1127 | FARDO4 | 1.0000 | True |
| 9 | `77205002` | CARVAJAL | 9 | SUPPLIER_LINK | Plato Bio N6 Duroport ¨20/25 Termo Fom | 1069 | FARDO20 | 1.0000 | True |
| 10 | `77205035` | CARVAJAL | 10 | SUPPLIER_LINK | Portacomida Bio 7x7 Liso Negro Duroport ¨4/50 Term | 1113 | FARDO4 | 1.0000 | True |
| 11 | `77205187` | CARVAJAL | 11 | SUPPLIER_LINK | Plato Bio N6 Duroport ¨20/25 Viva | 1035 | FARDO20 | 1.0000 | True |
| 12 | `77201046` | REYMA | 1 | NAME | Vaso Blanco 10oz Duroport ¨40/25 Reyma | 33 | CAJA40 | 1.0000 | True |
| 13 | `77201000` | REYMA | 2 | NAME | Vaso Blanco 8oz Duroport ¨40/25 Reyma | 34 | CAJA40 | 1.0000 | True |
| 14 | `77201055` | REYMA | 3 | NAME | Vaso Plástico 12oz Plástico ¨20/50 Reyma | 1590 | CAJA20 | 1.0000 | True |
| 15 | `77201053` | REYMA | 4 | NAME | Vaso Plástico 16oz Plástico ¨40/25 Reyma | 1606 | CAJA40 | 1.0000 | True |
| 16 | `77201069` | REYMA | 5 | NAME | Film 0 12"x2000´ Plástico 0 Reyma | 469 | CAJA | 1.0000 | True |
| 17 | `77201041` | REYMA | 6 | NAME | Envase Blanco 16oz Duroport ¨20/25 Reyma | 20 | CAJA20 | 1.0000 | True |
| 18 | `77201014` | REYMA | 7 | NAME | Tapa P/Envase 16 y 32oz Plástico ¨20/25 Reyma | 1366 | CAJA20 | 1.0000 | True |
| 19 | `77201056` | REYMA | 8 | NAME | Vaso Plástico 8oz Plástico ¨20/50 REYMA | 1600 | CAJA20 | 1.0000 | True |
| 20 | `77201019` | REYMA | 9 | NAME | Vaso Plástico 10oz Plástico ¨20/50 Reyma | 1587 | CAJA20 | 1.0000 | True |
| 21 | `77201038` | REYMA | 10 | NAME | Contenedor Termoformado 6x6 Duroport ¨1/500 Reyma | 539 | CAJA10 | 1.0000 | True |
| 22 | `77201047` | REYMA | 11 | NAME | Vaso Blanco 12oz Duroport ¨40/25 Reyma | 1562 | CAJA40 | 1.0000 | True |
| 23 | `77201023` | REYMA | 18 | NAME | Plato Foam N8 Hondo Duroport ¨20/25 Reyma | 1096 | FARDO20 | 1.0000 | True |

## Observations

- **Class breakdown:** {'CARVAJAL': 11, 'REYMA': 12}
- **SKUs missing from Supabase `products` table:** 0
- **Distinct stock UoMs in scope:** 8 — {'FARDO10': 2, 'FARDO5': 1, 'CAJA40': 6, 'FARDO4': 3, 'FARDO20': 4, 'CAJA20': 5, 'CAJA': 1, 'CAJA10': 1}

## Distinct UoMs

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

## Insights

- **Cross-UoM aggregation in the existing Forecast a Ciegas total row is UNSAFE** per §3 UoM policy (multiple distinct stock UoMs in scope). This must be remediated before the demo or moved to a ratio/index view.
