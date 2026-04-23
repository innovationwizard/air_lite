# Quick Glance — David Demo 2026-04-23 9:30

## Opening (40s)

> Datos hasta 31-ene-2025 → App predijo feb–may → comparamos App vs Humanos vs ventas reales. Solo Carvajal + Reyma. Ciclo por ciclo, empezando febrero.

---

## Headline Numbers

- **Feb (run 58):** 36 SKUs · App 65% · Humanos 75% · Uplift Q469k
- **Mar (run 59):** 36 SKUs · App 70% · Humanos 82% · Uplift Q543k
- **Abr (run 60):** 38 SKUs · App 70% · Humanos 81% · Uplift Q571k
- **May (run 61):** 37 SKUs · App 69% · Humanos 81% · Uplift Q577k

---

## Top 5 SKUs por ciclo (by |uplift| desc)

### Feb — run 58
- `77201000` VASO 8 REYMA → App 13,431 / Vendió 5,637 / **+Q364k** ⚠️ overshoot
- `77201046` VASO 10 REYMA → App 9,543 / Hum 8,124 / Vendió 5,434 / **+Q259k**
- `77205207` VASO 8 BIO VIVA → App 5,536 / Vendió 9,871 / **-Q237k** ⚠️ undershoot
- `77205001` BANDEJA 2P BIO → App 33,196 / Vendió 37,933 / **-Q78k**
- `77205190` BANDEJA 2 BIO VIVA → App 3,863 / Vendió 2,095 / **+Q46k**

### Mar — run 59
- `77201046` VASO 10 REYMA → App 8,111 / Hum 5,155 / Vendió 4,510 / **+Q227k**
- `77205001` BANDEJA 2P BIO → App 43,559 / Vendió 30,129 / **+Q222k**
- `77201000` VASO 8 REYMA → App 10,450 / Vendió 6,602 / **+Q180k**
- `77205207` VASO 8 BIO VIVA → App 9,910 / Vendió 11,116 / **-Q66k**
- `77201006` CLING FILM 18" → App 444 / Vendió 1,206 / **-Q33k**

### Abr — run 60
- `77201000` VASO 8 REYMA → App 9,001 / Vendió 3,387 / **+Q262k** ⚠️ overshoot
- `77205207` VASO 8 BIO VIVA → App 12,571 / Vendió 10,103 / **+Q135k**
- `77205208` VASO 10 BIO VIVA → App 2,250 / Vendió 3,355 / **-Q66k**
- `77205190` BANDEJA 2 BIO VIVA → App 3,655 / Vendió 1,936 / **+Q45k**
- `77201046` VASO 10 REYMA → App 5,507 / Hum 4,000 / Vendió 4,806 / **+Q44k**

### May — run 61
- `77205207` VASO 8 BIO VIVA → App 13,919 / Vendió 9,678 / **+Q232k**
- `77205208` VASO 10 BIO VIVA → App 3,590 / Vendió 2,150 / **+Q86k**
- `77205001` BANDEJA 2P BIO → App 40,173 / Vendió 36,375 / **+Q63k**
- `77201000` VASO 8 REYMA → App 4,941 / Vendió 6,047 / **-Q52k**
- `77205190` BANDEJA 2 BIO VIVA → App 3,525 / Vendió 1,851 / **+Q44k**

---

## Worst Overshoots (admitir)
- Feb `77201000` VASO 8 REYMA → +7,794 unidades de más
- Abr `77201000` VASO 8 REYMA → +5,614 unidades de más
- Feb `77205012` BANDEJA 9 → +729
- May `77201030` PORTACOMIDA 8X8 → +696
- May `77205020` BANDEJA 2P NEGRA → +628

## Worst Undershoots (ventas perdidas)
- Feb `77205001` BANDEJA 2P BIO → -4,737 unidades faltantes
- Feb `77205207` VASO 8 BIO VIVA → -4,335
- Feb `77205003` BANDEJA 1 BIO → -1,596
- Mar `77205207` VASO 8 BIO VIVA → -1,206
- May `77201000` VASO 8 REYMA → -1,106

---

## Caveats — mencionar ANTES de que pregunte

- ⚠️ Reyma no está en `product_suppliers` — identificado por nombre. Fix post-demo.
- ⚠️ Notas de crédito — revenue puede ser bruto. Preguntar a David.
- ⚠️ `Humanos = —` = no hubo OC confirmada. Es realidad, no bug.
- ⚠️ `margin_uplift` = techo teórico (asume demanda se habría vendido).
- ⚠️ ~100 de 715 SKUs modelados por ciclo. Si no aparece → "no modelado."
- ⚠️ Snapshot al 2026-03-03. Los 4 ciclos son holdouts legítimos.
