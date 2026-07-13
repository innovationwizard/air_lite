# Supabase API Key Migration — Legacy → Publishable/Secret

**Status:** ✅ COMPLETE 2026-07-13 — legacy keys disabled, `_THE_RULES.MD` flag updated. (Only optional manual browser-login spot-check remains.)
**Opened:** 2026-07-13
**Owner:** Jorge
**Driver:** `_THE_RULES.MD` §ACTIVE CONTEXT — *"Deprecated: SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY — do not use."* Legacy anon/service_role keys are removed by Supabase in **late 2026**, inside the delivery horizon.

> **Live document.** Update the checkboxes and the Status line as work lands. Record decisions in the Decisions log at the bottom.

---

## Key finding

The `.env` values are **already the new-format keys** (`sb_publishable_…`, `sb_secret_…`). This is **not** a key-regeneration job — it is fixing **env-var names and code references**, which are currently inconsistent and still use deprecated `anon`/`service_role` naming in several places.

Per the [migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys): the new **secret key bypasses RLS identically to `service_role`**, and the **publishable key carries the same low privileges as `anon`** (RLS behaves the same). So these are safe renames, not behavior changes.

## Current state (verified in code 2026-07-13)

The secret key is referenced under **three different names**; the publishable key still uses the deprecated `anon` name:

| Key (actual value type) | Env var name in use | Locations |
|---|---|---|
| Publishable (`sb_publishable_`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | [client.ts:6](frontend/src/lib/supabase/client.ts#L6), [server.ts:10](frontend/src/lib/supabase/server.ts#L10), [middleware.ts:45](frontend/src/middleware.ts#L45) |
| Secret (`sb_secret_`) | `SUPABASE_SERVICE_ROLE_KEY` ⚠️ deprecated name | [server.ts:38](frontend/src/lib/supabase/server.ts#L38), [ml/odoo_sync_oa_v2.py:32](ml/odoo_sync_oa_v2.py#L32) |
| Secret (`sb_secret_`) | `SUPABASE_SERVICE_KEY` (third name) | [ml/api.py:27](ml/api.py#L27), [ml/_baselines/golden_backtest.py:109](ml/_baselines/golden_backtest.py#L109) |

## Target naming convention

Supabase does **not** prescribe app env-var names (it only defines `SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS` for Edge Functions). Chosen convention, aligned with the new key names:

- Publishable → **`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**
- Secret → **`SUPABASE_SECRET_KEY`** (retire *both* `SUPABASE_SERVICE_ROLE_KEY` **and** `SUPABASE_SERVICE_KEY` → one name)

---

## Checklist

### Phase 0 — Confirm in the dashboard (do first) — ✅ DONE 2026-07-13
- [x] Settings → API Keys → **Publishable and secret API keys** tab. Confirm the `sb_publishable_…` and `sb_secret_…` keys in `.env4` match what's shown (created under name `default`). — **Confirmed correct by Jorge.**
- [x] Decide whether to **rotate** now. — **Decision: DO NOT rotate now.** Keep the existing `sb_publishable_`/`sb_secret_` values; this migration is rename-only.

### Phase 1 — Naming convention
- [ ] Confirm/adjust the target names above (or record an alternative in the Decisions log).

### Phase 2 — Code changes — ✅ DONE 2026-07-13
Frontend:
- [x] [client.ts:6](frontend/src/lib/supabase/client.ts#L6) — `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [x] [server.ts:10](frontend/src/lib/supabase/server.ts#L10) — same publishable rename
- [x] [server.ts:38](frontend/src/lib/supabase/server.ts#L38) — `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`
- [x] [middleware.ts:45](frontend/src/middleware.ts#L45) — same publishable rename

ML:
- [x] [ml/api.py:27](ml/api.py#L27) — `SUPABASE_SERVICE_KEY` → `SUPABASE_SECRET_KEY` (env string **and** the Python constant, incl. usage at [:31](ml/api.py#L31))
- [x] [ml/odoo_sync_oa_v2.py:32](ml/odoo_sync_oa_v2.py#L32) — `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`; usage banner [:12](ml/odoo_sync_oa_v2.py#L12) and error message [:219](ml/odoo_sync_oa_v2.py#L219) fixed
- [x] [ml/_baselines/golden_backtest.py:109](ml/_baselines/golden_backtest.py#L109) — `SUPABASE_SERVICE_KEY` → `SUPABASE_SECRET_KEY`; docstring [:23](ml/_baselines/golden_backtest.py#L23) fixed
- [x] `.env.example` (root) + `frontend/.env.example` — renamed to new names, example values shown as `sb_publishable_…` / `sb_secret_…`
- [x] [.github/workflows/ci.yml:24](.github/workflows/ci.yml#L24) — build-time `NEXT_PUBLIC_SUPABASE_ANON_KEY` placeholder → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (kept in step with the renamed code so the CI build validates the real var)

**Verification (2026-07-13):**
- `ruff check .` clean; `pytest` 35 passed, coverage floor met.
- `next lint` clean; `npm run build` **compiled successfully** (all routes + middleware) with placeholder publishable/secret env.
- `git grep` over the runtime set (frontend/src, ml, both `.env.example`, ci.yml) → **zero** old names remain.

### Phase 3 — Library sanity check — ✅ DONE 2026-07-13
- [x] Current: `@supabase/supabase-js ^2.49.0`, `@supabase/ssr ^0.5.0`. Guide sets no minimum version; new keys are drop-in strings and the production build compiles against them. **No forced bump** — a latest-patch bump (`@supabase/ssr` 0.6.x) is optional and deferred to normal dep maintenance.
- [ ] Header rule from the guide: *"Send publishable and secret keys on the `apikey` header only; do not use `Authorization: Bearer`."* The JS SDK handles this for `sb_`-prefixed keys; the manual ML REST calls already set the `apikey` header. **Still to be confirmed live in Phase 5.**

### Phase 2b — Broader footprint — ✅ DONE 2026-07-13 (decision: update all)
Jorge's call: **update all**. Renamed the deprecated names across **40 files** (token rename `SUPABASE_ANON_KEY`→`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_SERVICE_KEY`→`SUPABASE_SECRET_KEY`):
- [x] `scripts/ingest.py`, `scripts/reingest_lines.py` — live CLI utilities
- [x] ~35 one-shot scripts under `docs/reconciliation/` + `docs/april_jumpstart/` (incl. `step0_audit.py`, `_CHECKLIST_APR23_0930.md` curl examples, `_GERENTE`/`_RECONCILE` prose)
- [x] `SUPERREADME.md` — env table tokens **and** stale descriptions ("anonymous key"/"service role key" → "publishable key"/"secret key")
- [x] `docs/security/PLAN_API_AUTH_DEFENSE_IN_DEPTH.md` — rotation/secret-marking instructions

**Verification:** `git grep` residual → only the 3 excluded buckets below; `py_compile` on all renamed `.py` → OK.

**Deliberately EXCLUDED (renaming would corrupt meaning — left verbatim):**
1. `_THE_RULES.MD` §ACTIVE-CONTEXT line — it *declares* `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` deprecated; renaming would make it falsely mark the new names deprecated. Update separately once migration fully closes.
2. `changelogs/2026-03-22_deep-refactor-phases-0-6.md` — historical record of what was set on that date; not rewritten.
3. `june_delivery/TECH_DEBT_PROGRESS.md` + `TECH_DEBT_REMEDIATION_PLAN.md` — describe the deprecated key as a *known violation to fix*; the old name is the point of the sentence.

### Phase 4 — Update env vars on every runtime (must mirror the renames) — ✅ DONE 2026-07-13
> ⚠️ A rename not mirrored in the hosts = instant outage (same failure class as the 2026-04-24 ML auth-key drift).
- [x] **Railway** (ML service): `SUPABASE_SECRET_KEY` present; no `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (6 service vars confirmed via dashboard 2026-07-13)
- [x] **Frontend host = Vercel** (confirmed — resolves the earlier App-Runner-vs-Vercel doc ambiguity; live frontend is Vercel): `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + `SUPABASE_SECRET_KEY` added (both marked **Sensitive**, scoped Production+Preview)
- [x] Local canonical env consolidated to `.env4` (new names). Old `.env*` to be deleted.
- [x] [frontend/.env.production](frontend/.env.production) — introduces no old names (only `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_DEMO_MODE`)

**Live verification (2026-07-13):**
- **ML / Railway — full pass.** `/health`→200; protected endpoint **without** key→**401** (restored auth deployed & enforcing); with correct key→`404 "Run not found"` (auth passed **and** Supabase queried successfully → `SUPABASE_SECRET_KEY` wired correctly). Confirms both the auth fix *and* the key rename are live.
- **Frontend / Vercel — liveness only.** `airefill.app/login`→200. Browser login + service-role RLS-bypass path still to be confirmed after a Vercel **redeploy** picks up the new vars (env changes apply only to new deployments; `NEXT_PUBLIC_` vars are inlined at build time).

⚠️ **Vercel caveats:**
- Trigger a **redeploy** of the renamed commit so the new vars take effect (existing deployment still runs the pre-rename build).
- New vars are scoped **Production + Preview** only — add **Development** if you use `vercel dev`.

### Phase 5 — Verify before cutting over — mostly ✅ (browser login pending)
- [ ] Frontend: log in, load a role-gated page → publishable key + RLS auth works. **← ONLY REMAINING ITEM (manual, Jorge).** Vercel redeployed 2026-07-13; `/login`→200 and `/api/health`→ok on the new build.
- [x] ML: `/backtest/status/1` against live Railway — auth **enforced** (401 without key) and Supabase **queried** with correct key → `SUPABASE_SECRET_KEY` confirmed live.
- [x] Creds from consolidated local `.env`: Supabase REST with secret key → HTTP 200; Odoo authenticate → uid 198.
- [x] `ruff check . && pytest` (ml) green; `next lint && npm run build` (frontend) green.
- [x] Local `frontend/.env.local` migrated to new names (values preserved) so `npm run dev` matches the renamed code.

**Local env final state (2026-07-13):** `.env3`/`.env4` deleted; `.env4`→`.env` (new names inside); `frontend/.env.local` renamed to new names. No old names in any local env file.

### Phase 6 — Decommission legacy — ✅ DONE 2026-07-13
- [x] Runtime/config grep for old names → **zero** in the app path. Remaining mentions are intentional historical/meta only: `changelogs/`, `june_delivery/TECH_DEBT_*` (violation descriptions), and `_THE_RULES.MD` (now phrased as "disabled — do not re-enable").
- [x] **Legacy anon + service_role keys disabled** in the Supabase dashboard (dashboard now shows "Re-enable JWT-based API keys", i.e. currently off). Reversible if needed.
- [x] `_THE_RULES.MD` §ACTIVE-CONTEXT flag updated: from "Deprecated … do not use" → new-key convention + "legacy … disabled, do not re-enable."

---

## Sequencing rules
1. Do **Phase 4** (host env vars) in the **same deploy** as **Phase 2** (code), or the app 500s on missing keys.
2. Do **not** disable legacy keys (Phase 6) until **Phase 5** passes in production.

## Decisions log
- _2026-07-13_ — Checklist opened. Confirmed `.env4` already holds `sb_publishable_`/`sb_secret_` values; scope is rename + consistency, not regeneration.
- _2026-07-13_ — **Phase 0 closed.** Jorge confirmed the dashboard keys are correct. **Decision: do NOT rotate now** — reuse existing key values; migration is rename-only. (Rotation can be revisited later if the values need retiring.)
- _2026-07-13_ — **Naming confirmed:** publishable → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the `NEXT_PUBLIC_` prefix is required — key is read in browser via `createBrowserClient`); secret → `SUPABASE_SECRET_KEY` (server-only, no prefix).
- _2026-07-13_ — **Phases 2–3 landed & verified** (runtime code + `.env.example` + ci.yml). ml ruff/pytest green; frontend lint + production build green. Zero old names remain in the runtime set.
- _2026-07-13_ — **Discovered broader footprint** (~40 files in `docs/` + `scripts/`, see Phase 2b).
- _2026-07-13_ — **Decision: update all.** Swept all 40 files. Excluded 3 buckets where the deprecated name is the point of the text (`_THE_RULES.MD` deprecation flag, `changelogs/`, `june_delivery/TECH_DEBT_*` violation descriptions) — see Phase 2b.
- _2026-07-13_ — **Phase 4 done.** Railway (6 vars) + Vercel (2 new Sensitive vars) + local `.env4` all set with new names. ML side live-verified (auth + secret key). Frontend host confirmed = **Vercel**. **Decision: old `.env*` files to be permanently deleted** — production reads platform vars, not local files, so safe for prod; keep `.env4` as canonical and re-copy to `.env.local`/`.env` for local dev (those names are what tooling auto-loads; `.env4` is not).
- _2026-07-13_ — **Local env consolidated:** `.env3`/`.env4`/root `.env.local` deleted; `.env4`→`.env`; `frontend/.env.local` renamed to new var names (values preserved). Vercel redeployed; ML + Supabase + Odoo creds re-verified from the new `.env`.
- _2026-07-13_ — **Phase 6 done → MIGRATION COMPLETE.** Legacy anon/service_role keys disabled in dashboard; `_THE_RULES.MD` flag updated to the new-key convention. Optional: one manual browser-login spot-check.

## Sources
- [Migrating to publishable and secret API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Understanding API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/api-keys)
