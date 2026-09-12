# Session log — REYMA identificador→SKU: bug triage, by-hand fix, propose-and-confirm feature

Date: 2026-09-12
Scope: `/compras-internacionales/facturas` (Alexis's upload screen) and `/compras-internacionales/facturas/pendientes`, `ml/reyma_factura_carga.py`, new `ml/reyma_identificador_propuesta.py`, `ml/api.py`, Railway ML service config, production Supabase (`reyma_products`, `reyma_clave_map`, `route_permissions`).
Commits: `8e347c1` (search-error UX fix), `b584db8` (propose-and-confirm feature).
Related prior work: [VENDOR_SKU_CROSSWALK_DESIGN.md](VENDOR_SKU_CROSSWALK_DESIGN.md), [REYMA_QUARANTINE_AND_COMPRAS_INTERNACIONALES_RENAME_SESSION_LOG_2026-09-09.md](REYMA_QUARANTINE_AND_COMPRAS_INTERNACIONALES_RENAME_SESSION_LOG_2026-09-09.md) — this session picks up exactly where that one left off (Alexis's bug report was filed 2026-09-07, two days before that fix shipped).

Six parts, chronological. Each user message in this session moved the target — this is not one continuous build, it's a diagnosis that kept getting corrected by follow-up questions.

---

## Part A — Triaging Alexis's bug report

### A.1 What was handed to me

A bug-report screenshot from `/inventarios/facturas` (Alexis's URL was stale — the 09-09 rename hadn't reached his bookmark): *"F173634 no se puede cargar... G-251-2026 CH2PRXN: sin mapa en reyma_products.clave... No se cargó nada de esta factura."* Reported by Alexis, role `inventario`, 2026-09-07.

### A.2 Diagnosis

Recognized this as the exact incident the 09-09 session had already fixed in principle: an unmapped REYMA identificador. Read `VENDOR_SKU_CROSSWALK_DESIGN.md` and the 09-09 session log first (memory rule: [[check-facts-before-recommending]]) rather than re-deriving from scratch. Confirmed against production (read-only Odoo + Supabase):

- `reyma_clave_map` and `reyma_factura_pendiente` were both **empty** — Alexis had not touched the new quarantine feature yet, because his last upload (G-252, 09-02) predates the 09-09 fix.
- `77201001` was still not in `reyma_products`.
- **New finding, not in the prior session's record**: the ML service's `/reyma/productos/buscar` endpoint — deployed 09-09 — returned 502 *"Odoo no está configurado"*. The API service's Railway environment variables only ever held Supabase secrets; `ODOO_URL`/`ODOO_DB`/`ODOO_USERNAME`/`ODOO_API_KEY` lived only on the separate cron services. Nobody had added them to the API service when the search endpoint was built.
- Worse: on that failure, `PendientesClient.tsx` told Alexis *"No apareció nada en Odoo con ese texto"* — false, Odoo was never actually asked — which risked reproducing the exact same bug report.

### A.3 Fix applied this pass

`PendientesClient.tsx`: distinguished a genuine empty search result from a failed search, surfacing the real error and pointing at the still-working manual código box instead. `tsc`/lint clean. **Decision: report the gap and ask the user to add the Railway variables**, rather than guess at credentials I don't have — I have no Railway CLI access in this environment.

Committed later as part of `8e347c1` together with the session-log update.

---

## Part B — The correction: "why would you suggest Alexis do this?"

### B.1 What happened

After Railway variables were added and the search endpoint verified live, I recommended the standard flow: Alexis re-uploads G-251 and resolves `CH2PRXN` himself on `/facturas/pendientes`, typing `77201001`.

**User's correction:** *"You know Alexis is in the middle of the highest season of the year. WHY would you suggest Alexis to do the mapping if you already know the codes and you can do it yourself?????"*

### B.2 Why this was a real mistake, not just a style note

I already held every fact needed — REYMA's identificador (`CH2PRXN`), the Odoo SKU (`77201001`), the Odoo product ID (`9397`), the UoM (`FARDO500`), the cubicaje (`0.07862`) — all discovered during the original 09-09 diagnosis and re-confirmed this session. Routing a known answer back through a person mid-peak-season is pure friction with no upside. The app exists to remove that friction, not reproduce it. [[odoo-is-read-only-hard-rule]] governs Odoo specifically; it says nothing about Supabase, so there was no actual constraint stopping me — only an unexamined habit of treating "resolve this identificador" as inherently Alexis's job.

### B.3 What I did

Wrote directly to production Supabase (read-only Odoo only, per the hard rule):
- `reyma_products`: inserted `77201001` / `CH2PRXN`, `odoo_product_id=9397`, `uom='FARDO500'`, `cubicaje=0.07862`, `en_alcance=true` (per the 09-09 decision: a confirmed mapping enters the reorder model automatically).
- `reyma_clave_map`: inserted `CH2PRXN → 77201001` with evidence, authored as Jorge/Claude Code.
- **Verified live, not assumed**: replayed a synthetic `CH2PRXN`/`XPK` line through the production `/reyma/factura/pendiente/reintentar` endpoint (the same `evaluar()` the real upload path uses) and confirmed it resolves to `77201001` with nothing retained.

Left undone and said so explicitly: F173634 itself was never loaded, because the PDF was never on disk in this session — that genuinely needed Alexis (or a forwarded PDF).

### B.4 What I saved for next time

Wrote a new memory, [[do-known-data-fixes-yourself]]: when I hold every value a data fix needs, write it and verify it — Supabase writes are fine, only Odoo is read-only — instead of assigning the work back to Alexis or Wilmer as a to-do. Peak season makes this non-optional, not just nice-to-have.

---

## Part C — "Can the app do this?"

### C.1 The question

*"You were able to find the values to map. Can the app do this, instead of asking Alexis to do it?"*

### C.2 Research: why it can't be a lookup

Checked whether Odoo stores REYMA's identificador anywhere a query could hit directly. It does not: `product.supplierinfo.product_code` — the field a vendor SKU belongs in — is literally the string `"0"` on every one of REYMA's 116 rows that has a value there, and empty on the rest. Nothing in Odoo says "CH2PRXN". So any automated match has to be **inferred**, not looked up.

Identified three real signals, in order of strength, checked against production data:
1. **Purchase orders.** A REYMA product on a confirmed Odoo PO within the invoice's date window, not yet in the app's map, is very likely the product on an unmapped invoice line. For 77201001: PO-P-3025, 25-ago, 1,414 FARDO500 — six days before the invoice, matching quantity.
2. **REYMA's own wording in Odoo** (`supplierinfo.product_name`) — present on 44/116 REYMA supplier rows. This alone had already solved the August precedent by hand (`CN9X9D4PXN` → supplierinfo *"CONTENEDOR TERMICO 9X9-D"* → `77201025`).
3. **Description structure** — pack size, size token, product-family synonyms (CHAROLA≡BANDEJA, CONTENEDOR≡PORTACOMIDA, etc.) between the CFDI text and Odoo's product name.

### C.3 Proposal made, and the guardrail I set myself

Proposed a three-way policy (auto-map on strong agreement / queue for review / never auto-map on weak signal alone), explicitly modeling it on the Fellegi-Sunter three-way match decision already discussed in `VENDOR_SKU_CROSSWALK_DESIGN.md`. Queue destination: originally proposed **me (Jorge)**, reasoning that a wrong auto-map silently corrupts stock and money.

This proposal was overridden in full by the next message — see Part D.

---

## Part D — Three hard rules from the user, before building anything

### D.1 The correction

> "Your spanish is terrible. 'se mapeó sola: CH2PRXN → 77201001' is incomprehensible. Say: 'Por favor confirme que el código CH2PRXN corresponde al SKU 77201001' and if the answer is NO, then ask: '¿Cuál es el SKU correcto?' Never auto-map without human confirmation. Queue must not go to me, I don't know any codes. Alexis is the only authoritative source for confirmation. Before making any actions, ask clarifying questions if necessary."

Three rulings, all binding on the design from this point on:
1. **Never auto-map, under any confidence.** Overrides my Part C proposal entirely — there is no "strong enough to skip confirmation" tier.
2. **Alexis is the only confirmer.** Not Jorge, not gerencia. My Part C instinct (route the queue to the user as a safety net) was based on a wrong assumption — the user does not have the domain knowledge to confirm these mappings; only Alexis does.
3. **Exact wording**, verbatim, for the question.

### D.2 Clarifying questions asked, per instruction

Used `AskUserQuestion` before writing code, because the answers would materially change scope:
- **Where does Alexis see the question?** → Both the upload screen and `/facturas/pendientes`, upload screen first (chosen: recommended option — lets a one-click confirmation load the invoice immediately at the point Alexis is already looking at it, while still degrading gracefully to the existing pendientes page if skipped).
- **What happens with multiple plausible SKUs?** → Ask about the best one, then fall back to "¿Cuál es el SKU correcto?" with the others as suggestions (chosen: recommended — avoids picking an answer for Alexis when the app itself isn't sure, but avoids a bare unranked list when it does have a clear top guess).
- **Vocabulary: "código" vs "clave"?** → I asked which word to use for REYMA's own code. **User's answer redirected the question itself**: *"I know 77201001 is SKU. Where did you get 'clave' from?"* — meaning "clave" wasn't the user's word at all; I had introduced it from the DB schema and needed to trace its origin before answering.

### D.3 Tracing "clave" — and finding it was my own naming error

Grepped the migration history: `reyma_products.clave` was named in the `20260805000001_reyma_schema.sql` migration comment as *"clave proveedor Reyma (xlsx col B)"* — i.e., I (in an earlier session) had named that database column myself when building the original Alexis-replica sync, based on a spreadsheet column header, not on anything Alexis or REYMA calls it. Checked REYMA's actual CFDI document format (`ml/reyma_factura_extract.py`): the column there is **identificador**, and on that same document "clave" means something else entirely — the 8-digit *clave SAT* (a Mexican tax authority code), a completely unrelated field. So the app's existing vocabulary was wrong on two counts: it used a word that wasn't REYMA's, and that word collided with a real field meaning something else on the same document.

Reported this to the user rather than silently picking a word.

### D.4 Final ruling

*"Stick to the document's nomenclature, if Reyma's document says 'identificador', the app should follow suite and say 'identificador' to prevent any ambiguity or confusion. Green light on everything else. Build."*

Locked vocabulary: **identificador** = REYMA's code (CH2PRXN), **SKU** = ours (77201001), everywhere Alexis reads text. Database column names (`reyma_products.clave`, `reyma_clave_map.clave`) were deliberately left unchanged — renaming them touches the hourly sync, the CLI backfill script, tests, and live production data for zero user-facing benefit, since Alexis never sees a column name.

---

## Part E — Building the propose-and-confirm feature

### E.1 Read-before-write

Before touching anything, read the full existing invoice-upload flow end to end: `FacturasClient.tsx`, `extraer`/`cargar` API routes, `reyma_factura_carga.py`'s `evaluar()`, `_mapas_reyma()`, the `pendientes` page and its `resolver` route, and the `route_permissions` matrix pattern used for prior REYMA routes. Design principle already established in this codebase (09-09 session, restated here because the new code follows it): **one evaluation rule, never two implementations** — Python `evaluar()` stays the single source of truth for what a line converts to; TypeScript never re-derives it.

### E.2 The inference module — `ml/reyma_identificador_propuesta.py`

Pure, no I/O, unit-tested independent of Odoo. Scores every REYMA product Odoo knows about against a CFDI line's description, using the three signals from Part C:

- **PO signal**: `purchase.order.line` for partner 23188 (REYMA) within a 90-day-before/7-day-after window of the invoice date; a quantity match adds more weight. This is the signal that shrinks the search — most invoices will have zero or one plausible new-product PO in that window, not REYMA's full ~120-product catalogue.
- **Vendor-wording signal**: `supplierinfo.product_name` containment against the CFDI description, requiring at least 2 significant (non-brand) tokens to match — tuned during testing after the first pass wrongly rejected `"CONTENEDOR TERMICO 9X9-D"` for being "too short" against a single-letter-suffix false negative.
- **Structural signal**: custom parsers for pack size (`1 PAQ/500` ↔ `1/500`), size tokens (`2P`, `9X9`, `16OZ`), and a REYMA↔Odoo product-family synonym table (CHAROLA≡BANDEJA≡PLATO, CONTENEDOR≡PORTACOMIDA≡HAMBURGUESERA, etc.), built from REYMA's 44 supplierinfo rows that carry vendor wording.

**Design decision — threshold + separation, not top-score-wins**: `proponer()` only returns a `propuesta` when the best candidate clears an absolute score threshold **and** is separated from the runner-up by a minimum margin. A close call between two candidates (tested explicitly: two SKUs with identical scores) returns no proposal at all, only both as suggestions — because Rule D.1 ("never auto-map") extends naturally to "never even suggest with false confidence" when the app itself can't tell two products apart.

**Tests** (`ml/tests/test_reyma_identificador_propuesta.py`, 11 cases): both real incidents (F173634/CH2PRXN → 77201001, August precedent CN9X9D4PXN → 77201025) reproduced from real production Odoo names and real REYMA CFDI description text, plus the ambiguous-tie case, an empaque mismatch penalty case, and a case penalizing a SKU already mapped to a different identificador (guards against double-mapping under the append-only `reyma_clave_map` convention).

### E.3 ML API — three new read-only endpoints in `ml/api.py`

- `POST /reyma/identificador/proponer` — runs the inference against live Odoo, returns `{propuesta, otras, ya_asignado}`. Short-circuits immediately if the identificador is already mapped (covers the race where two furgones carry the same new identificador in the same week).
- `GET /reyma/sku/verificar` — looks up a SKU Alexis types by hand, returns its Odoo name, whether it's genuinely a REYMA product, whether it's active, and whether it's already claimed by another identificador — all surfaced to Alexis *before* he confirms, per Rule D.1's spirit (never let him confirm blind).
- `POST /reyma/factura/reevaluar` — re-runs the *same* `evaluar()` against an already-staged invoice after Alexis confirms an identificador mid-upload, so the invoice can load whole in one action instead of needing a second PDF upload.

All three: read-only against Odoo, fail loud with 502 rather than falling back to a guess, and were smoke-tested live against production before being called done (evidence in Part F).

### E.4 Frontend — one shared confirmation component

Built `ConfirmarIdentificador.tsx` once and used it in both places (upload screen, pendientes page) rather than duplicating the question — the same reuse principle the backend already follows. States: fetching a proposal → showing the exact-wording question with Sí/No → (on No) "¿Cuál es el SKU correcto?" with suggestions and a manual box that verifies against Odoo before allowing confirmation → writing the mapping only after a human click.

Rewired the upload screen (`FacturasClient.tsx`) so a held line shows the confirmation inline, and a Sí/manual-confirm triggers `reevaluar` before `Cargar` — meaning the invoice can now load complete in one visit if Alexis confirms in the moment, not just via the separate pendientes page. Rewrote `PendientesClient.tsx` around the same shared component rather than its old bespoke search UI.

### E.5 Vocabulary sweep

Went beyond the two screens that prompted the question and swept every place Alexis reads "clave" or "código" in this flow: the line-items table header, the post-upload receipt line, the sidebar subtitle, and every user-facing error string in `cargar/route.ts` and `resolver/route.ts`. Left `ml/reyma_factura_carga.py`'s internal hold-reason text updated to match (*"identificador sin SKU asignado — pendiente de confirmar"*, was *"sin mapa en reyma_products.clave"*) since that string reaches the screen verbatim.

### E.6 Migration

`20260912000001_reyma_identificador_propuesta.sql` — no new tables, only 9 `route_permissions` rows (3 new routes × the existing `compras_internacionales`/`gerencia`/`admin` trio), following the exact pattern of the 09-09 migration. Applied by hand in the Supabase SQL editor per this project's standing practice ([[migrations-applied-by-hand-history-drifts]]).

---

## Part F — Verification

Before calling anything done: `ml` — pytest 201/201 (39 in the two touched files), ruff clean. `frontend` — `tsc --noEmit` clean, `next lint` clean, jest 555/555.

Then, because passing tests against fixtures isn't the same as working code ([[xlsx-verify-with-openpyxl]] extends to: an independent runtime check beats trusting your own test suite), smoke-tested against live production, read-only, twice — once locally via `api.app.test_client()` before deploy, and again after the user pushed and Railway redeployed:

- `proponer` on the F173634 case: 74 Odoo candidates evaluated → proposes 77201001 via PO-P-3025, score 90.
- `proponer` on the August precedent: proposes 77201025 via PO-P-2884 + REYMA's own wording, score 135, with the sibling "9x9 LISO" product correctly scored lower as runner-up.
- `verificar` on 77201001 (exists, REYMA product, already assigned to CH2PRXN) and on a nonexistent SKU (404).
- `reevaluar` replaying the F173634 line end-to-end: resolves to 77201001 × 1,414 units, nothing retained.

After the user applied the migration in the Supabase SQL editor, independently re-queried `route_permissions` via the REST API (not just trusting the SQL editor's own success message) and confirmed the same 9 rows, 3 roles, correct methods.

---

## Net result

- **Bug fixed twice over**: F173634's `CH2PRXN`/`77201001` mapping exists in production now (written by hand, Part B); going forward, any *new* REYMA identificador gets a proposed SKU instead of forcing Alexis to look it up during peak season.
- **Nothing auto-maps.** Every mapping still requires Alexis's explicit Sí, or his typed-and-Odoo-verified SKU after No. No queue reaches Jorge or gerencia.
- **Vocabulary now matches REYMA's own document** everywhere Alexis reads it — a genuine bug (I had invented "clave" from a spreadsheet column, and it collided with clave SAT on the real document) that predated this session and would have kept causing exactly this kind of confusion.
- `ml/reyma_identificador_propuesta.py` + 11 tests, `ml/api.py` (+3 endpoints), 3 new Next.js proxy routes, 1 shared confirmation component, 1 migration (9 permission rows) — all live in production as of commit `b584db8`.
- Two new memories saved: [[do-known-data-fixes-yourself]] and (pointed at from there) reinforcement of [[odoo-is-read-only-hard-rule]] as the actual boundary — Supabase writes were never off-limits.

## Open items / not done this session

- **Sync-time proactive detection** (flagged since the 09-09 log, Part 5 of the design doc) — still not built. The PO signal in the new `proponer()` endpoint makes this less urgent (a new product now gets a strong proposal reactively, at invoice time), but detecting it before the truck arrives is still undone.
- **F173634's PDF itself** — the mapping row exists, but nobody has re-uploaded the actual PDF in this session; it needs one drag-and-drop from Alexis (now a no-op confirmation, since the identificador is already mapped) or a forwarded copy for the CLI backfill.
- **WhatsApp async nudge to Alexis** (from the 09-09 log) — still deferred by design, not built.
