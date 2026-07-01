# Tech-Debt Remediation — LIVE PROGRESS LEDGER

> **This is the single source of truth for "where are we."** It is updated the instant a sub-batch is verified.
> If a session is compacted/interrupted: resume from the **first unchecked `[ ]`**, re-read its spec in [TECH_DEBT_REMEDIATION_PLAN.md](./TECH_DEBT_REMEDIATION_PLAN.md), and re-run its Verify step before continuing.
>
> Legend: `[ ]` not started · `[~]` in progress · `[x]` done & verified · `[!]` blocked/needs Jorge

**Last updated:** 2026-06-30 — Batch 1 committed (`6d1566d`); Batch 2 COMPLETE & verified (awaiting commit); Batch 3 next
**Git note:** Claude does not commit. Each `[x]` batch is handed to Jorge to commit. "Committed?" column tracks that.

---

## Status board

| Batch | Title | State | Committed? |
|---|---|---|---|
| 1 | Frontend runtime pin (Node 22) | `[x]` done & verified | ☑ committed `6d1566d` |
| 2 | Re-enable ESLint + ESLint 9 | `[x]` done & verified | ☐ pending Jorge |
| 3 | Jest 30 alignment | `[ ]` | — |
| 4 | Remove recharts | `[ ]` | — |
| 5 | ML environment (gated) | `[!]` blocked on numpy decision | — |
| 6 | Non-forecast Python caps | `[ ]` | — |

**OPEN DECISION (Jorge):** numpy — widen `>=1.26,<3.0` (adopt 2.x only if backtest matches) **vs.** hold `<2.0` through blind test. Blocks Batch 5 only.

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

- [ ] 3.1 — `jest` + `@types/jest` → `^30`
- [ ] 3.2 — `@testing-library/react` peer reconcile (bump to 16 only if required)
- [ ] 3.3 — `npm test --ci` green under Jest 30

---

## BATCH 4 — Remove recharts

- [ ] 4.1 — Re-confirm 0 `recharts` imports in `src`
- [ ] 4.2 — `npm remove recharts`
- [ ] 4.3 — `npm run build` green

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

- [ ] 6.1 — gunicorn `<23` → `<27` + ML image boots
- [ ] 6.2 — pytest `<9` → `<10` + suite green
- [ ] 6.3 — Refresh stale floors (hygiene) + ruff/pytest green

---

## Change log (append-only)

- **2026-06-30** — Plan + addendum + this ledger created. Drift check: no commits since base audit (last commit `8aa5c99`, 2026-05-27). Lint backlog measured = 12 warnings / 0 errors. Batch 1 started.
- **2026-06-30** — Batch 1 (Node 22 runtime pin) COMPLETE & verified green on Node 22 (build + 10 tests). Handed to Jorge for commit.
- **2026-06-30** — Docker smoke test run (daemon now up). Exposed pre-existing bug N6 (Dockerfile expects standalone output that config never emitted). Jorge confirmed App Runner image is real → fixed via `output: 'standalone'`. Full image now builds (465 MB) + boots + serves on `node:22-alpine`. N6 closed. Committed `6d1566d`.
- **2026-06-30** — Batch 2 (re-enable ESLint + ESLint 9) COMPLETE. Cleared 12 warnings, removed build suppression, enforced `--max-warnings 0` (gate proven via negative test), upgraded ESLint 8→9 + tseslint 7→8 (no flat-config migration needed). tseslint v8 found + fixed 1 empty-interface error (N7). Logged `next lint` deprecation for the deferred Next-16 pass (N8). Handed to Jorge for commit.
