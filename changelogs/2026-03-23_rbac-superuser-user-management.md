# RBAC, Superuser Dashboard & User Management

**Date:** 2026-03-23
**Scope:** Enterprise-grade role-based access control, superuser system dashboard, user CRUD
**Stack:** Supabase PostgreSQL (RLS policies) + Next.js API routes + Supabase Auth Admin API

---

## Why This Was Built

The original airefill had a 7-role RBAC system built on Fastify + Prisma + Zustand JWT stores — all of which were deleted in the old code cleanup. The user requires:

1. **Superuser (developer):** System health visibility, user management, app settings — the "god mode" for technical oversight
2. **Admin (client-side app owner):** User CRUD, operational management
3. **Gerencia, Compras, Ventas, Inventario, Financiero:** Operational roles — currently see backtest + fear pages; role-specific dashboards deferred (see `_SCOPE_CONCERN_RBAC_2026-03-23.md`)

The RBAC infrastructure is built for all 7 roles now so that role-specific features can be plugged in incrementally without migration.

---

## Database Changes

### Migration: `supabase/migrations/20260323000002_rbac.sql`

**1. Expanded role constraint on `user_profiles`**

Before:
```sql
CHECK (role IN ('admin', 'viewer'))
```

After:
```sql
CHECK (role IN ('superuser', 'admin', 'gerencia', 'compras', 'ventas', 'inventario', 'financiero'))
```

**2. New table: `route_permissions`**

Maps roles to API route patterns they can access. 17 rows inserted covering all current API routes.

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL PK | Auto-increment |
| `role` | VARCHAR(20) | One of the 7 roles |
| `route_pattern` | VARCHAR(100) | API path with optional `*` wildcard |
| `methods` | VARCHAR(10)[] | Array of HTTP methods: `{GET}`, `{GET,POST}`, etc. |
| `description` | TEXT | Human-readable purpose |

Example rows:
- `('admin', '/api/admin/*', '{GET,POST,PUT,DELETE}', 'Full admin access')`
- `('gerencia', '/api/backtest/*', '{GET}', 'View backtest results (read-only)')`
- `('compras', '/api/kpis/stockout-risk', '{GET}', 'Stockout risk (drives purchase decisions)')`

**3. New SQL functions**

| Function | Purpose |
|----------|---------|
| `check_route_access(user_id, route, method)` | Returns boolean — checks `route_permissions` table, superuser always returns true |
| `get_user_profile(user_id)` | Returns user_id, display_name, role, tenant_id |
| `auth_role()` | Returns current user's role from `user_profiles` — used by RLS policies |

**4. RLS policies on all business tables**

Every business table now has role-aware RLS policies:

| Table | SELECT | INSERT/UPDATE/DELETE |
|-------|--------|---------------------|
| `products` | Any authenticated user | Service role only |
| `sale_orders` | Any authenticated user | Service role only |
| `sale_order_lines` | Any authenticated user | Service role only |
| `inventory_daily` | Any authenticated user | Service role only |
| `demand_daily` | Any authenticated user | Service role only |
| `backtest_runs` | Any authenticated user | superuser, admin, gerencia (INSERT); service role (all) |
| `backtest_results` | Any authenticated user | Service role only |
| `backtest_savings` | Any authenticated user | Service role only |
| `user_profiles` | Own profile OR superuser/admin see all | superuser/admin OR service role |
| `app_settings` | superuser/admin | superuser OR service role |
| `audit_log` | superuser/admin | Any authenticated (INSERT); service role (all) |

RLS was enabled on `user_profiles`, `app_settings`, and `audit_log` (previously not enabled).

**5. User profile created for developer**

```sql
INSERT INTO user_profiles (id, display_name, role)
VALUES ('8a335502-...', 'Jorge Contreras', 'superuser');
```

---

## Server-Side Auth Layer

### `frontend/src/lib/auth/roles.ts` — Role definitions

Defines the 7 roles as TypeScript constants and provides authorization helpers:

| Export | Type | Purpose |
|--------|------|---------|
| `ROLES` | Object | `{ SUPERUSER: 'superuser', ADMIN: 'admin', ... }` |
| `Role` | Type | Union type of all role strings |
| `CAN_RUN_BACKTEST` | Role[] | `['superuser', 'admin', 'gerencia']` |
| `CAN_MANAGE_USERS` | Role[] | `['superuser', 'admin']` |
| `CAN_MODIFY_SETTINGS` | Role[] | `['superuser']` |
| `CAN_VIEW_SYSTEM` | Role[] | `['superuser']` |
| `CAN_VIEW_ADMIN` | Role[] | `['superuser', 'admin']` |
| `CAN_VIEW_OPERATIONAL` | Role[] | All 7 roles |
| `isAuthorized(role, allowedRoles)` | Function | Returns true if role is in allowedRoles; superuser always true |
| `PAGE_PERMISSIONS` | Record | Maps page paths to allowed roles |
| `getDefaultPage(role)` | Function | Returns landing page for role (`/superuser` or `/backtest`) |
| `ROLE_LABELS` | Record | Spanish display names: `{ superuser: 'Superusuario', admin: 'Administrador', ... }` |

### `frontend/src/lib/auth/server.ts` — Server-side auth

| Export | Purpose |
|--------|---------|
| `getAuthUser()` | Gets authenticated user + role from Supabase Auth + `user_profiles`. Returns `AuthUser \| null` |
| `requireAuth(allowedRoles?)` | Returns `AuthUser` if authorized, or `Response(401/403)` if not. Used in API route handlers. |

`AuthUser` interface:
```typescript
{ id: string; email: string; role: Role; displayName: string | null }
```

### `frontend/src/lib/auth/useUserRole.ts` — Client-side hook

`useUserRole()` hook fetches the current user's role from `user_profiles` on mount. Returns `{ profile, loading }` where profile contains `role`, `displayName`, `email`.

Used by the sidebar to conditionally show admin/system navigation sections.

---

## Frontend Changes

### Sidebar: `frontend/src/components/layout/FearsSidebar.tsx`

Rebuilt with role-based navigation groups:

| Section | Visible to | Items |
|---------|-----------|-------|
| *(no section)* | All authenticated | Demostración de Valor → `/backtest` |
| Mis Preocupaciones | All authenticated | 4 fear pages |
| Administración | superuser, admin | Gestión de Usuarios → `/admin/usuarios`, Configuración → `/admin/configuracion` |
| Sistema | superuser only | Panel de Control → `/superuser` |

Navigation groups have a `requiredRoles` property. The sidebar filters groups using `isAuthorized(userRole, group.requiredRoles)`.

Footer shows the logged-in user's email and role label in Spanish.

### Superuser Dashboard: `frontend/src/app/(authenticated)/superuser/page.tsx`

Three sections of real system data:

**1. Servicio ML (Railway)**
- Calls `GET /api/admin/ml-health` (proxy to Railway's `/health` endpoint)
- Shows green checkmark + "En línea" when Railway responds with `{ status: "ok" }`
- Shows red X + error message when Railway is down or unreachable
- 10-second timeout on health check

**2. Historial de Backtests**
- Calls `GET /api/backtest/runs` to list all backtest cycles
- Three KPI cards: Total ejecutados, Completados (green), Con errores (red if > 0)
- Table with columns: Mes predicho, Estado (badge), Productos modelados, Duración, Fecha
- Status badges: Completado (green), Error (red), Ejecutando (yellow)
- Shows "No se han ejecutado backtests aún." when empty

**3. Frescura de Datos**
- Calls `GET /api/admin/data-status` to get table row counts and date ranges
- Table with columns: Tabla (monospace), Registros (formatted), Desde, Hasta
- Shows warning icon if data could not be loaded

Manual refresh button in header.

### User Management: `frontend/src/app/(authenticated)/admin/usuarios/page.tsx`

**Features:**
- Users table with columns: Usuario (name + email), Rol (colored badge), Último acceso, Creado, Acciones
- Role badge colors: superuser = purple, admin = blue, others = gray
- "Nuevo Usuario" button opens inline create form
- Create form fields: email, password (min 8 chars), display name, role (dropdown of 6 assignable roles — superuser excluded)
- Delete button per user (with confirmation dialog), except superuser users cannot be deleted
- Error messages displayed in red banner

---

## API Routes

### `GET /api/admin/ml-health`

- **Auth:** superuser only (`CAN_VIEW_SYSTEM`)
- **Purpose:** Proxies Railway's `/health` endpoint to avoid CORS
- **Response:** `{ status: "ok", service: "air-lite-ml" }` or `{ status: "error", error: "..." }`
- **Timeout:** 10 seconds

### `GET /api/admin/users`

- **Auth:** superuser/admin (`CAN_MANAGE_USERS`)
- **Purpose:** List all users with profiles and auth data
- **Implementation:**
  1. Fetches all `user_profiles` (id, display_name, role, created_at)
  2. Fetches all auth users via `supabase.auth.admin.listUsers()`
  3. Merges by user ID
- **Response:** Array of `{ id, email, displayName, role, createdAt, lastSignIn }`

### `POST /api/admin/users`

- **Auth:** superuser/admin (`CAN_MANAGE_USERS`)
- **Purpose:** Create a new user
- **Body:** `{ email, password, displayName?, role }`
- **Validation:**
  - email, password, role required
  - Role must be one of 6 assignable roles (superuser cannot be assigned)
  - Password minimum 8 characters
- **Implementation:**
  1. Creates auth user via `supabase.auth.admin.createUser()` with `email_confirm: true`
  2. Creates `user_profiles` row with role
  3. On profile creation failure: rolls back by deleting auth user
- **Response:** `201 { id, email, displayName, role }`

### `DELETE /api/admin/users?id=<uuid>`

- **Auth:** superuser/admin (`CAN_MANAGE_USERS`)
- **Purpose:** Delete a user
- **Validation:**
  - Cannot delete own account (403)
  - Cannot delete superuser users (403)
- **Implementation:**
  1. Deletes `user_profiles` row (FK cascade)
  2. Deletes auth user via `supabase.auth.admin.deleteUser()`
- **Response:** `{ success: true }`

---

## New Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/20260323000002_rbac.sql` | RBAC schema: roles, route_permissions, RLS policies |
| `frontend/src/lib/auth/roles.ts` | Role constants, permission groups, authorization helpers |
| `frontend/src/lib/auth/server.ts` | Server-side getAuthUser() + requireAuth() |
| `frontend/src/lib/auth/useUserRole.ts` | Client-side useUserRole() hook |
| `frontend/src/app/api/admin/ml-health/route.ts` | Railway health proxy |
| `frontend/src/app/api/admin/users/route.ts` | User CRUD API (GET, POST, DELETE) |
| `frontend/src/app/(authenticated)/superuser/page.tsx` | Superuser dashboard page |
| `frontend/src/app/(authenticated)/admin/usuarios/page.tsx` | User management page |
| `_SCOPE_CONCERN_RBAC_2026-03-23.md` | Documented scope concern about 7-role feature gap |

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/components/layout/FearsSidebar.tsx` | Rebuilt with role-based navigation, useUserRole hook, role label footer |

---

## Deferred (per scope concern)

The following role-specific features are **defined in the RBAC infrastructure** (roles exist, RLS policies are set, route_permissions rows are ready) but their **dashboards/UI are not built yet:**

- Compras dashboard: "What to buy, how much, when"
- Ventas dashboard: "Demand predictions with granularity and reliability labels"
- Inventario dashboard: "What to move from where to where and when, and why"
- Financiero dashboard: "ROI impact analysis"
- Admin: market segments, product categories, supplier classifications CRUD

These users currently see the same backtest + fear pages as Gerencia. When their role-specific features are built, they will be wired into the existing RBAC without any schema migration.

---

*No mock data. No placeholder permissions. All RLS policies enforce real authorization against real user profiles.*
