# Session log — gap analysis as a live page (`/status`), RBAC repair, and Alexis's four supplier models

Date: 2026-09-01 (the build day), closed out 2026-09-09 (documentation hygiene pass)
Commits: `ce412fa` … `15217e1` — 20 commits, 62 files, +13,563 / −190
Migrations: `20260901000001` … `20260901000012` (12, all applied by hand in the SQL editor)
Inputs read: `docs/gap-analysis-corpus-aug31/` (185 items · 25 categories · 28 sources · 16 people · 20 decisions · 11 exclusions · 7 patterns · 26 glossary terms), the 10/13/14/19-ago transcripts, `CARVAJAL_evidence.md`, and the models-3/4 xlsx
Produced this session: `docs/INVESTIGACION_PRESENTACION_ESTADO_2026-09-01.md`, `docs/PLAN_PAGINA_STATUS_2026-09-01.md`, `docs/gap-analysis-corpus-aug31/juicio.tsv`, `docs/gap-analysis-corpus-aug31/items_addendum.tsv`, `docs/inventarios/MANIFEST_MODELO_PUNTO_REORDEN.md`, `docs/inventarios/PROGRESO_MODELOS_3Y4.md`

Fifteen parts, chronological. The session began as a documentation ask and turned
into a day of building, so the parts are not uniform: A–C are research and
decisions, D–L are code, M is the closeout.

---

## Part A — The original ask

The project deadline had passed with the app incomplete. Three explicit asks:

1. Read every file in `docs/gap-analysis-corpus-aug31/`, starting with HANDOFF.md.
2. Research how a gap analysis is properly presented, and **persist the findings
   to a new md file** — not just answer in chat.
3. Plan an interactive `/status` page — better than the xlsx the corpus specified
   in T001 — and **persist the plan to a new md file**.

Plus: *"ask all necessary clarifying questions"* before starting.

### A.1 What the clarifying rounds established

Two rounds of questions. What came back, and what each answer decided:

| Answer | What it decided |
|---|---|
| Authenticated route, visible to **all roles**, including Wilmer and Alexis | No separate "client view" — one page, so there is no second version to keep honest |
| I pre-fill a suggested state per row, **marked as a suggestion**, with its evidence | Respects R03 (the judgment is Jorge's) without handing over an empty page |
| *"Help me think this through. I need CLARITY"* | The page is a thinking tool first, a report second |
| *"toggle to include or exclude items added outside of the original contract terms"* | Scope toggle, defaulting to contracted-only |
| *"help David make a realistic plan… the most complex season of the year… STARTS THIS WEEK"* | The season clock is the reason priority order beats date order |
| Corpus nuevo as the spine; the 26-ago report is **evidence**, not structure | Single source of truth for row identity |
| Master toggle **"Mostrar: Avance ↔ Prontitud"**, default Avance | Two readings of the same data, never mixed in one number |
| *"priority order. Make priority order the default. Give David, David only, the ability to reorder priorities and the ability to input dates freely."* | The plan is David's; the judgment is not |
| *"Supabase table + superuser in-app edition. Do not allow David in-app edition. Note that I will most likely ask you to make the editions from here, from the claude code conversation, so that you and me stay in sync."* | **This single answer decided the whole data architecture** — see Part B |
| Category E excluded; lower headline accepted | 7 commercial-terms rows leave the page |
| *"Do make a new role for David, and name the role 'project_manager'"* | Migration `000002` |
| *"Do replace 'Parcial o con defecto abierto' with 'Parcial o en construcción'"* | Label P-14 |

---

## Part B — Research, and the decisions it forced

Written to `docs/INVESTIGACION_PRESENTACION_ESTADO_2026-09-01.md`. The point of
the document is that the page's shape is defensible from established practice
rather than taste. The findings that actually changed the build:

**B.1 The 0/100 rule.** The *90-percent-done syndrome* is well documented: teams
report high completion for long stretches while nothing moves, because the
percentage tracks duration consumed rather than work finished. The remedy is the
0/100 method — an item is worth 0% until it is finished **and accepted**.

⇒ **`construido` (built, not confirmed by the client) does not count toward the
headline.** It gets its own bar and its own label. This is uncomfortable and it is
correct: R12 of the corpus already said *"ENTREGADO = Jorge lo mostró funcionando
en sesión; no implica aceptación del cliente"*. The rule was already written; the
page only had to respect it. Numerically: the 26-ago report claimed 47% by adding
verified (23%) to unverified (24%). Under 0/100 the honest headline was **23%**.

**B.2 The confirmation gap is an asset, not an excuse.** The literature stops at
"don't count it until accepted" and says nothing about what to do with a large
built-but-unaccepted bucket. Here that bucket was the same size as the finished
one, which makes it the central finding rather than a footnote. The test applied
to every `construido` row: *can I write today, in one line, what a named person
would have to look at and what they would have to say for this to be finished?*
Yes → it goes on the confirmation list with that person and that criterion (a
meeting, not a sprint). No → it isn't one meeting away; the honest state is
`parcial`.

⇒ Two fields per row (`confirmable_con`, `criterio_aceptacion`) and a first-class
block on the page. This is simultaneously how the bucket is presented *and* the
control that stops it from being inflated — a `construido` with no writable
acceptance criterion is the modern version of 90% done.

**B.3 The watermelon effect.** RAG reporting fails four ways: amber as the default
when nobody will commit, green-outside/red-inside until collapse, one inflated
green destroying trust in the whole report, and colors nobody has defined.
⇒ Every threshold is published next to the color it drives.

**B.4 Backward traceability is the defense against scope creep** — and the corpus
already had it (`src` mandatory, `[CREEP]` flags). ⇒ Expose it as a filter axis,
not a footnote. This is what the scope toggle is made of.

**B.5 Readiness ≠ completeness.** A serious go/no-go sorts open defects into "there
is a workaround" vs "hard block" and names the workaround. ⇒ The `rodeo` field and
the Prontitud half of the master toggle.

The doc also carries an antipattern table and decisions D-1…D-14.

---

## Part C — Data architecture: the `sync` decision

The requirement *"so that you and me stay in sync"* decided the architecture. If
the judgment were edited only in the database, this conversation and the
repository would diverge within a day. So:

```
docs/gap-analysis-corpus-aug31/
  items.tsv        ← IMMUTABLE. 185 facts with their source. Never touched.
  categories.tsv   ← IMMUTABLE.
  juicio.tsv       ← the judgment. 13 columns. THIS is what I edit when the
                     instruction is "change A4.22 to parcial".
  items_addendum.tsv ← findings after the corpus's 26-ago cutoff (Part J.2)
scripts/sync_status.py ← reads all of it, validates, upserts. Dry-run default.
```

`juicio.tsv` in git means the judgment is reviewable in a diff, attributable to a
commit, and reversible. It is the same treatment the corpus gave itself.

**Two tables, two owners** (migration `000001`):

- `status_items` — facts + judgment. Owner: Jorge, via `juicio.tsv` + sync. The
  sync **overwrites** it; it is a mirror of the repo, not an original.
- `status_plan` — priority, target date, note. Owner: David. **The sync never
  touches it.** This is why it is a separate table and not columns on
  `status_items`: as columns, the next `sync --commit` would erase David's work
  without saying so.

**Five independent axes per row** (research D-3): `estado · origen · bloqueo ·
temporada · esfuerzo`, plus `area` and `visible_ui`. Independent because collapsing
them is how a status report becomes unfalsifiable.

The sync's weights, which produce the default priority order:

```python
PESO_TEMPORADA = {'critico': 100, 'mejora': 40, 'puede_esperar': 5, 'na': 0}
PESO_BLOQUEO   = {'nadie': 30, 'jorge': 25, 'cliente': 10, 'tercero': 0, 'na': 0}
PESO_ESFUERZO  = {'horas': 20, 'dias': 12, 'semanas': 3, 'no_estimable': 0}
PESO_ESTADO    = {'parcial': 15}
```

Season value dominates on purpose — the season starts this week. Within equal
season value, "nobody is blocking this and it takes hours" outranks "it takes
weeks", because David needs a plan he can actually execute.

A **QUALITY GATE** in the sync refuses to write unless the arithmetic closes
(`185 + 7 addendum − 7 excluded = 185`). It exists because a silent row loss in a
completeness report is the worst possible failure mode.

---

## Part D — The naming and tone policy (P-15)

Explicit instruction, confirmed for all rows:

> *"rewrite the prose to describe the situation instead of the person. NOTHING in
> the UI should sound at all -not even remotely- like I'm pointing fingers at
> people. The only place where we name people is in who owns the acceptance step.
> Do flag me if this is in any way ambiguous or contradictory."*

And then:

> *"Verbatim quotes belong in the dev environment, not on the page visible to
> everyone. Same with Personas annex. About the acceptance block: do not change
> the grouping without asking me first. New field visible_ui is a good workaround."*

⇒ **Two filters enforced server-side, in `GET /api/status`, not in the client** —
a presentation filter can be switched off from the browser and these must not be:

1. `visible_ui = false` — 9 rows whose content is an assessment of a person's
   performance. They are loaded (they inform the judgment, per R03) and never sent
   to the browser: C3, D1.1, D1.2, D1.4, D2.3, D6.5, D7.5, D7.7, D7.8.
2. `ref` — the verbatim transcript quote never leaves the database. Auditability
   is carried by `src` (date + file + lines), which is enough for anyone to go to
   the transcript. The quotes are exactly where judgments about people live.

I flagged one genuine tension, as asked: the acceptance block names people by
design (`confirmable_con`). That is the sanctioned exception, and the grouping was
left alone per the instruction.

---

## Part E — `/status` built (`6bc7c72`)

`frontend/src/lib/status/metricas.ts` holds the arithmetic as pure functions —
`titular()`, `brechaConfirmacion()`, `esperandoQue()`, `ordenarPlan()`,
`prontitud()`, `reordenarIds()` — so the headline is unit-testable and the rule it
implements is readable in one file. Ordering model:

```ts
const clave = (i) => plan.get(i.id)?.prioridad ?? i.orden_sugerido ?? 1e9;
```

David's manual priority wins; the computed order is the fallback; unranked rows
sink. One expression, no special cases.

Headline as of the 09-09 sync:

| Scope | n | Finished (0/100) | If the confirmations land |
|---|---|---|---|
| Contracted only (default) | 93 | 31.2% | 58.1% (+25) |
| Everything asked for | 128 | 28.1% | 50.8% (+29) |
| Only what was added later | 22 | 18.2% | 36.4% (+4) |

---

## Part F — RBAC repair (`7c018fe`, migration `000003`)

Asked: *"Clean up the rbac first. Does gerencia user have a real use now that
we're live in prod?"* Then: *"Do implement the rbac cleanup. Do hide the
demonstration surfaces from gerencia. Remove '(Demo)' from the name. Make it the
real prod account for Luis Roberto."*

Findings and fixes:

- **`PAGE_PERMISSIONS` was enforced nowhere.** It was declared in `roles.ts` and
  asserted in tests, and no runtime code ever checked it. A permission table that
  tests itself and guards nothing is worse than none, because it reads as
  protection. Added middleware enforcement, most-specific-prefix wins.
- **15 orphan route grants revoked.** Rows in `route_permissions` for routes that
  do not exist. A permission must never precede its route; an orphan grant becomes
  live access the moment someone creates that path.
- `/poc` closed; `gerencia` landed on `/status`; the demo account became Luis
  Roberto's real production account.

---

## Part G — David's role and plan editing (`3e624e6`, `e0f5b0a`)

Migrations `000002` (role), `000004` (David's profile), `000005` (PUT on plan).

Asked for the profile row *"after the fact to keep the history honest"* — the
account already existed, so the profile is back-dated rather than pretended to be
new. Then: *"There's a better UI/UX for reordering: drag and drop. Implement it."*

Write access is double-gated: the server resolves `puedeEditarPlan` and passes it
down as a prop, so the editing UI is not drawn for anyone who cannot write, **and**
the route re-checks on every request. The prop is an affordance, not a guard.

---

## Part H — Forecast comercial level 1 (`37a3ff3`, migration `000006`)

Built as asked. Shipped in the same commit as the `PAGE_PERMISSIONS` enforcement
from Part F, because the new route was the first one that needed it.

---

## Part I — Compras features

| Commit | What | Reasoning |
|---|---|---|
| `0a974a1` | **Copiar** — the visible table to the clipboard as TSV (`lib/compras/tabla.ts`) | He manipulates in Excel. Copy of *what is on screen, after filters*, not a rebuilt export — otherwise the two disagree and he stops trusting both |
| `61ba916` | **Divergence alert** (`lib/compras/tendencia.ts`) | See I.1 |
| `053d152` | **Agrupar por categoría** — A6.11 | |
| `31966a4` | **"Pide bodega"** — the CD's own suggestion, A4.17 | Append-only capture: history *is* the data |
| `6dc3297` | **Tránsito drill-down by date** — A6.15 | |

### I.1 Calibrating the divergence alert

First attempt measured p3 against h: **75% median divergence, 82% of rows firing
at a 20% threshold.** An alert that fires on four rows in five is not an alert, it
is a column. Changed the basis to p3-vs-p6 (72% coverage, 27% median divergence)
and required **both** conditions — rising twice *and* diverging:

```ts
export const DIVERGENCIA_UMBRAL = 0.40;  // const now, user-configurable later
export const SIN_REFERENCIA_ANIO_ANTERIOR = 'Sin referencia del año pasado';
```

Result: **39 of 1,331 rows (2.9%)**. That is an alert. The threshold is a named
constant rather than a literal so that making it configurable later is a UI change,
not a hunt through the engine.

---

## Part J — The tránsito breakdown wrote zero rows (`1ff2566`, `ba8e5cf`)

Instruction: *"query transito_detalle directly, exhaustively, until you find the
root cause, and fix it."*

**Root cause:** `product_map` was keyed by string and looked up with an int, so
every lookup missed and the table was written empty — silently, which is the
actual defect. Fixes:

- `product_map.get(str(d['opid']))`
- Extracted `map_detalle_rows()` so the mapping is testable without Odoo.
- **Added a runtime guard that raises a `sync_issue` when transit exists but the
  breakdown is empty.** The bug was cheap to fix and expensive to notice; the guard
  is the part that matters.

**Verified against production Odoo with a read-only probe: 141/141 entries
survive.** (Odoo is read-only — hard rule. Probes committed separately as
`eeeabb6`, explicitly behavior-neutral.)

Also corrected a **wrong corpus diagnosis** on B1.13: transit was being
*replicated*, not mixed, and ~30% of it was bound for out-of-scope warehouses.

---

## Part K — Carvajal, Alexis's second model (`3caafa9`, migration `000011`)

Raised as: *"I just noticed a huge elephant in the room: where is Alexis' second
model, Carvajal?"* The evidence file came with an explicit warning that it
contained false information, which is the reason every rule was re-derived from
the transcripts and the workbook rather than taken from the summary.

**Decision: parameterise, do not fork.** *"Models Reyma and Carvajal are basically
the same business rules with different numbers"* — so the numbers go to data
(`modelo_proveedor`) and the scope to `reyma_products.modelo`. A second engine
would have put the measured Reyma parity (2,752/2,752 cells; Sugerido 1,325/1,327
= 99.85%) at risk for no gain.

---

## Part L — Models 3 and 4: Darnel and Asia (`15217e1`, migration `000012`)

Asked for a deep inspection of every worksheet, *"keeping in mind The Dirty George
Principle. Map semantically to headers, never to column numbers"*, starting with a
comprehensive manifest, in small batches and sub-batches, with a **live progress
document**.

### L.1 The manifest first

`MANIFEST_MODELO_PUNTO_REORDEN.md`: 5 sheets, 44 engine columns, 20 formulas
transcribed, 8 open unknowns. What the inspection found, before any code:

- The **EN LIQUIDACIÓN rule is broken in the workbook** by a `#REF!` — 0 products
  classified where 11 should be, so the sheet currently proposes purchases for 11
  discontinued products.
- **64% of the line sits in EXCESO.**
- `PEDIDO 13` references an external workbook.
- The reorder point (9) is not the sum its own legend declares (3 + 7).

### L.2 Decisions

| # | Decision | Why |
|---|---|---|
| D1 | A **new** engine, not a Reyma variant | Reyma is global order + weekly MRP; this is reorder point + lead time + maximum coverage. Forcing them into one codebase would risk the measured 2,752-cell parity |
| D2 | **One** engine serves Darnel **and** Asia | Parameterised, like Reyma/Carvajal |
| D3 | Projection over **2 months, editable** | The written instruction beats the workbook's "prom Jul-Sep", and the message explicitly asked for it to be editable |
| D4 | Confirmed transit normalised to **dated rows**, not columns | The workbook uses 4 dated columns; that does not scale, and Reyma already solved it this way |
| D5 | EN LIQUIDACIÓN read from `Estado en Modelo` on the price sheet | The data exists and is clean there (11 products); the engine's copy is broken |
| D6 | Parameters into `modelo_proveedor` | It already exists and already serves Reyma/Carvajal |

The contradictions were **implemented as the workbook has them (9 and 10) and
declared on screen**, rather than quietly corrected. Asia was born with empty scope
and NULL parameters, labelled "sin definir" — never inheriting Darnel's numbers in
silence.

### L.3 Semantic header mapping

`ml/modelo_reorden_carga.py`. The book has headers across two rows, merged cells,
internal line breaks, and dates embedded in header text. Three categories:

1. Fixed fields, matched by normalised synonym.
2. Repeating columns (shipments) detected **by group**, with the date read from the
   header itself — so adding a shipment needs no code change, and a test fixes that.
3. `CALCULADAS` — ignored on purpose, but **enumerated**, so a genuinely new column
   cannot hide among 21 expected ones.

An unmatched column is **reported**; a missing mandatory column **stops the load**.
Nothing is ever guessed from position. Validated against the real file: 17/17
fields, 4 shipments with correct dates, 0 missing mandatories, 0 unknown columns.

**Correction to the plan, recorded in the tracker:** the mapping went to Python,
not TypeScript, because Python is where the xlsx is read.

### L.4 Parity

The engine (`frontend/src/lib/inventarios/reorden.ts`) is pure and runs two passes
by necessity: `semanasPorContenedorGlobal` depends on every product's sales and
also feeds each product's maximum. Thresholds: `UMBRAL_CRITICO_SEM = 7`,
`UMBRAL_REORDENAR_SEM = 10.7`, `FACTOR_EXCESO = 1.5`, `SEMANAS_POR_MES = 4.2857`.

Measured against all **141 rows**: net inventory, total, weekly sales, coverage,
maximum and order all reproduce the cached values; the global term gives 0.6566 as
the book does. The semaphore agrees on **130/141, and all 11 differences are EN
LIQUIDACIÓN** — the workbook classifies zero because of its `#REF!`. A test pins
that every difference must be a liquidation and that there must be exactly 11.

Production load for `darnel`: 141 products, 9 shipments, 48 prices from 3
proformas; 0 unknown columns, 0 rows held back, 2 missing cubicaje (reported).

---

## Part M — UI text and navigation

| Commit | Change | Reason |
|---|---|---|
| `f0eec80` | Hide "Demostración de Valor" in the sidebar for all roles | Asked |
| `5111a5d` | "juicio" → **"Actualizado"** in visible text | *"This is not a legal trial!"* |
| `baf2206` | Hide a disclaimer written in hard-to-understand Spanish | Same root cause as N.4 below |

---

## Part N — My errors this session, and the corrections

1. **Graded items from notes instead of code, three times.** A1.15 and A6.17 were
   already built; A4.5 was marked `construido` citing Alexis's
   `reyma-vivo/planificacion.ts` — a cross-silo misattribution, since the Carvajal
   rules are not in that code. A6.3's "two of three workbooks" note was also false;
   only one is replicated. **The lesson is the fix: the evidence column must cite a
   code path I actually opened, not a note.**
2. **A stray string-replace hit two functions** — injecting `fecha_por_orden` into
   `sync_invoiced` broke 9 ML tests. Removed the two misplaced lines.
3. **Wrong Python version** — the first venv used the system 3.9; CI and Docker
   target 3.12. Rebuilt.
4. **Spanish.** *"Your spanish is extremely hard to understand!!! Half of what you
   write I don't understand. Why do you keep talking to me in spanish??????????"* I
   had violated the stored memory "Write in English always". Switched, and this is
   why `baf2206` exists.
5. **A vacuous test** — `test_le_lee_la_fecha...` had an `or` that passed either
   way. Tightened it and threaded `anio` explicitly through `mapear_encabezados`.
6. **Mixed categories in a status list.** *"You are mixing up many things together.
   Make a list. Order by criticality for client operations."* Then most of that
   list came back rejected as not-code or already-done.
7. **`.env` points at a dead Odoo dev instance**; `.env.prod` reaches production.
   Noted because it cost time twice.

---

## Part O — The 09-09 closeout

Asked: *"is there any item from this session that we planned to build but haven't
built yet?"* After the list was re-cut by criticality, four instructions came back:

| # | Instruction | What I did |
|---|---|---|
| 1 | Annexes on `/status` → *"Move to out of scope"* | Fase 3 · 10 marked out of scope in the plan doc, with date and reason |
| 2 | xlsx export — *"This is false. See for yourself."* then *"Status does not need to be exported."* | See O.1 |
| 3 | Superuser judgment editing — *"I can live with this. Move to out of scope."* | Fase 3 · 8 split: David's half marked delivered with evidence, the superuser half out of scope |
| 4 | *"All documentation should always be kept up to date!"* | See O.2 |

### O.1 The xlsx export

I had reported it as planned-but-not-built; the user said that was false. I checked
three ways — no git history for the route, no code under
`frontend/src/app/api/status/export`, no row in `route_permissions` — and found
nothing, so I said so and asked where to look rather than quietly agreeing.

While verifying A6.16 I found what was probably meant: the repo **does** have xlsx
exporters (`lib/compras/sugeridoExport.ts`, Wilmer's) — just none that export
`/status`. The user then settled it: *"Status does not need to be exported."* So
Fase 3 · 9 is out of scope, and two stale claims were corrected:

- **P-1** in the plan doc had said the xlsx survives "as an **export** of the same
  source". No longer true.
- The antipattern table in the research doc (line 126) had "página viva +
  exportación" as the remedy. Now says there is no export.

Fase 3 now has nothing open and says so.

### O.2 Documentation hygiene

- `docs/inventarios/PROGRESO_MODELOS_3Y4.md:80` — `F2 … 🔵 falta push` was stale;
  it had been pushed as `15217e1`. Corrected, and the log entry that ended "Falta el
  push" now closes out all six batches.
- **The consequence that mattered:** `juicio.tsv` still had **A6.16** as
  `no_construido`, which means `/status` was showing David a gap that closed on
  07-sep. The rename is built — `frontend/src/lib/compras/sugeridoExport.ts:46`
  fixes the download name as «Sugerido», and a test asserts the name never matches
  `/Prioridades/i`. Row rewritten to `construido`, waiting on Wilmer to download it
  and confirm. Re-synced: 185 rows, gate OK, `status_plan` untouched.
- Verified rather than asserted, before writing it into the plan doc: `status_plan`
  holds **64 rows with a manual priority, 35 with a target date, 3 with a note** —
  which is the evidence that David's editing is in real use, not merely shipped.

**Why the stale row is treated as a defect and not a tidiness issue:** `juicio.tsv`
renders straight to David on `/status`. A stale judgment row is not an out-of-date
document, it is a wrong number on a live page, and it costs exactly the credibility
the 0/100 rule was adopted to protect. Saved as a memory (`keep-docs-current.md`).

---

## Part P — Verification

- **367 frontend tests + 144 ML tests, clean build**, at `15217e1`.
- Reyma parity: 2,752/2,752 cells; Sugerido 1,325/1,327 products (99.85%).
- Reorden parity: 141/141 rows, 37 tests; semaphore 130/141 with the 11
  liquidations pinned by a test.
- Header mapping: 28 tests against the real headers.
- `transito_detalle`: 141/141 entries verified by read-only probe against
  production Odoo.
- Sync quality gate: `185 + 7 − 7 = 185`, enforced on every run.

## Part Q — Standing rules this session operated under

- **Odoo is read-only — hard rule.** The app reads Odoo, never writes; CEO-set, and
  the credentials enforce it.
- **`items.tsv` is immutable** (R06, X09): no renumbering, no merging, no rewriting
  quotes, no adding rows without a source. Post-cutoff findings go to
  `items_addendum.tsv` — the corpus closes 26-ago while work continued to 31-ago, a
  5-day blind spot.
- **`docs/` stays gitignored**; a physical backup exists.
- **Write in English always** — the repo is Spanish; my output must not be.
- **Nothing in the UI points fingers at people**; names appear only as
  acceptance-step owners.
- **Do not change the confirmation-block grouping without asking first.**
- **Migrations are applied by hand in the SQL editor; never `db push` blind.**

## Part R — Still open

- The 25 contracted rows sitting in `construido`, each with a named person and a
  written acceptance criterion. They are the difference between 31.2% and 58.1%,
  and none of them is a build task.
- Ventas accounts, deferred: *"I don't have sufficient information to create them."*
- Asia's parameters and scope, NULL and empty on purpose until declared.
- `DIVERGENCIA_UMBRAL` is a constant; making it user-configurable was deferred, not
  rejected.
