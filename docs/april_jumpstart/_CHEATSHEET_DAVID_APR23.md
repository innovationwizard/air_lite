# CHEAT SHEET — Gerencia Validación — 2026-04-23 9:30 demo

**Audience:** David (PM, Suplicentro) — preview before Alexis.
**Scope:** Carvajal + Reyma only. Runs 58/59/60/61 = Feb/Mar/Abr/May 2025.
**Generated:** 2026-04-22 evening from live prod Supabase.
**Nomenclature:** "App" = la herramienta (AI Refill Lite). "Humanos" = los compradores (Wilmer/Alexis).

The page is at `/gerencia/validacion`. Jorge opens it logged in as `gerencia` (or `superuser`/`admin`). Default landing for the `gerencia` role now goes straight there.

---

## Headline numbers per cycle

| Mes predicho | SKUs | Acierto App | Acierto Humanos | Σ margen proyectado | Σ margen real | Σ uplift |
|---|---|---|---|---|---|---|
| **Febrero 2025** (run 58) | 36 | 65% | 75% (8 SKUs con OC) | Q3.57M | Q3.10M | Q469k |
| **Marzo 2025** (run 59) | 36 | 70% | 82% (7 SKUs con OC) | Q3.82M | Q3.27M | Q543k |
| **Abril 2025** (run 60) | 38 | 70% | 81% (8 SKUs con OC) | Q3.79M | Q3.22M | Q571k |
| **Mayo 2025** (run 61) | 37 | 69% | 81% (8 SKUs con OC) | Q4.07M | Q3.49M | Q577k |

---

## The 5 SKUs Jorge must remember per cycle

Sorted by |margin_uplift| desc (biggest monetary spread first). These are what Alexis is most likely to point at.

### Febrero 2025 — run 58
*Training cutoff: 2025-01-31*

| SKU | Producto | App predijo | Humanos compraron | Se vendió | Acierto App | Acierto Humanos | Uplift GTQ |
|---|---|---:|---:|---:|---:|---:|---:|
| `77201000` | VASO DUROPORT No. 8 REYMA 40-25 | 13,431 | — | 5,637 | 0% | — | Q364k |
| `77201046` | VASO DUROPORT No. 10 REYMA 40-25 | 9,543 | 8,124 | 5,434 | 24% | 50% | Q259k |
| `77205207` | VASO No 8 OZ VIVA DUROPORT BIODEG. 4 | 5,536 | — | 9,871 | 56% | — | -Q237k |
| `77205001` | BANDEJA 2P TERMO FOM BIO 10/50 | 33,196 | — | 37,933 | 88% | — | -Q78k |
| `77205190` | BANDEJA No.2 DUROPORT BIO VIVA 20X25 | 3,863 | — | 2,095 | 16% | — | Q46k |

### Marzo 2025 — run 59
*Training cutoff: 2025-02-28*

| SKU | Producto | App predijo | Humanos compraron | Se vendió | Acierto App | Acierto Humanos | Uplift GTQ |
|---|---|---:|---:|---:|---:|---:|---:|
| `77201046` | VASO DUROPORT No. 10 REYMA 40-25 | 8,111 | 5,155 | 4,510 | 20% | 86% | Q227k |
| `77205001` | BANDEJA 2P TERMO FOM BIO 10/50 | 43,559 | — | 30,129 | 55% | — | Q222k |
| `77201000` | VASO DUROPORT No. 8 REYMA 40-25 | 10,450 | — | 6,602 | 42% | — | Q180k |
| `77205207` | VASO No 8 OZ VIVA DUROPORT BIODEG. 4 | 9,910 | — | 11,116 | 89% | — | -Q66k |
| `77201006` | CLING FILM 18" x 2000' REYMA | 444 | — | 1,206 | 37% | — | -Q33k |

### Abril 2025 — run 60
*Training cutoff: 2025-03-31*

| SKU | Producto | App predijo | Humanos compraron | Se vendió | Acierto App | Acierto Humanos | Uplift GTQ |
|---|---|---:|---:|---:|---:|---:|---:|
| `77201000` | VASO DUROPORT No. 8 REYMA 40-25 | 9,001 | — | 3,387 | 0% | — | Q262k |
| `77205207` | VASO No 8 OZ VIVA DUROPORT BIODEG. 4 | 12,571 | — | 10,103 | 76% | — | Q135k |
| `77205208` | VASO No 10 OZ VIVA DUROPORT BIODEG.4 | 2,250 | — | 3,355 | 67% | — | -Q66k |
| `77205190` | BANDEJA No.2 DUROPORT BIO VIVA 20X25 | 3,655 | — | 1,936 | 11% | — | Q45k |
| `77201046` | VASO DUROPORT No. 10 REYMA 40-25 | 5,507 | 4,000 | 4,806 | 85% | 83% | Q44k |

### Mayo 2025 — run 61
*Training cutoff: 2025-04-30*

| SKU | Producto | App predijo | Humanos compraron | Se vendió | Acierto App | Acierto Humanos | Uplift GTQ |
|---|---|---:|---:|---:|---:|---:|---:|
| `77205207` | VASO No 8 OZ VIVA DUROPORT BIODEG. 4 | 13,919 | — | 9,678 | 56% | — | Q232k |
| `77205208` | VASO No 10 OZ VIVA DUROPORT BIODEG.4 | 3,590 | — | 2,150 | 33% | — | Q86k |
| `77205001` | BANDEJA 2P TERMO FOM BIO 10/50 | 40,173 | — | 36,375 | 90% | — | Q63k |
| `77201000` | VASO DUROPORT No. 8 REYMA 40-25 | 4,941 | — | 6,047 | 82% | — | -Q52k |
| `77205190` | BANDEJA No.2 DUROPORT BIO VIVA 20X25 | 3,525 | — | 1,851 | 10% | — | Q44k |

---

## Honest lookouts — what will David probably notice

### Top-5 overshoots (App pronosticó mucho más de lo que se vendió)

Admitir honestamente. No esconder.

| Mes | SKU | Producto | Predijo | Vendió | Diferencia |
|---|---|---|---:|---:|---:|
| Febrero | `77201000` | VASO DUROPORT No. 8 REYMA 40-25 | 13,431 | 5,637 | +7,794 |
| Abril | `77201000` | VASO DUROPORT No. 8 REYMA 40-25 | 9,001 | 3,387 | +5,614 |
| Febrero | `77205012` | BANDEJA  No. 9 TERMOFOM C/D 20/2 | 1,270 | 541 | +729 |
| Mayo | `77201030` | PORTACOMIDA 8X8 C/D REYMA 1/200 | 828 | 132 | +696 |
| Mayo | `77205020` | BANDEJA No. 2P NEGRA INDUSTRIAL  | 883 | 255 | +628 |

### Top-5 undershoots (se vendió más de lo que la App pronosticó)

Estos son los casos donde la App DEJÓ DE vender. Útil si Alexis pregunta: "¿y las ventas que se perdieron?"

| Mes | SKU | Producto | Predijo | Vendió | Faltante |
|---|---|---|---:|---:|---:|
| Febrero | `77205001` | BANDEJA 2P TERMO FOM BIO 10/50 | 33,196 | 37,933 | -4,737 |
| Febrero | `77205207` | VASO No 8 OZ VIVA DUROPORT BIODE | 5,536 | 9,871 | -4,335 |
| Febrero | `77205003` | BANDEJA No.1 BIO TERMOFOM  5X50 | 9,963 | 11,559 | -1,596 |
| Marzo | `77205207` | VASO No 8 OZ VIVA DUROPORT BIODE | 9,910 | 11,116 | -1,206 |
| Mayo | `77201000` | VASO DUROPORT No. 8 REYMA 40-25 | 4,941 | 6,047 | -1,106 |

---

## Data gaps Jorge must mention BEFORE David asks

1. **Reyma no está en `product_suppliers`.** Los SKUs de Reyma se identifican por nombre del producto — etiqueta "Reyma (por nombre)". Fix post-demo.
2. **Notas de crédito.** El pipeline de revenue puede estar bruto. Pregunta explícita a David en la reunión.
3. **`Humanos compraron = —`** en muchos SKUs — los compradores no hicieron OC confirmada de ese SKU en ese mes. Realidad, no bug.
4. **`margin_uplift` es un techo teórico** — asume que la demanda pronosticada se habría vendido. En SKUs con acierto bajo, el uplift real habría sido menor.
5. **100 de 715 SKUs modelados** por ciclo. Si David pregunta por un SKU específico y no está, la página muestra "SKU no modelado en este ciclo."
6. **Datos snapshot al 2026-03-03.** Los 4 ciclos demostrados son anteriores a esa fecha — son holdouts legítimos.

---

## Script corto de apertura (40 seg)

> "Mira, tomamos todos los datos de Suplicentro hasta 31 de enero 2025, le pedimos a la App que predijera qué se iba a vender en febrero, marzo, abril y mayo, y ahora comparamos SKU por SKU tres cosas: lo que dijo la App, lo que compraron los Humanos (tus compradores), lo que realmente se vendió. Estos números son para Carvajal y Reyma — que vos me dijiste que son los dos dolores más grandes. Vamos a ir ciclo por ciclo. Empezamos con febrero."

Abrir run 58, dejar que David vea el desfase, pasar a run 59, 60, 61.

---

*Todos los números de esta hoja provienen del Supabase de producción, generados la noche del 2026-04-22. Si el modelo se retrena entre esta generación y el demo, los números pueden variar levemente.*