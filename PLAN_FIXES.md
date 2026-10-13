# Fix plan

Work that remains after the code-derived manifest in `manifest/`. Ordered by dependency, then by criticality inside each step. Drift is fixed. This file does not propose a second redesign on top of that.

Already done, and not repeated below:

- The frozen workbook page at `/compras/reabastecimiento` is gone, including `data.json` and its client. It had no database table.
- The live page moved from `/compras/reabastecimiento-vivo` to `/compras/reabastecimiento`, with `/historial` and `/proveedores` under it.
- The sidebar label is **Reabastecimiento**.
- The shared calculation lives in `frontend/src/lib/compras/reabastecimientoEngine.ts`. The live page and `GET /api/compras/reabastecimiento` still use it.

## Decisions

- When a handler and `route_permissions` disagree, keep the narrower list. Middleware already enforces the table. Handlers change to match it, so nobody gains access.
- The three day-counts stay three different metrics. Each screen names the one it shows.
- `/status` rows are the 31 August gap analysis and are stale. This pass only fixes who can open the page. The rows wait for a new list.
- Remove `/api/gerencia/validacion`. The Validación Histórica page already reads `/api/gerencia/gap-report`.
- `project_manager` keeps the pages the lists already allow. The comment that says the role is `/status` only is corrected. The role is not newly confined.
- Drop unused tables in a new migration. Do not keep them for a later transit redesign.
- Do not create `purchase_schedule_runs` or `purchase_schedule_lines`. Remove the code that writes them.
- Do not edit a migration that may already have been applied. Every schema or grant change is a new file. Supabase records applied files by version prefix.

## How changes land

Sources for this rule: Supabase's migration guide (never edit an applied file; repair history only when the tracking table is wrong) and the expand/contract pattern (add before you depend on it; drop only after the application has stopped using the object).

- Do not edit `004_optimized_reconstruction.sql`.
- Do not rename either file that shares the prefix `20260911000006`.
- A fresh replay still runs the old `CREATE TABLE` statements. The new migration drops the unused tables at the end.
- Do not move user-facing API routes off the service-role client onto row-level security in this pass. Route checks remain the gate.

## 1. One authorization list

Security first. Behavior for anyone who can already pass middleware stays the same, because the handlers shrink to the table.

Replenishment reads and writes: `compras`, plus `superuser` through the existing bypass. `ceo` and `sales_manager` stay GET-only on the paths they already have. Take `admin` and `gerencia` out of `CAN_VIEW_COMPRAS` and `CAN_EDIT_COMPRAS` for those routes (`conflict.reabastecimiento-handler-vs-matrix`).

`GET /api/status`: delete the extra grants so only `superuser`, `gerencia`, and `project_manager` remain. The handler already rejects everyone else (`conflict.status-handler-vs-matrix`).

`/api/admin/ml-health`: stay `superuser` only. Split the `admin` grant on `/api/admin/*` into the admin routes that should remain, so the wildcard no longer covers this one (`conflict.ml-health-handler-vs-matrix`).

Do not add `PATCH` to `/api/oa/*`. Órdenes Abiertas is hidden. Plan maestro stops offering a save the matrix will reject (`conflict.oa-open-orders-patch`).

Delete grants for paths with no route file (`conflict.orphan-route-grants`):

- `GET /api/compras-internacionales/modelos`
- `POST /api/compras/reabastecimiento/destino`
- `POST /api/compras/reabastecimiento/pendiente`

The user-admin form can assign `operaciones` and `project_manager`, which the database already accepts. It still cannot assign `superuser` (`conflict.user-create-role-list`).

Correct the role-count comment. `ROLES` has twelve values, including `project_manager` (`conflict.role-count-comment`). Correct the `project_manager` comment so it no longer says the role is `/status` only (`conflict.project-manager-scope`).

## 2. Landings and links

Depends on the lists in step 1.

`/` and `/login` both use `getDefaultPage`. An unfocused role is not sent to `/backtest` by one path and somewhere else by the other (`conflict.root-vs-default-page`).

The sidebar uses the same prefix match as the middleware, so Facturas pendientes is visible to `compras_internacionales`, who can already open that URL (`conflict.focus-exact-vs-prefix`).

Remove the Configuración item. It points at `/admin/configuracion`, and that page does not exist. Leave the `/configuracion` permission key. That map restricts a path if a page appears there later (`conflict.admin-configuracion-path`).

The reorder loader comment points at `frontend/src/lib/compras-internacionales/reorden.ts` (`conflict.reorden-path-comment`).

## 3. Remove `/api/gerencia/validacion`

The page at `/gerencia/validacion` loads `/api/gerencia/gap-report` and does not call this route (`conflict.validacion-page-vs-route`). Delete the route file and its grants. Leave `rpc_gerencia_validation` and `rpc_gerencia_validation_runs` until something else needs them. Leave the page on the gap report.

## 4. `/status` shell only

Step 1 narrows who can open it. Do not change `status_items`, `status_plan`, or `scripts/sync_status.py`. The stored rows are the 31 August gap analysis. They are stale. Replacing them waits on a new item list. Do not write a stale flag onto the rows.

## 5. Name the three day-counts

Do not merge them. Label the number each screen already shows.

Stock divided by average `demand_daily` over the last 90 days (`rpc_stockout_risks`, `rpc_stockout_risks_by_warehouse`):

- `/compras` — “cobertura promedio” and the per-SKU “Nd / LT” line
- `/compras/forecast` — “Nd inventario” on the at-risk SKUs
- `/operaciones` — the same average and the same per-SKU days
- `/preocupaciones/desabastecimiento` — the days column
- `/preocupaciones/capital-congelado` — the per-warehouse figure used for the lead-time threshold

Stock divided by the 3-month average over 26 business days (`doh()` in `reabastecimientoEngine.ts`):

- `/compras/reabastecimiento` — the DOH column, including the supplying warehouse

Stock divided by sales over the last 30 days, compared with lead time (`rpc_days_of_inventory`):

- `/operaciones/dias-inventario` — the only screen on that function

Out of these three, and left unlabeled on purpose: Órdenes Abiertas (Excepciones and Dashboard Proveedor) uses `rpc_oa_net_inventory`, which is average uncensored `demand_daily` over 30 days. Programación de Compras shows days from the purchase-schedule proof of concept, which step 7 removes.

## 6. Make the replenishment comment match the calculation

A new migration replaces the comment on `reabastecimiento_inputs` (`conflict.reabastecimiento-net-formula`).

Net stock on the live grid is on-hand minus reserved minus the live Odoo pending quantity. Patio is shown and is not an input to Sugerido. The `pending_reserve` column is not what gets subtracted.

## 7. Drop unused tables, and remove the dead purchase-schedule path

This replaces the earlier decision to keep `transito_destino` and `pending_reserve_overrides` until a shipment-and-leg model existed. Those tables are not the model. Drop them. A later shipment table, if one is built, is a new pair of tables and does not depend on these rows.

One new migration. Drop policies and indexes, then the child table, then the parent. Update `scripts/cleanup_products_without_sku.sql` so it no longer checks `pending_reserve_overrides`. Update the comments in the live replenishment route, `rows.ts`, and `pendienteReserva.ts` that still describe those tables as remaining history.

| Drop | Why |
| --- | --- |
| `transito_destino` | Hand-typed single destination. The live grid does not read it. A truck that unloads in more than one warehouse cannot be represented by one destination per product. |
| `pending_reserve_overrides` | Hand-typed reserve. The live grid reads that number from Odoo on each request. |
| `extraordinary_order_lines` | Nothing queries the stored rows. `/api/oa/extraordinary` calls `rpc_oa_detect_extraordinary`, which does not use this table. |
| `extraordinary_orders` | Parent of those lines. Drop the lines first because of the foreign key. |
| `products_acid_test_archived` | Archive twin. Forecast and KPI routes read only `products_acid_test_active`. |
| `audit_log` | Created in the initial schema. Nothing inserts or selects it. |

Do not drop these. Ingest or a SQL function still uses them: `tenants`, `customers`, `units_of_measure`, `exchange_rates`, `sale_orders`, `warehouses`, `stock_locations`. Do not drop `transito_overrides` or `transito_detalle`. Those are the live transit path. Do not drop `products_acid_test_active`.

`purchase_schedule_runs` and `purchase_schedule_lines` are not in the drop. No migration creates them. Remove `ml/purchase_scheduler.py`'s writes, Flask `POST /backtest/purchase-schedule-all`, and `/api/poc/purchase-schedule`. Leave the Programación de Compras sidebar item disabled. Purchase timing stays on Sugerido, the Reyma plan, and the reorder-point engine.

The live chain after this step is unchanged: a purchase order belongs to one branch (`bodega_map`), its quantity and expected date land on that warehouse (`reabastecimiento_inputs.transito` and `transito_detalle`), and a typed quantity in `transito_overrides` can override that. Unreserved demand stays a live Odoo read.

## 8. Reconstruction function, only after a live check

Do not edit `004_optimized_reconstruction.sql`. Filename order makes the body in `20260322000002_reconstruction_functions.sql` the one a fresh replay keeps (`conflict.reconstruct-inventory-order`). Which body is installed in the real database is not visible from the files. A new `CREATE OR REPLACE` happens only after that is checked. The two files that share the prefix `20260911000006` stay under those names (`conflict.migration-version-collision`).

## Not in this pass

- Replacing the `/status` rows. That waits on a new item list.
- Merging the three day-counts into one formula.
- Confining `project_manager` to `/status`.
- A shipment-and-leg table for multi-stop unloads. The current sync still assigns one purchase order to one branch. Building the multi-stop model is separate work, and it starts from new tables.
- Moving API reads off the service-role client onto row-level security.
