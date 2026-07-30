<!-- ════════════════════════════════════════════════════════════════════════ -->
<!-- SCOPE BOUNDARY — DO NOT REMOVE. Present verbatim in every project doc.     -->
<!-- NOTE: this banner is specific to the GI5 project. If you reuse this SOP    -->
<!-- in another repository, DELETE the banner — it will be false there.         -->
<!-- ════════════════════════════════════════════════════════════════════════ -->

> # 🚫 SCOPE BOUNDARY — READ BEFORE ANYTHING ELSE
>
> **Guatemalan regulatory compliance is NOT part of the `.xlsx` this project exists to replace.**
> The source workbook contains only tax **cash amounts** — IVA/ISR paid and retained, and a flat
> **5% dividend retention**. There is **no** KYC/DPI data, **no** compliance framework, **no**
> regulatory or IFRS/NIIF financial statements, and **no** tax-filing logic anywhere in the file.
> Any such capability is a **NEW product decision — RULE ZERO / RULE 14**.

---

# SOP — Deep Inspection of an `.xlsx` Workbook, and How to Write a Manifest That Survives Contact With the ETL

> **Audience:** whoever is about to turn a real, messy, business-critical spreadsheet into an
> application. **Scope:** everything from first opening the file to declaring the manifest done.
>
> This is written from a completed engagement: a 13-sheet Guatemalan cash-flow workbook that
> became a Next.js + Postgres application. Roughly half the content below exists because
> something went wrong **after** we thought the inspection was finished. Those sections are the
> valuable ones.

---

## 0. The three ideas this whole document rests on

### 0.1 The manifest is a hypothesis, not a finding

Every expensive mistake in that engagement had the same shape: **the manifest asserted something
plausible, and nobody had actually measured it.** Not one of them was a mystery that inspection
couldn't have solved — they were all things we *assumed* because the first few rows looked
consistent.

> Write the manifest so that a reader can tell, for every claim, whether it was **measured**,
> **sampled**, or **assumed**. If you cannot tell, it was assumed.

### 0.2 Sampling is how you generate hypotheses, never how you conclude

We looked at 4 rows and reported "the FX rate is ~7.72". The real answer was **12 distinct
rates**. We looked at the first product sheet and said "the four product sheets are similar
per-delivery ledgers". One of the four was a completely different financial instrument.

> Any statement of the form "the sheets are similar", "the values are X", "there are no Y"
> must come from a script that visited **every row of every sheet**, not from reading a dump.

### 0.3 Verbatim beats tidy, always

We title-cased `SAN JUAN` → `"San Juan"` and `CAFE` → `"Café"` (adding an accent the file does
not contain). Both felt like politeness. Both were **inventions** that made stored labels
un-findable in the source, and we had to undo them twice.

> **Rule:** any label you store must be findable *character-for-character* in the workbook, using
> Ctrl-F. Typos, double spaces, trailing blanks, `sic` misspellings — all preserved. Prettify at
> the presentation layer only, never at rest.

---

## 1. Phase 0 — Provenance before content

**Do this before opening the file in any spreadsheet tool.** An `.xlsx` is a ZIP of XML; the
metadata answers questions the grid never will.

```bash
unzip -l "workbook.xlsx"                 # inventory of parts
unzip -o -q "workbook.xlsx" -d ./x       # extract for reading
cat x/docProps/core.xml                  # author, created, modified, lastPrinted
cat x/docProps/app.xml                   # sheet names + count
cat x/xl/workbook.xml                    # sheet order, defined names, hidden state
cat x/xl/externalLinks/externalLink1.xml # links to OTHER workbooks — read this
```

### What to extract, and why it matters

| Signal | Where | Why you care |
|---|---|---|
| Creator / lastModifiedBy | `core.xml` | Who to ask. In our case `lastModifiedBy` was the person who still maintains the file daily — the eventual MANAGER user. |
| Created / modified dates | `core.xml` | A file "created 2022" but modified last week is a living system, not an archive. |
| `absPath` | `workbook.xml` | Reveals the folder structure and often the org/team. |
| **`externalLinks/`** | `xl/externalLinks/` | **The highest-value part of Phase 0.** |
| Sheet count vs visible | `workbook.xml` `<sheets>` | `state="hidden"` sheets contain live data surprisingly often. |
| `definedNames` | `workbook.xml` | Named ranges reveal the author's own mental model and true data extents. |
| `calcChain.xml` size | file listing | Large = heavy inter-sheet formula dependency. Expect a computation graph, not a table. |
| `xl/media/` | file listing | Embedded logos/images. Usually irrelevant, occasionally a signed document. |
| `persons/person.xml` | file listing | Threaded comments — may hold reasoning found nowhere else. |

### The external-link trick

`externalLink1.xml` lists the sheet names of *other* workbooks this file references — **and
caches the last-read values**. In our engagement this single file revealed:

- the workbook was a **subset of a larger master** we had never been told about;
- the names of ~10 sheets that did not exist in our copy (financial statements, capital, other
  business lines);
- a cached snapshot of the company's capital structure.

**Ask about the master workbook on day one.** Discovering mid-build that you were handed a
fragment is expensive.

---

## 2. Phase 1 — Structural census

Get the true shape of every sheet before reading any content.

```python
import openpyxl
wb_f = openpyxl.load_workbook(path, data_only=False)  # formulas
wb_v = openpyxl.load_workbook(path, data_only=True)   # cached values
for name in wb_f.sheetnames:
    ws = wb_f[name]
    nonempty = sum(1 for row in ws.iter_rows() for c in row if c.value is not None)
    print(name, ws.sheet_state, ws.dimensions, ws.max_row, ws.max_column, nonempty)
```

> ⚠️ **Name your script anything but `inspect.py`.** It shadows the stdlib module that openpyxl
> imports, and the failure is a confusing circular-import error. We lost time to this.

### Phantom dimensions — expect them

`max_row` is a **formatting artifact**, not a data extent. Real numbers from our workbook:

| Sheet | `max_row` says | Real last data row |
|---|---|---|
| A | 1,048,469 | 255 |
| B | 1,048,576 | 33 (+ stray junk at 891–953) |
| C | 3,788 | 136 |

**Always compute the real extent** by scanning for the last row with content in a *known
populated* column. Never trust `dimensions`, `max_row`, or `rowCount`.

### Two loads, always

Load the workbook **twice** — `data_only=False` for formulas, `data_only=True` for cached
results. You need both:

- **Cached values** are what the user sees, and what your ETL must reproduce.
- **Formulas** are where the business logic hides — currency conversion, rates, day counts,
  renewal history.

> ⚠️ If the file was written by a tool that never calculated (some generators), `data_only=True`
> returns `None` everywhere. Check for this immediately; if it happens, you must open and re-save
> the file in Excel/LibreOffice before you can trust any value.

---

## 3. Phase 2 — Per-sheet deep inspection

Dump each sheet to a **text file**, not to your terminal. You will re-read these dozens of times.

For every sheet capture: every non-empty cell as `REF=value`, and for formula cells
`REF=[formula]->cached`. That single format made the whole engagement tractable.

### Enumerate EVERY sheet's headers — never generalise from one

This is the single highest-yield discipline in this document. Print a compact table of every
sheet's header row:

```
SHEET A   A:FECHA COMPRA | B:COSTO | C:PRODUCTO | D:CLIENTE | H:FECHA VENCE | I:LUNES PAGO | J:FONDO | K:UTILIDAD | L:FONDO | M:UTILIDAD
SHEET B   A:FECHA COMPRA | B:COSTO | C:PRODUCTO | D:CLIENTE | G:FECHA VENCE | H:LUNES PAGO | I:FONDO | J:UTILIDAD
```

Two catastrophes are visible in those two lines, and invisible in any single-sheet read:

1. **`FECHA VENCE` is at H on one sheet and G on the other.** Position-based reading would have
   silently loaded one exporter's dates into another's fields.
2. **`FONDO` and `UTILIDAD` appear TWICE on sheet A.** A naive `find first matching header`
   silently ignores the second pair — 64 rows of real data gone without a trace.

> **Corollaries that cost us real time:**
> - Bind columns by **header text**, never by index.
> - Headers are **not unique**. Detect duplicates explicitly and report them.
> - "These sheets look alike" is a hypothesis. Prove it by diffing the full header sets.

### Multi-row headers

Real workbooks stack headers across 2–3 rows (`ACCIONES` in row 1 spanning four columns, the
specific name in row 2, a detail in row 3). Only the **composite** is unique. Build the key by
joining the non-empty header rows:

```
"INGRESOS EXPO 1 / CAPITAL"      "RETENCION/ / PAGO / IVA"      "RE / INTEGROS"
```

Note the artifacts: a trailing slash in `RETENCION/`, a word split across rows in `RE / INTEGROS`.
Keep them verbatim.

### Hidden columns and sheets carry live data

```python
hidden = [k for k, d in ws.column_dimensions.items() if d.hidden]
```

Our workbook hid a column with active daily values (a business line being wound down) and a
reference/password column. **Hidden ≠ unused.** Never skip hidden cells.

### Number formats identify meaning

```python
ws["K5"].number_format   # '_-"Q"* #,##0.00_-;...'  -> currency, and WHICH currency
ws["L5"].number_format   # '0.00%'                  -> a rate, not an amount
ws["H5"].number_format   # 'd-mmm'                  -> a date stored as a serial
```

This is how you discover the currency without being told, and how you avoid treating a rate as
money. Do it for one populated row of every column.

---

## 4. Phase 3 — Formula archaeology

**The business rules are in the formulas, not the values.** Budget real time here.

### Find the engine

In a cash-flow workbook, one formula usually *is* the whole system:

```
AB[day] = AB[day-1] + INGRESOS!AG[day] - EGRESOS!AA[day]
```

Yesterday's balance + today's inflows − today's outflows. Identify this recurrence early: it
becomes both your data model's core and your acceptance test (§7).

### Read formulas for hidden semantics

Things we found **only** by reading formula text:

| Formula fragment | What it actually meant |
|---|---|
| `=U12+(K13*7.728)-R13-S13` | **This investment is in USD.** There is no currency column anywhere. Currency is inferrable *only* from the presence of a multiplier — and the rate **varies per row**. |
| `=(82)/30` | Months are **fractional** (2.7333…). We stored `months` as `Int` and silently corrupted 11 of 135 dividend calculations. |
| `=+H2+365+270` | A renewal/extension **history**, encoded by appending terms to a formula. Model these as events, not as a date. |
| `=2487761.29375832/10` | A hard-coded seed value with no provenance. Flag every magic number. |

> **Method:** grep the formula dump for `*` (multipliers), `/` (divisors), and `+` chains on
> dates. Each one is a business rule someone never wrote down.

### Distinguish derived columns from source columns

TOTAL, SALDO, and subtotal columns are **outputs**. Import them and you have imported a number
you cannot verify. Recompute them and compare — that comparison is your reconciliation.

> Declare derived columns explicitly in the manifest so a later importer does not treat them as
> data, *and* does not report them as "unconsumed".

---

## 5. Phase 4 — Numeric forensics

This section exists entirely because we got precision wrong, twice, and a sharp question caught it.

### Measure decimal precision. Do not estimate it.

We wrote "values carry 2 decimals", then "no more than 4 decimals". Both were wrong. The user
asked *"Are you sure that no values in the source have more than 4 decimals?"* — and the honest
answer, once measured, was **1,814 values (18.1%) need more than 4**, with a maximum of **9**.

**How to measure properly:**

```python
def intended_dp(v, tol_abs=1e-9, tol_rel=1e-9, maxk=12):
    """Smallest k where rounding to k dp is within float noise of v."""
    for k in range(maxk + 1):
        if abs(v - round(v, k)) <= max(tol_abs, abs(v) * tol_rel):
            return k
    return None
```

Then histogram `intended_dp` over **every numeric cell in the file**.

> ⚠️ **Tolerance choice changes the answer.** Our first pass used a `1e-15` relative tolerance
> and reported "12 dp everywhere" — that was IEEE-754 dust, not precision. Re-run with a sane
> tolerance (`1e-9`) before concluding anything.

### Separate LOSS from DUST

Two opposing costs, and you need both to choose a scale:

- **LOSS** — real precision discarded by storing at scale *n*.
- **DUST** — IEEE-754 artifacts *persisted as if they were data* by storing at scale *n*.

Tabulate both for scales 2…12. In our file:

| scale | LOSS (sum) | DUST (sum) |
|---|---|---|
| 2 | 9.10 | 0.00 |
| 4 | 0.052 | 0.366 |
| 8 | 0.0000005 | 0.361 |
| **9** | **0.000000000** | 0.361 |
| 10 | 0.000000000 | 0.361 (over *more* cells) |

**LOSS hits exactly zero at 9; DUST plateaus from 4 onward and never improves.** So 9 was the
precise inflection point — below it you discard data, above it you only widen the dust surface.
That is a *measured* decision, not a preference.

> 💡 **Bonus finding:** storing at the chosen scale (`Decimal(20,9)`) **strips float dust for
> free** — `65152.882000000056` → `65152.882` — while preserving genuine repeating decimals.
> A separate "dust normalisation" pass turned out to be unnecessary.

### Signs are semantics, not noise

Do **not** assume a negative number is a reversal. Count negatives per column and look at the
ratio:

| Column | Negatives | What it actually was |
|---|---|---|
| Tax retention | **61 of 61 (100%)** | Not a reversal at all — a structural **outflow** living in the inflow sheet |
| Eventual income | 10 of 21 | A genuinely **bidirectional** account (± sweeps) |
| An expense column | 1 of 14 | An occasional **refund** |

Three completely different meanings. A naive "flip negatives to the opposite category" rule
would have conflated all three and destroyed provenance.

> **Design consequence:** decouple *direction* from *category*. Store a non-negative magnitude,
> an explicit direction, and keep the origin category. Then a tax retention can be an OUTFLOW
> while still recording that it came from the inflow sheet's retention column.

### Dates

- Check whether a "date" column is a real date or a serial number formatted as one.
- Check the **timezone assumption** — cell dates are naive; decide UTC vs local once, explicitly.
- Find the **real data horizon**: the last row with a date is *not* the last row with data.

> We claimed the ledger "carries ~8 months of projections". It carries **empty pre-dated rows**.
> Data stopped at the file's title month; everything after was scaffolding. Compute the range of
> dates that have **non-zero values**, not the range of dates that exist.

---

## 6. Phase 5 — Cross-sheet relationships

Map how sheets reference each other, and be explicit about what is **not** determinable.

### Unresolvable links: say so, do not guess

Our ledger had columns literally labelled `INGRESOS EXPO 1 … EXPO 5`. There were exactly five
detail sheets with company names. The mapping is obvious, tempting, and **stated nowhere in the
file**.

The correct answer was the client's: *"Do not make any assumptions. Assign xlsx nomenclature
verbatim."* We imported `EXPO 1…5` under their own names and **asserted no link**.

> A derived-but-unconfirmed relationship is worse than an absent one: it looks authoritative and
> silently misattributes every downstream record. **Record the ambiguity in the manifest as an
> open question with a named owner.**

---

## 7. Phase 6 — Define the acceptance test before you build

Find the one number the business actually trusts, and make reproducing it your definition of done.

> **Rebuild the running bank balance from imported line items and match the workbook's own
> figure, to the cent, for every single day.**

Ours: 409 days, 0 mismatches, max delta 1e-9, final balance identical to the digit. Until that
passed, nothing else mattered; once it passed, the project's core claim was demonstrable.

**Properties of a good acceptance test:**
- It is a **single number** the client already looks at.
- It is **derived** (so it exercises the whole chain), not a stored field you can copy.
- It is checkable **per period**, so a failure localises to a day.
- You compare against the workbook's **cached results** — the numbers the client sees.

---

## 8. Phase 7 — The anomaly hunt

Before writing the manifest, actively hunt for things that will break an importer.

| Hunt for | How | Real example |
|---|---|---|
| Stray data below the block | Scan far past the visible end | 63 rows of loose integers at row 891+ |
| Duplicate headers | Count occurrences per header string | `FONDO` twice on one sheet |
| Empty "required" columns | Count populated cells per column, per sheet | One sheet's cut-date column was **100% empty** |
| Merged cells | `ws.merged_cells.ranges` | Header spans |
| Error cells | Look for `#REF!`, `#DIV/0!` | — |
| Mixed types in a column | Histogram cell types per column | Text in numeric columns |
| Rounding noise | Values like `18924.000000000004` | Everywhere |
| Whitespace/typo labels | Print `repr()` of headers | `"CORRELA TIVO"`, `"INVESIONISTA"` (sic), `"DIVIDENDOS  A PAGAR"` (double space) |

---

## 9. The manifest — structure that proved useful

Write it as a **reference document a stranger could use to rebuild the system**, not as a report.

```markdown
# XLSX Manifest — <exact filename>

> How this was produced (tools, what was measured vs sampled), and a note that
> header labels are quoted VERBATIM.

## 1. File identity & provenance
   author, dates, origin path, currency, entity, external links,
   "this file is a subset of X" if applicable

## 2. Sheet inventory
   | # | Sheet (verbatim) | Group | REAL extent | Purpose (observed) |
   -- always the real extent, never max_row

## 3. The engine
   The core recurrence, written as a formula. This is the heart of the model.

## 4..N. Per-sheet detail
   Verbatim column table: | Col | Header (verbatim) | Meaning / formula |
   Row ranges. Derived vs source columns. Hidden columns called out.

## N+1. External references & embedded snapshots

## N+2. Anomalies & risks   <-- the section people actually re-read
   Numbered, each with: what, where (cell refs), why it will bite.

## N+3. Open questions
   Things the FILE CANNOT ANSWER, with a named owner for each.

## N+4. Coverage vs. requirements
   Map each requirement to where it lives — and mark what has NO home in the file.
```

### What made ours genuinely useful

- **Verbatim headers everywhere**, including typos — made the ETL's job mechanical.
- **The engine formula stated up front** — became the schema's core and the acceptance test.
- **A numbered anomalies section** — every entry eventually became an ETL guard.
- **"Not in this file" stated explicitly** — stopped two rounds of scope creep.

### What was missing, and cost us

1. **No per-sheet header enumeration.** We described sheets in prose as "similar". Two of the
   worst bugs (duplicate headers, a completely different sibling schema) were sitting in plain
   sight in the header sets.
2. **No precision analysis.** "Currency is Q" is not enough; the *scale* decision needed data.
3. **Formula implications not carried through.** We quoted `=(82)/30` in the manifest and still
   modelled months as an integer. **Quoting a formula is not the same as stating its
   consequence.** Add a "therefore:" to every formula you record.
4. **No "measured vs assumed" labelling**, so downstream readers (including us) treated
   sampled statements as facts.
5. **Data horizon asserted, not computed** — leading to a wrong claim about projections.

---

## 10. Gotchas catalogue — the ones that appeared AFTER the manifest

Treat this as a pre-flight checklist. Every item is something we believed we had covered.

| # | Gotcha | How it surfaced | Prevention |
|---|---|---|---|
| 1 | Sibling sheets with **different schemas** — one of four "product" sheets was an interest-bearing instrument (rate, day-count), not a delivery ledger | ETL imported 0 rows | Enumerate every sheet's full header set; never generalise |
| 2 | **Duplicate headers** on one sheet | Importer silently bound the first only | Detect duplicates, report them |
| 3 | **Fractional values in an "integer" field** (`=(82)/30`) | Validator flagged 11 of 135 rows inconsistent | Carry every formula through to its type consequence |
| 4 | **A required column that is 100% empty on one sheet** | 25 rows rejected | Count populated cells per column *per sheet* |
| 5 | **Sampling error** — reported 4 FX rates, actually 12 | Full-file scan during ETL | Never conclude from a sample |
| 6 | **Precision underestimated twice** (2 dp, then 4 dp) | User challenge → measurement | Histogram intended dp over every cell |
| 7 | **Overstated a limitation** — claimed no finite scale could be lossless | Re-measurement | Distinguish float dust from true non-termination |
| 8 | **Wrong label recorded** (`EVENTUALES/BODEGA` vs actual `RENTA/BODEGA`) | Composite header extraction | Extract headers programmatically, never by eye |
| 9 | **"Projections" that were empty rows** | Computing the non-zero date range | Compute the horizon from values, not dates |
| 10 | **Tidy-naming invented data** twice (`San Juan`, `Café`) | Verbatim rule enforcement | Store verbatim; prettify only at display |
| 11 | **Status invented by import** — every receivable landed as PENDING because the file has no collection dates, producing a screen full of "90+ days overdue" that is an artifact, not a fact | Reviewing the aging report | Never let an import default become a business assertion |

> **Pattern across all eleven:** each is a place where something *looked* uniform and wasn't.
> Uniformity is the assumption to attack hardest.

---

## 11. Verification checklist — before declaring the manifest done

Do not hand it over until every box is ticked with a **command you actually ran**.

- [ ] Raw XML parts inspected; external links read and asked about
- [ ] Hidden sheets AND hidden columns enumerated
- [ ] Real data extent computed for every sheet (not `max_row`)
- [ ] **Full header set printed for every sheet, and diffed across sibling sheets**
- [ ] **Duplicate headers detected explicitly**
- [ ] Multi-row headers composed and recorded verbatim (with `repr()` to catch whitespace)
- [ ] Number formats sampled per column (currency vs rate vs date)
- [ ] Both formula and cached-value loads performed
- [ ] Every distinct formula *shape* catalogued, each with a "therefore:"
- [ ] Derived/total columns identified and marked as recompute-only
- [ ] **Intended decimal precision histogrammed over every numeric cell**
- [ ] LOSS vs DUST tabulated; storage scale chosen from the table
- [ ] Negative values counted per column, with a stated meaning for each pattern
- [ ] Real data horizon computed from **non-zero values**
- [ ] Stray data outside the main blocks located
- [ ] Cross-sheet relationships mapped; **unresolvable ones listed as open questions**
- [ ] Acceptance test identified and its formula written down
- [ ] Every claim labelled **measured / sampled / assumed**
- [ ] Cross-validated with a **second tool** (e.g. Python *and* the language you will build in)

---

## 12. Handing off to the ETL

The manifest's real job is to make the importer mechanical. It must enable an importer that:

1. **Binds columns by header text**, never position.
2. **Never fails silently and never fails loudly-but-uselessly** — every anomaly is recorded with
   its exact cell reference, in a queryable table, with a severity.
3. **Drops nothing.** A populated column that no field claims is an *issue*, not a shrug.
4. **Refuses to guess.** Ambiguous semantics → flagged for a human, not interpreted.
5. **Is idempotent** — rebuild inside a transaction so a re-run converges.
6. **Records the source file's SHA-256**, so any figure traces to an exact file version.
7. **Keeps per-value provenance** (sheet + cell). This is what lets a user reconcile a screen
   against the spreadsheet by hand, and it is the single most trust-building feature you can ship.

> An empty issue list should be **evidence** that nothing was dropped, not a claim. That is only
> true if the importer is capable of producing issues.

---

## 13. Anti-patterns

| Anti-pattern | Why it hurts |
|---|---|
| Reading the file in Excel and writing prose | You will describe the first 20 rows and generalise |
| `df = pd.read_excel(...)` as step one | Silently coerces types, drops formulas, mangles headers, hides duplicates |
| Position-based column access | Breaks the moment two sheets differ — silently, with plausible numbers |
| Importing TOTAL columns | You import a number you cannot verify |
| "Cleaning" labels on the way in | Invents data; makes values un-findable in the source |
| Treating `max_row` as the data extent | Imports a million empty rows or scans forever |
| Deciding money precision by convention | Currencies have a minor unit; *spreadsheets* have whatever precision the formulas produced |
| Letting an import default (e.g. `PENDING`) reach a UI | Presents an artifact as a business fact |
| Declaring the manifest "done" before an ETL has run against it | The manifest is unfalsified until then |

---

## 14. Fast start — the first hour

```bash
# 1. Provenance
unzip -o -q wb.xlsx -d ./x && cat x/docProps/core.xml x/xl/workbook.xml
ls x/xl/externalLinks/ 2>/dev/null && cat x/xl/externalLinks/*.xml   # ask about these

# 2. Census: sheet, state, claimed size, REAL size, non-empty count
# 3. Headers: full set for EVERY sheet, printed as one comparable block
# 4. Dumps: one text file per sheet, "REF=value" and "REF=[formula]->cached"
# 5. Numbers: intended-dp histogram; negatives per column; date range of non-zero rows
# 6. Find the engine formula. Write down the acceptance test.
```

Then, and only then, start writing the manifest.

---

## 15. One last thing

The most valuable question asked during the whole engagement was four words long:

> **"Are you sure?"**

It was asked about a precision claim I had not measured. The answer was no, and measuring it
changed a schema decision that would otherwise have silently corrupted 18% of the imported
values.

Invite that question. Better: **make it unnecessary by labelling every claim with how you know
it.**
