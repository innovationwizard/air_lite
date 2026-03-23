# Changelog: Superuser Dashboard & User Management

**Date:** 2026-03-23
**Author:** Claude Opus 4.6
**Scope:** Backend admin routes, frontend pages, sidebar navigation
**Status:** Code complete, pending deploy

---

## Summary

Built the superuser dashboard page, a shared user management page (accessible to both Admin and Superuser roles), full backend user CRUD routes, and role-based sidebar navigation.

---

## Changes

### 1. Backend — User CRUD Routes (`api-node/src/routes/admin.ts`)

Added four new endpoints to the existing admin route module, all protected by authentication middleware and permission guards:

#### `GET /api/v1/admin/users/:id`
- **Permission:** `user:read`
- Returns a single user with their active role assignments
- Response includes `id`, `username`, `email`, `isActive`, `createdAt`, `roleId`, `role`, `roles[]`
- Returns 404 if user is soft-deleted or not found

#### `POST /api/v1/admin/users`
- **Permission:** `user:create` OR `SUPERUSER`
- Creates a new user with full server-side validation:
  - Required fields: `username`, `email`, `password`, `roleId`
  - Password policy: minimum 8 characters, must contain uppercase, lowercase, and digits
  - Uniqueness check on both `username` and `email` (among non-deleted users)
  - Role existence verification
- Password hashed with bcrypt (12 salt rounds) via existing `hashPassword` utility
- User creation and role assignment wrapped in a Prisma transaction
- Returns 201 with the created user data

#### `PUT /api/v1/admin/users/:id`
- **Permission:** `user:update` OR `SUPERUSER`
- Partial update — only provided fields are modified
- Validates:
  - Username minimum length (3 chars) and uniqueness
  - Email format and uniqueness
  - Password strength (same policy as create, only if provided)
  - Role existence (if `roleId` provided)
- Role change performed atomically: soft-deletes existing role assignments, creates new one — all in a transaction
- Returns the updated user with current role info

#### `DELETE /api/v1/admin/users/:id`
- **Permission:** `user:delete` OR `SUPERUSER`
- Soft-delete: sets `isDeleted = true` and `isActive = false`
- Self-deletion prevention: returns 403 if the authenticated user tries to delete their own account
- Also soft-deletes all associated `userRole` records in a transaction

**Import additions:** `errorResponse`, `validationErrorResponse` from response utilities; `hashPassword` from password utility.

---

### 2. Frontend — User Management Page (`frontend/src/app/(authenticated)/admin/usuarios/page.tsx`)

Full-featured user administration page at route `/admin/usuarios`.

**Access control:** Client-side guard checks for `user:read` or `SUPERUSER` permission. Unauthorized users see an access-denied alert.

**Features:**
- **KPI cards:** Total users, active count, inactive count, distinct role count
- **Search & filter bar:**
  - Free-text search on username and email
  - Role dropdown filter (dynamically populated from loaded user data)
  - Status filter (all / active / inactive)
- **User table:**
  - Columns: checkbox, username, email, role badges, status badge, creation date, actions
  - Row actions: View details (eye icon), Edit (pencil icon), Delete (trash icon)
  - Checkbox selection with select-all toggle per page
  - Bulk actions button appears when selections are active
- **Pagination:** 20 users per page with previous/next controls and "showing X–Y of Z" indicator
- **Delete confirmation:** Modal dialog with clear description of the soft-delete behavior
- **Modal integration:** Uses existing `UserCreateEditModal` (create/edit), `UserDetailModal` (view), and `BulkUserActionsModal` (bulk operations)
- **Data fetching:** Calls `adminService.getUsers()` with required `ParametrosConsultaTemporal` fields (30-day window, daily granularity)

---

### 3. Frontend — Superuser Dashboard Page (`frontend/src/app/(authenticated)/superuser/page.tsx`)

AI governance and system oversight dashboard at route `/superuser`.

**Access control:** Client-side guard checks for `SUPERUSER` permission only.

**Sections:**

#### AI Model Metrics (6-card grid)
- Model Accuracy (percentage with trend indicator)
- WMAPE (weighted mean absolute percentage error)
- Bias (forecast bias percentage)
- Latency (inference time in ms)
- Last Training Date
- Model Version

#### System Overview (card with 2x2 grid)
- Total Users / Active Users
- Total Predictions / API Calls
- System uptime percentage
- Last deployment timestamp

#### Data Quality (card with progress bars)
- Completeness, Accuracy, Timeliness, Consistency — each with percentage and visual progress bar
- Last audit timestamp

#### Model Alerts (card, scrollable)
- Severity badges (critical/high/medium/low) with color coding
- Alert type badges (accuracy/drift/bias/performance)
- Alert message and optional recommendation
- Timestamp

#### Quick Navigation (card with links)
- Link to User Management (`/admin/usuarios`)
- Link to Value Demonstration (`/backtest`)
- Link to Stockout Analysis (`/preocupaciones/desabastecimiento`)

#### Recent Audit Logs (table)
- Columns: Date, User, Action, Resource, Details
- Shows latest 10 entries

**Data source:** Calls `superuserService.getDashboardData()` which hits the existing `/api/v1/bi/dashboards?role=Superuser` endpoint and transforms the response through the `SuperuserDashboardData` interface.

**UX:** Loading spinner on initial load, error state with retry button, last-refresh timestamp, manual refresh button.

---

### 4. Sidebar — Role-Based Navigation (`frontend/src/components/layout/FearsSidebar.tsx`)

Converted the static navigation array into a dynamic one that reads the authenticated user's permissions from the Zustand auth store.

**Base navigation (unchanged, visible to all authenticated users):**
- Demostración de Valor
- Mis Preocupaciones (4 sub-items)
- Productos, Configuración

**New conditional sections:**

#### "Administración" section
- **Visible when:** user has `user:read` OR `SUPERUSER` permission
- **Items:** Gestión de Usuarios → `/admin/usuarios`
- **Icon:** `Users` from lucide-react

#### "Superusuario" section
- **Visible when:** user has `SUPERUSER` permission
- **Items:** Panel de Control → `/superuser` (subtitle: "Gobernanza IA y sistema")
- **Icon:** `Brain` from lucide-react

**Implementation:** The component reads `useAuthStore((s) => s.user)` and derives `hasUserRead` and `isSuperuser` booleans from the permissions array. Navigation groups are conditionally appended to the base array before rendering.

---

## Files Modified

| File | Change |
|------|--------|
| `api-node/src/routes/admin.ts` | Added 4 user CRUD routes (GET by ID, POST, PUT, DELETE), new imports |
| `frontend/src/app/(authenticated)/admin/usuarios/page.tsx` | **New file** — User management page |
| `frontend/src/app/(authenticated)/superuser/page.tsx` | **New file** — Superuser dashboard page |
| `frontend/src/components/layout/FearsSidebar.tsx` | Added auth store import, role-based navigation sections |

## Files Not Modified

- No database migrations required — all CRUD operates on existing `users`, `user_roles`, and `roles` tables
- No changes to Prisma schema
- No changes to existing service files (`adminService.ts`, `superuserService.ts`) — they already had the required methods
- No changes to existing modal components — they were already built and ready

---

## Permission Matrix

| Route | Required Permission | Admin | Superuser |
|-------|-------------------|-------|-----------|
| `/admin/usuarios` (page) | `user:read` OR `SUPERUSER` | Yes | Yes |
| `/superuser` (page) | `SUPERUSER` | No | Yes |
| `GET /api/v1/admin/users/:id` | `user:read` | Yes | Yes |
| `POST /api/v1/admin/users` | `user:create` OR `SUPERUSER` | Yes | Yes |
| `PUT /api/v1/admin/users/:id` | `user:update` OR `SUPERUSER` | Yes | Yes |
| `DELETE /api/v1/admin/users/:id` | `user:delete` OR `SUPERUSER` | Yes | Yes |
| Sidebar: "Administración" | `user:read` OR `SUPERUSER` | Yes | Yes |
| Sidebar: "Superusuario" | `SUPERUSER` | No | Yes |

---

## Validation & Compilation

- `npx tsc --noEmit` passes cleanly on both `api-node` and `frontend`
- No new dependencies introduced
- All new code uses existing patterns, utilities, and UI components
