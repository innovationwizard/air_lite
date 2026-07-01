# Tech-Debt Remediation — LIVE PROGRESS LEDGER

> **This is the single source of truth for "where are we."** It is updated the instant a sub-batch is verified.
> If a session is compacted/interrupted: resume from the **first unchecked `[ ]`**, re-read its spec in [TECH_DEBT_REMEDIATION_PLAN.md](./TECH_DEBT_REMEDIATION_PLAN.md), and re-run its Verify step before continuing.
>
> Legend: `[ ]` not started · `[~]` in progress · `[x]` done & verified · `[!]` blocked/needs Jorge

**Last updated:** 2026-06-30 — Batches 1–3 committed (`6d1566d`/`54cb226`/`fb76f2e`); Batches 4 & 6 COMPLETE & verified (awaiting commit); Batch 5 (numpy 2.x, backtest-gated) is the only one left — needs the golden-baseline harness decision
**Git note:** Claude does not commit. Each `[x]` batch is handed to Jorge to commit. "Committed?" column tracks that.

---

## Status board

| Batch | Title | State | Committed? |
|---|---|---|---|
| 1 | Frontend runtime pin (Node 22) | `[x]` done & verified | ☑ committed `6d1566d` |
| 2 | Re-enable ESLint + ESLint 9 | `[x]` done & verified | ☑ committed `54cb226` |
| 3 | Jest 30 alignment | `[x]` done & verified | ☑ committed `fb76f2e` |
| 4 | Remove recharts | `[x]` done & verified | ☐ pending Jorge |
| 5 | ML environment (gated) | `[!]` blocked on numpy decision | — |
| 6 | Non-forecast Python caps | `[x]` done & verified | ☐ pending Jorge |

**DECISION (Jorge, 2026-06-30):** numpy → **widen to 2.x now, gated by golden-backtest diff** (`numpy>=1.26,<3.0`; adopt only if Prophet output unchanged within tolerance, else roll back). Batch 5 unblocked. Prophet stays.

**⚠️ Batch 5 dependency surfaced:** the golden backtest (`ml/backtest_engine.py`) requires a **live Supabase service-role client** and **writes** to `backtest_runs`/`backtest_results`/`backtest_savings` (not a pure local computation). Establishing the baseline needs credentials + a non-polluting harness — see Batch 5.0 notes.

---

## BATCH 1 — Frontend runtime pin (Node 22)

- [x] 1.1 — Create `frontend/.nvmrc` = `22`
- [x] 1.2 — Add `engines: { node: ">=22 <23" }` to `package.json`
- [x] 1.3 — `frontend/Dockerfile` ×3 `node:18-alpine` → `node:22-alpine` (verified: 3× node:22, 0× node:18)
- [x] 1.4 — CI `node-version: '20'` → `'22'`
- [x] 1.5 — `@types/node` `^20.14.2` → `^22` + lockfile refreshed (resolved 22.20.0)
- [x] 1.6 — `npm ci` + `npm run build` + `npm test` green on Node 22
- [x] 1.7 — `docker build` smoke test → **VERIFIED end-to-end.** Full image builds clean on `node:22-alpine` (465 MB) and **boots** (`server.js`, Next.js Ready 96 ms, HTTP 307, Node v22.23.1 inside). Initial build exposed pre-existing bug N6 (missing `output: 'standalone'`), fixed as a tracked side-item (see below).

**N6 fix (separate tracked item, applied alongside Batch 1):**
- [x] Added `output: 'standalone'` to `frontend/next.config.mjs` (Jorge: App Runner image is real)
- [x] Verified: local build emits `.next/standalone/server.js`; Docker image builds + boots + serves

**Verification log (1.6) — 2026-06-30, Node v22.17.1:**
- `npm ci` → exit 0, 848 packages (only deprecation warnings, no errors)
- `npm run build` → exit 0, full route table emitted, standalone output produced
- `npm test -- --ci --passWithNoTests` → **10 passed / 10 total**, 1 suite, exit 0

**Files changed in Batch 1 (for Jorge's commit):**
- `frontend/.nvmrc` (new)
- `frontend/package.json` (engines + `@types/node`)
- `frontend/package-lock.json` (lockfile refresh)
- `frontend/Dockerfile` (×3 base image)
- `frontend/next.config.mjs` (N6 fix: `output: 'standalone'`)
- `.github/workflows/ci.yml` (node-version)

---

## BATCH 2 — Re-enable ESLint + ESLint 9

- [x] 2.1 — Cleared all 12 lint warnings (verified `npm run lint` → 0/0)
- [x] 2.2 — Removed `eslint.ignoreDuringBuilds` from `next.config.mjs` + set `lint` script to `next lint --max-warnings 0` so the gate fails CI on **any** warning (proven via negative test: unused var → exit 1; removal → exit 0)
- [x] 2.3 — ESLint 8→9 (9.39.4) + `@typescript-eslint/*` 7→8 (8.62.1). **No flat-config migration needed** — `eslint-config-next@15` peer-supports `eslint ^9` and `next lint` drives ESLint via its compat layer using the existing `.eslintrc.json`. tseslint v8 surfaced 1 new error (empty interface in `input.tsx`), fixed (see N7).
- [x] 2.4 — Verified: `npm run lint` 0/0 under ESLint 9, `npm run build` green (lint active, standalone emits), 10/10 tests pass

**The 12 warnings cleared (2.1) — exact disposition (for Jorge's review):**
| File | Symbol | Fix |
|---|---|---|
| `admin/usuarios/page.tsx` | `Users` (import) | removed unused import |
| `compras/page.tsx` | `Package` (import) | removed unused import |
| `backtest/page.tsx` | `cumulative` block (L92–102) | removed dead accumulation loop ("Will be tracked via state" — never read) |
| `api/oa/recalc-unload/route.ts` | `request` arg | renamed `request` → `_request` (matches `argsIgnorePattern`) |
| `gerencia/gap-report/page.tsx` | `MAX_MONTH` const | **removed dead const, KEPT the cap comment.** Cap is enforced by `MONTH_NAV` (`'2026': ['2026-01']`), not this const. |
| `gerencia/validacion/page.tsx` | `MAX_MONTH` const | same as above — comment preserved |
| `preocupaciones/capital-congelado/page.tsx` | `CONFIDENCE_COLORS` map | removed dead const (no references) |
| `preocupaciones/capital-congelado/page.tsx` | `policyTooltip`/`setPolicyTooltip` state | removed dead `useState` |
| `preocupaciones/desabastecimiento/page.tsx` | `HOLDING_COST_RATE = 0.18` | **removed dead business const.** ⚠️ Was the 18% holding-cost assumption; not used anywhere. Flagged in case a future capital-cost feature needs it. |
| `oa/recepcion/page.tsx` | `useEffect` missing dep | added `// eslint-disable-next-line react-hooks/exhaustive-deps` (matches existing codebase pattern; `loadData` is unmemoized so adding it would loop) |
| `superuser/forecast-diagnostic/page.tsx` | `useEffect` missing dep | fixed the **misplaced** inline disable comment (was on the same line, suppressing nothing) → proper own-line disable |

**Verification log (2.4) — 2026-06-30, ESLint 9.39.4:**
- `npm run lint` → exit 0, "No ESLint warnings or errors" (with `--max-warnings 0`)
- Negative test → unused var causes exit 1; gate confirmed enforcing
- `npm run build` → exit 0, "Compiled successfully", "Linting and checking validity of types", standalone emitted
- `npm test` → 10/10 pass

**Files changed in Batch 2 (for Jorge's commit):**
- `frontend/next.config.mjs` (drop `ignoreDuringBuilds`)
- `frontend/package.json` (`lint` script `--max-warnings 0`; `eslint ^9.39.4`; `@typescript-eslint/* ^8.62.1`)
- `frontend/package-lock.json`
- 11 source files: the 10 warning fixes above + `src/components/ui/input.tsx` (N7 tseslint-v8 fix)
- `.eslintrc.json` — **unchanged** (works as-is under ESLint 9 via Next compat)

---

## BATCH 3 — Jest 30 alignment

- [x] 3.1 — `jest` `^29.7.0`→`^30.4.2`, `@types/jest` `^29.5.12`→`^30.0.0`
- [x] 3.2 — `@testing-library/react` **left at `^15.0.7`** — bump to 16 NOT required (RTL 15 peers React ^18, which we're staying on; RTL is Jest-version-agnostic). Deferred to the React-19 pass.
- [x] 3.3 — `npm test --ci` → **10/10 pass** under Jest 30

**Extra sub-item discovered during 3.3 (the actual "mismatch" fix):**
- [x] 3.4 — Aligned `jest-environment-jsdom` `^30.3.0`→`^30.4.1`. Bumping only `jest`→30.4.2 first produced a runtime crash (`this._moduleMocker.clearMocksOnScope is not a function`) because the locked `jest-environment-jsdom@30.3.0` pulled an older `jest-mock` lacking that method. Aligning jsdom to 30.4.1 (its latest; Jest didn't republish it at .4.2) brings `jest-mock@30.4.1`, which matches `jest-runtime@30.4.2`. **This was the real "major mismatch" the audit warned about** — now resolved with all four Jest packages on 30.4.x.

**Verification log (Batch 3) — 2026-06-30:**
- Aligned versions: `jest 30.4.2`, `jest-runtime 30.4.2`, `jest-environment-jsdom 30.4.1`, `jest-mock 30.4.1`
- `npm test --ci` → 10/10 pass · `npm run lint` → 0/0 · `npm run build` → green, standalone emitted

**Files changed in Batch 3 (for Jorge's commit):**
- `frontend/package.json` (`jest ^30.4.2`, `@types/jest ^30.0.0`, `jest-environment-jsdom ^30.4.1`)
- `frontend/package-lock.json`

---

## BATCH 4 — Remove recharts

- [x] 4.1 — Re-confirmed 0 `recharts` references in `src` (guard against post-audit usage)
- [x] 4.2 — `npm remove recharts` → removed 33 packages; gone from `package.json` + lockfile (0 `node_modules/recharts` entries)
- [x] 4.3 — `npm run build` green (standalone emitted) + `lint` 0/0 + `test` 10/10

**Files changed in Batch 4 (for Jorge's commit):**
- `frontend/package.json` (removed `recharts`; npm also re-sorted the dependency list alphabetically)
- `frontend/package-lock.json` (−33 packages)

---

## BATCH 5 — ML environment (forecast-critical, gated) ⚠️

- [!] 5.0 — Golden backtest baseline on CURRENT env → `ml/_baselines/backtest_golden_2026-06-30.json` _(can start once unblocked; do FIRST)_
- [!] 5.1 — Pin `prophet>=1.3.0,<1.4.0` + diff vs golden (identical)
- [!] 5.2 — Python 3.11→3.12 (Dockerfile + CI) + diff vs golden
- [!] 5.3 — numpy per Jorge's decision (A widen / B hold) + diff vs golden
- [!] 5.4 — pandas cap (coupled to 5.3) + diff vs golden
- [!] 5.5 — Final ML rebuild + ruff + pytest + golden diff documented

**Blocked:** awaiting numpy decision. Golden baseline (5.0) is the mandatory first step regardless of A/B.

---

## BATCH 6 — Non-forecast Python caps

- [x] 6.1 — gunicorn `<23` → `<27` (in `requirements.txt`) — verified via full ML Docker image build (see log below)
- [x] 6.2 — pytest `<9` → `<10` — resolves to **pytest 9.1.1**; smoke test passes in CI-mirrored container (repo root + `-w /repo/ml`)
- [x] 6.3 — ruff floor `>=0.4.0` → `>=0.11.0` (cosmetic; installed ruff already latest **0.15.20**) — `ruff check .` → All checks passed

**Verification log (Batch 6) — 2026-06-30, python:3.11-slim (prod base):**
- Dev-deps (CI-mirrored): `pytest 9.1.1` → 1 passed; `ruff 0.15.20` → clean
- ML image build (exit 0, 2.68 GB): `gunicorn` resolved to **26.0.0** (was <23); `gunicorn --version` inside image = 26.0.0; `Prophet + cmdstan OK` (prophet 1.3.0, cmdstanpy 1.3.0, numpy 1.26.4, pandas 2.3.3)
- **Reference for Batch 5:** current resolved forecast stack = prophet **1.3.0**, numpy **1.26.4**, pandas **2.3.3**. Note prophet already resolves to 1.3.0, so Batch 5.1's pin is behaviorally a no-op (pure reproducibility guard). This image (`air-ml:b6`, python 3.11 / numpy 1.x) is the **"before"** for the numpy-2.x diff.

**Files changed in Batch 6 (for Jorge's commit):**
- `ml/requirements.txt` (`gunicorn<27`)
- `ml/requirements-dev.txt` (`pytest<10`, `ruff>=0.11.0`)

---

## Change log (append-only)

- **2026-06-30** — Plan + addendum + this ledger created. Drift check: no commits since base audit (last commit `8aa5c99`, 2026-05-27). Lint backlog measured = 12 warnings / 0 errors. Batch 1 started.
- **2026-06-30** — Batch 1 (Node 22 runtime pin) COMPLETE & verified green on Node 22 (build + 10 tests). Handed to Jorge for commit.
- **2026-06-30** — Docker smoke test run (daemon now up). Exposed pre-existing bug N6 (Dockerfile expects standalone output that config never emitted). Jorge confirmed App Runner image is real → fixed via `output: 'standalone'`. Full image now builds (465 MB) + boots + serves on `node:22-alpine`. N6 closed. Committed `6d1566d`.
- **2026-06-30** — Batch 2 (re-enable ESLint + ESLint 9) COMPLETE. Cleared 12 warnings, removed build suppression, enforced `--max-warnings 0` (gate proven via negative test), upgraded ESLint 8→9 + tseslint 7→8 (no flat-config migration needed). tseslint v8 found + fixed 1 empty-interface error (N7). Logged `next lint` deprecation for the deferred Next-16 pass (N8). Committed `54cb226` (with docs relocation to root `june_delivery/`).
- **2026-06-30** — Batch 3 (Jest 30 alignment) COMPLETE. jest+@types/jest→30; RTL left at 15 (React 18). Real mismatch was jest-environment-jsdom locked at 30.3.0 → `clearMocksOnScope` crash; aligned to 30.4.1. All four Jest packages now 30.4.x, 10/10 tests pass, lint+build green. Committed `fb76f2e`.
- **2026-06-30** — Batch 4 (remove recharts) COMPLETE. 0 src references confirmed; `npm remove recharts` dropped 33 packages; build+lint+test green. Handed to Jorge for commit.
- **2026-06-30** — Batch 6 (non-forecast Python caps) COMPLETE. gunicorn <23→<27 (resolves 26.0.0), pytest <9→<10 (resolves 9.1.1), ruff floor →0.11 (installed 0.15.20). Verified via full ML Docker image build (Prophet+cmdstan OK) + CI-mirrored pytest/ruff. Handed to Jorge for commit. **All forecast-safe tech debt now done; only Batch 5 (numpy 2.x) remains.**
