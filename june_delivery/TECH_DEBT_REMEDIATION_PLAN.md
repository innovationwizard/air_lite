# Tech-Debt Remediation Plan — Batched & Resumable

**Date:** 2026-06-30
**Author:** Jorge Luis Contreras Herrera (with Claude)
**Source audits:** [DEPENDENCIES_AND_TECH_DEBT.md](../docs/DEPENDENCIES_AND_TECH_DEBT.md) (base, 2026-06-16) + [TECH_DEBT_ADDENDUM_2026-06-30.md](./TECH_DEBT_ADDENDUM_2026-06-30.md) (drift check)
**Delivery guide:** [AIR3_DELIVERY_PLAN.md](./AIR3_DELIVERY_PLAN.md) §3 (Phase 1 Critical + Phase 2 High)
**Contract:** [_THE_RULES.MD](../_THE_RULES.MD)

---

## How to use this document

This plan is split into **6 batches**, each batch into **small numbered sub-batches**. Every sub-batch is independently shippable and independently verifiable. The companion [TECH_DEBT_PROGRESS.md](./TECH_DEBT_PROGRESS.md) is the **live ledger** — it is updated the moment each sub-batch is completed, so that **if a conversation is compacted or interrupted mid-flight, the next session resumes from the first unchecked box with zero lost progress.**

**Resumption protocol (read this if you are a fresh session):**
1. Open [TECH_DEBT_PROGRESS.md](./TECH_DEBT_PROGRESS.md).
2. Find the first unchecked `[ ]` sub-batch.
3. Re-read that sub-batch's spec below before touching anything.
4. Re-run that sub-batch's **Verify** step to confirm the prior state before proceeding (don't trust the ledger blindly — confirm on disk).

---

## Operating boundaries (locked with Jorge, 2026-06-30)

- **Scope:** Phase 1 (Critical) + Phase 2 (High) only. The deferred coordinated frontend major upgrade (React 18→19, Next 15→16, Tailwind 3→4, zustand 4→5, date-fns 3→4, echarts 5→6, TS 5→6, @testing-library 15→16 beyond what Jest needs) is **OUT OF SCOPE** — a separate signed-off pass, per both source docs and the pre-production hard gates.
- **Execution split:** Claude edits files and runs **non-git** verification locally (`npm ci`, `npm run build`, `npm test`, `pip install`, `ruff`, `pytest`, docker build where feasible). **Claude never runs git.** Jorge reviews and commits each batch.
- **Forecast-output protection:** the client's Feb/Mar/Apr forecast values are being **blind-tested** by decision-makers. Any change that can move Prophet's numerical output (Python version, numpy, pandas) is quarantined into **Batch 5** behind a **golden-backtest diff gate**. Nothing that touches forecast output ships without proving the output is unchanged within tolerance.
- **OPEN DECISION (blocks Batch 5 only):** numpy strategy — widen to `>=1.26,<3.0` and adopt 2.x only if the backtest matches, **vs.** hold `<2.0` through the blind test and defer 2.x. Jorge to decide before Batch 5. (Prophet is **not** being replaced — confirmed against AIR3 plan §2.)

---

## Batch overview & sequencing

| Batch | Title | Forecast risk | Blocking? | Maps to audit |
|---|---|---|---|---|
| **1** | Frontend runtime pin (Node 22) | None | Ready now | Critical #1, §3 parity, §4 #11 |
| **2** | Re-enable ESLint + ESLint 9 | None | After 1 | High #4 |
| **3** | Jest 30 alignment | None | After 2 | High #5 |
| **4** | Remove `recharts` | None | Any time | Medium #7 |
| **5** | ML environment (Python 3.12 + pin prophet + numpy + pandas) | **HIGH** | After numpy decision | Critical #2, #3 + High #6 + Medium #8 (pandas) |
| **6** | Non-forecast Python caps (gunicorn, pytest, ruff floor) | None | After 5 | Medium #8 (rest), Low #10 |

**Why this order differs slightly from base-audit §5:** the base audit puts ML reproducibility second. We move the forecast-safe quality-gate batches (2–4) ahead of the ML batch because (a) Batch 5 is blocked on Jorge's numpy decision, and (b) sequencing the forecast-risky change last lets the golden-backtest baseline be established deliberately. Batches 1–4 + 6 carry **zero** forecast-output risk.

---

## BATCH 1 — Frontend runtime pin (Node 18/20 → 22)

**Goal:** one Node version (22 LTS) across dev, CI, and Docker; runtime declared and enforced. Removes EOL exposure (Node 18 EOL 2025-04-30) and ends the three-version drift. **Zero forecast impact.**

- **1.1 — Add `.nvmrc`.** Create `frontend/.nvmrc` containing `22`.
  - _Verify:_ `cat frontend/.nvmrc` → `22`.
- **1.2 — Add `engines` to `package.json`.** Add `"engines": { "node": ">=22 <23" }` to `frontend/package.json`.
  - _Verify:_ `node -e "console.log(require('./frontend/package.json').engines)"`.
- **1.3 — Dockerfile to `node:22-alpine`.** Replace all three `FROM node:18-alpine` (lines 7, 20, 40) in `frontend/Dockerfile` with `node:22-alpine`.
  - _Verify:_ `grep -c 'node:22-alpine' frontend/Dockerfile` → `3`; `grep -c 'node:18' frontend/Dockerfile` → `0`.
- **1.4 — CI to Node 22.** In `.github/workflows/ci.yml`, change `node-version: '20'` → `'22'`.
  - _Verify:_ `grep "node-version" .github/workflows/ci.yml` → `'22'`.
- **1.5 — Bump `@types/node` to track runtime.** `@types/node@^20.14.2` → `^22` in `frontend/package.json`; run `npm install` to refresh the lockfile.
  - _Verify:_ lockfile updated; `@types/node` resolves to 22.x.
- **1.6 — Full local verification.** From `frontend/`: `npm ci` → `npm run build` → `npm test -- --ci --passWithNoTests`. All must pass on Node 22.
  - _Verify:_ build succeeds, tests pass. Capture summary into the progress ledger.
- **1.7 — (Optional, if Docker available) image smoke test.** `docker build -t air-fe:node22 frontend/` and confirm it builds.
  - _Verify:_ image builds; if Docker unavailable locally, mark N/A and note CI will cover it.

**Batch 1 done when:** every sub-batch verified, `npm run build` green on Node 22, no `node:18`/`'20'` left. → Hand to Jorge for commit.

---

## BATCH 2 — Re-enable ESLint at build time + upgrade to ESLint 9

**Goal:** restore the lint quality gate (currently suppressed) and move off EOL ESLint 8. Per addendum N1 the backlog is **12 warnings / 0 errors** — trivial. **Zero forecast impact.**

- **2.1 — Clear the 12 warnings.** Fix each (remove genuinely-unused consts; for the 2 `exhaustive-deps`, either add the dep or keep an intentional, commented `eslint-disable-next-line` consistent with the existing one in `forecast-diagnostic`). Files listed in addendum N1.
  - _Verify:_ `npm run lint` → 0 warnings, 0 errors.
- **2.2 — Remove the build suppression.** Delete the `eslint.ignoreDuringBuilds: true` block from `frontend/next.config.mjs`.
  - _Verify:_ `npm run build` runs lint and stays green.
- **2.3 — Upgrade ESLint 8 → 9 (flat config).** Bump `eslint` to `^9`, `@typescript-eslint/*` `^7` → `^8`, `eslint-config-next` to a 9-compatible line; migrate `.eslintrc.json` → `eslint.config.mjs` flat config. `npm install`.
  - _Verify:_ `npm run lint` green under ESLint 9; `npx eslint --version` → 9.x.
- **2.4 — Re-verify build + CI parity.** `npm run build` + `npm test`. Confirm CI `Lint` step will pass (it runs `npm run lint`).
  - _Verify:_ build + test green.

> _Note: base audit cites ESLint 10 as latest. We target **ESLint 9 flat config** per AIR3 plan §3 ("upgrade to ESLint 9"). ESLint 10 deferred with the coordinated major pass._

**Batch 2 done when:** lint gate live in build, 0 findings, ESLint 9. → Hand to Jorge.

---

## BATCH 3 — Fix Jest major mismatch (29 → 30)

**Goal:** runner and environment on the same major. **Zero forecast impact.**

- **3.1 — Bump Jest + types.** `jest@^29.7.0` → `^30`, `@types/jest@^29.5.12` → `^30`. Keep `jest-environment-jsdom@^30` (already 30 — the mismatch resolves). `npm install`.
  - _Verify:_ `npx jest --version` → 30.x.
- **3.2 — Reconcile `@testing-library/react` peer.** Jest 30 + jsdom 30 may require `@testing-library/react@^16` (needs `@testing-library/dom` as an explicit peer). Bump **only if** the test run demands it; otherwise leave at 15 to stay minimal (Rule 10). If bumped, add `@testing-library/dom` explicitly.
  - _Verify:_ install resolves with no peer errors.
- **3.3 — Run the suite.** `npm test -- --ci`. Both existing test files must pass under Jest 30.
  - _Verify:_ tests green; capture output.

**Batch 3 done when:** Jest 30 across runner + env, suite green. → Hand to Jorge.

---

## BATCH 4 — Remove dead `recharts` dependency

**Goal:** drop the unused charting lib (zero `src/` imports). One-line cleanup, smaller bundle. **Zero forecast impact.**

- **4.1 — Re-confirm zero usage.** `grep -rn "recharts" frontend/src` → 0 hits (guard against new usage since the audit).
  - _Verify:_ 0 hits.
- **4.2 — Remove it.** `npm remove recharts` (from `frontend/`).
  - _Verify:_ `recharts` gone from `package.json` + lockfile.
- **4.3 — Rebuild.** `npm run build`.
  - _Verify:_ build green.

**Batch 4 done when:** `recharts` removed, build green. → Hand to Jorge.

---

## BATCH 5 — ML environment change (forecast-critical, gated) ⚠️ BLOCKED on numpy decision

**Goal:** reproducible, current ML runtime — pin prophet, move off Python 3.11 (EOL 2026-10-31), resolve the numpy cap, address the pandas cap. **HIGH forecast risk: every item here can move Prophet output.** Nothing ships until the golden-backtest diff proves output is unchanged within tolerance.

**Prerequisite — Jorge's numpy decision** (see Operating boundaries). Until decided, this batch does not start beyond 5.0.

- **5.0 — Establish the golden backtest baseline (do FIRST, on the CURRENT unchanged env).** Run `ml/backtest_engine.py` (`run_backtest_cycle` / `calculate_all_savings`) over the demo SKUs on the existing `python:3.11` + `numpy<2.0` + current prophet stack. Serialize the full predicted output to a versioned snapshot file (e.g. `ml/_baselines/backtest_golden_2026-06-30.json`). This is the immutable reference every later sub-batch diffs against.
  - _Verify:_ baseline file written; row counts + per-SKU predictions captured.
- **5.1 — Pin `prophet`.** `ml/requirements.txt` line 1: `prophet` → `prophet>=1.3.0,<1.4.0`. (Low risk — constrains to the version already resolving; reproducibility win.)
  - _Verify:_ rebuild ML deps; re-run backtest; **diff vs golden → must be identical.**
- **5.2 — Python 3.11 → 3.12.** `ml/Dockerfile` line 1 `python:3.11-slim` → `python:3.12-slim`; CI `python-version: '3.11'` → `'3.12'`. Rebuild image incl. CmdStan compile + the `Prophet OK` verify line.
  - _Verify:_ image builds; Prophet imports; **re-run backtest; diff vs golden within tolerance.** If output moves, STOP and report before proceeding.
- **5.3 — numpy (PER JORGE'S DECISION).**
  - _Option A (widen):_ `numpy>=1.24.0,<2.0.0` → `numpy>=1.26,<3.0`. Rebuild; **diff vs golden.** Adopt 2.x **only if** identical/within tolerance; otherwise roll back to a `<2.0` floor and record the drift.
  - _Option B (hold):_ keep `numpy<2.0` (optionally raise floor to `>=1.26,<2.0`); defer 2.x to post-blind-test. No output change expected.
  - _Verify:_ backtest diff vs golden documented either way.
- **5.4 — pandas cap.** `pandas>=2.0.0,<3.0.0` → widen toward `<4.0` **only if** numpy path allows and backtest stays green; otherwise hold (pandas 3.0 wants numpy 2.x, so this is coupled to 5.3).
  - _Verify:_ backtest diff vs golden.
- **5.5 — Final ML verification.** Full rebuild, `ruff check .`, `pytest tests/`, and the **golden-backtest diff** all green. Write the before/after diff summary into the ledger.
  - _Verify:_ all green; diff documented.

**Batch 5 done when:** ML env current + pinned, and the golden-backtest diff proves forecast output unchanged within tolerance (or the change is explicitly accepted by Jorge). → Hand to Jorge.

---

## BATCH 6 — Widen non-forecast Python caps

**Goal:** stop excluding current majors with no reason, for packages that **cannot** affect forecast output. **Zero forecast impact.**

- **6.1 — gunicorn.** `gunicorn>=22.0.0,<23.0.0` → `>=22.0.0,<27.0.0` (allows 26; may carry security fixes). Server only — no numerical impact.
  - _Verify:_ ML image builds + boots; `pytest tests/` green.
- **6.2 — pytest.** `pytest>=8.0.0,<9.0.0` → `>=8.0.0,<10.0.0` in `requirements-dev.txt`.
  - _Verify:_ `pytest tests/` green under the resolved version.
- **6.3 — Refresh stale floors (hygiene).** Optionally raise the most-stale floors to match resolved versions (e.g. ruff `>=0.4.0`). Conservative; no behavior change.
  - _Verify:_ `ruff check .` + `pytest` green.

**Batch 6 done when:** caps widened, ML CI green. → Hand to Jorge.

---

## Explicitly NOT in this plan (deferred / out of scope)

- React 19 / Next 16 / Tailwind 4 / zustand 5 / date-fns 4 / echarts 6 / TS 6 / lucide-react 1.x / ESLint 10 — the coordinated major pass (base audit Medium #9, AIR3 deferred #10–#11). Needs separate sign-off.
- Test-coverage expansion (addendum N2) — logged as debt, not dependency-remediation scope.
- The `forecast_purchases_derived.py` / weight-persistence work — AIR3 delivery scope, not tech debt.
- Supabase floor bumps (`supabase-js`, `@supabase/ssr`) — same-major, low concern; fold into a future hygiene sweep unless prioritized.

---

## Recommended order for the following steps (post-remediation)

_Added 2026-06-30 by Jorge. With all 6 tech-debt batches shipped, this is the sequencing for what comes next. Short version: **deliver first (1-2-3), then harden (4-5-6).**_

1. **Infrastructure migration (Railway → AWS App Runner + S3)** — Completes Chapter 1. Enables everything that follows. Without this, weight persistence has nowhere to land and you're still paying Railway for a service that should be on your SaaS plane.

2. **Derived-ratio refactor + weight persistence + Odoo sync** — Chapter 2. The single biggest client-visible improvement. Purchase forecast errors go from +1,069% to ±15%. Predictions go from minutes to milliseconds. This is the demo that justifies the gain-sharing payments.

3. **Acid Test 2** — Chapter 3. Proves value with signed evidence. Locks the baseline document.

4. **Test coverage expansion** — This is the gate for everything below. You have 10 tests covering a codebase that serves production predictions for a paying client. Before you touch React, Next, Tailwind, pandas, or anything that could introduce regressions, you need enough coverage to catch them. Target: critical paths (prediction pipeline, Census Filter, derived-ratio computation, auth, data sync). _(Addresses addendum N2.)_

5. **Pandas 3.0** — Same golden-backtest approach that worked for numpy. CoW changes how DataFrame mutations propagate, so any code that does chained assignment on slices could silently break. Gated, proven, then applied. Lower risk than the frontend pass because the backtest harness already exists (`ml/_baselines/`, local-only). _(This is Batch 5.4, deliberately deferred.)_

6. **Coordinated frontend pass (React 19 / Next 16 / Tailwind 4 / etc.)** — Last. Largest blast radius, zero client-visible value, and you need the test coverage from step 4 to do it safely. Tailwind 4 alone is a config rewrite (JS → CSS `@theme`). React 19 removes APIs you might be using. This is a dedicated sprint after delivery stabilizes. _(The deferred major pass; also carries N8 — migrate `next lint` → ESLint CLI.)_

**Rationale in one line:** ship the value the client is paying for (1-2-3), then build the safety net and take on the high-blast-radius upgrades (4-5-6) — with step 4 as the hard gate before 5 and 6.
