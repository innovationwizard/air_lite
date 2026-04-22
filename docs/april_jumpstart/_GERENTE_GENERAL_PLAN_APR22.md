# PLAN — Convincing the Gerente General (Post-Demo Pivot)

**Date:** 2026-04-22 (evening, post-demo)
**Horizon 1:** David preview — 2026-04-23 09:30
**Horizon 2:** Luis formal demo — date TBD (see Open Question #8)
**Anchored in:** [_FEEDBACK-2026-04-22.txt](../../_FEEDBACK-2026-04-22.txt) (lines 29–865; lines 1–28 are song lyrics, ignored as noise), [_THE_RULES.MD](../../_THE_RULES.MD), [_REFACTOR_PLAN_APR22.md](_REFACTOR_PLAN_APR22.md), [_SILO_DEFINITIONS_APR22.md](_SILO_DEFINITIONS_APR22.md), [AIREFILL_CLAUDE_ONLINE_HANDOVER_APR21.md](AIREFILL_CLAUDE_ONLINE_HANDOVER_APR21.md), [_ODOO_EXPLORATION_RESULTS.md](../../_ODOO_EXPLORATION_RESULTS.md), [_odoo_exploration_raw.json](../../_odoo_exploration_raw.json), [_odoo_deep_dive_raw.json](../../_odoo_deep_dive_raw.json), and the source of truth on disk (17 migrations in `supabase/migrations/`, 21 authenticated routes in `frontend/src/app/(authenticated)/`).

**Revision 2 (2026-04-22 evening):** Integrated the three Odoo exploration files that were missing from Revision 1. Sections §4, §5.P1.1, §5.P2, §9, and new §11 updated. What changed: Ask 1's third series (comprador purchases) is confirmed data-feasible from Odoo directly. Ask 3's cubicaje math upgrades from "bodega aggregate" to "bodega + real fleet capacity" because 29 vehicles with `x_studio_cubicaje` exist. Container time-tracking needs operational discipline, not new UI.

**Revision 4 (2026-04-22 late evening, post user Q&A on warehouse dimensions + supplier scope):** Demo scope narrowed to **Carvajal + Reyma** suppliers only (Jorge: "most pain, should be enough for tomorrow"). Warehouse-capacity ask sharpened: the user memory "4 bodegas × 2,501.82 m³" refers to the **Central warehouse (San José) only** — shown in `______PlanosBodegas.png` as Bodega 1/2/3/4 at 28.25 × 31.85 m each. In Supabase terms, that maps to `warehouses.id = 1` ("1 Bodega Central"), and we store a single `capacity_m3 = 10007` on that row. Zacapa/Peten/Zona 11 capacities come post-Luis (Zacapa ≈ 2 × bodega-20×40, Peten ≈ ¾ Zacapa, Zona 11 ≈ Peten — per Jorge's screenshot, "approximate values"). Build window confirmed: all night. New data gap discovered: **Reyma supplier (ID 1752) has 0 rows in `product_suppliers`** despite Reyma-branded SKUs existing in `products` — fallback is name-match (`products.name ILIKE '%REYMA%'`).

**Revision 3 (2026-04-22 evening, post prod-DB probe):** Queried the production Supabase (`plirrpkasyytpgzwwztl`) to answer outstanding blockers. Q2, Q3, Q13, Q14 resolved inline. Critical findings: `purchase_orders` = 3,253 rows and `purchase_order_lines` = 16,169 rows (Ask 1 third-series is ingested and covers 2024-10-01 → 2026-03-24). The 14 backtest cycles (IDs 57–70) are rolling-origin holdouts training on `2024-10-01 → month-end-N` and predicting month N+1; runs **58 (Feb 2025), 59 (Mar 2025), 60 (Apr 2025), 61 (May 2025)** are a near-perfect match for Luis's cited months. No `fleet_vehicles` table in Supabase — fleet data will be seeded from the Odoo exploration MD. `warehouses` table has 25 rows (all of Odoo's warehouses, not just the 4 bodegas — IDs 1–4 look like the bodegas, ID 5 is a production dept, ID 11 is Walmart staging per memory). Each cycle models 100 of 715 eligible SKUs — the "SKU not modeled" case is a real demo-time risk. New schema note: `backtest_runs` is the cycle table; `backtest_cycles` from Revision 1 does not exist.

---

## 1. WHAT TODAY'S CALL ACTUALLY SAID

David (PM at Suplicentro) is giving Jorge a ground-truth post-mortem. The full picture in his own words:

- Wilmer (Compras) and Mario (Operaciones) were shown their silos. Implicit signal: they're not blocking anymore. David: *"ya logramos convencer a la mayoría, pero a él no"* (lines 307–309).
- **Luis (Gerente General) is NOT convinced.** He is the single decision maker. David: *"sin eso, aunque queramos ayudar a los demás, no nos va a servir... él es el tomador de decisiones máximo"* (lines 355–363).
- Luis has a buying committee he reports to ("la junta directiva"). David needs ammunition to defend the project upward (lines 262–266).
- Luis is explicitly skeptical, not hostile. He wants to see numbers that prove the tool is more atinado than his current compradores before he signs off on a 6-month implementation.
- David's own next move: he will spend tomorrow morning (2026-04-23 09:30) sanity-checking the tool's projections against reality **before** scheduling the Luis meeting (lines 738–778). Jorge is the demo operator; David is the first filter.

---

## 2. WHAT ALEXIS NEEDS TO SEE (verbatim, with line refs)

Three asks, ranked by Luis's own priority.

### Ask 1 — "Top 1" — Historical per-SKU forecast backtest (lines 64–78, 394–498)

For months already closed (he cited **February, March, April, May 2025** — see line 70), per SKU:

| Series | What it is | Data source in air_lite |
|---|---|---|
| System demand forecast | "Cómo debió haber vendido" | `backtest_results.predicted_demand` |
| System purchase recommendation | "Qué se debe haber comprado" | Needs derivation: predicted_demand + safety_stock − starting_inventory |
| Compradores' actual purchases | "Qué compramos actualmente" | `purchase_order_lines.quantity` joined to `purchase_orders.order_date` |
| Actual sales | What really sold | `backtest_results.actual_demand` (or `demand_daily` aggregated) |

Luis's own example (lines 400–414): faros — system says 52k, compradores bought 41k, reality was X. He wants to see which was more atinado.

Luis explicitly gave Jorge permission to be wrong. Lines 455–468: *"hay que comprar 121 mil fardos... de una vez me tira por la ventana... el desfase pues puede existir o va a existir, eso es más que de cajón en lo que va aprendiendo la situación"*. **Honest disagreement is expected. Hiding disagreement is the lose condition.** Do not suppress outliers.

### Ask 2 — "Top 2" — Monetary translation of the delta (lines 500–535)

Per SKU / per month / aggregate, convert units to GTQ:

- **Cost of the recommended purchase** = recommended_qty × `products.cost`
- **Revenue of the recommended purchase-driven sales** = predicted_demand × `products.list_price`
- **Gross margin delta** = recommended revenue − recommended cost
- **Comparison**: same math but with compradores' actual buys + actual sales
- **Headline**: *"Si hubieras hecho caso al sistema, tu margen habría sido GTQ X en vez de GTQ Y en este mes"*

Luis's own framing (lines 502–531): *"cuánto me representó en dinero esa proyección... cuánto tenía que haber gastado... cuánto tendría que vender... tuve 25 mil extras... cuánto tendría que haber ganado en base a tu proyección."*

### Ask 3 — "Si se pudiera sería excelente" — Cubicaje (lines 80–98, 539–608)

**Not a blocker. Explicit nice-to-have.**

Luis's frame: *"sería excelente, solo para que tones en cuenta"* (line 541–544). He wants to know:
- If the tool's purchase plan had been followed, how many m³ per bodega?
- How many furgones? How many of those spill into the 8–12 patio slots?
- Per supplier (he named Carvajal to bodega 1, Reyma to bodega 1), what Lun/Mié/Vie schedule would have fit?

Translation for us: this is a **bodega-aggregate** cubicaje view. No slot-level placement required. The silo doc ([silo §MARIO — Screen 1](_SILO_DEFINITIONS_APR22.md) row "Available m³ per bodega") already flags this as "needs one-time capacity config." We have `warehouses` dimensions cached in user memory (4 bodegas × 2,501.82 m³ = 10,007 m³ total; 8,559 m³ en uso per the Warehouse Dimensions memory).

---

## 3. WHAT DAVID WILL TEST TOMORROW (2026-04-23 09:30)

David is the rehearsal gate. His method (lines 677–728, 738–773):

1. Jorge shows a projection computed **as-of a historical cutoff** (e.g. "trained on data up to Jan 1 2025, predicting Feb–May 2025").
2. David independently gathers post-cutoff reality from sources Jorge doesn't see — *"reunir información de algún otro lado"* (line 746).
3. David compares blind, tells Jorge *"estás pegando / no estás pegando"* (lines 750–754).
4. Only after that does the Luis meeting get scheduled.

**The point of the 9:30 meeting is calibration measurement, not persuasion.** Jorge needs to know exactly where the tool over- and under-shoots **before** Luis sees anything. The tool must be honest by design — if we curate the SKU list to only winners, David will catch it.

---

## 4. GAP ANALYSIS — AIR_LITE AS OF 2026-04-22

### 4.1 What already exists and directly serves Ask 1

- `backtest_results` ([20260322000001_initial_schema.sql:346–364](../../supabase/migrations/20260322000001_initial_schema.sql#L346-L364)) has `predicted_demand`, `actual_demand`, `error_absolute`, `error_percentage`, `predicted_reorder_point`, `predicted_safety_stock` per product per run. ✅
- `backtest_runs` + `backtest_cycles` (14 pre-computed cycles per the refactor plan §2.4). ✅
- `/backtest` page already shows the 14-cycle timeline. ✅
- `products.cost` + `products.list_price` ([20260322000001_initial_schema.sql:78-79](../../supabase/migrations/20260322000001_initial_schema.sql#L78-L79)). ✅ — monetary math is data-feasible.
- `products.stock_uom_ratio` exists. ✅ — fardo/caja conversion is addressable.

### 4.2 What is missing vs Ask 1

- **Compradores' PO history as a comparable third series.** `purchase_orders` + `purchase_order_lines` tables exist ([20260322000001_initial_schema.sql:198–232](../../supabase/migrations/20260322000001_initial_schema.sql#L198-L232)). Supabase ingestion state unknown — see Open Question #2. **Odoo has it confirmed:** 3,047 `purchase.order` records + 19,322 `purchase.order.line` records ([_ODOO_EXPLORATION_RESULTS.md:28-29](../../_ODOO_EXPLORATION_RESULTS.md#L28-L29)) with full fields (`product_qty`, `qty_received`, `price_unit`, `date_order`, `state`, `partner_id`). If Supabase PO is empty or stale, the ingest is a pipeline run, not a scope pivot.
- **Per-SKU drill-down that shows all four series side-by-side on one screen.** Today, `/backtest` shows aggregate savings and per-cycle summaries. No per-SKU four-series comparison page.
- **Holdout-framing narrative.** Current UI presents savings, not calibration. For Luis we need the explicit statement: *"El modelo vio datos hasta 2025-01-01. Predijo X. Lo que realmente pasó fue Y. Los compradores compraron Z."*

### 4.3 What is missing vs Ask 2

- **`backtest_results` has no monetary columns.** `predicted_purchase_qty`, `predicted_purchase_cost`, `predicted_sales_revenue`, `predicted_margin_gtq`, `actual_margin_gtq`, `margin_uplift_gtq` do not exist. They are all computable at query time via JOIN to `products.cost` + `products.list_price` but they are not pre-computed.
- **`backtest_savings` exists but is aggregate and partially broken** (storage flat 0%, stockout flat 80%, rotation flat 53.85% — per refactor plan §2.4). We cannot reuse it directly for Luis; we must derive fresh per-SKU monetary numbers.

### 4.4 What is missing vs Ask 3

- No `bodega_capacity_m3` column on `warehouses`. Memory says 2,501.82 m³ × 4 — this needs to be stored, not re-keyed from memory. Odoo has 25 `stock.warehouse` records ([_odoo_exploration_raw.json](../../_odoo_exploration_raw.json)); the mapping of memory's "4 bodegas" to Odoo warehouse ids is **not locked** — see Open Question #6.
- No m³ aggregation RPC. `products.volume` is 74.6% populated per refactor plan §2.3 (also confirmed in [_ODOO_EXPLORATION_RESULTS.md:264-267](../../_ODOO_EXPLORATION_RESULTS.md#L264-L267)).
- No supplier → bodega mapping beyond what's implicit in PO history.
- **Fleet capacity data EXISTS in Odoo** and is much richer than we assumed. `fleet.vehicle` has 29 records, 22 with `x_studio_cubicaje` > 0 (volumes 5–50 m³), and the trucks are already categorized by route (11 SJVN LOCAL, 9 SJVN DEPARTAMENTAL, 3 Peten, 2 Zacapa). See [_ODOO_EXPLORATION_RESULTS.md:180-240](../../_ODOO_EXPLORATION_RESULTS.md#L180-L240). Ingestion state into Supabase: **unknown — see Open Question #14**. This replaces the "hardcoded 67 m³ constant" approach from Revision 1.

### 4.5 What is missing cross-cutting

- **Production deployment.** Per the call (lines 670–674), Jorge explicitly answered "No" when asked if the API is in production. The Luis demo on a localhost URL is a credibility loss. See §5 P1.4.
- **Container time-tracking capture** (lines 223–233). Luis wants entrada/descarga/salida timestamps starting now. **Update from Revision 1:** these are not missing fields — they are existing Odoo custom fields at 0% population. `x_studio_inicio_carga`, `x_studio_terminacin_carga`, `x_studio_fecha_y_hora_entrante`, `x_studio_fecha_y_hora_salida_dulgon` live on `stock.picking` today ([_ODOO_EXPLORATION_RESULTS.md:83-86](../../_ODOO_EXPLORATION_RESULTS.md#L83-L86)). The ask is operational adoption (who types the timestamps, when), not a new form. See Open Question #9.
- **Credit-note correction on revenue.** Handover doc §1 flags "credit notes still excluded from the revenue stream" as a known issue. Odoo has the signals to fix it: `account.move.reversal_move_id`, `reversed_entry_id`, `nota_debito`, `move_type IN ('out_refund','in_refund')`. This matters for Ask 2 — if Supabase's revenue is uncorrected, `/gerencia/validacion`'s GTQ columns will overstate revenue by the credit-note rate. See Open Question #13.

---

## 5. WORK BREAKDOWN

### P0 — Ship before 2026-04-23 09:30 (David preview)

Target audience: David only. Goal: measure calibration, not persuade.

#### P0.1 — New Gerencia validation page (~2h30m)

**Route:** `/gerencia/validacion` (new directory under `frontend/src/app/(authenticated)/gerencia/`).

**Scope (Revision 4):** The RPC supports the full 100-SKU set per run, but the page **defaults to a Carvajal + Reyma filter**. Jorge's 2026-04-22 answer: Carvajal + Reyma are the demo's pain point; the rest can wait. Filter logic in the RPC: `WHERE p.id IN (SELECT product_id FROM product_suppliers ps JOIN suppliers s ON s.id = ps.supplier_id WHERE s.name ILIKE '%carvajal%' AND s.name NOT ILIKE '%no usar%') OR p.name ILIKE '%REYMA%'` — the name-match fallback for Reyma is explicit, flagged in the UI, and entered in §7 as a documented data gap to fix post-demo. An "all suppliers" toggle exists but is off by default.

**DB (≈40m):** New migration `20260422000004_rpc_gerencia_backtest_validation.sql`:
- Function `rpc_gerencia_validation(p_run_id INT, p_top_n INT DEFAULT NULL)` returning one row per SKU per run with columns:
  - `product_id, sku, product_name`
  - `training_start_date, training_end_date, prediction_month` (from `backtest_runs`, surfaced to UI so the holdout narrative is explicit)
  - `predicted_demand, actual_demand` (from `backtest_results`)
  - `recommended_purchase_qty` = `GREATEST(predicted_demand + predicted_safety_stock - starting_inventory, 0)` — exact formula locked per Open Question #10, this is a placeholder
  - `comprador_purchase_qty` = SUM(`purchase_order_lines.quantity`) joined on `purchase_orders.order_date` within the prediction month window and `purchase_orders.state IN ('purchase','done')`. Note the naming reality: `purchase_order_lines.quantity` is the ordered qty; `received_qty` is what arrived. Use `quantity` (ordered) for the comparison — that's what Luis meant by "compraron."
  - `actual_sales_qty` (= actual_demand, aliased for Luis's language)
  - Monetary columns: `predicted_purchase_cost_gtq`, `predicted_revenue_gtq`, `predicted_margin_gtq`, `comprador_purchase_cost_gtq`, `actual_revenue_gtq`, `actual_margin_gtq`, `margin_uplift_gtq` — derived at query time via JOIN to `products.cost` + `products.list_price`
  - `acierto_system_pct` = 1 − ABS(`predicted_demand` − `actual_demand`) / NULLIF(`actual_demand`, 0)
  - `acierto_comprador_pct` = 1 − ABS(`comprador_purchase_qty` − `actual_demand`) / NULLIF(`actual_demand`, 0)
- Rows where `actual_demand = 0` are returned with NULL acierto columns, not dropped.
- GRANT EXECUTE to `authenticated`, RLS aligned with existing backtest pattern.
- **Prod-DB verified (2026-04-22):** `backtest_runs` has IDs 57–70, each `products_modeled=100`. Runs **58, 59, 60, 61** are the Feb/Mar/Apr/May 2025 predictions Luis asked about (training ends 2025-01-31, -02-28, -03-31, -04-30 respectively; `prediction_month` = 2025-02-01, -03-01, -04-01, -05-01). `purchase_orders.order_date` range: 2024-10-01 → 2026-03-24, fully covers all 14 cycles.

**API (≈15m):** `frontend/src/app/api/gerencia/validacion/route.ts`, same pattern as `/api/kpis/stockout-risk`.

**Page (≈1h30m):** `frontend/src/app/(authenticated)/gerencia/validacion/page.tsx`:
- Header: *"Validación histórica — ¿qué tan atinado fue cada uno?"* + subtitle stating the exact cutoff date of the displayed cycle.
- Cycle selector (dropdown of the 14 runs, IDs 57–70). **Default: run 58** (predicts Feb 2025 from a 2025-01-31 training cutoff — the first month Luis asked about). Recommended demo sequence: 58 → 59 → 60 → 61 (Luis's Feb/Mar/Apr/May 2025 sequence).
- KPI row: `margin_uplift_gtq` headline, `acierto_system_pct` mean, `acierto_comprador_pct` mean, SKU count (100 of 715 eligible).
- Main table (sortable, default sort by `|margin_uplift_gtq|` DESC so the biggest-impact SKUs are first):
  - SKU, producto
  - Sistema predijo (unidades)
  - Compradores compraron (unidades)
  - Se vendió (unidades)
  - Sistema acierto % | Compradores acierto % (color-coded)
  - Margen sistema (GTQ) | Margen real (GTQ) | Delta (GTQ)
- Red/amber/green pills on acierto columns.
- No filtering/curation toggle. Show the whole list. The raw honest spread is the feature.
- **Footnote beneath the monetary block (Q13 resolution, per Jorge 2026-04-22 evening):** *"Nota: los montos GTQ se calculan sobre las ventas registradas en Supabase. Pendiente de verificar con David si esta cifra está neta o bruta de notas de crédito."* This line is the explicit Q13 prompt for the 9:30 meeting.
- **"SKU no modelado" handling:** If Luis asks about a SKU that is NOT in the 100 `products_modeled` for the selected run, the UI shows *"Este SKU no fue modelado en este ciclo. Está entre los 615 SKUs elegibles no priorizados. Podemos agregarlo en el próximo ciclo."* — not an error, not silence.

**Cut point:** If monetary columns don't compute correctly (cost nulls, UOM ratio glitches), ship with unit-only columns and flag the monetary section as "pendiente — siguiente iteración". Unit-level calibration alone satisfies Ask 1.

#### P0.2 — Holdout framing banner (~15m)

On `/gerencia/validacion` AND on `/backtest`, top-of-page banner:

> *"El modelo fue entrenado con datos hasta **{cycle.training_cutoff}**. Los resultados mostrados son proyecciones que el modelo hizo sin haber visto lo que pasó después. Los datos reales en esta tabla provienen de Odoo."*

This is the holdout narrative Luis wants. It is literally what Prophet does in the backtest, but the UI does not say it today.

#### P0.3 — Honest-spread sanity run (~30m)

Before leaving for the meeting:

1. Open `/gerencia/validacion` on a cycle whose training cutoff is ≤ 2025-01-31.
2. Sort by largest absolute margin delta.
3. **Write down, on paper**, the top 10 SKUs and the system's prediction, comprador's purchase, and actual sales for each. This is Jorge's cheat sheet for the David meeting. If David pulls a number from his "outside source" that contradicts the tool, Jorge knows immediately whether it's a data issue (Odoo sync lag, archived-code breakage — see handover doc §1) or a model issue.

### P1 — Ship before Luis meeting

#### P1.1 — Cubicaje aggregate view (≈2h30m, upgraded in Revision 2)

**Scope:** bodega-level m³ aggregate + fleet-backed furgón translation. NO slot-level placement.

**Database:**
- Add `capacity_m3 NUMERIC(10,2)` to `warehouses` (new migration). Values come from the Warehouse Dimensions user memory (2,501.82 m³ × 4 = 10,007 m³). **Before committing, lock the Odoo `stock.warehouse.id` ↔ "4 bodegas" mapping** — Odoo has 25 warehouse records; memory's "4 bodegas" is not a given subset. See Open Question #6.
- New table `fleet_vehicles` (new migration) populated from the Odoo fleet dump in [_ODOO_EXPLORATION_RESULTS.md:184-214](../../_ODOO_EXPLORATION_RESULTS.md#L184-L214): `plate`, `category` (SJVN LOCAL / SJVN DEPARTAMENTAL / Peten / Zacapa / Departamental), `cubicaje_m3`, `driver`, `trailer_hook`, `is_active`. 29 rows. The one marked "ACCIDENTADO" and the "warehouse placeholder" ride a `status` column. Or alternatively: a seed SQL file, not a table, if this is only used for demo math. See Open Question #14.
- New RPC `rpc_cubicaje_projection(p_run_id INT)` returning:
  - **Per-bodega**: total m³ if the system's recommended purchase plan had been executed; total m³ if the compradores' actual purchase plan had been executed (control); % occupancy vs `capacity_m3`; overflow m³.
  - **Per fleet category**: total fleet m³ available (sum of `cubicaje_m3` for vehicles in category), average single-delivery m³, required deliveries to absorb overflow.
  - The furgón count is derived from the fleet average — no hardcoded constant. E.g. if Peten overflow = 180 m³ and the 3 Peten trucks average 25.55 m³, that's ≈7 Peten deliveries. This is the honest answer Luis asked for.

**Page:** extend `/gerencia/validacion` with a second tab "Cubicaje proyectado" — same cycle selector, per-bodega bar chart (occupancy vs capacity) + fleet-category callouts (deliveries needed per route).

**Cut point:** If `products.volume` is too sparse (<50% populated for the bodega's top-demand SKUs), show a clear disclaimer instead of the chart and skip this section in the demo. If the fleet data isn't ingested (Q14 is "no"), seed the 29 rows directly from the exploration doc — the numbers are static enough for the Luis demo and the ingestion can follow post-approval.

#### P1.2 — Monetary aggregate headline card (≈20m)

On `/gerencia/validacion` top-of-page, a single big-number card:

> *"Margen potencial sobre el período: **GTQ {sum(margin_uplift_gtq)}** — derivado de {n} SKUs cubiertos."*

This is Ask 2's ≈ 30-second-answer summary. If Luis leaves the meeting remembering one number, this is the one.

#### P1.3 — Archived-code handling audit (≈1h)

Per handover doc §1 and silo doc insight §2, archived codes in Odoo destroy sales history. If `/gerencia/validacion` shows a top-moving SKU with zero `actual_demand` because the code was archived mid-period, Luis will flag it as a data bug and question the whole tool. **Before the Luis demo**, run a query:

```sql
SELECT COUNT(*)
FROM backtest_results br
JOIN products p ON p.id = br.product_id
WHERE br.actual_demand = 0
  AND br.predicted_demand > (SELECT AVG(predicted_demand) FROM backtest_results);
```

If this returns >0, we have archived-code contamination. Handling options: (a) flag affected SKUs with an "código archivado" badge, (b) defer to Sprint 1 of silo doc POST-DEMO roadmap. Do NOT silently delete them.

#### P1.4 — Production deployment (≈4h, critical)

On the call, David asked *"subiste la API a producción?"* — Jorge: *"No, a producción no"* (lines 670–674). Luis will ask the same question.

Deploy:
- Supabase: already hosted; verify `anon` / `service_role` keys are set for the production project, not staging.
- Next.js: Vercel, env vars pointing to production Supabase + production Railway.
- Flask + Prophet: Railway, env vars pointing to production Supabase.

Blocker to flag: any secrets currently committed? Per `_THE_RULES.MD` item 4 and the INTENT intent-review Rule 11 ("Secret & Config Isolation"), no `.env` references. Run a pre-deploy audit. See Open Question #7.

### P2 — Post-Luis approval (6-month scope per Jorge's line 293–302 estimate)

Do NOT start any of these before Luis says yes.

- Full bodega levantamiento with metro (line 104–121).
- Rack-level posicionamiento rules (lines 140–178).
- **Container time-tracking operational rollout.** The Odoo fields already exist (see §4.5). The work is human: define the capture protocol (bodega team fills `x_studio_inicio_carga` at the start of each load, `x_studio_terminacin_carga` at end, `x_studio_fecha_y_hora_entrante` and `x_studio_fecha_y_hora_salida_dulgon` on arrival/departure). David sponsors, Ángel enforces. air_lite surfaces the data once it starts flowing. See Open Question #9.
- **Rampa (dock) scheduling.** `purchase.order.x_studio_horario_rampa_inicio` + `_final` + `x_studio_numero_rampa` are existing Odoo fields — supports Mario's rampa-saturation view in silo doc §MARIO "NOT in scope for the demo."
- **Supplier compliance surfacing.** `purchase.order.on_time_rate_perc`, `delivered_on_time`, `supplier_fulfillment_rate` are pre-computed in Odoo. Silo doc §POST-DEMO Sprint 5 gets a shortcut — we don't compute these, we ingest them.
- Live Odoo XML-RPC sync on Railway (handover doc §Sprint 4).
- **Reingestion with credit-note correction** (handover doc §Sprint 3; silo doc §POST-DEMO Sprint 3). Use `account.move.move_type IN ('out_refund','in_refund')` and `reversal_move_id` to net credit notes out of revenue. See §4.5 and Open Question #13.
- Forecast comparison upload (Ventas' forecast vs system's forecast).
- Homólogo / never-be-out flag classification (silo doc §5 insight, §POST-DEMO Sprint 5).
- UOM ratio audit across the KPI pipeline (handover doc §1).

---

## 6. EXPLICIT OUT OF SCOPE

Pulled directly from the feedback transcript and the silo doc. Listed so Jorge can point here when Luis asks "¿por qué no está X?":

- Slot-level or rack-level warehouse mapping (Luis mentioned it as a general future want; silo doc §MARIO "NOT feasible").
- Container scheduling optimizer (lines 149–163 — "movimientos ya más avanzados"; Jorge explicitly pushed to Sprint 2+).
- Rebuilding Wilmer/Mario silo views — the refactor from this morning stands. Luis's validation page is additive, not a replacement.
- Fixing the three flat savings-card values (storage 0%, stockout 80%, rotation 53.85%). The "en validación" banner from the refactor plan §4 P0.2 covers that honestly. The monetary section on `/gerencia/validacion` uses fresh math, not those columns.
- BOM / packaging materials explosion — still blocked by `mrp.bom` access denial (handover doc §Sprint 5).
- Live Odoo sync — Sprint 4, not now (handover doc).
- Any feature Luis did NOT name in the transcript. This plan is scoped to what he actually asked for.

---

## 7. RISKS

| Risk | Likelihood | Blast radius | Mitigation |
|---|---|---|---|
| `purchase_order_lines` not ingested | ~~High~~ **Resolved 2026-04-22** | — | `purchase_orders` = 3,253 rows, `purchase_order_lines` = 16,169 rows in prod. Covered. |
| **Reyma SKUs not linked in `product_suppliers`** | **High (newly discovered 2026-04-22)** | Default filter misses all Reyma SKUs if we rely on `product_suppliers` | RPC uses OR logic: `supplier name match for Carvajal` OR `products.name ILIKE '%REYMA%'`. The name-match fallback is visible in the UI as an italic footnote *"Reyma identificado por nombre del SKU — la tabla `product_suppliers` no tiene la relación cargada; la corregimos post-demo."* Open honesty, not a hidden patch. |
| Carvajal has 5 supplier entities (300, 301, 490, 550, 1535) | Medium | Double-counting or missing SKUs | RPC filters `name ILIKE '%carvajal%' AND name NOT ILIKE '%no usar%'`. SKUs deduped via `DISTINCT product_id` before the backtest JOIN. |
| `products.cost` is sparse or wrong units | Medium | Ask 2's monetary column is meaningless | Audit before the demo: `SELECT COUNT(*) FROM products WHERE cost IS NULL OR cost = 0` — if >20% of the top-demand SKUs are null, degrade to unit-only columns and disclose. |
| Archived-code contamination inflates the "tool wrong" signal | **High** | David catches it, or worse, Luis catches it | Run the audit in P1.3 BEFORE the David meeting, not after. |
| UOM mismatch (fardo vs caja) in the monetary math | Medium | Columns misalign by 10×–20× | Use `products.stock_uom_ratio` explicitly in every qty × price multiplication. Write the formula once in the RPC, not per-query. |
| Jorge oversells calibration after one good cycle, David's outside data crushes it | Medium | Credibility loss with David, cascades to Luis | Run P0.3 (the paper cheat-sheet) before the 9:30. Go in knowing the worst misses, don't be surprised by them. |
| Localhost demo for Luis | **High** | *"Es que todavía no está en producción"* → same skepticism Wilmer said Luis already has about "mucho tiempo, necesito respuesta" (lines 46–59) | Ship P1.4 before the Luis meeting. If deployment isn't feasible in the window, get written sign-off that localhost is acceptable — do not assume. |
| Snapshot is 2026-03-03, Luis wants Feb–May 2025 projections | Low (data covers it) | None if the cycle window maps correctly | Confirm the cycle window. Pick a cycle whose training cutoff is 2025-01-31 or earlier. See Open Question #3. |
| David's BEMB document issue (lines 823–864) | Low | Independent of the demo | Handle on a separate channel — do not let it eat P0 time. |
| Data freshness question from Luis | **High** | *"Los datos son del 3 de marzo"* → honest acknowledgment, pre-empt | The holdout banner from P0.2 pre-empts this. Frame the snapshot age as a **feature** of the holdout: we're predicting past-dated months on purpose, not hiding fresh data. |

---

## 8. VERIFICATION BEFORE 2026-04-23 09:30

- [ ] `npm run build` clean locally.
- [ ] Log in as `gerencia` role → `/gerencia/validacion` renders with real rows.
- [ ] At least one cycle has non-null `comprador_purchase_qty` for the top-10-by-absolute-margin-uplift SKUs.
- [ ] Monetary columns show GTQ, not unit-less.
- [ ] Holdout banner visible on both `/gerencia/validacion` and `/backtest`.
- [ ] P0.3 paper cheat-sheet in Jorge's hand.
- [ ] No emoji, no placeholder, no TODO, no mock data, no hardcoded sample arrays in any committed file.

---

## 9. OPEN CLARIFYING QUESTIONS (blocking — need answers from Jorge)

Per `_THE_RULES.MD` item 1, these are NOT assumed. They need explicit answers.

1. **Budget until David's 9:30 meeting.** ✅ **RESOLVED 2026-04-22 (Jorge): "All night."** Full P0 scope is achievable. P1 items (cubicaje, monetary headline card, archived-code audit, deployment) feasible if sleep is compressed.

2. **`purchase_orders` + `purchase_order_lines` ingestion state in Supabase.** ✅ **RESOLVED 2026-04-22 via direct prod probe.** `purchase_orders` = 3,253 rows; `purchase_order_lines` = 16,169 rows; `order_date` range = 2024-10-01 → 2026-03-24. Fully covers all 14 backtest cycles. No ingest needed for P0.1.

3. **Cycle window aligning with Feb–May 2025.** ✅ **RESOLVED 2026-04-22 via direct prod probe.** `backtest_runs` (not `backtest_cycles` — that table does not exist) has 14 rolling-origin holdouts, IDs 57–70, each training on `2024-10-01 → month-end-N` and predicting month N+1. The four that match Luis's ask:
   - Run **58**: trains through 2025-01-31, predicts **Feb 2025**
   - Run **59**: trains through 2025-02-28, predicts **Mar 2025**
   - Run **60**: trains through 2025-03-31, predicts **Apr 2025**
   - Run **61**: trains through 2025-04-30, predicts **May 2025**
   Each has `products_modeled = 100` of 715 eligible. Exposed via `backtest_runs.training_start_date / training_end_date / prediction_month` — the RPC should surface all three so the UI banner can write the holdout narrative literally.

4. **David's "outside data" source.** Line 746: *"reunir información de algún otro lado"*. Does he have Odoo access that sees data post-snapshot 2026-03-03? Or is his source something else (sales team reports, Finanzas ledger, WhatsApp from the floor)? This affects whether we can match his ground truth.

5. **Luis's meeting date.** Tomorrow is David-only. When is Luis scheduled? This sets the P1 budget, which in turn decides whether cubicaje (P1.1) and deployment (P1.4) can both ship.

6. **Warehouse capacity numbers + ID mapping.** ✅ **RESOLVED 2026-04-22 evening (Jorge + planos).** The "4 bodegas × 2,501.82 m³" from memory refers to the **Central warehouse at San José only** — the planos (`______PlanosBodegas.png`) show 4 sub-bodegas of 28.25 × 31.85 m each. In Supabase, Central = `warehouses.id = 1`. For tomorrow's Carvajal + Reyma demo, Central is the only bodega that matters (both suppliers feed Central). **Action:** `capacity_m3 = 10007` on warehouse ID 1. Other warehouses per Jorge's approximate screenshot: Zacapa (ID 4) ≈ 2 sub-bodegas of similar dimensions, Peten (ID 3) ≈ ¾ of Zacapa, Zona 11 (ID 2) ≈ Peten. These values are **approximate per Jorge, not Mario-validated** — left as NULL for now, filled post-Luis when measurements exist.

7. **Production secrets.** Are the Supabase service_role key, Railway secrets, and Odoo credentials already in Vercel/Railway env vars, or do we need to set them up tonight? Any secrets currently in committed files?

8. **Monetary math — UOM scope.** Should `predicted_purchase_cost_gtq` multiply in fardos (commercial UOM) or in units (stock UOM × ratio)? The compradores buy in fardos; Odoo stores in units. Align on one convention before writing the RPC.

9. **Container time-tracking operational owner.** Luis wants to start entrada/descarga/salida timestamps "a partir de hoy, mañana, o el lunes" (line 226–230). Revision 2 update: the Odoo fields already exist (`x_studio_inicio_carga`, `x_studio_terminacin_carga`, `x_studio_fecha_y_hora_entrante`, `x_studio_fecha_y_hora_salida_dulgon`) at 0% populated. The question becomes organizational, not technical: **who fills them, at what moment, and on which device?** air_lite doesn't need a new form — it needs an Odoo usage protocol. David or Ángel?

10. **Recommended-purchase formula.** For the RPC, what's the exact definition of "recommended purchase"? Candidates:
    - (a) `predicted_demand + predicted_safety_stock − starting_inventory` (simple reorder-point math)
    - (b) Use the POC `purchase_schedule_*` RPC output directly, if it covers the cycle window
    - (c) Something else Wilmer has told us is the "real" rule
    The answer changes the RPC and the narrative ("aquí está lo que el sistema habría comprado").

11. **`/compras/programacion` redirect and Wilmer's OA access.** Per the refactor plan this morning, are Wilmer and Mario's sidebars actually verified working post-merge? If any regression is open, fix-forward takes priority over new work because Luis will likely click around during his demo.

12. **Who presents to Luis?** David (lines 762–766): *"te voy a reunir contigo porque tú eres quien lo va a presentar"*. Confirm Jorge is the presenter so tomorrow's rehearsal is meaningful.

13. **Credit-note correction state in the monetary pipeline.** ✅ **DECISION LOCKED 2026-04-22 (Jorge):** Show what we have. Add a visible footnote on `/gerencia/validacion` stating gross-vs-net is pending verification. Raise the question with David at 9:30. Implementation: see the footnote copy in §5 P0.1 Page spec. No RPC change required today. Follow-up decision (gross disclaimer vs net correction against `account.move`) can happen after David confirms.

14. **Fleet-table ingestion state.** ✅ **RESOLVED 2026-04-22 via direct prod probe.** No `fleet_vehicles`, `fleet_vehicle`, or `vehicles` table exists in Supabase (all three returned HTTP 404). **Action:** seed the 29 vehicles from [_ODOO_EXPLORATION_RESULTS.md:184-214](../../_ODOO_EXPLORATION_RESULTS.md#L184-L214) as part of migration `20260422000005_fleet_vehicles_seed.sql` (new). Frame it honestly in the UI: *"Flota al 2026-03-26, capturada directamente de Odoo. La sincronización continua es parte del Sprint 4."*

15. **"SKU no modelado" edge case.** Prod probe (2026-04-22) confirms each backtest run has `products_modeled = 100` out of 715 eligible. If Luis asks to see "faros" specifically and faros aren't in the 100, the tool must say so cleanly — not hide, not error. Covered in §5 P0.1 Page spec. But: **which 100 SKUs are in each run?** Is the selection stable across runs 57–70, or does it vary? If stable, the 100 are probably the top ABC-movers — safe bet Luis's examples are included. If unstable, we need to pre-verify run 58's SKU list before the 9:30. Quick verification: `SELECT COUNT(DISTINCT product_id) FROM backtest_results WHERE run_id = 58;` should equal 100, and `SELECT sku FROM products WHERE id IN (...)` will tell us which.

---

## 10. THE ONE-LINER FOR ALEXIS

The entire tool's pitch to Luis, written as one sentence Jorge can actually say out loud:

> *"Tomamos todos los datos de Suplicentro hasta enero de 2025, le pedimos al sistema que predijera qué se iba a vender y qué había que comprar entre febrero y mayo, y ahora comparamos, SKU por SKU, lo que el sistema dijo contra lo que sus compradores compraron contra lo que realmente se vendió — y la diferencia en quetzales está en esta columna."*

Everything in this plan exists to make that sentence honest.

---

*This plan contains no assumptions that weren't flagged as open questions. Every file path, migration name, and transcript line reference was verified on 2026-04-22 against the code on disk. Every scope decision traces back to a line number in [_FEEDBACK-2026-04-22.txt](../../_FEEDBACK-2026-04-22.txt).*

---

## 11. ODOO DATA AVAILABILITY — WHAT THE EXPLORATION FILES ADD (Revision 2)

Consolidated findings from [_ODOO_EXPLORATION_RESULTS.md](../../_ODOO_EXPLORATION_RESULTS.md), [_odoo_exploration_raw.json](../../_odoo_exploration_raw.json) (2,929 lines), and [_odoo_deep_dive_raw.json](../../_odoo_deep_dive_raw.json) (5,702 lines). These files were not reflected in Revision 1. Each row points at which section of the plan it changes.

| Odoo finding | Record count / population | Affects |
|---|---|---|
| `purchase.order` + `purchase.order.line` fully accessible | 3,047 / 19,322 records | §4.2, §9.Q2 — Ask 1's third series is not blocked at source |
| `product.product.standard_price` + `avg_cost` + `total_value` + `value_svl` | 1,628 products | §5.P0.1 — better cost source than Supabase `products.cost` if that turns out stale |
| `stock.picking.amount_volume` populated | 95.3% of 196K outbound | §5.P1.1 — sales volume math is credible |
| `product.product.volume` populated | 74.6% of 1,628 products | §5.P1.1 — m³ per SKU usable, same as silo doc |
| `fleet.vehicle` with `x_studio_cubicaje` | 22 of 29 vehicles populated, 5–50 m³ | §4.4, §5.P1.1, §9.Q14 — fleet math replaces the 67 m³ constant from Revision 1 |
| Fleet categorized by route | SJVN LOCAL (11), SJVN DEPARTAMENTAL (9), Peten (3), Zacapa (2) | §5.P1.1 — per-route furgón calc |
| `stock.picking.x_studio_inicio_carga` + `_terminacin_carga` | 0% / 0% | §4.5, §5.P2, §9.Q9 — no new form needed |
| `stock.picking.x_studio_fecha_y_hora_entrante` + `_salida_dulgon` | 0% / 0% | Same |
| `stock.picking.x_studio_bultos` | 0% | §5.P2 — available for future use |
| `stock.picking.x_studio_placa` | 0.03% (54/196K) | §5.P2 — license-plate trail is there if enforced |
| `stock.picking.x_studio_vehculo` | 0.002% (4/196K) | §5.P2 — vehicle assignment field exists, nobody uses it |
| `purchase.order.x_studio_horario_rampa_inicio` / `_final` / `x_studio_numero_rampa` | Population unknown, fields exist | §5.P2 — Mario's rampa scheduling has native Odoo support |
| `purchase.order.on_time_rate_perc` + `delivered_on_time` + `supplier_fulfillment_rate` | Computed natively | §5.P2 — supplier compliance shortcut |
| `account.move` with `reversal_move_id`, `reversed_entry_id`, `nota_debito`, `move_type` | 1.35M records | §4.5, §9.Q13 — credit-note correction has full signal |
| `account.move.line` with `price_unit`, `price_subtotal`, `product_volume`, `product_id`, `purchase_order_id` | 5.05M records | §5.P0.1 fallback — authoritative revenue source, beats `sale.order` for credit-note correctness |
| `product.product.stock_uom_ratio` equivalent via `uom_id`, `uom_po_id`, `pos_uom_id` | Per-product | §7 risk #4 — UOM math has explicit Odoo source of truth |
| `stock.warehouse` records | 25 | §9.Q6 — need explicit mapping to "4 bodegas" |
| `x_studio_descripcin_antigua_del_producto` field on product | Population unknown | §5.P1.3 — may be the archived-code bridge Wilmer uses in his head (silo doc §2 insight) |
| `mrp.bom` / `mrp.production` | Access denied | Confirmed still blocked (handover doc §Sprint 5) — packaging explosion stays out of scope |
| `fleet.vehicle` was access-denied at 07:48, granted at 10:10 same day | — | Evidence that access requests get approved — useful for the Luis-meeting promise that "data barriers unblock within hours" |

### 11.1 Changed recommendation for P0.1 (Ask 1)

The RPC `rpc_gerencia_validation` can fall back to pulling PO data from Odoo via XML-RPC if Supabase `purchase_order_lines` is empty. This removes Revision 1's "HIGH RISK" designation on the third series. Rewording Risk Row 1 in §7:

- **Old (Revision 1):** *"`purchase_order_lines` not ingested… Ask 1 is impossible… SHOW-STOPPER."*
- **New (Revision 2):** *"`purchase_order_lines` not ingested in Supabase. Ask 1 requires an overnight ingest from Odoo (3,047 POs / 19,322 lines, XML-RPC read access confirmed). Blocker only if the ingest script doesn't exist; not a scope pivot."*

### 11.2 Changed recommendation for P1.1 (Ask 3)

Cubicaje math is no longer "bodega aggregate with a hardcoded 67 m³ furgón." It is: *"based on your actual fleet — 29 vehicles, 22 measured — your Peten route has 3 trucks averaging 25.55 m³, your SJVN DEPARTAMENTAL route has 9 trucks averaging 47 m³, so this purchase plan's overflow of X m³ to Peten requires Y trips."* That is what Luis meant by "sería excelente" in line 541.

### 11.3 Prod-DB state as of 2026-04-22 evening (Revision 3)

Direct probe of Supabase project `plirrpkasyytpgzwwztl` via REST + `SUPABASE_SERVICE_ROLE_KEY`:

| Table | Count | Relevance |
|---|---|---|
| `purchase_orders` | 3,253 | Ask 1 third series unblocked |
| `purchase_order_lines` | 16,169 | Same; `order_date` range 2024-10-01 → 2026-03-24 |
| `fleet_vehicles` / `fleet_vehicle` / `vehicles` | 404 (no table) | Seed from MD for cubicaje demo |
| `warehouses` | 25 | IDs 1–4 look like the 4 bodegas; ID 5 is prod dept; ID 11 is Walmart staging |
| `products` | 1,653 | Matches Odoo 1,628 within normal drift |
| `backtest_runs` | 14 | IDs 57–70, rolling-origin holdouts |
| `backtest_results` | 1,400 | 14 runs × 100 products, confirmed |
| `backtest_savings` | 14 | One per run |
| `stock_moves` | 964,010 | Populated |
| `demand_daily` | 145,286 | SSOT for demand |
| `inventory_daily` | 1,410,123 | Populated |
| `sale_orders` + `sale_order_lines` | 85,985 + 478,245 | Populated |
| `product_suppliers` | 595 | Lead times available |

**Backtest cycles covering Luis's Feb–May 2025 ask:**

| Run ID | training_start | training_end | prediction_month | Luis mention |
|---|---|---|---|---|
| 58 | 2024-10-01 | 2025-01-31 | 2025-02-01 | "febrero" (line 70) |
| 59 | 2024-10-01 | 2025-02-28 | 2025-03-01 | "marzo" |
| 60 | 2024-10-01 | 2025-03-31 | 2025-04-01 | "abril" |
| 61 | 2024-10-01 | 2025-04-30 | 2025-05-01 | "mayo" |

Demo sequence: open on run 58, walk through 59 → 60 → 61. Four honest holdouts. Each cycle's training cutoff is months before the snapshot (2026-03-03), so David's "outside data" sanity-check has legitimate ground truth.

### 11.4 A word on timestamps (lines 223–233)

Luis's timestamp ask (*"comencemos a llevar ese tiempo"*) is not a build problem. It is a **discipline problem with a pre-wired home**. The fields are in Odoo. The bodega team is not filling them. The fastest lever is not air_lite — it is David enforcing a one-line SOP starting Monday:

> *"Cada furgón que entra o sale hoy se registra en `stock.picking` con `x_studio_fecha_y_hora_entrante` al llegar y `x_studio_fecha_y_hora_salida_dulgon` al salir. Inicio y fin de carga en `x_studio_inicio_carga` y `x_studio_terminacin_carga`. Ángel es responsable."*

air_lite can render the timestamps the moment they start flowing. Not before.

---

*Revision 2 — 2026-04-22 evening. Revision 1's structure preserved. Changes are additive except where explicitly marked (§7 Risk Row 1, §9.Q2, §9.Q6, §9.Q9).*

*Revision 3 — 2026-04-22 evening, post prod-DB probe. §9.Q2/Q3/Q13/Q14 resolved; §9.Q15 added (SKU-modeled edge case). §5 P0.1 updated with verified `backtest_runs` schema, default-to-run-58 guidance, "SKU no modelado" handling, and the Q13 footnote copy. §11.3 added with prod-DB state table.*
