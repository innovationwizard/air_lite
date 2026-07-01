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

---

## Phase 2 — Full AWS Migration + Delivery + Hardening

> **RECONCILED 2026-07-01 (rev. 2).** Jorge added `Full-AWS-architecture-for-Air-3_0.md` (+ addendum) + `Best-UX-for-B2B-SaaS-auth.md` and chose **full AWS migration, all at once**. The addendum makes the target a **literal two-account split-plane** (superseding the single-account `aid-saas-prod` draft). **This section replaces P1–P6 with three tracks:**
>
> - **Track M — AWS migration** (M0–M12): stand up the two-account split-plane. **Replaces old P1.**
> - **Track D — Forecasting delivery** (D1–D4): old P2 → D1–D3, old P3 → D4.
> - **Track H — Hardening** (H1–H3): old P4 → H1, old P5 → H2, old P6 → H3.
>
> **Two-account split-plane (the target):**
>
> | Account | Owner / billing | Holds |
> |---|---|---|
> | **CLIENT** (`plasticentro`) | Their card, ~$100–150/mo, **no invoicing** | Frontend App Runner · Aurora Serverless v2 (their data) · Secrets Manager |
> | **JORGE** (SaaS margin) | His cost, ~$60–120/mo | ML API App Runner (Census Filter + serving) · S3 weights (all tenants) · Lambda/EventBridge training · ECR · CloudWatch · SES |
>
> **Cross-account control:** the client grants Jorge's CI/CD a **deployment IAM role**; CI pushes container images + infra into their account. They see/pay their running services; they **cannot** modify the code (it lives in Jorge's repo) or reach the moats (Census Filter + weights never enter their account). Exit = revoke the ML API key; they keep their account + data + the frontend (their perpetual license anyway).
>
> **AIR3 reconciliation (flag per Rule 3 — amend AIR3 or annotate superseded):** §1 "keep Supabase/Vercel" + §7 "no Aurora" are **reversed**. §5 billing changes from "$500 budget, invoiced to client" → **client pays their own AWS bill directly**; Jorge absorbs the ML plane. The escrow/IP tension **resolves** — the client account contains **zero moats** by construction, which is *more* protective than the prior split-plane framing.

### ⚠️ Leaving Supabase is not "Aurora instead of Postgres"

Supabase bundles Postgres **+ PostgREST (the REST API `@supabase/supabase-js` calls) + GoTrue (auth) + RLS keyed on `auth.uid()` + Storage + Realtime**. Aurora is only Postgres. Measured surface to replace (2026-07-01):

| Dependency | Count | Replacement |
|---|---|---|
| Frontend `.from()` | 71 | Aurora data access (see M0 decision) |
| Frontend `.rpc()` | 25 | + 57 Postgres functions to port to Aurora |
| Frontend auth | 16 | → WorkOS |
| Frontend storage | 3 | → S3 |
| Realtime | **0** | none (not used) |
| ML `supabase.table/.rpc` | 21 | Aurora data access |
| DB objects | 38 tables · 42 migrations · 57 functions · **37 RLS policies** | port + re-architect authz |

**Forecast guard still applies:** D1/D2 and H2 touch/recompile the forecasting path → gate with the golden-backtest harness (`ml/_baselines/`). All data-migration batches (M2/M3/M6) are parity-checked (row counts + checksums) before any cutover. **Live paying client** — "all at once" still cuts over in a staged, parity-gated way (M12), not a big-bang switch.

### M0 — Prerequisites & pivotal decisions _(decision gate — resolve before M2/M4/M6)_

**External prereqs (Jorge / AIR3 §6):** **two** AWS accounts — Jorge's (ML plane) + the client's `plasticentro` (data plane, §6.5/§6.6) — plus a **cross-account deployment IAM role** the client grants Jorge's CI; **WorkOS account**; Odoo creds (§6.4). The IP/escrow addendum (§6.7) is simpler now (client account holds zero moats) but still worth formalizing.

**Pivotal architectural decisions:**
- **D-ACCESS — ✅ DECIDED 2026-07-01: (b) Direct-Postgres DAL rewrite.** Drop `@supabase/supabase-js`; talk to Aurora with a typed data layer (`pg`/Drizzle/Kysely) inside the server handlers. `.from()` → typed query; `.rpc('fn')` → `SELECT fn(...)` (the 57 functions still live in Aurora).
  - **Reasoning:** (1) It's the only option that actually reaches the stated **managed Aurora + WorkOS** end-state — (a) self-host PostgREST and (c) self-host full Supabase both re-host Supabase pieces we're trying to shed, and both need a throwaway GoTrue→WorkOS JWT bridge. (2) The migration is **much cheaper than "133 calls" implies**: data access is **~97% server-side already** (79 server-client vs 2 browser-client usages), concentrated in ~40 `src/app/api/**/route.ts` handlers + `src/lib/auth/server.ts` — so there is no server/API layer to invent, just handlers to convert + 2 browser spots to move behind routes. (3) Lowest steady-state ops (no PostgREST/GoTrue to run/patch). (4) Typed queries catch what the untyped SDK hides. (5) It composes cleanly with WorkOS (auth) + app-layer authz (below). Cost is front-loaded and de-risked by **H1 coverage first → per-page parity vs Supabase → golden-backtest harness proving ML reads identical on Aurora.**
- **D-AUTHZ — ✅ DECIDED 2026-07-01: defense-in-depth, database-enforced tenant + role isolation.** _Criteria (Jorge): client-data + moat security first, then world-class enterprise practice — effort/current-state explicitly irrelevant._ Enforce at **every** layer:
  1. **Identity:** WorkOS, JWT **server-verified every request** (never trust the cookie — per _THE_RULES NEXT.JS pattern).
  2. **App gate:** one typed role matrix through a **single DAL entry point** (`verifySession`+`getUser`, cached) — every route handler/server action (per _THE_RULES + global "centralized authorization").
  3. **DB gate (Aurora RLS as a *real* boundary):** DAL sets per-request session context (`SET LOCAL app.tenant_id/app.user_id/app.role` from the verified identity); RLS enforces **tenant isolation** (`row.tenant_id = app.tenant_id`) + role scoping. DB refuses unauthorized/cross-tenant rows even if the app layer has a bug.
  4. **Least-privilege connection:** app traffic uses a role **subject to RLS** (no `BYPASSRLS`); a privileged role is reserved **only** for system jobs (migrations, training) — never serving. **Eliminates the current 74× RLS-bypassing service-role anti-pattern** (and the deprecated `SUPABASE_SERVICE_ROLE_KEY` usage flagged in _THE_RULES).
  5. **Tenant isolation first-class:** `tenant_id` a first-class column; RLS guarantees tenant A can never read tenant B (multi-tenant: per-tenant S3 weights, client #2 coming).
  6. **Moat (auth):** ML API authenticates callers with a **scoped, rotatable, per-tenant credential** (prefer short-lived signed tokens over a static key); secrets in **Secrets Manager, not `.env`**; cross-account IAM least-privilege; ML API access **audit-logged** to CloudWatch; Census Filter + weights never leave Jorge's account.
  - **Consequence:** **M5 grows deliberately** (real per-tenant/role RLS + session-context + removing service-role-from-serving); M4/M6 wire the session context + least-privilege role. Reinforces D-ACCESS **(b)** — the direct-DAL is where per-request context + the single authz gate live.
- **D-CUTOVER — ✅ DECIDED 2026-07-01: blue-green with a short freeze + verified delta + warm rollback.** Build the entire green stack ahead of time and test it against a recent snapshot; at cutover → **short off-hours freeze** (minutes) → incremental **delta sync** of rows changed since the snapshot → **row-count + checksum parity gate** → **golden-backtest harness on Aurora must be 0-delta** → flip → keep blue (Supabase/Railway/Vercel) **warm for a rollback window** (hours–days) → decommission after soak.
  - **Reasoning (security-of-data first, per Jorge):** the app is **read-heavy / low-write / business-hours** (47 reads vs ~16 writes, 7 write routes, no 24/7 stream), so continuous dual-run buys zero-downtime we don't need at the cost of the **highest integrity/exposure risk** (cross-cloud CDC drift/split-brain + long-lived replication creds spanning both accounts + auth can't be shadowed anyway). Blue-green gives a **single clean, point-in-time-consistent, checksum-verified, harness-proven copy before any traffic hits Aurora**, a **short** exposure window, and a **fast, safe rollback** — the most defensible for client-data integrity and the enterprise standard. **Auth note:** WorkOS users are pre-provisioned before the flip (Supabase Auth ↔ WorkOS can't be dual-run); users re-authenticate once.

### Track M — Migration to the two-account split-plane

_Account tags: **[J]** = Jorge's account (ML plane), **[C]** = client `plasticentro` account (data plane), **[X]** = cross-account._

- **M1 — AWS foundation (both accounts + cross-account trust).** **[J]** Jorge's account: IAM + GitHub OIDC (CI deploy role, no long-lived keys), ECR repos (frontend + ml), CloudWatch baseline, SES, AWS Budgets alarm. **[C]** Client account: bootstrap + **[X]** a cross-account deployment role trusting Jorge's CI (least-privilege: App Runner, Aurora, Secrets only). _Verify:_ CI assumes the client role + pushes to ECR; both budget alarms armed. _(Client account setup is the client's action — Jorge's CI just needs the granted role.)_
- **M2 — Aurora Serverless v2 + schema [C].** In the **client account**: provision cluster (scale-to-zero); port 38 tables + extensions + all 57 functions/RPCs; establish an Aurora-native migration flow from the 42 existing migrations. _Verify:_ schema diff vs Supabase = 0 objects missing; all 57 functions create cleanly.
- **M3 — Data migration [C].** Dump Supabase → load Aurora (client account); **row-count + checksum parity** per table; Supabase stays authoritative until M12. _Verify:_ every table row-count + checksum matches; spot-check `revenue_daily_for_ml` (the ML source).
- **M4 — Auth → WorkOS [C/ext]** _(per D-AUTHZ)_. WorkOS wired to the client-account frontend: SSO (SAML+OIDC), organization/tenant model, session; rewrite the DAL `verifySession()`/`getUser()` as the **single authz entry point** (JWT server-verified every request, cached) + the 16 auth sites. _Verify:_ login end-to-end; sessions server-verified (no cookie-trust); DAL is the sole gate.
- **M5 — Authz / RLS re-architecture [C]** _(depends M4; defense-in-depth per D-AUTHZ — grows deliberately)_. Establish **least-privilege DB roles** (app role **subject to RLS**, no `BYPASSRLS`; privileged role only for migrations/training). Add `tenant_id` as first-class; DAL sets per-request `SET LOCAL app.tenant_id/app.user_id/app.role`; author **real** Aurora RLS enforcing tenant isolation + role scoping (replaces the coarse 37-policy set). Preserve the centralized typed role matrix. **Remove all service-role-from-serving usage.** _Verify:_ role-matrix tests pass; a `CAN_VIEW_COMPRAS`-only user sees exactly what they did before; a cross-tenant query returns **zero** rows at the DB even with app checks disabled (negative test); no serving path uses a BYPASSRLS role.
- **M6 — Data-access layer [C]** _(the big code batch, per D-ACCESS (b))_. Rewrite 71 `.from` + 25 `.rpc` (FE, concentrated in ~40 server handlers) + 21 ML calls + 3 storage→S3 to **typed Aurora queries via the least-privilege connection** (each request through the DAL session-context); move the 2 browser-client spots behind routes. _Verify:_ per-page parity vs Supabase; ML reads (`revenue_daily_for_ml`) identical (golden-backtest harness on Aurora → 0 delta); no direct DB access outside the DAL.
- **M7 — ML API on App Runner [J].** In **Jorge's account**: build `ml/` image via ECR (python 3.12); S3 `air3-weights` bucket (all tenants; versioning, `{tenant}/{sku}/{version}/`) + IAM; env via Secrets Manager; `/health`, autoscaling; client access via the revocable **ML API key**. _Verify:_ `/health` 200; prediction parity vs Railway (harness). _(Moats stay here — never enter the client account.)_
- **M8 — Frontend on App Runner [C].** In the **client account** (via cross-account deploy role): standalone image (N6) from Jorge's ECR; env via Secrets Manager. _Verify:_ app serves; auth + data paths work against Aurora/WorkOS.
- **M9 — Training pipeline + scheduler [J].** In **Jorge's account**: Lambda/Fargate job fits Prophet + ratios → serializes 5 artifacts to S3 per `{tenant}/{sku}/{version}/`; EventBridge cron (weekly/nightly). Reads client training data via the same path the ML API uses. _Verify:_ scheduled run trains 23 SKUs; artifacts land; serving loads them (ties to D2).
- **M10 — Email (SES) [J] + Storage (S3).** SES in **Jorge's account** for transactional email; move the 3 storage sites to S3 (tenant-scoped). _Verify:_ test email delivered; storage read/write works.
- **M11 — Observability (CloudWatch) [J+C].** ML-plane logs/metrics/alarms in **Jorge's account**; data-plane (App Runner + Aurora) in the **client account** (cross-account dashboard optional). Alarms: 5xx, latency, training failure. _Verify:_ alarms fire on induced failure; dashboards live.
- **M12 — Cutover & decommission [X]** _(blue-green short-freeze, per D-CUTOVER)_. Green stack pre-built + tested vs a recent snapshot; pre-provision WorkOS users. Cutover: **short off-hours freeze** → **delta sync** (rows changed since snapshot) → **row-count + checksum parity gate** → **golden-backtest harness on Aurora = 0-delta** → flip DNS/config → keep **blue warm for a rollback window** (hours–days) → retire **Railway + Vercel + Supabase** after soak. _Verify:_ parity + harness gates pass **before** flip; frontend+data on the client account, ML on Jorge's account; rollback rehearsed; old providers off only after soak; each bill within budget.

**Track M done when:** Air 3.0 runs on the two-account split-plane (client: frontend App Runner + Aurora + WorkOS; Jorge: ML App Runner + S3/training + SES/CloudWatch/ECR), parity-verified, old providers decommissioned, moats isolated in Jorge's account.

### Track D — Forecasting delivery _(overlaps Track M's ML plane)_

- **D1 — Derived-ratio: verify/finish.** `forecast_purchases_derived.py` + `/forecast/purchases-derived` endpoint are **already built**; verify against the harness + confirm `route.ts` Pass-1/Pass-2 orchestration. Add Tier-3 fallback (supplier-class median ratio, CARVAJAL/REYMA) for the 6 insufficient-data SKUs. _Verify:_ purchase-forecast error collapses from +1,069% to ±15% on samples; 6 fallback SKUs return a documented ratio. _(was P2.1–P2.2)_
- **D2 — Weight persistence serving** _(depends M7/M9)_. Serving endpoint loads stored model from S3 (cached) → ms latency; matches fresh train within tolerance. _Verify:_ served == fresh within tolerance; latency ms. _(was P2.3–P2.4)_
- **D3 — Odoo sync Feb–Jun 2026** _(post-sale; respect pre-production gates in `_qci/`)_. _Verify:_ `revenue_daily_for_ml` + demand updated through Jun; blind-test cutoff discipline preserved. _(was P2.5–P2.6)_
- **D4 — Acid Test 2 & validation.** Assemble Feb/Mar actuals; predicted-vs-actual report per SKU/metric; gain-sharing backtest; present; **sign the baseline document** (§6.1). _Verify:_ Acid Test 2 scored, baseline signed. _(was P3)_

### Track H — Hardening _(H1 is the gate before H2/H3, and before the M6 rewrite ideally)_

- **H1 — Test coverage expansion** _(addendum N2; hard gate)_. Critical paths: prediction pipeline (`forecast_revenue`), Census Filter, derived-ratio, auth/DAL, data sync. Drop `--passWithNoTests`; set a CI coverage floor. _Verify:_ critical paths covered; CI enforces floor. _(was P4)_ **Especially valuable before M6 — a rewrite of 133 call sites needs a regression net.**
- **H2 — Pandas 3.0** _(golden-backtest gated)_. Build pandas-3.0 image (mirror `_baselines/Dockerfile.target`); CoW audit of `ml/*.py`; diff vs baseline; fix CoW sites; apply to `ml/requirements.txt`. _Verify:_ diff within tolerance, prod image green. _(was P5 / deferred Batch 5.4)_
- **H3 — Coordinated frontend major pass** _(last; needs H1 coverage)_. React 18→19 · Next 15→16 (+ `next lint`→ESLint CLI, N8) · Tailwind 3→4 · zustand 4→5 · date-fns 3→4 · echarts 5→6 · lucide→1.x · TS→6 · ESLint→10. One major at a time, gated by tests. _Verify:_ build+test green per bump; full regression + deploy. _(was P6)_

**Sequencing note:** M1 → (M2‖H1) → M3 → M4 → M5 → M6 → M7/M8 → M9 → M10/M11 → M12; Track D interleaves once M7/M9 exist (D1 can start immediately — mostly built); H1 should precede M6; H2/H3 after cutover stabilizes. Deliver-first still holds: get the client value (D-track + Acid Test 2) provable even as the migration proceeds.

_(The original P2–P6 specs are superseded by Tracks D and H above. Mapping: P2 → D1–D3, P3 → D4, P4 → H1, P5 → H2, P6 → H3. The forecast-guard, harness reuse, and Verify steps carried over verbatim into the D/H batches.)_
