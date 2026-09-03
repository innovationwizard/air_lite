# Vendor SKU → Suplicentro código: crosswalk design

**Status:** proposal. Nothing here is built. Two decisions at the end are the client's, not mine.
**Author:** Claude, 2026-09-02. Triggered by Alexis' bug report on `/inventarios/facturas` (2026-09-01) and his correction of 2026-09-02 ("ya existen en Odoo" — he was right).
**Scope:** the mapping from a vendor's own SKU/description to our Odoo `default_code`, for REYMA first and every other vendor model after it.

---

## 1. The incident, in one paragraph

Invoice F173634 carried REYMA clave `CH2PRXN` = *"CHAROLA TERMICA 2P REYMA 1 PAQ/500 PZAS"*. The upload rejected the **entire invoice**, because an unmapped clave is classified as an invoice-level error ([reyma_factura_carga.py:33-42](ml/reyma_factura_carga.py#L33-L42), enforced at [:196-199](ml/reyma_factura_carga.py#L196-L199)). The product does exist in Odoo — `product.product` 9397, `default_code` **77201001**, *"BANDEJA TERMICA NO.2P BLANCA 1/500"*, created 2026-07-31, already linked to partner 23188 (PLASTICOS ADHERIBLES DEL BAJIO = REYMA) via `product.supplierinfo` 10012, with a 1,300-unit PO from 25-ago. It is simply not in `reyma_products`, and no code path can ever put it there.

That is not a bug in the matching rule. It is a missing subsystem.

---

## 2. What kind of problem this actually is

This is **record linkage / entity resolution** between two catalogues that share no key, specialised into its narrowest form: a **crosswalk** — a one-way value mapping from a source code list (REYMA's claves) to a target code list (our códigos), maintained by a human steward with provenance. That is the exact term the MDM literature uses, and the exact artifact Informatica Reference 360 and TopBraid EDG ship as a first-class object.

Four properties make our instance unusual, and they should drive every design choice:

| Property | Measured value | Consequence for the design |
|---|---|---|
| **Tiny cardinality** | 71 REYMA códigos in Odoo, 55 in our model, ~1,600 products total | Compute is free. Scalability is a non-issue. Anything justified by "it scales" is justified by nothing. |
| **Event-driven arrival** | New clave surfaces the instant a truck's invoice is uploaded | Resolution must be possible *in the upload flow, in seconds*, not in a back-office batch. |
| **Extreme cost asymmetry** | A wrong map silently corrupts stock, fill rate, reorder points and money. A missing map is loudly visible. | **Precision ≫ recall.** Never auto-commit a guess. A three-way decision is mandatory. |
| **Read-only source of truth** | Odoo is read-only by CEO rule; creds enforce it (verified: `product.template` write → Fault 4) | The map must live in our DB and survive every Odoo re-sync. |

And one more, which is the real finding: **the map is a business decision, not a computed value.** Two humans looking at "CHAROLA TERMICA 2P" and "BANDEJA TERMICA NO.2P BLANCA 1/500" have to agree these are the same thing. A decision needs an author, a timestamp, evidence, and a way to be reversed. A derived value needs none of those. The current design treats it as a derived value.

---

## 3. Measured state of the map today (2026-09-02, production, read-only)

| Fact | Value |
|---|---|
| REYMA supplier catalogue in Odoo (`product.supplierinfo`, partner 23188) | 116 rows → 75 templates → **71 distinct `default_code`, all active** |
| `reyma_products` where `modelo='reyma'` | **55** |
| Active REYMA códigos in Odoo **missing** from `reyma_products` | **18** |
| Of those 18 | includes `77201001` (today's blocked invoice) and `77201025` (the August precedent, still unmapped) |
| Non-null `clave` values in `reyma_products` | 55 rows, **53 distinct** |
| Ambiguous claves | `CAJA20` → 3 códigos (77206352, 77206353, 77206354) |
| Claves that are not vendor SKUs at all | `CAJA20`, `FARDO10` — these are **units of measure** that landed in the clave column during the July xlsx seed |
| Vendor SKU stored anywhere in Odoo | **Nowhere.** `product_code` is `false` or `"0"` on all 116 supplierinfo rows. |
| Vendor *description* stored in Odoo | **44 of 116** supplierinfo rows carry `product_name` = REYMA's own wording |

Read the third row again: **18 known landmines are sitting in production right now.** Under today's rules each one is a future truck whose invoice will not load, discovered at the worst possible moment. This is not a hypothetical risk; it is a queue with 18 items in it.

Read the last two rows together: the vendor's SKU has no home in Odoo, so the map genuinely has to be ours — but the vendor's *description* is already there for 44 products, and we have never read it. That is a free tier-1 signal we are leaving on the table. Cross-check: supplierinfo 7928 says *"CONTENEDOR TERMICO 9X9-D"* → 77201025, which is exactly the mapping a human decided by hand in August for clave `CN9X9D4PXN`. The rule would have gotten it right unaided.

---

## 4. Principles, and where they come from

**4.1 Three-way decision, not two.** Fellegi–Sunter's 1969 formulation — still the backbone of Splink and every serious linkage tool — does not output match/non-match. It outputs **match / non-match / possible-match**, where the middle band is routed to *clerical review* by design. The consensus practice built on top is confidence-banded routing: auto-accept above a threshold, auto-reject below, human review in between. Our current system has no middle band at all: it is match-or-hard-stop, which is why a single unknown clave destroys an eleven-line invoice.

**4.2 Blocking/candidate generation is a separate step from scoring.** Standard linkage splits "which pairs are worth comparing" from "is this pair a match". At 71×1,600 we do not need blocking for performance — but the *discipline* is still worth keeping, because it forces the evidence sources to be named and ranked explicitly rather than mushed into one similarity score.

**4.3 The crosswalk is an object with a lifecycle, not a column.** Reference-data tooling models crosswalks as versioned, audited artifacts with a complete change trail. The equivalent warehouse pattern is SCD Type 2 / bitemporal: never destroy a prior mapping, because a report run in August must remain reconstructible after a September correction. If you overwrite the map, your fill-rate history silently restates itself and nobody finds out.

**4.4 Rejections are data.** A human saying "no, those two are not the same" is as valuable as a confirmation and must be persisted, or the engine re-proposes the known-wrong pair forever.

**4.5 This repo already solved this problem once.** [`reyma_factura_match`](supabase/migrations/20260820000003_reyma_factura_match.sql) links PDF invoices to Odoo vendor bills with: append-only history, last-row-wins per pair, a tier ladder (0 = human, 1 = strong evidence, 2 = corroborating evidence), the rule that fired, an `evidencia JSONB` snapshot, an author, and `estado ∈ {auto, confirmado, rechazado}`. Its header states the reasoning verbatim: *"el enlace es un HECHO con procedencia … no un resultado de pantalla"* — the link is a fact with provenance, not a screen result — and lists the three things persistence buys: auditable trail, human override, and a stable exception queue. **That is this design.** The correct move is to reuse the proven local convention, not to import a new one.

---

## 5. Proposed design

Five parts. Parts 1–3 are the minimum that fixes the class of bug; parts 4–5 are what stop it recurring.

### Part 1 — A dedicated crosswalk table

`reyma_products.clave` is doing two incompatible jobs: it is an *attribute* of a product ("REYMA calls this CH105XN") and it is *the map*. As one nullable column on a master table it cannot express: more than one clave per código (vendors rename), a clave whose código is undecided, a rejected pair, who decided, when, or on what evidence. The measured pollution (`CAJA20` → 3 códigos; two UoM strings sitting in a SKU column) is the predictable result.

Split it out. Sketch, following the conventions of `reyma_factura_match` and `reyma_conversion_bulto`:

```sql
CREATE TABLE IF NOT EXISTS vendor_clave_map (
  id          UUID PRIMARY KEY DEFAULT uuidv7(),
  proveedor   VARCHAR(20)  NOT NULL,        -- 'reyma' | 'carvajal' | 'darnel' | 'asia'
  clave       VARCHAR(60)  NOT NULL,        -- the vendor's SKU, verbatim from the CFDI
  descripcion VARCHAR(300) NOT NULL,        -- the vendor's description, verbatim
  codigo      VARCHAR(20),                  -- our default_code; NULL = decided "no match yet"
  tier        SMALLINT NOT NULL CHECK (tier BETWEEN 0 AND 4),
  regla       VARCHAR(120) NOT NULL,        -- which rule produced it
  estado      VARCHAR(12)  NOT NULL
              CHECK (estado IN ('propuesto', 'confirmado', 'rechazado')),
  evidencia   JSONB NOT NULL,               -- what was compared, verbatim, at decision time
  autor       VARCHAR(500) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Append-only; the newest row per `(proveedor, clave, codigo)` wins; nothing is ever UPDATEd or DELETEd. Same posture as the four tables already doing this (`reyma_eta_config`, `reyma_nc_config`, the overrides, `reyma_factura_match`). RLS: `service_role` only, matching every `reyma_*` table.

Three consequences worth stating explicitly:

- **`proveedor` from day one.** Carvajal, Darnel and Asia models already ship. They will hit this identical wall. One table, one UI, one queue.
- **Mapping ≠ scope, by default — but decided otherwise.** Putting `CH2PRXN → 77201001` in the crosswalk says "these are the same product". Whether that also means "include this product in Alexis' reorder model" was open decision #1; **resolved 2026-09-02 (Jorge): yes, a confirmed crosswalk row sets `reyma_products.en_alcance = true` automatically.** A newly discovered REYMA product enters the reorder model the moment a human confirms the mapping — no separate scoping step. (This does raise the model's universe past the frozen 55 every time a product is confirmed; that's the intended effect, not a side effect.)
- **The clave column on `reyma_products` stays** as the human-readable attribute it was seeded as, or gets backfilled from the crosswalk. Either way the *reader* ([api.py:416-419](ml/api.py#L416-L419), [load_reyma_facturas_pdf.py:59-71](scripts/load_reyma_facturas_pdf.py#L59-L71)) switches to the crosswalk, in both implementations, at the same time — that module exists precisely so there is one set of rules with two callers.

### Part 2 — A candidate generator that proposes and never commits

A tier ladder, ordered by strength of evidence. Every tier's output is a `propuesto` row; nothing is applied without a decision.

| Tier | Signal | Source | Strength |
|---|---|---|---|
| **1** | Vendor description matches `product.supplierinfo.product_name` for that partner (normalised) | Odoo, 44 rows populated today | **Evidence.** Deterministic. Would have resolved the August precedent unaided. |
| **2** | Co-occurrence: the invoice cites a pedido; the corresponding Odoo PO for that partner contains a line whose product, quantity and price agree | Odoo `purchase.order.line` | **Evidence.** Transactional, not textual. Strongest available signal, and it is the one Alexis reasons with. |
| **3** | Structured attribute agreement on the normalised description: family, number, pack ratio, material/colour | Both sides | Similarity. Review only. |
| **4** | Fuzzy string similarity over the normalised description | Both sides | Similarity. Ranking only. Never applied. |

Tiers 1–2 are **evidence**; tiers 3–4 are **resemblance**. Only evidence tiers should ever be eligible for auto-apply, and whether they are at all is a policy switch the business owns — the safe default is that everything gets a human click until the acceptance rate (§7) earns the trust.

On tier 3, the normalisation matters more than the algorithm. This catalogue's discriminating attributes are known and few:

- **Family synonyms:** REYMA says CHAROLA, Odoo says BANDEJA. REYMA says CONTENEDOR, Odoo says PORTACOMIDA. This is a hand-kept synonym list of maybe fifteen pairs, and it is the single highest-value artifact in the whole design — it is precisely what I got wrong on 2026-09-01 when I searched Odoo for "CHAROLA", found nothing, and told Alexis the product did not exist.
- **Pack ratio is the highest-information attribute** and is present on both sides in different notation: `1 PAQ/500 PZAS` ↔ `1/500` ↔ UoM `FARDO500`. Extract and compare it as a number pair, not as a string.
- **Model number:** `2P`, `4P`, `105`, `855`, `9X9`, `8H`.
- Uppercase, strip accents, collapse whitespace before any of it.

### Part 3 — Quarantine the line, never the invoice

Today an unmapped clave is an invoice-level `error`: F173634's other lines were discarded along with the unknown one. **RESOLVED 2026-09-02:** this is rejected outright, for a reason specific to peak season — new SKUs cluster exactly when Alexis has the least slack to handle a broken upload, and [saldos.ts:1-17](frontend/src/app/(authenticated)/inventarios/reyma-vivo/saldos.ts#L1-L17) exists *because* PDF ingestion leads Odoo's own bookkeeping by days; blocking 10 good lines over 1 unknown one throws away the one thing this feature is for, at the moment it's worth the most.

The fix is not "hold the one bad line and show Alexis a queue" — that still makes the exception his problem, mid-truck. The fix is a **quarantine lane**: the standard warehouse-receiving pattern for exactly this situation — record the actual receipt immediately, segregate anything abnormal from usable/planning stock, and never let it block or contaminate the rest of the receipt. [(Hopstack; Mintsoft — warehouse receiving best practices)](https://www.hopstack.io/blog/improve-the-warehouse-receiving-process)

- **Every line posts, always.** Known lines write to `reyma_facturas_pdf` normally. `CH2PRXN` also writes immediately — `cantidad_cfdi` and `importe` preserved verbatim — but tagged to a placeholder, not a real `codigo`, and excluded from `facturado`-por-código (§ saldos.ts) until resolved. It is never invisible: "on-hand, unclassified" is a real, visible bucket, not a silent drop and not a block.
- **Alexis sees "cargada."** No error screen, no "no se cargó nada de esta factura." A small non-blocking badge — *1 producto nuevo, en revisión* — and he moves to the next truck. This is the optimistic-UI pattern: act immediately, surface the exception without gating on it, correct later. [(NN/g — User Control and Freedom)](https://www.nngroup.com/articles/user-control-and-freedom/)
- **High-confidence proposals apply provisionally, not silently.** A tier-1/2 hit (§ Part 2) can tentatively assign the código right away — labeled, reversible, still excluded from `en_alcance` until a human confirms — rather than waiting on anyone to click.
- **Reconciliation only ever sees complete invoices.** `reyma_factura_match` tier 2 compares total amount + line composition + date; a quarantined line's amount stays out of "facturado" but the invoice's own recorded total still includes it, so reconciliation isn't fed a partial number. (This is the one piece of bookkeeping discipline this design still needs, whichever way the line is held — just no longer a reason to block the invoice itself.)

This still changes what a "fully classified" invoice means and interacts with the frozen precedent ([test_reyma_factura_carga.py:285-292](ml/tests/test_reyma_factura_carga.py#L285-L292), `_CARGADA_A_MANO`) — that row can now retire once its código exists, rather than staying a permanent hand-loaded exception.

### Part 4 — Resolution: not Alexis' problem, unless only he can answer it

**RESOLVED 2026-09-02 — the real UX fix is routing, not a nicer screen.** The steward doesn't have to be the person holding the invoice mid-truck. Route resolution to whoever isn't time-pressured (Jorge / gerencia), using infrastructure that already exists and is already proven: [`bug_reports`](supabase/migrations/20260810000001_bug_reports.sql) — persist-first, then a Resend email — is the exact channel that delivered Alexis' own bug report that started this. Zero new dependency, no F8 (desktop-responsiveness) blocker, because nobody has to open the app on a phone to act on it.

- The moment a line quarantines, one email fires to Jorge/gerencia: the CFDI line verbatim (clave, description, quantity, unit, amount) plus the top 3–5 candidates, each with the *evidence in plain language*, not a score — "REYMA le llama así en Odoo" (REYMA's own name for it, in Odoo) · "vino en el mismo pedido PO-P-3025" (same purchase order) · "1/500 coincide" (pack ratio agrees). One-click confirm per candidate.
- **"Ninguno de estos"** (none of these) is a real outcome and gets a row — `codigo = NULL`, `estado = 'confirmado'`. It means "a human looked, and the answer isn't in Odoo yet," genuinely different from "nobody has looked."
- Rejections get rows too, exactly as `reyma_factura_match.estado='rechazado'` already works — a rejected pair is vetoed for good.
- **Resolve once, fixes the backlog.** The append-only, last-row-wins crosswalk means every quarantined line with that clave — across every invoice uploaded since, potentially several trucks in the same peak-season week — reclassifies in one shot. Alexis is interrupted at most once per new product, ever.
- Show a confidence *band*, never a bare number. A "0.83" invites deference to the machine; "REYMA calls it this in Odoo" invites the reader to check the claim.

Alexis only enters this loop if nobody else can answer — e.g. he's the one who spoke to the driver and might recognize the product. For that, a strictly optional, asynchronous nudge in the channel he already uses (WhatsApp: *"¿CH2PRXN de REYMA es lo mismo que 77201001 BANDEJA TERMICA NO.2P BLANCA 1/500?"* [Sí] [No] [No sé]) answerable whenever, no login, no desktop. This needs a WhatsApp Business API integration the repo doesn't have today — real added cost, so treat it as a v2 enhancement once the email-to-Jorge path is proven, not a launch blocker.

### Part 5 — Find them before the truck does

This is the part that actually retires the bug class. `load_or_seed_products` ([odoo_sync_reyma.py:248-269](ml/odoo_sync_reyma.py#L248-L269)) seeds `reyma_products` **only when the table is empty** and thereafter refreshes fields on existing rows only. The catalogue has been frozen at the July xlsx since day one; 77201001 was created in Odoo on 31-jul and could never have entered by any path.

The sync already runs against Odoo and already has an issue channel with severity and `odoo_id` (`sync_issues`; the module's own header commits to *"anomalies land in sync_issues … an empty issue list is evidence"*). Add one check to it: enumerate `product.supplierinfo` for the vendor's partner, diff against `reyma_products`, and raise one issue per product we don't know about — with the tier-1/2 proposal already attached. **That check would report 18 products today**, including both the one that blocked Alexis and the one that blocked him in August.

Not automatic inclusion — automatic *notification*, with a one-click accept. This is the standard data-contract posture for schema/domain drift: unknown values are surfaced loudly, never silently dropped and never silently accepted.

---

## 6. What NOT to build, and why

**No ML model. No LLM matcher.** This is the recommendation I expect to be argued with, so here is the evidence:

- **The volume doesn't support it.** ~1 new clave per month against 71 vendor products. There is no training set, and there never will be one.
- **A published head-to-head says it wouldn't help.** On the standard Abt-Buy entity-matching benchmark (2,194 labelled pairs), a *simple rule-based baseline* scored **F1 0.950** against **0.948** for LLM zero-shot prompting. Where LLMs did win was on pairs with low lexical overlap but clear semantic equivalence — abbreviated or reformatted SKU strings. That is genuinely our CHAROLA/BANDEJA case, and it is worth being honest about. But it is also exactly what the tier-1 supplierinfo lookup and a fifteen-pair synonym list solve deterministically, auditably, and for free.
- **The error profile is backwards for us.** Across studies, LLMs show *much higher recall than precision* — they are prone to assert a match to avoid returning nothing. Our cost function is the opposite: a false match silently corrupts stock, fill rate and money; a missed match is visible and cheap. An eager matcher is the single worst failure mode available here.
- **Deep entity-matching models (Ditto and successors) need labelled pairs and are brittle on unseen entities** — and unseen entities are the *only* case this system exists to handle.
- **A learned score cannot be audited.** Every mapping here has to survive the question "why is this product in the reorder model?" A tier and a rule name answer it. A cosine similarity does not.

If an LLM ever earns a place here it is as a **tier-4 ranker of the review list** — ordering candidates a human is about to choose between — never as a writer of rows. Note also that this repo has no LLM dependency today; adding one for this would be a new production surface for a problem that a lookup table solves.

**No fuzzy auto-apply, ever.** Similarity ranks; it never writes.

**No storing the map in Odoo.** Read-only by CEO rule, and there is no field for it anyway — `product_code` is empty on all 116 supplierinfo rows.

**No mutating UPDATEs.** Append-only, last-row-wins, per the four existing precedents. The August map must stay reconstructible after a September correction.

**No new matching framework.** Splink and friends are the right tools at millions of rows with probabilistic weights to learn. At 71 rows they are a dependency with no payoff. Take the *idea* — three-way decision, tiered evidence, clerical review — and skip the machinery.

---

## 7. How to know it's working

All of these are free once proposals are logged as rows:

| Metric | Why |
|---|---|
| Unmapped-clave rate per invoice | The headline. Should trend to zero as part 5 drains the backlog. |
| Time from held line → decision | If this is not seconds, the UI failed (see F8). |
| **Acceptance rate per tier** | The real precision measure. A tier whose proposals get rejected should be demoted or retired. |
| Rejections per tier | Same signal, early. |
| Vendor products in Odoo not in scope | **18 today.** Should be a burn-down, visible on the status page. |
| Invoices held with a pending line, by age | Prevents "held" from becoming a place where invoices quietly die. |

---

## 8. Rollout

1. **Unblock Alexis now, by hand** — one row, `77201001` / `CH2PRXN`, `odoo_product_id=9397`, `uom='FARDO500'`, `cubicaje=0.07862`. Units already work: the invoice bills XPK and [reyma_factura_carga.py:52](ml/reyma_factura_carga.py#L52) treats XPK ≡ Fardo 1:1 against Odoo's purchase UoM, which is FARDO500 here. This does not wait on the design.
2. **Table + backfill.** Seed the crosswalk with the 53 usable existing claves as tier-0 `confirmado` (author: the July xlsx), plus the 44 supplierinfo descriptions as tier-1. Quarantine `CAJA20`/`FARDO10` rather than importing them — they are UoM strings, not SKUs.
3. **Switch the readers** ([api.py:416-419](ml/api.py#L416-L419) and [load_reyma_facturas_pdf.py:59-71](scripts/load_reyma_facturas_pdf.py#L59-L71)) to the crosswalk, and prove the 175 production rows still reproduce exactly — that regression is the whole reason `reyma_factura_carga.py` exists as a shared module, and it is the gate for this step.
4. **Sync check + issues** (part 5). Drains the 18 immediately, before any UI work.
5. **Held-line behaviour** (part 3) — only after open decision #2.
6. **Resolution UI** (part 4) — and it needs F8 fixed to deliver what it promises.

Steps 1, 2 and 4 are independently valuable and carry no behaviour change. Step 4 alone would have prevented both this incident and August's.

---

## 9. Open decisions — client's, not mine

1. ~~Does mapping a clave imply putting the product in the model?~~ **RESOLVED 2026-09-02 (Jorge): yes — `en_alcance = true`.** Confirming a crosswalk mapping is the same act as adding the product to Alexis' reorder model; there is no separate scoping step. The trade-off flagged above (a clerical mapping fix changes tomorrow's purchase suggestion) is accepted as intended behavior.
2. ~~Held line vs whole-invoice stop.~~ **RESOLVED 2026-09-02: quarantine the line, never the invoice** (Part 3) — rejected "stop the invoice" outright given peak-season timing, and refined "hold the line" so the resolution UI is never Alexis' problem in the first place (Part 4): routed to Jorge/gerencia via the existing bug-report/Resend channel, with an optional async WhatsApp path for Alexis reserved as a v2 enhancement.

---

## Sources

Peak-season UX for exception handling (2026-09-03 addendum):
- [Warehouse Receiving Process: Steps, Best Practices — Hopstack](https://www.hopstack.io/blog/improve-the-warehouse-receiving-process) — quarantine-lane pattern for receiving exceptions
- [Warehouse Receiving: Processes & Best Practice — Mintsoft](https://www.mintsoft.com/warehouse-management/warehouse-receiving-processes-best-practice/)
- [User Control and Freedom (Usability Heuristic #3) — NN/g](https://www.nngroup.com/articles/user-control-and-freedom/) — optimistic UI / act-then-correct pattern

Entity resolution and human-in-the-loop practice:
- [What is entity resolution? Use cases and best practices — RudderStack](https://www.rudderstack.com/blog/what-is-entity-resolution/)
- [A guide to entity resolution tools for enterprise data projects — Data Ladder](https://dataladder.com/a-guide-to-entity-resolution-tools-for-enterprise-data-projects/)
- [CrowdER: Crowdsourcing Entity Resolution (arXiv:1208.1927)](https://arxiv.org/pdf/1208.1927)
- [r-HUMO: A Risk-Aware Human-Machine Cooperation Framework for Entity Resolution with Quality Guarantees (arXiv:1803.05714)](https://arxiv.org/pdf/1803.05714)

Probabilistic linkage, three-way decision, blocking:
- [The Fellegi-Sunter Model — Splink docs](https://moj-analytical-services.github.io/splink/topic_guides/theory/fellegi_sunter.html)
- [Splink — moj-analytical-services](https://github.com/moj-analytical-services/splink)
- [Probabilistic Linkage Training — Robin Linacre](https://www.robinlinacre.com/probabilistic_linkage/)
- [Probabilistic Record Linkage and Deduplication after Indexing, Blocking, and Filtering — Murray](http://www2.stat.duke.edu/~rcs46/linkage_readings/2015-Murray-Blocking-FellegiSunter.pdf)

Crosswalks, reference data, audit trail:
- [Crosswalks — Informatica Reference 360](https://docs.informatica.com/master-data-management-cloud/reference-360/current-version/reference-360/introducing-reference-360/key-concepts/crosswalks.html)
- [EDG Reference Data Management — TopQuadrant](https://www.topquadrant.com/doc/8.0/quick_start_guides/edg_reference_data_management/index.html)
- [Slowly Changing Dimension Type 2 — Microsoft Fabric](https://learn.microsoft.com/en-us/fabric/data-factory/slowly-changing-dimension-type-two)

Why not ML/LLM here:
- [When Do LLMs Actually Help? Evaluating LLMs as Data Quality Annotators (arXiv:2608.18158)](https://arxiv.org/abs/2608.18158) — rule-based F1 0.950 vs LLM zero-shot 0.948 on Abt-Buy
- [Entity Matching using Large Language Models — Peeters et al. (arXiv:2310.11244)](https://arxiv.org/pdf/2310.11244) — recall ≫ precision failure profile
- [Deep Entity Matching with Pre-Trained Language Models (Ditto, arXiv:2004.00584)](https://arxiv.org/pdf/2004.00584)
- [Deep Entity Matching: Challenges and Opportunities — ACM](https://dl.acm.org/doi/fullHtml/10.1145/3431816)

Local precedent (this repo):
- [supabase/migrations/20260820000003_reyma_factura_match.sql](supabase/migrations/20260820000003_reyma_factura_match.sql) — the pattern this design reuses
- [supabase/migrations/20260820000004_reyma_conversion_bulto.sql](supabase/migrations/20260820000004_reyma_conversion_bulto.sql) — append-only human-curated lookup
- [supabase/migrations/20260825000001_reyma_factura_staging.sql](supabase/migrations/20260825000001_reyma_factura_staging.sql) — trust boundary + provenance for the upload flow
