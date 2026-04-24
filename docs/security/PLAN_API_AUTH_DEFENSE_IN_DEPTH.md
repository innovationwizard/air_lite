# Plan — API Auth Hardening: Defense in Depth, 4 Layers

**Date created:** 2026-04-23
**Severity:** HIGH (data leakage of competitive intel — confirmed)
**Adheres to:** [_THE_RULES.MD](../../_THE_RULES.MD) — production-first, no assumptions, enterprise-grade, no corner-cutting.

---

## 0. The leak (verified, not assumed)

```
$ curl -s "https://air-lite-app.vercel.app/api/acid-test/gap-report?action=skus"
{"skus":[{"sku":"77205001","product_name":"Bandeja Bio 2P Foam ...","net_sales_quantity":580143.62}, ...]}
```

No auth header. No cookie. Returns 23 SKUs with sales totals worth millions of GTQ to a competitor.

This exposure exists for **every API endpoint** in the project today, not just the new gap-report — including `/api/gerencia/validacion`, `/api/admin/users`, `/api/oa/*`, `/api/backtest/*`, `/api/kpis/*`. **27 of 28 API routes are publicly readable** (only `/api/health` is intentionally public).

---

## 1. Current-state audit (what's already in place)

Reading the codebase reveals the security floor is **higher than I initially thought** but the implementation is incomplete and inconsistent. Honest grading:

### 1.1 Layer 1 — Edge (middleware): **F (broken)**

[frontend/src/middleware.ts:20](../../frontend/src/middleware.ts#L20):
```ts
if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) || pathname.startsWith('/api/')) {
  return NextResponse.next();   // ← unconditional bypass for ALL /api/*
}
```

This single line negates everything else.

### 1.2 Layer 2 — Per-route session check: **D (helper exists, nobody uses it)**

[frontend/src/lib/auth/server.ts](../../frontend/src/lib/auth/server.ts) defines:
- `getAuthUser()` — returns `{id, email, role, displayName}` from session + user_profiles
- `requireAuth(allowedRoles?)` — returns the user OR a 401/403 Response
- `Role` enum + `isAuthorized()` helper

**Zero** of the 28 API routes call these helpers. `grep "auth.getUser\|requireAuth" frontend/src/app/api/**/route.ts` returns nothing.

### 1.3 Layer 3 — Database RLS: **C+ (partial coverage, half-blocked by service-role usage)**

RLS is **enabled and policied** for the original schema's tables (per [20260323000002_rbac.sql](../../supabase/migrations/20260323000002_rbac.sql)):

✅ `products`, `sale_orders`, `sale_order_lines`, `inventory_daily`, `demand_daily`, `backtest_runs`, `backtest_results`, `backtest_savings`, `user_profiles`, `route_permissions`

The policy pattern is:
```sql
CREATE POLICY "products_read" ON products FOR SELECT USING (
  auth_role() IS NOT NULL  -- any authenticated user with a profile
);
CREATE POLICY "products_service_write" ON products FOR ALL USING (
  auth.role() = 'service_role'
);
```

This is well-formed. **But it only fires when queries come through the anon-key client with a session cookie.** All 27 API routes use `createServiceRoleClient()` (the service-role key) which **bypasses RLS entirely** ([service_role policy explicitly grants ALL](https://supabase.com/docs/guides/auth/row-level-security#bypassing-row-level-security)).

So the RLS work is **defensive scaffolding that's never tested in practice** because no production query actually goes through it.

❌ **RLS NOT enabled** on tables added since the RBAC migration (auditing all `CREATE TABLE` after 2026-03-23):
- OA module (9 tables): `open_orders`, `open_order_lines`, `dispatch_plan_weeks`, `warehouse_config`, `unloading_times`, `reception_schedule`, `weekly_audits`, `extraordinary_orders`, `extraordinary_order_lines`
- Acid-test (3 tables): `revenue_daily`, `products_acid_test_active`, `products_acid_test_archived`
- Plus: `customers`, `suppliers`, `warehouses`, `stock_locations`, `stock_moves`, `stock_quants`, `purchase_orders`, `purchase_order_lines`, `units_of_measure`, `exchange_rates`, `app_settings`, `audit_log`, `tenants` — never had RLS even in the original schema

**Net coverage: 10 of ~32 tables have RLS. ~31% protected at the DB level even if API leaks.**

### 1.4 Layer 4 — Service-to-service & ops: **D (one good pattern, not extended)**

✅ ML service has the `X-API-Key` shared-secret pattern ([ml/api.py:31-37](../../ml/api.py#L31-L37) verifies header, frontend [api/backtest/run/route.ts](../../frontend/src/app/api/backtest/run/route.ts) sends it).

❌ Not extended to inbound: anything calling Next.js from outside (Railway cron, future Odoo sync) has no auth path.
❌ No rate limiting at the edge (Vercel Edge Config not used for this).
❌ No CSRF protection on POST/PATCH/DELETE.
❌ `audit_log` table exists but no API route writes to it.
❌ No key rotation policy documented.

### 1.5 Net assessment

The team built the right pieces (RBAC tables, RLS policies, auth helpers, service-key pattern) but **wired nothing together**. This is a "security theater" pattern — looks defended, isn't.

---

## 2. Target architecture — Defense in Depth, 4 Layers

```
                        ┌─────────────────────────────────────┐
        Public          │  Layer 1 — EDGE (Next.js middleware) │
   ──────────────►      │  • Allowlist /api/health, /api/auth/*│
                        │  • Else → require Supabase session   │
                        │    cookie OR valid X-API-Key header  │
                        └─────────────────────┬───────────────┘
                                              ▼
                        ┌─────────────────────────────────────┐
                        │  Layer 2 — HANDLER (route.ts)        │
                        │  • requireAuth(allowedRoles)         │
                        │  • Role gate (gerencia / compras /   │
                        │    operaciones / superuser / admin)  │
                        └─────────────────────┬───────────────┘
                                              ▼
                        ┌─────────────────────────────────────┐
                        │  Layer 3 — DATABASE (PostgreSQL)     │
                        │  • RLS enabled on every table        │
                        │  • Reads use anon-key + session →    │
                        │    RLS policies fire                 │
                        │  • Writes use anon-key+session OR    │
                        │    service-role for trusted batch    │
                        └─────────────────────┬───────────────┘
                                              ▼
                        ┌─────────────────────────────────────┐
                        │  Layer 4 — OPERATIONAL              │
                        │  • Service-to-service via API key    │
                        │  • audit_log on sensitive endpoints  │
                        │  • Rate limit at edge                │
                        │  • Key rotation schedule             │
                        │  • CSRF on mutating requests         │
                        └─────────────────────────────────────┘
```

Each layer is **independently sufficient to deny unauthorized access**. Any one of them failing still leaves the other three. That's defense in depth.

---

## 3. Implementation plan per layer

### LAYER 1 — Edge (Middleware)

**File:** [frontend/src/middleware.ts](../../frontend/src/middleware.ts)

**Change:**
```ts
const PUBLIC_PAGE_ROUTES = ['/login', '/health', '/forgot-password', '/auth/callback'];
const PUBLIC_API_ROUTES = ['/api/health', '/api/auth/callback'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allowlist exact public routes
  if (PUBLIC_PAGE_ROUTES.some((r) => pathname.startsWith(r))) return NextResponse.next();
  if (PUBLIC_API_ROUTES.some((r) => pathname.startsWith(r))) return NextResponse.next();

  // For /api/*: accept either a valid Supabase session cookie OR a valid service API key
  if (pathname.startsWith('/api/')) {
    const apiKey = request.headers.get('x-api-key');
    if (apiKey && apiKey === process.env.SERVER_TO_SERVER_API_KEY) {
      return NextResponse.next();
    }
    // fall through to session check
  }

  // Session check (same as before — applies to pages AND api routes)
  const { user } = await checkSupabaseSession(request);
  if (!user) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}
```

**Rollback:** revert this single file. No DB or schema impact.

**New env var to set in Vercel:** `SERVER_TO_SERVER_API_KEY` (32-byte hex). Distinct from the existing `ML_SERVICE_API_KEY` which goes Next.js → Railway; this one is for inbound Railway → Next.js, cron → Next.js, etc.

**Verification:**
```bash
# Should now 401:
curl -s -o /dev/null -w "%{http_code}\n" https://air-lite-app.vercel.app/api/acid-test/gap-report?action=skus
# Expected: 401

# Should still 200 with session cookie (manually copied from browser):
curl -H "cookie: sb-...-auth-token=..." https://air-lite-app.vercel.app/api/acid-test/gap-report?action=skus
# Expected: 200 with JSON

# Should 200 with API key:
curl -H "x-api-key: $SERVER_TO_SERVER_API_KEY" https://air-lite-app.vercel.app/api/acid-test/gap-report?action=skus
# Expected: 200 with JSON
```

**Risk:** if any frontend page makes a same-origin `fetch('/api/...')` call before the user is authenticated, it would now 401. Mitigation: every page that calls `/api/*` is under `(authenticated)/` route group, which already requires a session.

### LAYER 2 — Handler (per-route session + role check)

**Helper exists** ([frontend/src/lib/auth/server.ts](../../frontend/src/lib/auth/server.ts) `requireAuth`). Just needs to be **invoked** in every API route.

**Pattern to apply to every API handler:**
```ts
import { requireAuth } from '@/lib/auth/server';

export async function GET(req: NextRequest) {
  const user = await requireAuth(['gerencia', 'superuser', 'admin']);
  if (user instanceof Response) return user;   // 401 or 403
  // ... rest of handler ...
}
```

**Per-route role-gating matrix — use the user's existing design, not a speculative one.**

The matrix is the single source of truth in **two places the user has already authored**:

1. **Database:** `route_permissions` table ([20260323000002_rbac.sql](../../supabase/migrations/20260323000002_rbac.sql)) — dynamic, query-at-runtime. Currently 23 rows covering 8 route patterns:

   | Pattern | Roles |
   |---|---|
   | `/api/admin/*` | admin (all methods) |
   | `/api/backtest/*` | admin (GET/POST); compras, financiero, gerencia, inventario, operaciones, ventas (GET) |
   | `/api/kpis/*` | admin, financiero, gerencia (GET) |
   | `/api/kpis/abc-xyz` | + inventario, operaciones, ventas |
   | `/api/kpis/days-of-inventory` | + operaciones |
   | `/api/kpis/slow-moving` | + compras, inventario, operaciones |
   | `/api/kpis/stockout-risk` | + compras, inventario, operaciones, ventas |
   | `/api/oa/*` | operaciones (all methods) |

2. **Code:** `CAN_*` constants in [frontend/src/lib/auth/roles.ts](../../frontend/src/lib/auth/roles.ts) — compile-time, TypeScript-typed. Defines `CAN_VIEW_GERENCIA`, `CAN_VIEW_COMPRAS`, `CAN_VIEW_OPERACIONES`, `CAN_VIEW_OA`, `CAN_MANAGE_USERS`, `CAN_MODIFY_SETTINGS`, etc. **Superuser bypasses all checks**.

**Gap in the existing design** — 6 route patterns exist in code that are NOT in `route_permissions`:
- `/api/acid-test/*` — new (added today) — expected roles: `CAN_VIEW_GERENCIA`
- `/api/gerencia/*` — existing — expected roles: `CAN_VIEW_GERENCIA`
- `/api/export/*` — existing — expected roles: `CAN_VIEW_GERENCIA` (or higher)
- `/api/poc/*` — existing — expected roles: `CAN_VIEW_COMPRAS`
- `/api/auth/*` — public (Supabase callbacks)
- `/api/health` — public

**Phase 1 requires the user to extend their existing matrix** (insert rows into `route_permissions` for the 4 non-public gaps), OR confirm that a `CAN_*` constant lookup is the intended fallback. Do not invent permissions — ask.

**Service-to-service exception:** if a request arrived with a valid `x-api-key` (caught at Layer 1), `requireAuth` should detect that and return a synthetic "service" user. Add to `getAuthUser()`:
```ts
// In getAuthUser:
const apiKey = headers().get('x-api-key');
if (apiKey === process.env.SERVER_TO_SERVER_API_KEY) {
  return { id: '00000000-0000-0000-0000-000000000000', email: 'service@internal',
           role: 'service' as Role, displayName: 'Service' };
}
```

Add `'service'` to the `Role` enum and to `isAuthorized()` so role-gated endpoints can opt-in to allowing service callers.

**Effort estimate:** 28 routes × ~5 min each = ~2.5 hours including diff review.

**Verification:** integration test — a script that exercises every route with (no auth, wrong role, right role) and asserts 401/403/200.

### LAYER 3 — Database RLS (the actual fix)

This is where Supabase's playbook says to fight the battle. Two sub-tasks:

#### 3.A Backfill RLS on un-protected tables

**One migration file** that, for each table in the gap list, runs:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

CREATE POLICY "<table>_read" ON <table> FOR SELECT USING (
  auth_role() IS NOT NULL    -- any authed user; tighten per role later
);
CREATE POLICY "<table>_service_write" ON <table> FOR ALL USING (
  auth.role() = 'service_role'
);
```

**Tables to add** (22 of them — I counted in §1.3):
- Reference: `customers`, `suppliers`, `warehouses`, `stock_locations`, `units_of_measure`, `exchange_rates`
- Operational: `stock_moves`, `stock_quants`, `purchase_orders`, `purchase_order_lines`
- App-internal: `app_settings`, `audit_log`, `tenants`
- OA module: `open_orders`, `open_order_lines`, `dispatch_plan_weeks`, `warehouse_config`, `unloading_times`, `reception_schedule`, `weekly_audits`, `extraordinary_orders`, `extraordinary_order_lines`
- Acid-test: `revenue_daily`, `products_acid_test_active`, `products_acid_test_archived`

**Non-trivial decision per table:** what's the read policy?
- `auth_role() IS NOT NULL` (any logged-in user) — easy default, matches existing pattern
- Role-specific (e.g. only `compras` for `purchase_orders`) — better but requires per-role analysis
- **My recommendation:** ship `auth_role() IS NOT NULL` as a baseline, then iterate per-table to tighten as the team learns who-needs-what.

#### 3.B Switch API handlers from service-role to session-scoped client

The harder part. For every API route currently doing:
```ts
const supabase = createServiceRoleClient();
const { data } = await supabase.from('demand_daily').select(...);
```

Change to:
```ts
const supabase = createServerSupabaseClient();   // uses session cookie + anon key
const { data } = await supabase.from('demand_daily').select(...);
// RLS will scope automatically based on auth_role()
```

This is the change that **makes Layer 3 actually fire**. Until this lands, RLS is decorative.

**When is service-role still appropriate?**
- Cron / batch ingest scripts (`scripts/ingest.py`)
- Admin user creation (`/api/admin/users` POST)
- Any query that legitimately needs to bypass per-user scoping (system aggregations across all users)

**Migration risk:** every endpoint needs re-testing because RLS may now reject queries that used to work. We'd need a route-by-route smoke test as we flip each.

**Phased rollout:**
1. Pick the highest-risk reads first (gerencia, gap-report, KPIs) — these expose competitive intel.
2. Flip them one PR at a time, verify with manual smoke test post-deploy.
3. Move to write paths (more complex; some legitimately need service role).
4. Last: admin endpoints; carefully because RLS could lock out admins from seeing all rows.

### LAYER 4 — Operational

#### 4.A Service-to-service inbound auth
- Generate `SERVER_TO_SERVER_API_KEY` (32-byte hex). Store in Vercel env + 1Password.
- Document which external callers use it (Railway cron, future Odoo sync, manual scripts).
- Used in Layer 1 + Layer 2.

#### 4.B Audit logging on sensitive endpoints
The `audit_log` table exists ([20260322000001_initial_schema.sql:46](../../supabase/migrations/20260322000001_initial_schema.sql#L46)) but is unused.

**Wrap requireAuth with an audit hook:**
```ts
export async function requireAuthAndAudit(req: NextRequest, allowedRoles: Role[], event: string) {
  const result = await requireAuth(allowedRoles);
  if (result instanceof Response) {
    // Log denied access
    await logAudit({ event: `${event}_denied`, ... });
    return result;
  }
  // Log accepted
  await logAudit({ event, user_id: result.id, ip: req.headers.get('x-forwarded-for'), ts: new Date() });
  return result;
}
```

Apply to high-sensitivity endpoints: `/api/admin/*`, `/api/export/*`, `/api/acid-test/gap-report` (until Test 1 is closed), `/api/gerencia/validacion`.

#### 4.C Rate limiting
Vercel Edge Config + middleware can implement token-bucket per IP. Or use Upstash Ratelimit (Redis-backed).

**Defaults per route class:**
- `/api/auth/*`: 10 req/min/IP (brute-force protection)
- `/api/admin/*`: 30 req/min/IP
- Everything else: 120 req/min/IP

#### 4.D CSRF on mutating endpoints
Next.js + Supabase SSR doesn't auto-protect against CSRF. For POST/PATCH/DELETE, require either:
- A valid `x-supabase-csrf-token` matching the session, OR
- The request is `same-site` (Vercel sets `Sec-Fetch-Site: same-origin` for browser fetches)

`@supabase/ssr` middleware helpers can be configured to require this.

#### 4.E Key rotation
- Quarterly rotation: `SERVER_TO_SERVER_API_KEY`, `ML_SERVICE_API_KEY`
- Annual rotation: `SUPABASE_SERVICE_ROLE_KEY` (regenerate from Supabase dashboard, redeploy)
- Document rotation runbook in `docs/security/RUNBOOK_KEY_ROTATION.md` (separate doc, not yet written)
- Calendar event in 90 days

#### 4.F Vercel deployment hygiene
- Ensure `SUPABASE_SERVICE_ROLE_KEY` is marked **Sensitive** in Vercel (does not appear in build logs)
- Lock Vercel project to GitHub-Actions-deployed only (no manual deploys)
- Enable Vercel SSO for dashboard access

---

## 4. Phased rollout

The leak is HIGH severity. The fix is multi-week. Phase to close the leak fast without breaking the demo.

### Phase 0 — TODAY: Plug the leak (Layer 1 only) — 2 hours
- Change middleware to require session for `/api/*` (with allowlist for `/api/health`, `/api/auth/*`).
- Set `SERVER_TO_SERVER_API_KEY` env var (even if unused yet, so we can use it).
- Smoke test: every existing page that calls `/api/*` still works for an authed user.
- Deploy. Verify `curl unauthed → 401`, `curl with cookie → 200`.

### Phase 1 — THIS WEEK: Per-route role gating (Layer 2) — ~3 hours
- Wire `requireAuth(roles)` into every API handler per the matrix in §3.B.
- Add `service` role for API-key-authed callers.
- Test matrix script. Deploy.
- Verify wrong-role caller gets 403; right-role gets 200.

### Phase 2 — NEXT WEEK: RLS coverage (Layer 3.A) — 1-2 days
- Migration: enable RLS on all 22 currently-unprotected tables.
- Same baseline policy (`auth_role() IS NOT NULL` for read; `service_role` for ALL).
- Apply via Supabase Studio (per existing pattern). Verify in prod.

### Phase 3 — FOLLOWING WEEK: Switch handlers to session-scoped client (Layer 3.B) — 2-3 days
- One PR per route-cluster (gerencia, kpis, oa, admin, etc.).
- Each PR: switch `createServiceRoleClient()` → `createServerSupabaseClient()`, verify the page still works, deploy.
- Where service role is genuinely needed (admin user creation), keep it but document the why.

### Phase 4 — MONTH 2: Operational layer (Layer 4) — 1 week
- Audit logging on sensitive endpoints.
- Rate limiting via Upstash.
- CSRF protection.
- Key rotation runbook.
- Document everything in `docs/security/`.

### Phase 5 — ONGOING: Tighten RLS policies per role
- For each table, decide the actual role allowlist (e.g., `purchase_orders` only `compras` + `superuser`).
- Replace baseline `auth_role() IS NOT NULL` with role-specific policies.
- This is the hardening lap; ongoing as the team's needs are clarified.

---

## 5. Testing strategy

Per layer:

### Layer 1 (middleware)
- Manual: cURL against every public + private route with no auth → expect 401/redirect.
- Automated: a Playwright script (`tests/security/edge_auth.spec.ts`) that hits every route from the route manifest.

### Layer 2 (per-route)
- Manual: cURL with auth cookie of `gerencia` user; cURL with `compras` user; cURL with `superuser`; verify expected 200/403 per the matrix.
- Automated: same script, run before every deploy.

### Layer 3 (RLS)
- Manual: query via PostgREST with a JWT of each role; assert returned row count matches expected scope.
- Automated: pgTAP-style `tests/sql/rls.test.sql` — `SELECT plan(N)` for each (role × table) cell.

### Layer 4 (ops)
- Audit log: hit a sensitive endpoint, query `audit_log`, assert event row exists.
- Rate limit: hit endpoint 121 times in a minute, assert 121st gets 429.
- Key rotation: dry-run rotation in staging, verify zero downtime.

### Smoke test for Vercel deploys
After every deploy, automated curl matrix:
```
✓ /              → 307 to /login
✓ /login         → 200
✓ /api/health    → 200 (public)
✓ /api/<sensitive>  → 401 (no auth)
✓ /api/<sensitive> with bad cookie → 401
✓ /api/<sensitive> with good cookie → 200
✓ /api/<sensitive> with bad role → 403
```

---

## 6. Rollback plan per phase

| Phase | Rollback action | Estimated time |
|---|---|---|
| 0 (middleware) | Revert middleware.ts commit | <5 min |
| 1 (per-route auth) | Revert each route handler change individually | <5 min per route |
| 2 (RLS enable) | `ALTER TABLE <t> DISABLE ROW LEVEL SECURITY;` per table | <1 min per table |
| 3 (session client) | Revert handler change (back to service role) | <5 min per route |
| 4 (operational) | Each sub-feature is isolated; revert per file | per-feature |

All phases are **forward-only safe**: a half-done rollout cannot expose data more than today.

---

## 7. Risk register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Phase 0 breaks an unauthenticated page-to-api call we missed | Medium | UI breaks for some users | Smoke-test every authed page before deploy; rollback in <5 min |
| Phase 1 wrong role-matrix locks legitimate user out of UI they need | High | Decision-maker frustration | Validate matrix with Luis before deploy; surface role-gate errors in UI clearly |
| Phase 2 RLS policy mistake hides legitimate data | Medium | Empty results in app | Test in staging; route-by-route smoke test; baseline = permissive ("any authed user") |
| Phase 3 service-role → session-client breaks an admin endpoint | Medium | Admin can't manage users | Last to migrate; explicit service-role exemption documented |
| Cron / Railway calls break when middleware enforces auth | Medium | Backtest cycles fail | Phase 0 includes API-key path; coordinate with Railway env var update |
| Service API key leaks via env var misconfig | Low | Equivalent to no key | Mark Sensitive in Vercel; rotate quarterly |
| Audit log fills the DB | Low | Performance degradation | Retention policy: 90-day TTL; partition by month |
| Rate limit too aggressive, blocks legitimate user | Low | UX problem | Start permissive, tighten with telemetry |

---

## 8. Decisions locked in (user, 2026-04-23)

1. **Role matrix** — use user's existing design: `route_permissions` table + `CAN_*` constants in `lib/auth/roles.ts`. Do not invent new permissions. For the 4 route patterns missing from the table (`/api/acid-test/*`, `/api/gerencia/*`, `/api/export/*`, `/api/poc/*`), user will extend the table before Phase 1.
2. **Phase 0 timing** — apply immediately.
3. **Service callers** — NONE external. Only Railway via existing `ML_SERVICE_API_KEY` (outbound Next.js → Railway). No inbound service-to-service callers today. Phase 0 does NOT need `SERVER_TO_SERVER_API_KEY`; omit that path until a future inbound caller appears.
4. **Rate limit backend** — Upstash Redis free tier (Phase 4).
5. **Public endpoints** — NONE. Everything secure. Only `/api/health` stays public (for Vercel health checks / monitoring) and `/api/auth/callback` (Supabase requirement).

---

## 9. References

- [Supabase RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security) — the canonical guide
- [Supabase Auth + RLS playbook](https://supabase.com/docs/guides/auth/row-level-security)
- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x00-introduction/) — items #1, #3, #5 directly apply
- [Next.js middleware](https://nextjs.org/docs/app/building-your-application/routing/middleware)
- Existing artifacts in this repo:
  - [supabase/migrations/20260323000002_rbac.sql](../../supabase/migrations/20260323000002_rbac.sql) — RBAC + initial RLS
  - [frontend/src/lib/auth/server.ts](../../frontend/src/lib/auth/server.ts) — `requireAuth` helper (built, never used)
  - [frontend/src/middleware.ts](../../frontend/src/middleware.ts) — the file with the leak

---

## 10. Files this plan would create/modify

| Phase | File | Action |
|---|---|---|
| 0 | `frontend/src/middleware.ts` | edit — gate `/api/*` |
| 0 | Vercel env | add `SERVER_TO_SERVER_API_KEY` |
| 1 | All 28 `frontend/src/app/api/**/route.ts` | edit — add `requireAuth(...)` |
| 1 | `frontend/src/lib/auth/roles.ts` | edit — add `'service'` role |
| 1 | `frontend/src/lib/auth/server.ts` | edit — `getAuthUser` accepts API key |
| 2 | `supabase/migrations/20260424000001_rls_backfill_unprotected_tables.sql` | new |
| 3 | All API route handlers (gradual) | edit — `createServiceRoleClient` → `createServerSupabaseClient` |
| 4 | `frontend/src/lib/audit/log.ts` | new |
| 4 | `frontend/src/middleware.ts` | edit — add rate limit |
| 4 | `docs/security/RUNBOOK_KEY_ROTATION.md` | new |
| 4 | `docs/security/ROUTE_PERMISSIONS_MATRIX.md` | new — single source of truth |
| All | `docs/security/PLAN_API_AUTH_DEFENSE_IN_DEPTH.md` | this doc |

---

## 11. What this plan deliberately does NOT do

- Does NOT introduce a new auth provider (Supabase Auth stays).
- Does NOT change the role model defined in [20260323000002_rbac.sql](../../supabase/migrations/20260323000002_rbac.sql) (gerencia, compras, operaciones, superuser, admin) — works within it.
- Does NOT add encryption-at-rest beyond what Supabase already provides.
- Does NOT add SSO / SAML / OIDC for end users — Supabase Auth handles this if needed later.
- Does NOT cover IAM for Vercel/Supabase admin consoles (separate scope).
- Does NOT cover penetration testing / WAF / SIEM (Tier 5 / mature org concerns).
