# Proveedores selector: grouping UI/UX research

**Status:** research findings + recommendation. Nothing here is built.
**Author:** Claude, 2026-09-03.
**Trigger:** the "Todos los proveedores" filter in reabastecimiento-vivo lists ~70+ legal-entity names, but many are the same real-world sourcing option (duplicate legal entities, parent/child companies, or interchangeable brands). Wilmer needs to filter by "who can I actually buy this from," not by which Odoo partner record it happens to be.
**Scope of this doc:** UI/UX patterns only, grounded in the current codebase. Scoping questions resolved with the client before/during research:
1. Grouping is **global and supplier-level**, not per-product — if A and B are substitutes, they're substitutes for everything sourced from either, not just one SKU. This rules out a per-part "Approved Vendor List" matrix and simplifies the data model to one flat grouping.
2. **One group per supplier**, no multi-membership — simpler filter logic; revisit only if a real overlapping case shows up.
3. **Scoped to this filter only** — other features that read raw `prov`/`suppliers.name` (reports, reorder-point calcs, etc.) keep showing raw legal names for now; grouping isn't propagated elsewhere in this pass.
4. **Access = Wilmer only** (role `compras`), and because `compras` is currently confined by `ROLLOUT_FOCUS` ([roles.ts:157](frontend/src/lib/auth/roles.ts#L157)) to 3 routes, group management is **inline in reabastecimiento-vivo** (a panel/modal on the page he already has), not a separate `admin/proveedores` route — sidestepping both a new permission list and a `ROLLOUT_FOCUS` change. This also fits §3.2 below: groups get built from the filter itself, not a cold standalone admin form.

---

## 1. Current state (measured)

- The filter is a plain HTML `<select>` at [VivoClient.tsx:601-608](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L601), hardcoded option `"Todos los proveedores"` followed by `provList.map(...)`.
- `provList` is **not** a stored list — it's recomputed per page load as `[...new Set(rows.map(r => r.prov))].sort()` ([VivoClient.tsx:329-332](frontend/src/app/(authenticated)/compras/reabastecimiento-vivo/VivoClient.tsx#L329)), i.e., whatever distinct supplier names happen to appear in that load's rows, alphabetically.
- Row-level `prov` comes from `supplierByProduct`, the **first** `product_suppliers` link per product ("primary supplier") — [rows.ts:189-195](frontend/src/app/api/compras/reabastecimiento/rows.ts#L189), sourced from Supabase tables `suppliers` and `product_suppliers` ([initial_schema.sql:106-128](supabase/migrations/20260322000001_initial_schema.sql#L106)), themselves synced from Odoo.
- Filtering itself is a strict string match, `r.prov !== f.proveedor`, in `filtrar()` ([tabla.ts:174](frontend/src/lib/compras/tabla.ts#L174)).
- **No grouping/aliasing model exists anywhere in the repo.** `suppliers` has no self-referencing `parent_id`, `group_id`, or `canonical_id` column; a repo-wide grep for `supplier_group`, `parent_company`, `vendor_alias`, `proveedor_grupo` returns nothing.
- **No admin config precedent to copy beyond `admin/usuarios`.** It's the only page under `admin/` today — no `admin/roles`, `admin/categorias`, or other many-to-many config screen exists.

The upshot: this isn't a matter of tweaking the `<select>`. There is no concept of "group" in the data at all, and no existing admin surface for building one except the one page.

---

## 2. What kind of UI problem this actually is

Two genuinely different needs are bundled inside "some proveedores are the same" — worth naming separately even though the client's decision (global, flat grouping) means they'll likely share **one mechanism**, not two:

| Relationship | What it means for the filter | Closest existing pattern |
|---|---|---|
| **Same company, different legal-entity records** (e.g. "CARVAJAL EMPAQUES CENTROAMERICA, S.A. DE C.V." vs "CARVAJAL EMPAQUES, S. A. DE C. V.") | These are duplicates. Wilmer never wants to see both as separate filter options — one should stand in for the other. | **Merge / canonical record**: CRM dedup UIs (Salesforce, Dynamics) let a user pick a "master record" that survives, with the rest becoming aliases pointing at it. |
| **Parent/child companies** (a subsidiary of a named group) | Similar to the above from Wilmer's sourcing perspective — he cares about the buying relationship, not the corporate structure — but the underlying entities stay legitimately distinct in Odoo. | Same merge/canonical pattern, just without deleting the child's own identity — it's an alias, not a deletion. |
| **Valid substitutes / interchangeable suppliers** (different, unrelated companies that can both supply the same kind of product) | Wilmer still may want to pick a specific one (price, lead time) — these should stay individually selectable, just filterable together. | **Named group / tag / user-group**: Slack user groups, saved segments, tag managers — a named set of otherwise-independent members. |

Since the client's decision collapses both into one flat, global grouping concept, the practical recommendation is: **one `supplier_groups` construct, used for both.** A group can have one member (a plain alias) or many (a substitute set) — the UI doesn't need to force the user to declare which case they're in up front. This mirrors how Slack user groups and Gmail-style tag managers work: a named bucket of members, no distinction between "this is really the same thing" and "these are just related" baked into the schema.

---

## 3. UI/UX patterns worth adopting

### 3.1 Group management panel: master-detail, inline on the page Wilmer already has

`compras` is currently confined by `ROLLOUT_FOCUS` ([roles.ts:157](frontend/src/lib/auth/roles.ts#L157)) to 3 routes, and access to group management is Wilmer-only — so this is **not** a new `admin/` route. It's a panel/modal launched from reabastecimiento-vivo itself (e.g. a "Gestionar grupos de proveedores" button near the filter), avoiding both a new permission list and a `ROLLOUT_FOCUS` edit.

Inside that panel, still follow the shape used by Slack's and most identity-provider "groups" admin screens rather than a single flat form: a **list of groups on the left** (name, member count), and a **member picker on the right** for whichever group is selected — search-and-checkbox multi-select to add/remove suppliers ([Slack: Manage user groups from the admin dashboard](https://slack.com/help/articles/115004952926-Manage-user-groups-from-the-admin-dashboard)). This scales far better than one page per group.

- Left: list of existing groups, each showing its display name and how many raw proveedor records it contains, plus an "ungrouped" bucket so nothing is silently hidden.
- Right, on selecting a group: a search box over the full raw proveedor list, checkboxes to add/remove members, and a **display name** field — this becomes the label the filter dropdown shows instead of the raw legal name (borrowing the "pick a master record" step from CRM merge flows: [Clay — merging duplicate accounts in Salesforce](https://www.clay.com/guides/how-to-merge-duplicate-accounts-in-salesforce)). Since membership is one-group-per-supplier, adding a proveedor to a new group is a move, not an add — the picker should show and let Wilmer confirm reassignment if a proveedor already belongs elsewhere.

### 3.2 Build groups from the filter itself, not only from a cold panel

A blank panel with 70 unlabeled checkboxes is a bad first experience — Wilmer has to already know which names are duplicates before he can tell the tool. Instead, let the grouping workflow start **from the exact place the problem is visible**: in the reabastecimiento-vivo filter dropdown itself, allow multi-select of raw proveedor names plus a "Guardar como grupo…" action, prompting only for a group name. This is the same pattern as "Save as segment" in analytics tools ([Adobe Analytics — Manage Segments](https://experienceleague.adobe.com/en/docs/analytics/components/segmentation/segmentation-workflow/seg-manage)) and "Save as List View" in Salesforce — the management panel (3.1) still exists for later maintenance (renaming, adding a member discovered next month), but group *creation* doesn't require a context switch away from the task that motivated it.

### 3.3 Replace the native `<select>` with a grouped, searchable multi-select

A native HTML `<select>` cannot show grouping headers cleanly and forces single-item scanning through 70+ alphabetical entries — already the exact complaint in the screenshot. Once groups exist, the filter should become:
- A searchable combobox/listbox (not native `<select>`) so typing narrows the list, per general filter-UX guidance to cap visible options and avoid raw alphabetical scanning of large sets ([LogRocket — Filtering UX/UI design patterns](https://blog.logrocket.com/ux-design/filtering-ux-ui-design-patterns-best-practices/), [Bricx — Filter UI patterns](https://bricxlabs.com/blogs/universal-search-and-filters-ui)).
- Each **group** appears as one row showing its display name (e.g. "Carvajal", "Corporación Athezeus") with a disclosure chevron to expand and see/deselect the individual legal entities inside it, so the grouping is never a black box.
- Ungrouped proveedores appear as their own rows below/among the groups, unchanged — grouping should be additive, never mandatory, so nothing Wilmer hasn't gotten around to organizing disappears from the filter.
- Once selected, show the active filter as a removable tag/chip above the table (group name, with an ×), consistent with the general "show applied filters as dismissible tags" pattern ([LogRocket](https://blog.logrocket.com/ux-design/filtering-ux-ui-design-patterns-best-practices/)).

This also directly fixes the filtering logic at [tabla.ts:174](frontend/src/lib/compras/tabla.ts#L174): instead of `r.prov !== f.proveedor` (exact string match against one name), matching becomes "is `r.prov` a member of the selected group" — a superset check, falling back to exact match for ungrouped suppliers.

### 3.4 Keep it a flat, low-ceremony CRUD — not the crosswalk doc's audit machinery

`VENDOR_SKU_CROSSWALK_DESIGN.md` (this repo) proposes an append-only, evidence-tiered, human-reviewed table for vendor-SKU↔código mapping, because that map silently corrupts financial/inventory numbers if wrong and is fed by an automated proposal engine. Supplier grouping is a different risk profile: it's authored directly by Wilmer (no automated proposals to review), and a wrong grouping is immediately visible as "wrong items showed up in my filter" rather than a silent stock/money error. Recommend a plain mutable `supplier_groups` + `supplier_group_members` (one row per supplier, `supplier_id` unique — enforcing one-group-per-supplier at the schema level) with `created_by`/`updated_by`/`updated_at` for accountability, not a versioned/append-only ledger — matching a lighter-weight config than the `reyma_factura_match` precedent, since there's no automated proposal engine here to audit.

### 3.5 Access gate

New permission list, since Wilmer's role (`compras`) isn't in `CAN_VIEW_ADMIN`: something like `CAN_MANAGE_SUPPLIER_GROUPS = ['superuser', 'compras']` in [roles.ts](frontend/src/lib/auth/roles.ts), checked when rendering/opening the panel from 3.1 — not a `PAGE_PERMISSIONS`/`ROLLOUT_FOCUS` entry, since there's no separate route.

---

## Sources

- [Manage user groups from the admin dashboard — Slack](https://slack.com/help/articles/115004952926-Manage-user-groups-from-the-admin-dashboard) — master-detail group list + search-and-select member management
- [Create and edit user groups — Slack](https://slack.com/help/articles/212906697-Create-and-edit-user-groups)
- [How to Merge Duplicate Accounts in Salesforce — Clay](https://www.clay.com/guides/how-to-merge-duplicate-accounts-in-salesforce) — canonical/master-record selection pattern
- [Merge Duplicates — Dynamics 365 CRM Apps (Inogic)](https://docs.inogic.com/deduped/features/merge-duplicates)
- [Manage Segments — Adobe Analytics](https://experienceleague.adobe.com/en/docs/analytics/components/segmentation/segmentation-workflow/seg-manage) — "save current selection as a named segment" pattern
- [Getting filters right: UX/UI design patterns and best practices — LogRocket](https://blog.logrocket.com/ux-design/filtering-ux-ui-design-patterns-best-practices/) — dismissible filter tags, grouping filters into categories
- [15 Filter UI Patterns That Actually Work — Bricx](https://bricxlabs.com/blogs/universal-search-and-filters-ui) — searchable combobox over long option lists
- [Approved Supplier List: What Manufacturers Should Track — SourceDay](https://sourceday.com/blog/approved-supplier-list/) — considered and set aside: per-product AVL matrix, ruled out by the client's "global, not per-product" decision

Local precedent (this repo):
- [VENDOR_SKU_CROSSWALK_DESIGN.md](VENDOR_SKU_CROSSWALK_DESIGN.md) — related but distinct problem (vendor SKU → our código); establishes this repo's convention of flagging open decisions explicitly and citing evidence, followed here, but its append-only/tiered-evidence machinery is deliberately **not** reused (see §3.4)
- [frontend/src/app/(authenticated)/admin/usuarios/page.tsx](frontend/src/app/(authenticated)/admin/usuarios/page.tsx) — only existing admin config page, the shape to extend
