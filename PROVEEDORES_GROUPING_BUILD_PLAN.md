# Proveedores grouping: build plan

**Status:** ready to implement. Nothing here is built yet.
**Author:** Claude, 2026-09-03.
**Based on:** [PROVEEDORES_GROUPING_UX_DESIGN.md](PROVEEDORES_GROUPING_UX_DESIGN.md) — read that first for the *why*. This document is the *how*: exact schema, exact API contracts, exact files to touch, in order.
**Scope, restated from the UX doc's resolved decisions:** one flat group per supplier (no multi-membership), scoped to the reabastecimiento-vivo filter only, Wilmer-only access (`compras` role), delivered as a panel inline on the page he already has — no new route.

---

## 0. Preconditions — verify before writing code

1. This branch has uncommitted, unrelated changes (`admin/usuarios/page.tsx`, `api/admin/users/route.ts`, `lib/auth/roles.ts`, `roles.test.ts`, plus two new migrations `20260903000001`/`20260903000002` — see repo status). **Resolved:** build on top of them, same branch — the in-flight `roles.ts`/`roles.test.ts` edits are treated as a dependency this plan's own `roles.ts` addition (§2.3) lands after, not something to branch away from.
2. Run `npm test -- roles.test.ts` (or the project's actual test command) before starting, to get a clean baseline — this plan adds to that file and a pre-existing red test would otherwise be blamed on this change.
3. Confirm the local Supabase CLI / `supabase db push` workflow this repo actually uses for migrations (every existing migration file says "Aplicada con `supabase db push`. Idempotente." in its header — follow that convention, including `IF NOT EXISTS`/`ON CONFLICT` everywhere, so a rerun is a no-op).

---

## 1. Data model

New file: `supabase/migrations/20260904000001_supplier_groups.sql`

```sql
-- GRUPOS DE PROVEEDORES — filtro de reabastecimiento-vivo.
--
-- QUÉ PROBLEMA RESUELVE. El filtro «Todos los proveedores» de
-- reabastecimiento-vivo lista cada `suppliers.name` distinto que aparece en
-- las filas — hoy ~70, muchos de ellos la MISMA opción de compra real:
-- entidades legales duplicadas, empresas del mismo grupo, o proveedores
-- sustitutos entre sí. Ver PROVEEDORES_GROUPING_UX_DESIGN.md.
--
-- DECISIONES DEL CLIENTE (2026-09-03), de las que este esquema es consecuencia
-- directa:
--   1. El agrupamiento es GLOBAL por proveedor, no por producto — si A y B son
--      sustitutos, lo son para todo lo que se compra de cualquiera de los dos.
--   2. UN proveedor pertenece A LO SUMO A UN grupo. Enforced abajo con
--      supplier_id como PRIMARY KEY de supplier_group_members, no con un
--      UNIQUE INDEX — así una reasignación es un UPDATE del mismo row, no una
--      segunda fila que hay que recordar borrar.
--   3. Solo Wilmer (rol `compras`) mantiene esto — ver la migración de
--      route_permissions abajo. Sin ruta nueva: la gestión vive en un panel
--      dentro de reabastecimiento-vivo, así que no hay página que confinar.
--
-- POR QUÉ NO ES APPEND-ONLY, a diferencia de transito_overrides/
-- sugerido_bodega/reyma_factura_match. Esas tablas auditan una DECISIÓN
-- automatizada o financiera que alguien más tiene que poder reconstruir. Un
-- grupo de proveedores lo escribe Wilmer directamente, sin motor de
-- propuestas que auditar, y un grupo mal armado es visible de inmediato como
-- "salieron los proveedores equivocados en mi filtro" — no un número
-- financiero silenciosamente corrompido. CRUD mutable, con quién-y-cuándo
-- para trazabilidad, es proporcional al riesgo real.
--
-- Aplicada con `supabase db push`. Idempotente.

CREATE TABLE IF NOT EXISTS supplier_groups (
  id           UUID PRIMARY KEY DEFAULT uuidv7(),
  tenant_id    UUID REFERENCES tenants(id),
  display_name VARCHAR(255) NOT NULL,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   UUID,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un row por proveedor agrupado. `supplier_id` es la PRIMARY KEY (no un
-- UNIQUE INDEX aparte) precisamente para que "un proveedor, a lo sumo un
-- grupo" sea imposible de violar por construcción, no solo por convención de
-- la API.
CREATE TABLE IF NOT EXISTS supplier_group_members (
  supplier_id INT PRIMARY KEY REFERENCES suppliers(id),
  group_id    UUID NOT NULL REFERENCES supplier_groups(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supplier_group_members_group
  ON supplier_group_members(group_id);

COMMENT ON TABLE supplier_groups IS
  'Grupos nombrados de proveedores duplicados/sustituibles, mantenidos por '
  'Wilmer desde reabastecimiento-vivo. Ver PROVEEDORES_GROUPING_UX_DESIGN.md '
  'y PROVEEDORES_GROUPING_BUILD_PLAN.md.';
COMMENT ON TABLE supplier_group_members IS
  'Un row por proveedor agrupado; supplier_id es PK: un proveedor pertenece '
  'a lo sumo a un grupo (decision del cliente, 2026-09-03).';

ALTER TABLE supplier_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_groups_service" ON supplier_groups;
CREATE POLICY "supplier_groups_service" ON supplier_groups
  FOR ALL USING (auth.role() = 'service_role');

ALTER TABLE supplier_group_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "supplier_group_members_service" ON supplier_group_members;
CREATE POLICY "supplier_group_members_service" ON supplier_group_members
  FOR ALL USING (auth.role() = 'service_role');

-- Permisos de ruta — SOLO compras (Wilmer). Superuser hace bypass en
-- check_route_access (20260323000002) sin necesitar fila. Dos patrones,
-- igual que /api/forecast (20260527000001_route_permissions_forecast.sql):
-- la ruta exacta NO es alcanzada por su propio glob "/*", así que hacen falta
-- ambas filas o el GET a la ruta base quedaría fuera del enforcement.
INSERT INTO route_permissions (role, route_pattern, methods, description) VALUES
  ('compras', '/api/compras/proveedor-grupos',   '{GET,POST}',
   'Listar y crear grupos de proveedores (reabastecimiento-vivo)'),
  ('compras', '/api/compras/proveedor-grupos/*', '{PATCH,DELETE}',
   'Editar/borrar un grupo de proveedores (reabastecimiento-vivo)')
ON CONFLICT (role, route_pattern) DO UPDATE
  SET methods = EXCLUDED.methods, description = EXCLUDED.description;
```

**Design notes:**
- `suppliers.id` is `SERIAL`/`INT` ([initial_schema.sql:107](supabase/migrations/20260322000001_initial_schema.sql#L107)), so `supplier_group_members.supplier_id` is `INT`, not `UUID`.
- No `estado`/soft-delete on groups — deleting a group row (`ON DELETE CASCADE`) simply drops its membership rows; the suppliers themselves are untouched and fall back to being ungrouped in the filter. This matches "grouping should be additive, never mandatory" from the UX doc (§3.3).
- `created_by`/`updated_by` are bare `UUID` (no FK to `auth.users`), matching the loose-coupling style already used by `sugerido_bodega.created_by` ([20260901000008_sugerido_bodega.sql:45](supabase/migrations/20260901000008_sugerido_bodega.sql#L45)) rather than `user_profiles`.

---

## 2. Backend API

Two new route files, modeled directly on [api/admin/users/route.ts](frontend/src/app/api/admin/users/route.ts) (same `requireAuth` + `createServiceRoleClient` shape).

### 2.1 `frontend/src/app/api/compras/proveedor-grupos/route.ts`

```ts
export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_MANAGE_SUPPLIER_GROUPS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
```

**`GET`** — list every group with its resolved members, plus every ungrouped supplier (so the management panel never needs a second endpoint):
- Auth: `requireAuth(CAN_MANAGE_SUPPLIER_GROUPS)`.
- Query `supplier_groups` (all rows), `supplier_group_members` joined to `suppliers(id, name)`, and `suppliers` filtered to `is_active = true` for the "ungrouped" complement.
- Response shape:
  ```ts
  {
    groups: { id: string; displayName: string; members: { id: number; name: string }[] }[];
    ungrouped: { id: number; name: string }[];
  }
  ```

**`POST`** — create a group:
- Body: `{ displayName: string; supplierIds: number[] }`.
- Validate: `displayName` trimmed non-empty (≤255 chars); `supplierIds` a non-empty array of integers (empty-group creation is disallowed here — see §7 for why — a group with zero members has no purpose and is the one state the UI can trivially avoid producing).
- Verify every `supplierIds` entry exists in `suppliers`; reject with 400 naming the unknown id(s) otherwise (mirrors the `area` validation in [admin/users/route.ts:105-116](frontend/src/app/api/admin/users/route.ts#L105)).
- Insert the `supplier_groups` row (`created_by`/`updated_by` = `authResult.id`).
- Upsert each `supplierIds` entry into `supplier_group_members` with `ON CONFLICT (supplier_id) DO UPDATE SET group_id = EXCLUDED.group_id, added_at = now()` — this is the "move" semantics from the UX doc (§3.1): claiming a supplier that already belonged to another group silently reassigns it. The **client** is responsible for warning before submitting (§3.2 below); the API's job is just to make the end state correct.
- Response `201` with the created group in the same shape as a `GET` row.

### 2.2 `frontend/src/app/api/compras/proveedor-grupos/[id]/route.ts`

**`PATCH`** — body `{ displayName?: string; supplierIds?: number[] }`:
- If `displayName` present: update it (+`updated_by`/`updated_at`).
- If `supplierIds` present: **replace** the group's full membership — delete every `supplier_group_members` row currently pointing at this `group_id` that is *not* in the new list, then upsert every id in the new list (same `ON CONFLICT` move semantics as `POST`). Replacing rather than diffing client-side keeps the contract simple: the panel always sends the complete intended member set.
- 404 if the group id doesn't exist.
- Response `200` with the updated group.

**`DELETE`**:
- Delete the `supplier_groups` row; `ON DELETE CASCADE` handles `supplier_group_members`.
- Response `200 { success: true }`.

### 2.3 Auth additions

`frontend/src/lib/auth/roles.ts` — add near `CAN_MANAGE_USERS` ([roles.ts:49](frontend/src/lib/auth/roles.ts#L49)):
```ts
/** Roles that can create/edit supplier groups (reabastecimiento-vivo filter) */
export const CAN_MANAGE_SUPPLIER_GROUPS: Role[] = ['superuser', 'compras'];
```
No `PAGE_PERMISSIONS` or `ROLLOUT_FOCUS` entry — per the resolved decision, this ships as a panel inside `/compras/reabastecimiento-vivo`, a route Wilmer already has in both tables.

`frontend/src/lib/auth/__tests__/roles.test.ts` — add an invariant test next to the existing `CAN_MANAGE_USERS` one ([roles.test.ts:55](frontend/src/lib/auth/__tests__/roles.test.ts#L55)):
```ts
it('CAN_MANAGE_SUPPLIER_GROUPS is exactly superuser/compras', () => {
  expect([...CAN_MANAGE_SUPPLIER_GROUPS].sort()).toEqual(['compras', 'superuser']);
});
```
and a cross-privilege negative test alongside the `compras` block ([roles.test.ts:80-84](frontend/src/lib/auth/__tests__/roles.test.ts#L80)) asserting `isAuthorized('gerencia'|'admin'|'inventario', CAN_MANAGE_SUPPLIER_GROUPS)` is `false` — this is the test that would catch someone "helpfully" widening it to `admin` later the way `admin/usuarios` was.

---

## 3. Wiring groups into the reabastecimiento-vivo data flow

The row-building pipeline currently resolves a product's supplier to a **name string only** ([rows.ts:189-197](frontend/src/app/api/compras/reabastecimiento/rows.ts#L189)). It needs to also carry that supplier's group id, if any.

### 3.1 `rows.ts` changes

Add two more parallel fetches inside the existing `Promise.all` ([rows.ts:140-183](frontend/src/app/api/compras/reabastecimiento/rows.ts#L140)):
```ts
fetchAll<{ id: string; display_name: string }>((a, b) =>
  service.from('supplier_groups').select('id, display_name').range(a, b)),
fetchAll<{ supplier_id: number; group_id: string }>((a, b) =>
  service.from('supplier_group_members').select('supplier_id, group_id').range(a, b)),
```

Change the supplier-resolution block ([rows.ts:189-197](frontend/src/app/api/compras/reabastecimiento/rows.ts#L189)) from storing a bare name to storing `{ name, groupId }`:
```ts
const supplierById = new Map(suppliers.map((s) => [s.id, s.name]));
const groupIdBySupplierId = new Map(groupMembers.map((m) => [m.supplier_id, m.group_id]));
const supplierByProduct = new Map<number, { name: string; groupId: string | null }>();
for (const l of links) {
  if (!supplierByProduct.has(l.product_id)) {
    supplierByProduct.set(l.product_id, {
      name: supplierById.get(l.supplier_id) ?? '',
      groupId: groupIdBySupplierId.get(l.supplier_id) ?? null,
    });
  }
}
```
Every read of `supplierByProduct.get(...)` becomes `.get(...)?.name` (engine row at [rows.ts:282](frontend/src/app/api/compras/reabastecimiento/rows.ts#L282), plain-object read at [rows.ts:298](frontend/src/app/api/compras/reabastecimiento/rows.ts#L298)); add a new field next to it:
```ts
provGroupId: supplierByProduct.get(r.product_id)?.groupId ?? null,
```

Extend the `LiveRow` interface ([rows.ts:100-131](frontend/src/app/api/compras/reabastecimiento/rows.ts#L100)) with `provGroupId: string | null;` next to `prov`.

`buildRows`'s return type gains a `groups` catalog so the page doesn't need a second round-trip to label the filter:
```ts
return {
  rows, maxAsOf, monthStart, coberturaDias,
  groups: groupsCatalog.map((g) => ({ id: g.id, displayName: g.display_name })),
};
```

### 3.2 `route.ts` changes

[route.ts:52](frontend/src/app/api/compras/reabastecimiento/route.ts#L52) destructures `buildRows`'s return — add `groups` there, and include it in the JSON payload ([route.ts:84-98](frontend/src/app/api/compras/reabastecimiento/route.ts#L84)):
```ts
const [{ rows, maxAsOf, monthStart, coberturaDias, groups }, tiendaRows, lastSync] = ...
...
return NextResponse.json({ bodega, bodegas, rows, groups, tiendas, meta: {...} });
```

### 3.3 `tabla.ts` changes (pure, testable — no component touched)

Extend `FilaOrdenable` ([tabla.ts:20-36](frontend/src/lib/compras/tabla.ts#L20)) with `provGroupId: string | null;`.

Change filter matching in `filtrar()` ([tabla.ts:171-184](frontend/src/lib/compras/tabla.ts#L171)). The selected filter value stays a single string (no type change to `Filtros.proveedor`), but a group selection is distinguished by a `'group:'` prefix so raw supplier names (which can never collide with that prefix in practice, but see validation note below) and group ids share one field:
```ts
if (f.proveedor) {
  if (f.proveedor.startsWith('group:')) {
    if (r.provGroupId !== f.proveedor.slice(6)) return false;
  } else if (r.prov !== f.proveedor) return false;
}
```
Add a tiny exported helper so the prefix convention lives in one place instead of being duplicated between `tabla.ts` and the component that builds the dropdown options:
```ts
export const grupoFiltroValor = (groupId: string): string => `group:${groupId}`;
```

**Why a string prefix instead of changing `Filtros.proveedor` to a union type:** `vista()`/`filtrar()` are already exercised by tests that construct `Filtros` objects directly; a string keeps the existing test shape valid and keeps `<select>`/combobox `value=`/`onChange` wiring trivial (HTML form controls are string-in-string-out). The alternative (`{ type: 'raw' | 'group'; value: string }`) is more "correct" but buys nothing here — flagged, not adopted, per the project's stated preference against premature abstraction.

---

## 4. Frontend: the management panel

New file: `frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/ProveedorGruposPanel.tsx`

A `@radix-ui/react-dialog` modal (already a dependency — [package.json](frontend/package.json), used elsewhere in the repo; no new dependency needed) containing the master-detail layout from the UX doc §3.1:

- **State:** fetches `GET /api/compras/proveedor-grupos` on open; local state for the selected group id (or `'new'`), a search string over the combined groups+ungrouped list, and a draft member-id set + draft display name for whichever group is selected.
- **Left column:** list of groups (`displayName` + member count) and a synthetic "Sin agrupar" entry showing the ungrouped count; a "+ Nuevo grupo" button.
- **Right panel:** for the selected group — a text input for `displayName`, a search-filtered checklist of all suppliers (checked = member of *this* group), and a save/cancel pair. Any checked supplier that belongs to a *different* existing group shows a small inline warning ("actualmente en «X» — se moverá aquí") **before** save, per the "move, not add" semantics from §2.1 — this is a client-side-only warning; the API always executes the move.
- **Save:** `POST` for a new group, `PATCH` for an existing one (sending the complete member id set, per §2.2). On success, refetch and close the edit sub-panel, keeping the modal open (Wilmer likely edits more than one group per sitting).
- **Delete:** confirm dialog ("¿Eliminar el grupo «X»? Sus N proveedores vuelven a aparecer sueltos en el filtro.") then `DELETE`.

### 4.1 Entry point in `VivoClient.tsx`

Add a small button next to the existing proveedor filter ([VivoClient.tsx:601-608](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L601)) — e.g. a gear/settings icon with `title="Gestionar grupos de proveedores"` — that opens `ProveedorGruposPanel`. On the panel's close, call `load(bodega, true)` (the same silent-refetch pattern already used everywhere else in this file, e.g. [VivoClient.tsx:261](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L261)) so group changes are reflected in the filter immediately without a full-page reload.

Gate the button's visibility client-side on the caller's role (fetch it once via whatever the app already uses to know the logged-in user's role client-side — check `getAuthUser`/session context used elsewhere in authenticated layouts) so non-`compras`/`superuser` sessions never see it — this is a UX nicety, **not** the security boundary; the boundary is `requireAuth`+`route_permissions` on the API (§2.3), which must hold even if the button were somehow shown.

---

## 5. Frontend: the filter itself

Replace the native `<select>` at [VivoClient.tsx:601-608](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L601) with a new component.

New file: `frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/ProveedorFiltro.tsx`

- A small custom searchable listbox (input + absolutely-positioned popover list, `role="listbox"`/`role="option"` + arrow-key handling) — **not** a new dependency: with ~70 items and one-at-a-time selection, a from-scratch component is a couple dozen lines and keeps this repo's minimal-dependency footprint (no `cmdk`/`downshift` needed; `@radix-ui/react-select` was considered and rejected because Radix's `Select` has no built-in text-filter behavior, which is the one thing the native `<select>` is being replaced *for*).
- **Options, built from `payload.groups` + `provList`:** every group present in the current bodega's rows (i.e. `payload.groups` filtered to ids that actually appear in `payload.rows[].provGroupId`, so a group with zero rows in this bodega doesn't clutter the list) rendered with `grupoFiltroValor(g.id)` as the value, followed by every ungrouped `provList` entry (raw names not present in any group's members) — same `[...new Set(...)].sort()` derivation as today ([VivoClient.tsx:329-332](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L329)), just filtered to exclude names that now belong to a group.
- Typing filters both lists client-side (simple substring match), matching general filter-UX guidance to avoid raw alphabetical scanning of 70+ items (cited in the UX doc, §3.3).
- Selecting an option sets the same `prov` state `VivoClient` already has ([VivoClient.tsx:187](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L187)) — no change to how `prov` flows into `vista(...)` ([VivoClient.tsx:340-351](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L340)), since `filtrar()` already knows how to interpret a `'group:'`-prefixed value (§3.3).
- **Renaming a group must not disturb an active filter on it (resolved, §7):** since `prov` stores the group **id** (`grupoFiltroValor(g.id)`), never its label, this falls out for free as long as the displayed label is always looked up fresh from the current `payload.groups` on every render (e.g. `payload.groups.find(g => grupoFiltroValor(g.id) === prov)?.displayName`) rather than captured into local state at selection time. Do not cache the label anywhere — that's the one implementation mistake that would silently break this.
- Once a selection is active, show it as a dismissible chip above/beside the table (the group's `displayName`, or the raw name) with an `×`, per the UX doc's "applied filters as removable tags" recommendation (§3.3) — this can literally replace the current bare `<select>` visual with `chip + "change" trigger` or simply keep the combobox showing the current selection as its display value; either is acceptable, pick whichever costs less against the existing layout.

Update `ApiRow`/`ApiPayload` interfaces in `VivoClient.tsx` ([VivoClient.tsx:123-170](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L123)): add `provGroupId: string | null;` to `ApiRow`, and `groups: { id: string; displayName: string }[];` to `ApiPayload`.

---

## 6. Testing

### 6.1 New unit tests

`frontend/src/lib/compras/__tests__/tabla.test.ts` (extend the existing suite — check whether one already exists next to `tabla.ts`; if so, add to it rather than creating a duplicate):
- `filtrar()` matches rows by raw `prov` when the filter value has no `group:` prefix (regression: today's behavior unchanged for ungrouped suppliers).
- `filtrar()` matches every row whose `provGroupId` equals the selected group, across multiple distinct `prov` names — this is the actual new behavior and the one worth a dedicated test.
- A row with `provGroupId: null` never matches a `group:` filter, even if its raw name happens to equal something absurd like the literal string `group:<id>` (guards the prefix-collision edge case named in §3.3).
- `grupoFiltroValor` round-trips (`'group:' + id` in, and the exact prefix `filtrar` strips).

### 6.2 API route tests

If this repo has route-level tests for similar admin endpoints (check for a test file alongside `api/admin/users/route.ts` — none was found during research, so this may be establishing the pattern rather than following one), add at minimum:
- `POST` rejects an empty `supplierIds` array and a non-existent supplier id.
- `POST` followed by a second `POST` claiming an overlapping supplier moves it (verify via a follow-up `GET` that it appears in only the second group).
- `DELETE` on a group with members succeeds and a subsequent `GET` shows those suppliers back in `ungrouped`.
- Every handler 403s a non-`compras`/`superuser` role and 401s an unauthenticated request (mirrors the existing `requireAuth` contract — see how `admin/users/route.ts` is tested, if at all, for the house style).

### 6.3 Manual QA checklist (do before calling this done)

1. Create a group of 2+ suppliers from the panel; confirm the filter dropdown now shows the group's display name once, not the raw names.
2. Filter by that group; confirm rows from *all* member suppliers appear together, sorted/filtered identically to a normal single-supplier filter today.
3. Rename the group while it's the active filter selection; confirm the table's filtering is undisturbed throughout and the label updates to the new name without Wilmer needing to reselect anything (resolved, §7 — selection follows the rename, since it's keyed by group id, not label).
4. Move a supplier from group A to group B via the panel; confirm the client-side "will move" warning appears before save, and that after saving, filtering by A no longer includes that supplier's rows while filtering by B does.
5. Delete a group with members; confirm its suppliers reappear as individually-selectable ungrouped options in the filter.
6. Log in (or switch role, if the dev environment supports role impersonation) as `gerencia` or `inventario`; confirm the "Gestionar grupos" button is absent, and confirm a direct `curl`/fetch to `POST /api/compras/proveedor-grupos` with that session returns 403.
7. Confirm existing reabastecimiento-vivo behavior is unchanged for a bodega with **zero** groups defined (regression check — `provGroupId` is `null` everywhere, `filtrar()` falls through to the existing exact-match branch).

---

## 7. Edge cases and validation rules, decided explicitly

| Case | Rule | Why |
|---|---|---|
| Creating a group with 0 members | Rejected (400) by the API | A group nobody belongs to has no filter effect and just clutters the management panel's left column; trivial for the UI to prevent by requiring ≥1 checkbox before enabling Save. |
| A group's membership shrinks to 0 via `PATCH` (removing its last member) | Allowed — the group row survives, empty, rather than being auto-deleted | Auto-deleting on the last member's removal is a surprising side effect ("I unchecked one box and the whole group vanished"); an empty group is harmless clutter Wilmer can delete explicitly via the trash icon. |
| Two groups with the same `display_name` | Allowed, not deduplicated | No uniqueness signal exists for group names the way `suppliers.name` at least maps 1:1 to an Odoo partner — inventing a uniqueness rule here would be solving a problem nobody has reported yet. |
| A supplier is deactivated in Odoo (`suppliers.is_active = false`) while grouped | Membership row is untouched; `GET`'s `ungrouped` list already filters to active suppliers (§2.1), but grouped inactive suppliers still resolve via `supplier_group_members` regardless of `is_active` | Deactivation is an Odoo-sync concern orthogonal to grouping; silently dropping a membership row because of it would be an invisible, hard-to-debug group shrinkage. |
| Renaming a group Wilmer currently has selected in the filter | **Resolved:** the selection follows the rename — his filter keeps showing the same group's rows under the new label, never resets to "todos" | Least surprising: the group he selected didn't change, only its display name; forcing a reselect over a pure rename would be friction he didn't ask for. Implemented by keying the filter's `prov` state on group **id**, never on its label (§5). |

---

## 8. Rollout phases

Ship in this order; each phase is independently useful and independently demoable to Wilmer, which matters because none of this has been validated with him yet — the UX doc is a considered recommendation, not something he's seen.

1. **Phase 1 — data model + API + management panel, filter unchanged.** Migration (§1), both API routes (§2), `roles.ts`/test additions (§2.3), `ProveedorGruposPanel` (§4). The native `<select>` still lists raw names. This alone lets Wilmer start building groups and lets you sanity-check the CRUD before touching the (higher-traffic, higher-risk-of-regression) filter component.
2. **Phase 2 — wire groups into the filter.** §3 (`rows.ts`/`route.ts`/`tabla.ts`) + §5 (`ProveedorFiltro`). This is the phase that changes what Wilmer sees every day; do it only after Phase 1's data is real (a handful of actual groups he's created) so Phase 2 can be demoed with real groups instead of synthetic test data.
3. **Phase 3 (optional, defer until Phase 1+2 are validated) — "build a group from the filter itself"** (UX doc §3.2): multi-select raw names directly in `ProveedorFiltro`'s popover with a "Guardar como grupo…" action that opens `ProveedorGruposPanel` pre-seeded with that selection and focus on the name field. This is real, separate interaction work (multi-select mode inside what's otherwise a single-select combobox) — worth doing, but only once it's clear Wilmer actually wants to create groups often enough that starting from the admin panel (Phase 1) is real friction rather than a non-issue.

---

## 9. Rollback plan

Every piece is additive — no existing table, column, or route is altered or removed:
- Migration: `DROP TABLE IF EXISTS supplier_group_members, supplier_groups;` plus a `DELETE FROM route_permissions WHERE route_pattern LIKE '/api/compras/proveedor-grupos%'` fully reverts §1–2 with zero effect on any other feature.
- Frontend: reverting `rows.ts`/`route.ts`/`tabla.ts`/`VivoClient.tsx` to their pre-Phase-2 state restores the exact current filter behavior, since `provGroupId` is additive on every touched interface (nothing existing was renamed or removed — verified against every read site cited in §3).
- Because Phase 1 and Phase 2 are separate deploys (§8), a bad Phase 2 can be reverted on its own while leaving Wilmer's already-authored groups intact in the database for whenever Phase 2 is retried.

---

## 10. File manifest

**New:**
- `supabase/migrations/20260904000001_supplier_groups.sql`
- `frontend/src/app/api/compras/proveedor-grupos/route.ts`
- `frontend/src/app/api/compras/proveedor-grupos/[id]/route.ts`
- `frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/ProveedorGruposPanel.tsx`
- `frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/ProveedorFiltro.tsx`
- `frontend/src/lib/compras/__tests__/tabla.test.ts` (or extend existing file of that name if present)

**Edited:**
- `frontend/src/lib/auth/roles.ts` — add `CAN_MANAGE_SUPPLIER_GROUPS`
- `frontend/src/lib/auth/__tests__/roles.test.ts` — add invariant + negative tests
- `frontend/src/app/api/compras/reabastecimiento/rows.ts` — `provGroupId` on `LiveRow`, group-catalog fetch, `groups` in `buildRows`'s return
- `frontend/src/app/api/compras/reabastecimiento/route.ts` — thread `groups` into the JSON payload
- `frontend/src/lib/compras/tabla.ts` — `provGroupId` on `FilaOrdenable`, group-aware branch in `filtrar()`, export `grupoFiltroValor`
- `frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx` — `ApiRow`/`ApiPayload` fields, swap `<select>` for `ProveedorFiltro`, add the "Gestionar grupos" entry point

---

## 11. Explicit non-goals (do not build these; they were considered and set aside)

- **No per-product substitution matrix / Approved Vendor List.** Ruled out by the client's "global, not per-product" decision (UX doc, framing §).
- **No propagation of grouping into other features** (purchasing reports, reorder-point math, the Carvajal xlsx export) in this pass — they keep showing raw `suppliers.name`. Revisit only if Wilmer or someone else explicitly asks.
- **No append-only/versioned audit trail** for group edits, unlike `sugerido_bodega`/`transito_overrides`/`reyma_factura_match`. Plain `updated_by`/`updated_at` is proportional to the risk (§1 design notes).
- **No new route or `ROLLOUT_FOCUS` entry.** The panel is inline on a page Wilmer already reaches.
- **No new npm dependency** for the combobox/listbox — built from scratch on top of existing primitives (§5).
