# Tech-Debt Addendum — Drift Check & New Findings

_Compiled 2026-06-30, as the companion to [DEPENDENCIES_AND_TECH_DEBT.md](../docs/DEPENDENCIES_AND_TECH_DEBT.md) (the base audit, dated 2026-06-16). Purpose: record any tech debt accrued **after** the base audit was written, and correct/sharpen any of its claims against the live codebase as it stands today._

---

## 0. Headline

**No new commits have landed since the base audit.** The most recent commit on `main` is `8aa5c99` (2026-05-27, "bodegas page"), which **predates** the base audit (2026-06-16). The base audit therefore describes a codebase that has not changed since. Every dependency state it documents is still exactly true today — verified file-by-file below. There is no drift from new feature work to reconcile.

What this addendum adds is **(a) verification that the base audit is still accurate**, and **(b) a handful of findings the base audit either softened or did not cover** — most importantly, that re-enabling ESLint is far cheaper than its in-code justification implies.

---

## 1. Verification of the base audit (all still true as of 2026-06-30)

| Base-audit claim | Verified state today | Status |
|---|---|---|
| Frontend Docker on `node:18-alpine` | `frontend/Dockerfile` lines 7, 20, 40 — all three stages on `node:18-alpine` | ✅ confirmed |
| CI on Node 20 | `.github/workflows/ci.yml` `node-version: '20'` | ✅ confirmed |
| Local dev on Node 22 | `node --version` → `v22.17.1` | ✅ confirmed |
| ML Docker on `python:3.11-slim` | `ml/Dockerfile` line 1 | ✅ confirmed |
| CI Python 3.11 | `.github/workflows/ci.yml` `python-version: '3.11'` | ✅ confirmed |
| Local Python 3.14 | `python3 --version` → `3.14.3` | ✅ confirmed |
| `prophet` unpinned | `ml/requirements.txt` line 1 — bare `prophet` | ✅ confirmed |
| `numpy>=1.24.0,<2.0.0` | `ml/requirements.txt` line 3 | ✅ confirmed |
| `pandas>=2.0.0,<3.0.0` | `ml/requirements.txt` line 2 | ✅ confirmed |
| `gunicorn>=22.0.0,<23.0.0` | `ml/requirements.txt` line 6 | ✅ confirmed |
| `pytest>=8.0.0,<9.0.0` | `ml/requirements-dev.txt` line 1 | ✅ confirmed |
| ESLint disabled at build | `frontend/next.config.mjs` `eslint.ignoreDuringBuilds: true` | ✅ confirmed |
| jest 29 + jest-environment-jsdom 30 | `package.json` `jest@^29.7.0`, `jest-environment-jsdom@^30.3.0` | ✅ confirmed |
| `recharts` present, zero `src/` imports | declared `^2.12.7`; `grep -rn recharts frontend/src` → **0 hits** | ✅ confirmed |
| No `.nvmrc` / `engines` / `runtime.txt` | none present | ✅ confirmed |

**Conclusion:** the base audit needs no corrections to its facts. The remediation plan is built directly on it.

---

## 2. New / sharpened findings (not in the base audit, or softened there)

### N1 — ESLint backlog is trivial, not scary 🟢 (good news)

The base audit (§4 High #4) repeats the in-code justification from `next.config.mjs`:
> _"Old airefill components have warnings — don't block deploy. Will be cleaned up when old code is removed."_

**Measured reality (ran `npm run lint` on 2026-06-30, ESLint 8.57.1):**

- **12 warnings, 0 errors**, across **10 files**
- Rule breakdown: `@typescript-eslint/no-unused-vars` ×10, `react-hooks/exhaustive-deps` ×2
- There is exactly **one** `eslint-disable-next-line` in all of `frontend/src` (a deliberate `exhaustive-deps` suppression in `superuser/forecast-diagnostic/page.tsx:181`)

**Implication:** the "old airefill components have warnings" framing is **stale**. The backlog is a dozen trivial fixes (mostly unused constants like `MAX_MONTH`, `CONFIDENCE_COLORS`, `HOLDING_COST_RATE`), not a deep legacy mess. Re-enabling the lint gate is a low-risk, high-value batch — re-prioritize it accordingly. **0 errors** means the gate can be turned back on the moment the 12 warnings are resolved (or escalated to errors).

The complete 12-warning list (10 files) and the exact fix applied to each is in the Batch 2 disposition table in [TECH_DEBT_PROGRESS.md](./TECH_DEBT_PROGRESS.md). (An earlier draft of this finding listed only 9 of the 12 — the first `npm run lint` capture was truncated; the full enumeration and all fixes are now recorded in the ledger and were completed in Batch 2.)

> ⚠️ **Note for Jorge:** two of the removed unused declarations were business/project constants — `HOLDING_COST_RATE = 0.18` (the 18% holding-cost assumption) and the `MAX_MONTH = '2026-01'` blind-test cap. Both were genuinely dead (the cap is enforced by `MONTH_NAV`, not `MAX_MONTH`; the holding rate was referenced nowhere). The `MAX_MONTH` explanatory comment was preserved; `HOLDING_COST_RATE` was removed entirely. Flagged in case either is wanted back when a downstream feature lands.

### N2 — Thin automated-test coverage + `--passWithNoTests` masks it 🟠 (quality-gate debt, not dependency debt)

Not in the base audit (which is dependency-scoped), but it is real tech debt that the remediation touches:

- **Frontend:** exactly **1** test file under `frontend/src` (`find … -name '*.test.*'` → 1).
- **ML:** exactly **1** test module, `ml/tests/test_smoke.py`.
- **CI runs `npm test -- --ci --passWithNoTests`** — the `--passWithNoTests` flag means the frontend test step **goes green even if zero tests run**. Combined with one test file, the test gate is effectively decorative on the frontend.

**Why it matters for this plan specifically:** the numpy / Python / prophet batch (Batch 5) depends on a backtest to prove forecast output is unchanged. We cannot lean on a rich test suite to catch regressions — we must **establish an explicit golden backtest baseline** (`ml/backtest_engine.py` exists and gives us the tool) before any ML environment change. This is folded into Batch 5 as a hard prerequisite.

**Recommendation:** this is logged as debt but is **out of scope** for the dependency-remediation plan unless you say otherwise (Rule 10). Flagged here so it is on the record.

### N3 — `@types/node` will need to move with the Node bump (mechanical)

The base audit notes `@types/node@^20.14.2` "should follow runtime." When Batch 1 bumps the runtime to Node 22, `@types/node` must move to `^22` in the same batch or the types lag the runtime. Captured in Batch 1 so it isn't forgotten.

### N4 — Only `eslint.ignoreDuringBuilds` is suppressed — TypeScript checking is NOT bypassed 🟢

Verified: `next.config.mjs` suppresses **only** ESLint. There is **no** `typescript.ignoreBuildErrors`, and `tsconfig.json` has `"strict": true`. So type-safety is intact; the single disabled gate is lint. This narrows the "quality gates disabled" surface to exactly one item — good news for scope.

### N6 — Frontend Dockerfile is broken independent of Node version 🟠 (found via Batch 1 image smoke test, 2026-06-30)

`frontend/Dockerfile` is written for a Next.js **standalone** build — its runner stage does `COPY --from=builder /app/.next/standalone ./` (line 52) and `CMD ["node", "server.js"]` (line 72). But `frontend/next.config.mjs` does **not** set `output: 'standalone'`, so Next never emits `.next/standalone` or `server.js`. **The image build fails at the runner stage** — verified by `docker build` on 2026-06-30:

```
ERROR: failed to compute cache key: "/app/.next/standalone": not found
Dockerfile:52  COPY --from=builder /app/.next/standalone ./
```

**This is Node-independent** — it fails identically on Node 18 or 22. The Node 22 portion of Batch 1 is unaffected and verified: `npm ci` + `npm run build` both succeed on `node:22-alpine` (the builder stage completes; only the standalone COPY fails).

**Why it has gone unnoticed:** per `AIR3_DELIVERY_PLAN.md` (§4 Chapter 1), the **frontend deploys on Vercel**, which does its own build and ignores this Dockerfile. The Dockerfile targets **AWS App Runner** (per its own header) — aspirational infra not yet in the deploy path. So the image has likely never built from the current config.

**Status:** ✅ **FIXED 2026-06-30.** Jorge confirmed the App Runner image is real, so the fix was applied: added `output: 'standalone'` to `frontend/next.config.mjs`. Verified end-to-end — local `npm run build` now emits `.next/standalone/server.js`; the **full Docker image builds clean** on `node:22-alpine` (465 MB); and the container **boots and serves** (Next.js Ready in 96 ms, HTTP 307 auth redirect from `/`, Node v22.23.1 inside the image). This was found by the Batch 1 Docker smoke test and fixed as a tracked separate item alongside Batch 1.

### N7 — Empty interface in `input.tsx` 🟢 (surfaced + fixed during Batch 2, 2026-06-30)

Upgrading `@typescript-eslint` 7→8 (for ESLint 9) activated the v8 rule `@typescript-eslint/no-empty-object-type`, which flagged `src/components/ui/input.tsx:5` — the shadcn-default `export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}` (an empty interface equivalent to its supertype). **Fixed** by converting to a type alias (`export type InputProps = React.InputHTMLAttributes<HTMLInputElement>`) — the shadcn-recommended fix; the `InputProps` export is preserved identically. This was an **Error** (recommended-config), so it would block the build now that the lint gate is live. Closed within Batch 2.

### N8 — `next lint` is deprecated, removed in Next 16 🟡 (forward-looking, deferred)

`next lint` prints: _"`next lint` is deprecated and will be removed in Next.js 16. Migrate to the ESLint CLI: `npx @next/codemod@canary next-lint-to-eslint-cli .`"_. The Batch 2 lint gate is built on `next lint` (still fully functional on Next 15). When the **deferred Next 15→16 coordinated pass** happens, the lint invocation must migrate to the ESLint CLI (and very likely to flat config at that point) via the codemod above. **Not actionable now** — it belongs to the Next-16 pass, not this remediation. Logged so the future pass doesn't miss it.

### N5 — `forecast_purchases_derived.py` already exists in the repo (context, not debt)

The derived-ratio refactor referenced in `AIR3_DELIVERY_PLAN.md` Chapter 2 is partially present (`ml/forecast_purchases_derived.py`). This is **delivery-plan scope, not tech-debt scope**, and is explicitly **not** part of this remediation. Noted only so it isn't mistaken for debt or accidentally touched.

---

## 3. Net effect on the remediation plan

| Finding | Effect on plan |
|---|---|
| N0 (no drift) | Plan can be built directly on the base audit with no reconciliation. |
| N1 (lint trivial) | ESLint batch is low-risk; can run early. Scope = fix 12 warnings, then flip the flag. |
| N2 (thin tests) | Batch 5 **must** establish a golden backtest baseline first; cannot rely on the test suite. |
| N3 (`@types/node`) | Added to Batch 1. |
| N4 (only lint suppressed) | Confirms quality-gate scope is exactly one item. |
| N5 (derived refactor) | Explicitly excluded from this plan. |

Plan: [TECH_DEBT_REMEDIATION_PLAN.md](./TECH_DEBT_REMEDIATION_PLAN.md). Live progress: [TECH_DEBT_PROGRESS.md](./TECH_DEBT_PROGRESS.md).
