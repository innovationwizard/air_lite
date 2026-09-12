# Session log — REYMA clave quarantine + `inventario` → `compras_internacionales` rename

Date: 2026-09-09 (spans a session that began with a 2026-09-01/02 bug report)
Scope: `/inventarios/facturas` → `/compras-internacionales/facturas` (Alexis's silo), `ml/reyma_factura_carga.py`, RBAC (`frontend/src/lib/auth/roles.ts`)
Related doc (produced this session, read first for the *why*): [VENDOR_SKU_CROSSWALK_DESIGN.md](VENDOR_SKU_CROSSWALK_DESIGN.md)

Seven parts, roughly chronological. Each has its own "original ask → research →
decisions → what got built/changed → verification" shape, because the session
was seven separable asks handled in sequence, not one continuous task.

---

## Part A — Diagnosing Alexis's bug report (F173634 / CH2PRXN)

### A.1 What was handed to me

Three things in sequence: (1) a screenshot of `/inventarios/facturas` showing
*"F173634 no se puede cargar... G-251-2026 CH2PRXN: sin mapa en
reyma_products.clave... No se cargó nada de esta factura"*; (2) my own PRIOR
session's diagnosis (verbatim, pasted back to me) concluding the product was
genuinely out of scope, citing the August precedent (`CN9X9D4PXN` / G-226,
loaded by hand with sentinel `odoo:6037`); (3) Alexis's reply to that
diagnosis: *"Hago la aclaracion que ya existen en Odoo"* — he was contradicting
my own prior conclusion, and asked me to look again with fresh eyes.

### A.2 Research and the correction

Read-only XML-RPC probes against live production Odoo (`.env.prod` creds,
uid 199, write/create/unlink already denied at the credential level — verified
again this session by a failed `product.template` write attempt, Fault 4).
Searching `product.product`/`product.template` for `"CHAROLA"` (REYMA's word)
found nothing — because Odoo's own name for the product says **"BANDEJA"**,
not "CHAROLA." That vocabulary mismatch was what made my first pass wrongly
conclude the product didn't exist. Searching REYMA's own supplier catalogue
(`product.supplierinfo`, partner 23188) instead found it immediately:

| field | value |
|---|---|
| `product.product` id | 9397 (template 12140) |
| `default_code` | **77201001** |
| Odoo's name | "BANDEJA TERMICA NO.2P BLANCA 1/500" |
| `create_date` | 2026-07-31 — **after** the July xlsx seed |
| linked to REYMA via | `product.supplierinfo` id 10012, partner 23188 |
| live PO | PO-P-3025, 1,300 units, 25-ago |

**The real root cause, corrected from my prior session:** it isn't a
vocabulary mismatch alone — `reyma_products` is seeded from the July xlsx
**exactly once** (`load_or_seed_products()` in `ml/odoo_sync_reyma.py`, "empty
table → seed" logic) and never grows again. Any REYMA product created in Odoo
after that date is structurally invisible to the app, regardless of naming.

**Quantified the backlog** (read-only queries against prod): 71 distinct
active REYMA códigos exist in Odoo; only 55 are in `reyma_products`; **18 are
missing** — including both this incident's product and the August precedent's
(77201025, also still missing). Also found: `CAJA20` maps ambiguously to 3
códigos; `CAJA20`/`FARDO10` aren't vendor SKUs at all, they're unit-of-measure
strings that leaked into the `clave` column during the original seed; and 44
of 116 `product.supplierinfo` rows for REYMA already carry the vendor's own
product-name wording — a free, unused matching signal (cross-checked: it would
have solved the August precedent unaided — supplierinfo 7928 says
*"CONTENEDOR TERMICO 9X9-D"* → 77201025, exactly the mapping a human had to
make by hand).

Reported this back to the user, explicitly correcting the prior session's
wrong conclusion rather than defending it.

---

## Part B — Vendor SKU crosswalk design research

### B.1 The ask

*"We will not write to Odoo and the map genuinely has to be built by us,
new products can appear at any time — research data science best practices,
what's the best possible solution design, persist findings to a new md file,
ask clarifying questions if necessary."*

### B.2 Research

Web research across three areas, each checked against this specific problem's
shape (tiny cardinality, ~1 new clave/month; extreme cost asymmetry, a wrong
map silently corrupts money and stock while a missing map is loud and cheap):

- **Entity resolution / record linkage theory** — Fellegi-Sunter's three-way
  decision (match / non-match / possible-match routed to clerical review, not
  a binary), Splink's blocking discipline (naming evidence sources explicitly
  rather than one fused score).
- **Reference-data management** — Informatica Reference 360 / TopBraid EDG's
  crosswalk-as-versioned-object pattern; SCD Type 2 for "never destroy a prior
  mapping."
- **Whether ML/LLM matching would help** — deliberately investigated rather
  than assumed away. Key finding: on the standard Abt-Buy benchmark, a
  simple rule-based baseline scores F1 0.950 against LLM zero-shot's 0.948,
  and LLM matchers consistently show recall≫precision (they'd rather guess a
  match than return nothing) — the opposite of what this problem needs.
  **Recommended against ML/LLM** for this specific case, with reasoning, not
  a blanket "AI is wrong here."
- **This repo's own precedent** — `reyma_factura_match`
  (`20260820000003_reyma_factura_match.sql`) already solves a structurally
  identical problem (linking PDF invoices to Odoo bills) with append-only
  history, a tier ladder, an `evidencia JSONB` snapshot, an author, and
  `auto/confirmado/rechazado` states. Concluded: reuse this repo's own proven
  convention rather than import a new one.

### B.3 Output

Wrote [VENDOR_SKU_CROSSWALK_DESIGN.md](VENDOR_SKU_CROSSWALK_DESIGN.md): a
dedicated crosswalk table (Part 1), a tiered candidate generator — tier 1
supplierinfo match, tier 2 PO co-occurrence — that only ever *proposes*,
never auto-commits (Part 2), quarantine-not-block for invoice loading
(Part 3, first drafted as "hold the line, don't kill the invoice"), a
resolution UI sketch (Part 4), and a sync-time check to catch new Odoo
products proactively rather than discover them via a broken invoice
(Part 5). Left two decisions explicitly for the client rather than guessing:
(1) does confirming a mapping also mean `en_alcance = true`; (2) hold the
line vs. stop the invoice.

---

## Part C — Peak-season UX refinement

### C.1 Decisions closed, and one question asked back to me

User resolved decision (1): **`en_alcance = true`** on confirm. Asked me to
explain decision (2) in plain terms rather than deciding it themselves blind.

I explained "stop the invoice" (today's behavior — one bad clave, the whole
document rejected) vs. "hold the line" (quarantine just the bad line, the
rest loads), recommended hold-the-line *with* a reconciliation safeguard
(flagged that `reyma_factura_match`'s tier-2 matching compares total invoice
amounts — a partially-loaded invoice could silently mismatch against the
wrong Odoo bill unless guarded).

### C.2 The pushback that changed the design

User: *"Put yourself in Alexis's shoes during peak season... I have a hunch
that 'stop the invoice' is not a solution, and 'hold the line' can have a
better UX design. Do additional research if you need to."*

Further research: warehouse-receiving best practice (the **quarantine lane**
pattern — Hopstack/Mintsoft: record the actual receipt immediately, segregate
anything abnormal, never block the rest of the receipt) and the
**optimistic-UI** pattern (NN/g — act immediately, surface the exception
without gating on it). Then found the decisive evidence **inside this
codebase**: `saldos.ts`'s own docstring states PDF ingestion exists
specifically because it **leads Odoo's own bookkeeping by days** — meaning
"stop the invoice" doesn't just inconvenience Alexis, it defeats the entire
reason this feature exists, at the exact moment (peak season, more new SKUs)
it matters most.

**Revised design:** quarantine the *line*, never the invoice; route
resolution *off* Alexis's truck-side moment entirely — originally proposed
routing to Jorge/gerencia via the existing `bug_reports`/Resend email
infrastructure (reuse, not build new), with an optional future WhatsApp
async nudge to Alexis reserved as a v2, not a launch requirement. Updated
`VENDOR_SKU_CROSSWALK_DESIGN.md` Parts 3–4 to match and closed both open
decisions in the doc.

---

## Part D — Building the REYMA clave-pendiente feature ("build it")

### D.1 The ask, and how it changed the design one more time

*"Alexis is still the only right person to do the one-click confirmation or
manual assignment, just not at the same time he's unloading a truck. Give
him a dedicated page for quarantined facturas, with its corresponding
navigation item on the side panel. Build it."*

This overrode part of Part C's design: resolution stays with **Alexis**, not
Jorge — just moved to a page he visits when he has time, not routed away
from him. No clarifying questions were asked; ambiguous implementation
details were resolved with disclosed engineering defaults instead (documented
inline in code comments and in the wrap-up message), since none were
business-judgment calls beyond what was already decided.

### D.2 What was built

**Core rule change** — `ml/reyma_factura_carga.py`: an unmapped clave moved
from `r._error(...)` (kills the whole invoice) to `r.retenidas.append(...)`
with a new `tipo='clave_sin_mapa'`. Deliberately **left the "ambiguous
clave" (>1 código) branch as a hard error** — a separate, pre-existing data
bug (`CAJA20`), out of scope for this change, not silently fixed alongside
it. Extended the `_retenida()` helper to also carry `bultos`,
`precio_unitario`, `archivo`, `folio_fiscal`, `factura`, `fecha`,
`observ_destino` — everything needed to reconstruct the line and re-run the
*same* `evaluar()` later, rather than reimplementing conversion rules a
second time (the module's own stated design principle).

**Tests** — `ml/tests/test_reyma_factura_carga.py` updated to match; the
real-production regression test (26 actual REYMA PDFs, the frozen fixture
from `2026-08-25`) re-verified byte-identical except `CN9X9D4PXN` now
correctly retains instead of blocking. **28/28 passing.**

**`ml/api.py`** — `_mapas_reyma()` now merges a new `reyma_clave_map`
crosswalk on top of `reyma_products.clave` (additive; the 53 already-good
xlsx claves are untouched). Two new endpoints: `GET
/reyma/productos/buscar` (live, read-only Odoo search — tier-1 supplierinfo
match plus a general fallback — using a **purpose-built single-shot
connection helper**, deliberately not the batch-sync `connect_odoo()`, which
calls `sys.exit(1)` on failure and would kill the whole Flask worker); `POST
/reyma/factura/pendiente/reintentar`, which replays quarantined lines by
calling `evaluar()` again, never a second implementation.

**`scripts/load_reyma_facturas_pdf.py`** — `cargar_mapas()` given the
identical crosswalk merge, so the CLI backfill path never drifts from the
app.

**Migration `20260909000001_reyma_clave_pendiente.sql`** — two new tables:
`reyma_clave_map` (append-only crosswalk, mirrors `reyma_conversion_bulto`'s
"latest row wins" convention) and `reyma_factura_pendiente` (mutable
quarantine queue, `UNIQUE(folio_fiscal, clave)` for idempotent re-upload,
mirrors `reyma_factura_staging`'s lifecycle-state convention). `route_permissions`
rows for the new endpoints, matching the exact `inventario`/`gerencia`/`admin`
trio already used for the rest of the invoice-upload flow.

**Frontend** — `cargar/route.ts`: after writing known lines, also persists
`clave_sin_mapa` retenidas into `reyma_factura_pendiente`; relaxed the "0
filas = reject" guard so an invoice where *every* line is a new clave still
loads (into quarantine) instead of bouncing. Three new API routes under
`/api/inventarios/reyma/clave-pendiente/*` (list grouped by clave; live-search
proxy; resolver — upserts `reyma_products` **without ever overwriting an
existing row** `ignoreDuplicates: true`, inserts the crosswalk row, replays
every pending line for that clave via the ML `reintentar` endpoint, applies
results). New page `/inventarios/facturas/pendientes` +
`PendientesClient.tsx` (auto-searches using the CFDI description on open,
ranked candidates with plain-language evidence — "REYMA le llama así en
Odoo" — plus a manual código box). Sidebar nav item added. Small addition to
the existing upload screen: a held line now links straight to the new page.

### D.3 Verification

Python: `pytest` 28/28 (including the full production regression). Both new
ML endpoints **smoke-tested live, read-only, against real production**
before trusting them — confirmed the exact original incident now resolves
(searching "CHAROLA" surfaces `77201029`/`77201018`/`77201022` via the
vendor's own supplierinfo wording), and confirmed the `reintentar` endpoint's
per-invoice destino/eta grouping works correctly across multiple different
invoices in one batch (via a stubbed `Mapas`, since the crosswalk table
didn't exist in prod yet at that point in the session). Frontend: `tsc
--noEmit` clean, `jest` 430/430, `next lint` clean.

---

## Part E — Investigating the `inventario`/`compras_internacionales` naming mismatch

### E.1 The ask

*"I don't understand why you keep calling Alexis' field 'inventarios'.
Alexis' field is 'comprasinternacionales'. What's the blast radius of making
this correction project-wide, whole codebase?"*

### E.2 Investigation

Repo-wide grep (129 files touch the word, in some sense) categorized by risk
tier: production data (`user_profiles.role`, `route_permissions.role`), RBAC
code (`roles.ts`), URL namespace (two physical directory trees), UI labels,
and comments/historical docs. Found corroborating, pre-existing evidence the
mismatch wasn't intentional: `frontend/src/lib/status/metricas.ts` already
has an unrelated, correctly-named `Area` entry
(`compras_intl: 'Compras internacionales'`) — the right vocabulary already
existed elsewhere in this exact codebase. Verified live against
production (read-only): **exactly 1** `user_profiles` row has
`role='inventario'` (Alexis, no one else) and **26** `route_permissions` rows
key off it. Confirmed **no collision** with the existing, separate `compras`
role (Wilmer's — `compras@airefill.app`).

### E.3 Output

Presented a tiered blast-radius report (cosmetic / data-driven-and-reversible
/ URL-namespace-with-real-teeth) and recommended treating the role-string
rename and the URL-namespace rename as two decisions, not one, since the
latter breaks Alexis's saved links.

---

## Part F — Planning and executing the rename

### F.1 The ask

User locked in both names (`compras_internacionales` for the role,
`compras-internacionales` for the URL), said re-explaining the new links to
Alexis is a non-issue, and asked for **"a very careful plan... in the
correct order, without breaking anything... we are not in working hours,
downtime is acceptable."**

### F.2 Plan mode

Entered `EnterPlanMode` given the stakes (live production RBAC + a whole
codebase touch). Did exhaustive additional research before writing the plan
— found **three file-local role arrays living outside `roles.ts`** that a
`roles.ts`-only edit would have silently missed: `Sidebar.tsx`'s
`CAN_VIEW_RISKS`, and matching assignable-role lists in
`app/api/admin/users/route.ts` and `admin/usuarios/page.tsx`. Enumerated the
exact route_permissions split (15 of 26 rows need their `route_pattern`
rewritten too, not just the role column). Checked for a PWA manifest /
`vercel.json` redirect config that might also need touching (none existed).

**Ordering decision, with reasoning:** code first, verified locally, deployed
and confirmed live — DB migration last. A failed code deploy never touches
production data; the DB step is the harder-to-undo half, so it should be the
smallest, most surgical, last thing done, only once the code that expects
the new names is already live. Wrote the plan to the plan file, called
`ExitPlanMode`, got approval.

### F.3 Execution

`git mv` on both directory trees (preserving history, and correctly carrying
along the brand-new untracked `pendientes`/`clave-pendiente` files from
Part D). Fixed the one cross-tree absolute import found in advance
(`feedback/route.ts`). Rewrote `roles.ts` comprehensively: `Role` type
union, `ROLES` const, five `Role[]` arrays, `ROLLOUT_FOCUS` key + paths,
`PAGE_PERMISSIONS` keys, `getDefaultPage()`, `ROLE_LABELS`, and renamed the
exported `CAN_VIEW_INVENTARIOS` → `CAN_VIEW_COMPRAS_INTERNACIONALES` across
its 13 import sites. Fixed the three file-local arrays found in planning.
Bulk-edited `roles.test.ts` (mechanical `sed` pass, then hand-fixed the
handful BSD `sed`'s lack of `\b` word-boundary support silently missed, then
fixed prose test-description strings by hand since a blind substring
replace would have corrupted English sentences).

Ran the full verification gate: `tsc --noEmit` first showed ~60 errors, all
traced to a **stale `.next/` build-cache** referencing the old paths (not a
real source error) — confirmed `.next/` was gitignored and had zero tracked
files before deleting it, then re-ran clean.

### F.4 Bugs caught by going beyond the written plan

A **post-edit exhaustive final grep sweep**, done specifically because
`tsc`/`jest`/`lint` alone can't catch string-literal or runtime-only
breakage, found and fixed four real bugs the plan's file audit had missed —
three of them in files that didn't exist yet when the plan was written
(built during Part D, the same session, before the plan's audit pass):

1. Six absolute `@/app/(authenticated)/inventarios/...` imports still
   pointing at the old tree, inside two API route files
   (`reyma/route.ts`, `reyma/conciliacion/route.ts`) — these files moved
   with their directory, but the *strings inside them* referencing sibling
   modules by absolute path didn't move with them.
2. `PendientesClient.tsx`'s three `fetch()` calls, still saying
   `/api/inventarios/...` — built in Part D, after the sed pass that fixed
   the other two client components.
3. A literal `fetch('/api/inventarios/reorden')` in `ReordenClient.tsx` —
   missed because the earlier fix pass only targeted the two files known
   (from an earlier, narrower grep) to have literal path strings; this one
   didn't show up in that narrower search. Would have silently broken the
   Darnel/Asia reorder-point page in production.
4. **A whole directory outside the written plan's scope**:
   `frontend/src/lib/inventarios/` (the shared `reorden.ts` reorder-point
   engine, used only by this silo). Not enumerated in the plan because the
   plan's audit only searched `frontend/src/app`, not `frontend/src/lib`.
   Renamed it too (`lib/compras-internacionales/`), fixed its two import
   sites, and **disclosed this as a scope addition** rather than silently
   expanding beyond what was approved.

Followed by a comment/doc-header cleanup pass — each route file's own JSDoc
header describing its own (now-wrong) path, "Inventarios silo" phrases, one
bare `/inventarios/facturas/pendientes` reference the `/api/`-prefixed sed
pass didn't catch — while explicitly **leaving alone** two categories that
look similar but aren't: `docs/inventarios/*` (a real, separate, gitignored
folder, never renamed) and the `BD_INVENTARIOS` UI tab label in
`ReymaClient.tsx` (the literal name of a sheet in Alexis's original xlsx
workbook — historical data-source naming, not app routing).

### F.5 Verification and handoff

Final gate: `tsc --noEmit` 0 errors, `jest` 430/430, `next lint` clean,
final repo-wide grep showing zero remaining functional references (only
legitimate generic "inventory" usage and the one correctly-excluded
historical label). Wrote the DB migration
(`20260909000002_rename_inventario_a_compras_internacionales.sql`) as four
ordered, individually-safe sub-steps (additive constraint widen → the one
data row → the 26 route_permissions rows → constraint cleanup), with
read-after-write verification queries and rollback SQL in the header —
**did not apply it**, per the plan's code-then-DB ordering; left for the
user, along with an explicit note that nothing was committed or deployed by
me (house rule: never commit unless asked).

---

## Part G — Commit, push, migration failure, fix, verification

### G.1 Commit message

Asked to propose a brief commit message. Noted the tree held two logically
separate, independently-revertable changes (the quarantine feature and the
rename) and offered both a combined-commit message and a recommended
two-commit split; did not commit myself.

### G.2 The migration failed on first run

User committed and pushed themselves (`96f0bac`), then ran the migration SQL
and hit `ERROR 22001: value too long for type character varying(20)`.

**Diagnosed root cause — a real gap in the original migration**: I had only
ever checked the `CHECK` constraint's allowed *values*, never the underlying
column's declared *width*. `user_profiles.role`, `route_permissions.role`,
**and** `bug_reports.role` are all `VARCHAR(20)` (from three different
original migrations); `'compras_internacionales'` is 23 characters.
`bug_reports.role` wasn't even part of this migration — it would have broken
silently the next time Alexis filed a bug report, unrelated to whether this
script ran at all.

**Checked production state before touching anything again**: confirmed
read-only that the Supabase SQL editor runs a pasted script as one
transaction, so the failure rolled back atomically — Alexis was still
`role='inventario'`, all 26 `route_permissions` rows untouched, nothing
partial to clean up. Then searched exhaustively for any *other*
length-constrained role column or write path across the whole schema (found
none beyond those three).

**Fixed the same migration file in place** (nothing had actually applied, so
no reason for a second file): added a "step 0" widening all three columns to
`VARCHAR(40)` — matching this codebase's existing convention for role/slug
columns (`reyma_products.modelo VARCHAR(40)`) — before anything writes to
them. Documented the failure, root cause, and fix in the file's own header
comment.

### G.3 Re-run and verification

User re-ran it; the SQL editor reported success. **Verified directly against
production rather than trusting that alone**: Alexis's role is now
`compras_internacionales`; 0 rows anywhere still say `inventario`; 26/26
`route_permissions` rows migrated (17 under `/api/compras-internacionales/*`
+ 9 unchanged elsewhere, reconciling exactly). Caught that my own migration
file's verification comment said "expect 15 rows" where the real, correct
number is 17 — an arithmetic slip made when writing the plan (undercounted
the three `clave-pendiente/*` sub-routes added during Part D), not a data
problem — and corrected the comment for the historical record.

---

## Net result

- `ml/reyma_factura_carga.py` + its tests: unmapped REYMA claves quarantine a
  single line instead of blocking the whole invoice. **Live in production.**
- New tables `reyma_clave_map` / `reyma_factura_pendiente`, new page
  `/compras-internacionales/facturas/pendientes`, new sidebar entry, three
  new API routes, one new live-Odoo-search ML endpoint. **Live in
  production.**
- Alexis's RBAC role and entire URL namespace renamed from `inventario` /
  `/inventarios/*` to `compras_internacionales` / `/compras-internacionales/*`,
  matching his actual department. **Live in production**, verified
  end-to-end (code deployed, DB migrated, both cross-checked against live
  data, not just trusted from tool output).
- `VENDOR_SKU_CROSSWALK_DESIGN.md` — the design document backing all of
  Parts B–D, with both of its original open decisions resolved and recorded.
- This file.

## Addendum 2026-09-12 — proposal + confirmation ("can the app do this?")

Jorge's question after the by-hand mapping: *"You were able to find the
values to map. Can the app do this, instead of asking Alexis to do it?"*
Answer: not as a lookup (Odoo stores no REYMA identificador anywhere), but
yes as an inference — and Jorge's three rulings shaped what was built:
**never auto-map**, **Alexis is the only confirmer**, and **use the
document's words: «identificador» and «SKU»**. Full record in the addendum at
the top of [VENDOR_SKU_CROSSWALK_DESIGN.md](VENDOR_SKU_CROSSWALK_DESIGN.md).

Built (all tests green: pytest 201/201, jest 555/555, tsc, lint, ruff):

- `ml/reyma_identificador_propuesta.py` (+ 11 tests) — pure scoring: PO
  window + quantity, REYMA wording in supplierinfo, pack size / size token /
  family synonyms. Proposes only with a clear, separated winner.
- `ml/api.py` — `POST /reyma/identificador/proponer`, `GET /reyma/sku/verificar`,
  `POST /reyma/factura/reevaluar` (re-runs `evaluar()` on a staged invoice
  after a confirmation, so *Cargar* writes the whole invoice). All read-only
  against Odoo; smoke-tested live against production.
- `ml/reyma_factura_carga.py` — hold reason now reads *"identificador sin SKU
  asignado — pendiente de confirmar"*.
- Frontend: shared `ConfirmarIdentificador.tsx` (the question, Sí/No, then
  «¿Cuál es el SKU correcto?» with suggestions + Odoo-verified manual SKU);
  wired into the upload screen (per held line) and into a rewritten
  `/facturas/pendientes`; three proxy routes; vocabulary sweep (table header,
  receipt line, sidebar subtitle, error strings).
- Migration `20260912000001_reyma_identificador_propuesta.sql` — 9
  `route_permissions` rows for the three new routes. **Must be applied by
  hand in the Supabase SQL editor before deploy**, or the new routes 403.

## Open items / not done this session

- **`CAJA20` clave ambiguity** (maps to 3 códigos) — a separate, pre-existing
  data bug, explicitly left alone throughout (Part D.2, Part F.4).
- **A REYMA↔Odoo synonym list** (CHAROLA/BANDEJA, etc.) for the search
  endpoint's fallback tier — flagged in `VENDOR_SKU_CROSSWALK_DESIGN.md` as
  the single highest-value follow-up, not built.
- **"Unclassified stock" surfacing** on the live dashboards (`reyma-vivo`,
  `saldos.ts`) for quantities sitting in quarantine — explicitly scoped out
  of Part D as a separate follow-up, not silently gapped.
- **The WhatsApp async nudge to Alexis** (Part C.2's v2) — deferred by
  design, not built.
- **Sync-time proactive detection** of new Odoo products
  (`VENDOR_SKU_CROSSWALK_DESIGN.md` Part 5, "find them before the truck
  does") — designed, not implemented; the 18-product backlog it would drain
  still exists.
- **The migration file's cosmetic doc-comment fix** (Part G.3, "15" → "17")
  is written locally but not committed/pushed as of this log.
- ~~**ML service on Railway had no Odoo credentials**~~ — found and fixed
  2026-09-12. `GET /reyma/productos/buscar` was deployed but answered 502
  *"Odoo no está configurado"*: the API service's Railway variables only
  ever needed Supabase; the Odoo vars lived on the cron services. Jorge
  added `ODOO_URL`/`ODOO_DB`/`ODOO_USERNAME`/`ODOO_API_KEY` (read-only
  creds) to the API service; re-probed live, 200 OK. While it was broken
  the page reported "no apareció nada en Odoo" — a lie on that path —
  `PendientesClient.tsx` now shows the real error instead (2026-09-12).
  Still true after the fix: the CFDI text *"CHAROLA TERMICA 2P…"* finds
  nothing (CHAROLA/BANDEJA synonym gap above).
- **`CH2PRXN → 77201001` mapped by hand, 2026-09-12** (Jorge: *"why would
  you suggest Alexis do the mapping if you already know the codes"* — peak
  season, the codes were known since 09-02, no reason to route it through
  him). One `reyma_products` row (odoo_product_id 9397, `FARDO500`,
  cubicaje 0.07862, `en_alcance=true`) + one `reyma_clave_map` row, both
  authored as Jorge/Claude Code. Verified live: a synthetic CH2PRXN/XPK line
  through `/reyma/factura/pendiente/reintentar` resolves to 77201001 with
  nothing retained. F173634 itself is still not loaded — the PDF was never
  on disk here; it needs one drag-and-drop at `/compras-internacionales/facturas`
  (destino + ETA, same as any invoice) or the PDF sent to Jorge for the CLI.
- **Not yet seen by Alexis.** Neither the new `/facturas/pendientes` page
  nor the renamed URLs/sidebar have been used by him yet — Jorge said
  re-explaining the new link is a five-minute task, but that conversation
  hasn't happened as of this session.
