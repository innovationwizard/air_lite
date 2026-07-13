# Supabase API Key Migration — Legacy → Publishable/Secret

**Status:** NOT STARTED
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

### Phase 0 — Confirm in the dashboard (do first)
- [ ] Settings → API Keys → **Publishable and secret API keys** tab. Confirm the `sb_publishable_…` and `sb_secret_…` keys in `.env4` match what's shown (created under name `default`).
- [ ] Decide whether to **rotate** now. The current `sb_secret_…` has been passed around in `.env3`/`.env4`/`.env.local` on disk — migration is the natural moment to mint a fresh secret key and retire the old value. *(Recommended, optional — record decision below.)*

### Phase 1 — Naming convention
- [ ] Confirm/adjust the target names above (or record an alternative in the Decisions log).

### Phase 2 — Code changes
Frontend:
- [ ] [client.ts:6](frontend/src/lib/supabase/client.ts#L6) — `NEXT_PUBLIC_SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- [ ] [server.ts:10](frontend/src/lib/supabase/server.ts#L10) — same publishable rename
- [ ] [server.ts:38](frontend/src/lib/supabase/server.ts#L38) — `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`
- [ ] [middleware.ts:45](frontend/src/middleware.ts#L45) — same publishable rename

ML:
- [ ] [ml/api.py:27](ml/api.py#L27) — `SUPABASE_SERVICE_KEY` → `SUPABASE_SECRET_KEY`
- [ ] [ml/odoo_sync_oa_v2.py:32](ml/odoo_sync_oa_v2.py#L32) — `SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`; also fix usage banner [:12](ml/odoo_sync_oa_v2.py#L12) and error message [:219](ml/odoo_sync_oa_v2.py#L219)
- [ ] [ml/_baselines/golden_backtest.py:109](ml/_baselines/golden_backtest.py#L109) — `SUPABASE_SERVICE_KEY` → `SUPABASE_SECRET_KEY`; also docstring [:23](ml/_baselines/golden_backtest.py#L23)
- [ ] Update every `.env.example` to the new names (docs-only, but keep them truthful)

### Phase 3 — Library sanity check
- [ ] Current: `@supabase/supabase-js ^2.49.0`, `@supabase/ssr ^0.5.0`. The guide sets no minimum version, but confirm latest patch (`@supabase/ssr` is now 0.6.x). New keys are drop-in strings; no `createClient` signature change.
- [ ] Header rule from the guide: *"Send publishable and secret keys on the `apikey` header only; do not use `Authorization: Bearer`."* The JS SDK handles this for `sb_`-prefixed keys; the manual ML REST calls already set the `apikey` header. Verify in Phase 5.

### Phase 4 — Update env vars on every runtime (must mirror the renames)
> ⚠️ A rename not mirrored in the hosts = instant outage (same failure class as the 2026-04-24 ML auth-key drift).
- [ ] **Railway** (ML service): add `SUPABASE_SECRET_KEY`; remove `SUPABASE_SERVICE_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- [ ] **Frontend host** (App Runner / Vercel — whichever serves `airefill.app`): add `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` + `SUPABASE_SECRET_KEY`; remove old names
- [ ] Local `.env3` / `.env4` / `frontend/.env.local`: rename to match
- [ ] [frontend/.env.production](frontend/.env.production) (tracked): confirm it introduces no old names

### Phase 5 — Verify before cutting over
- [ ] Frontend: log in, load a role-gated page → publishable key + RLS auth works
- [ ] Service-role path: hit an endpoint using `createServiceRoleClient()` and confirm it **bypasses RLS** (an operation a normal user couldn't do) → proves the secret key has elevated access
- [ ] ML: trigger `/backtest/status/<id>` and an Odoo sync dry-run → Supabase reads/writes succeed with `SUPABASE_SECRET_KEY`
- [ ] `npm run lint && npm run build` (frontend); `ruff check . && pytest` (ml)

### Phase 6 — Decommission legacy
- [ ] Grep whole repo for `SERVICE_ROLE`, `SERVICE_KEY`, `_ANON_KEY` → expect **zero** remaining
- [ ] After all above is green in prod, **disable the legacy anon + service_role keys** in the dashboard (reversible)
- [ ] Close the `_THE_RULES.MD` §ACTIVE-CONTEXT deprecation flag

---

## Sequencing rules
1. Do **Phase 4** (host env vars) in the **same deploy** as **Phase 2** (code), or the app 500s on missing keys.
2. Do **not** disable legacy keys (Phase 6) until **Phase 5** passes in production.

## Decisions log
- _2026-07-13_ — Checklist opened. Confirmed `.env4` already holds `sb_publishable_`/`sb_secret_` values; scope is rename + consistency, not regeneration.
- _(add decisions here: rotate-vs-keep, final env-var names, deploy window)_

## Sources
- [Migrating to publishable and secret API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)
- [Understanding API keys — Supabase Docs](https://supabase.com/docs/guides/getting-started/api-keys)
