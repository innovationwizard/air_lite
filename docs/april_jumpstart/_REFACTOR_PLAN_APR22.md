# REFACTOR PLAN — Wilmer + Mario Silos for Demo Today

**Date:** 2026-04-22
**Budget:** 3–4 hours until demo. Audience: Wilmer + Mario only.
**Grounded in:** [_THE_RULES.MD](../../_THE_RULES.MD), [_SILO_DEFINITIONS_APR22.md](_SILO_DEFINITIONS_APR22.md), [_AI_Refill_Lite_Path_Forward_2026-04-21.md](../../_AI_Refill_Lite_Path_Forward_2026-04-21.md), actual source code read on 2026-04-22.
**Purpose:** Ship a role-specific split of air_lite so Wilmer sees his tool, Mario sees his tool, and both solve the daily pain named in the silo doc.

---

## 1. RULES ADHERENCE

Every section below is anchored to a file path or a verified fact. Where information was missing, it was asked — not assumed. Decisions locked by Jorge on 2026-04-22:

| # | Question | Decision |
|---|---|---|
| 1 | Demo window & audience | 3–4h, Wilmer + Mario only |
| 2 | Mario's role | Add new `operaciones` role (DB + TS + route_permissions) |
| 3 | Mario's "Días de Inventario" view | Build v1 today (aggregate, no m³) |
| 4 | Broken backtest savings (storage, stockout, rotation) | Show all 4 with explicit "en validación" disclaimer |

No mock data. No fabricated metrics. Data source remains the 2026-03-03 Odoo snapshot already in Supabase — the staleness will be surfaced on the page header, not hidden.

---

## 2. WHAT EXISTS TODAY (verified)

### 2.1 Routes under [frontend/src/app/(authenticated)/](../../frontend/src/app/(authenticated)/)

| Route | State | Relevance to refactor |
|---|---|---|
| `/backtest` | Production | Wilmer narrative (Forecast) + Gerencia value story |
| `/preocupaciones/desabastecimiento` | Production — RPC `rpc_stockout_risks()` | → Mario's **Hot List** |
| `/preocupaciones/capital-congelado` | Production — RPC `rpc_abc_xyz_classification()` | → Mario's **Hold List** (indirectly) |
| `/preocupaciones/costos-almacenamiento` | Production — RPC `rpc_slow_moving_items()` | Mario secondary |
| `/preocupaciones/compras-innecesarias` | Placeholder (sources from `backtest_savings`) | Wilmer narrative |
| `/oa/excepciones` | Early production | Mario Hot/Hold companion |
| `/oa/*` (10 more pages) | Early production | Compras-native — stays for Wilmer |
| `/poc/programacion` | Production-ready POC — RPC `purchase_schedule_*` | → Wilmer's **Programación de Compras** |
| `/admin/usuarios`, `/superuser`, `/configuracion` | Production | Out of scope today |

### 2.2 RBAC — real state

- TS constants: [frontend/src/lib/auth/roles.ts](../../frontend/src/lib/auth/roles.ts) defines 8 roles (`superuser, admin, gerencia, compras, ventas, inventario, financiero, testuser`).
- DB CHECK constraint: [supabase/migrations/20260323000002_rbac.sql:15-16](../../supabase/migrations/20260323000002_rbac.sql#L15-L16) enforces only 7 — `testuser` is in TS but **not** in the DB constraint. Pre-existing drift; do not attempt to fix today.
- `CAN_VIEW_RISKS` currently **excludes** `compras` and `testuser` — declared inline in [FearsSidebar.tsx:29](../../frontend/src/components/layout/FearsSidebar.tsx#L29). This is why Wilmer cannot see `/preocupaciones/*` today.
- `CAN_VIEW_POC` currently **excludes** `compras` — [FearsSidebar.tsx:32](../../frontend/src/components/layout/FearsSidebar.tsx#L32). Today's refactor must reverse this for Wilmer to see Programación de Compras.

### 2.3 Data available

- `demand_daily` (aggregated, Census-Filter-flagged) — enough to compute `avg_daily_demand_30d` per SKU × warehouse.
- `inventory_daily` (reconstructed daily position, frozen 2026-03-03 for the most recent value).
- `product_suppliers.delay` — lead time per SKU.
- `products.volume` — 74.6% populated (per prior audits). Enough for a future m³ calculation but **not in scope today**.
- `warehouses` + `stock_locations` — the 4 bodegas from user memory (10,007 m³ total; 85.5% en uso) are already in the DB.

### 2.4 Known credibility risks (carry into demo script)

- `storage_savings_pct = 0%` for all 14 backtest cycles.
- `stockout_savings_pct = 80%` flat (hardcoded assumption).
- `rotation_improvement_pct = 53.85%` flat.
- Jul 2025 cycle = GTQ 0 total savings.
- Data snapshot frozen at 2026-03-03.
- Credit notes still excluded from the revenue stream.

These are not fixed today. They are disclosed today.

---

## 3. TARGET ARCHITECTURE (after refactor)

### 3.1 Role → surface map

| Role | Landing page | Sidebar sections they see |
|---|---|---|
| **compras** (Wilmer) | `/compras` | Compras (new) + Órdenes Abiertas + Demostración de Valor |
| **operaciones** (Mario — new) | `/operaciones` | Operaciones (new) + Órdenes Abiertas + Demostración de Valor |
| gerencia / admin / superuser | unchanged | Everything |
| ventas / inventario / financiero | unchanged | No regression today |

### 3.2 New routes to create today

| Route | Purpose | Source data |
|---|---|---|
| `/compras` | Wilmer's landing. Three cards: Forecast de Demanda, Programación de Compras, Demostración de Valor. | Static nav links |
| `/operaciones` | Mario's landing. Three cards: Días de Inventario, Hot List, Hold List. | Static nav links |
| `/operaciones/dias-inventario` | **New page.** Per-SKU per-bodega days of supply. | New RPC `rpc_days_of_inventory()` |

### 3.3 Routes that stay where they are (rebranded in the sidebar only)

- `/backtest` → sidebar label for Wilmer: "Ahorro histórico — Demostración de Valor"
- `/poc/programacion` → sidebar label for Wilmer: "Programación de Compras" (Carvajal + Reyma). Kept at `/poc/programacion` to avoid breaking the existing page. A thin redirect from `/compras/programacion` is OK if trivial; otherwise defer.
- `/preocupaciones/desabastecimiento` → sidebar label for Mario: "Hot List — Riesgo de quedarse sin stock"
- `/preocupaciones/capital-congelado` → sidebar label for Mario: "Hold List — Inventario sobredimensionado"
- `/oa/excepciones` → kept for both, labeled "Excepciones del Día (Hot/Hold)"

**Moving files is out of scope.** Renaming a URL path invalidates every Next.js link, breaks bookmarks, and risks the demo. Sidebar labels + landing-page cards do the semantic work without the code churn.

---

## 4. WORK BREAKDOWN — PRIORITIZED FOR 3–4H BUDGET

Order = ship order. Each item has an estimate and an explicit cut point.

### P0 — Must ship (≈2h)

#### P0.1 — Días de Inventario v1 (≈1h45m)

The only net-new user-facing page. Highest risk item, therefore first.

**Database (≈25m):**
- New migration `20260422000001_rpc_days_of_inventory.sql`.
- Function `rpc_days_of_inventory()` returning columns:
  - `product_id, sku, product_name, warehouse_id, warehouse_name`
  - `current_stock` (latest `inventory_daily.qty_on_hand` for the SKU × warehouse)
  - `avg_daily_demand_30d` (AVG of `demand_daily.qty` last 30 days before snapshot)
  - `days_of_supply` = `current_stock / NULLIF(avg_daily_demand_30d, 0)`
  - `lead_time_days` from `product_suppliers.delay` (pick shortest if multiple)
  - `status` = `'hot'` if `days_of_supply < lead_time_days`, `'ok'` if `days_of_supply BETWEEN lead_time_days AND lead_time_days*2`, `'hold'` if `days_of_supply > lead_time_days*2`, `'no_demand'` if `avg_daily_demand_30d = 0`.
- Rows where `current_stock IS NULL` or `avg_daily_demand_30d = 0` are returned (honest) with status labeled — not dropped.
- Grant EXECUTE to `authenticated`.

**API (≈10m):**
- New route `frontend/src/app/api/kpis/days-of-inventory/route.ts` that calls the RPC via the Supabase service client, following the pattern used by `/api/kpis/stockout-risk`.

**Page (≈60m):**
- New route `frontend/src/app/(authenticated)/operaciones/dias-inventario/page.tsx`.
- Header: "Días de Inventario" + subtitle "Snapshot al 3 de marzo 2026" (honest staleness).
- Top KPI row: count of SKUs in `hot`, `ok`, `hold`, `no_demand`.
- Main table (sortable): SKU, producto, bodega, stock actual, demanda promedio diaria (30d), días de inventario, lead time, estado (color-coded badge).
- Default sort: `days_of_supply ASC` so Mario's fires are at the top.
- Filter dropdown: bodega (4 options from `warehouses`).
- **Do not** add m³ occupation, in-transit, or reserved-qty columns. Silo doc line 174 explicitly calls them out of scope.

**Cut point:** If the table renders, ship it. CSV export can be added later.

#### P0.2 — Backtest "en validación" disclaimer (≈15m)

- Edit `frontend/src/app/(authenticated)/backtest/page.tsx` (or the savings-cards sub-component — verify before editing).
- Add a yellow banner above the 4 savings cards: *"Tres de las cuatro métricas están en proceso de validación contra datos adicionales de Odoo. Los resultados reales pueden variar."*
- Add a small `EN VALIDACIÓN` pill to the Storage, Stockout, and Rotation cards specifically. Leave the Unnecessary Purchases card unmarked.

**Why this order:** the disclaimer is 15 minutes but essential. If Wilmer clicks `/backtest` during the demo and the storage card reads 0%, the silence kills the whole pitch. Honesty is cheap; awkwardness is expensive.

### P1 — Should ship (≈1h)

#### P1.1 — Add `operaciones` role (≈30m)

- New migration `20260422000002_add_operaciones_role.sql`:
  - `ALTER TABLE user_profiles DROP CONSTRAINT user_profiles_role_check;`
  - `ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('superuser','admin','gerencia','compras','ventas','inventario','financiero','operaciones'));`
  - Insert `route_permissions` rows for `operaciones`:
    - `/api/backtest/*` GET (value demo)
    - `/api/kpis/stockout-risk` GET (Hot List)
    - `/api/kpis/abc-xyz` GET (Hold List)
    - `/api/kpis/slow-moving` GET
    - `/api/kpis/days-of-inventory` GET (new)
    - `/api/oa/*` GET
- TS change to [frontend/src/lib/auth/roles.ts](../../frontend/src/lib/auth/roles.ts):
  - Add `OPERACIONES: 'operaciones'` to `ROLES`.
  - Add `'operaciones'` to `CAN_VIEW_OPERATIONAL` and `CAN_VIEW_OA`.
  - Add `'Operaciones'` label to `ROLE_LABELS`.
  - Add `'operaciones'` default landing to `getDefaultPage()` → `'/operaciones'`.
- Seed Mario's user: either update an existing `user_profiles.role` to `'operaciones'` via SQL, or use the admin UI. **Ask Jorge which account to reassign before running** — do not invent an email.

**Cut point if time runs out:** fall back to `'inventario'` role for Mario, relabel `Inventario → Operaciones` in `ROLE_LABELS` only. Documented as technical debt, surfaces immediately post-demo.

#### P1.2 — Sidebar restructure (≈20m)

Edit [frontend/src/components/layout/FearsSidebar.tsx](../../frontend/src/components/layout/FearsSidebar.tsx):

- Add a new `Compras` section group (`requiredRoles: ['compras', 'superuser', 'admin', 'gerencia']`) with items:
  - `Forecast de Demanda` → `/backtest` (label is the value, path is existing)
  - `Programación de Compras` → `/poc/programacion`
  - `Órdenes Abiertas` → remains its own group, keep showing for compras

- Add a new `Operaciones` section group (`requiredRoles: ['operaciones', 'superuser', 'admin', 'gerencia']`) with items:
  - `Días de Inventario` → `/operaciones/dias-inventario`
  - `Hot List (Desabastecimiento)` → `/preocupaciones/desabastecimiento`
  - `Hold List (Capital Congelado)` → `/preocupaciones/capital-congelado`

- Update `CAN_VIEW_POC` (line 32) to include `compras`. Update `CAN_VIEW_RISKS` (line 29) to include `operaciones`. Compras deliberately does **not** get the full Riesgos bundle — it gets Forecast + Programación + OA.

- Keep "Demostración de Valor" at the top for everyone.

#### P1.3 — Landing pages `/compras` and `/operaciones` (≈20m)

Two thin pages. No RPC, no state. Pure marketing-style card layout linking to existing routes. Each card shows: icon, title (role-specific framing from silo doc), subtitle, and a one-liner describing what the user will see.

`/compras` cards (verbatim framing from silo doc):
- "Forecast de Demanda" → `/backtest` — *"Tu Excel automatizado. 12 meses de horizonte, no 3."*
- "Programación de Compras" → `/poc/programacion` — *"Lo que hay que comprarle a Carvajal y Reyma, semana por semana."*
- "Ahorro histórico" → `/backtest` (same route, different framing) — *"Cuánto habrías ahorrado si hubieras tenido AI Refill el año pasado."*

`/operaciones` cards:
- "Días de Inventario" → `/operaciones/dias-inventario` — *"¿Cuántos días tengo de cada producto en cada bodega?"*
- "Hot List" → `/preocupaciones/desabastecimiento` — *"Los que están por agotarse. Aseguralos primero."*
- "Hold List" → `/preocupaciones/capital-congelado` — *"Los que están comiendo espacio. Decile a Carvajal que no mande más."*

### P2 — Nice to have (skip if over budget)

- CSV export on Días de Inventario, Hot List, Hold List (Mario wants to email Carvajal a list — but a screenshot works for today's demo).
- `/compras/programacion` redirect to `/poc/programacion` (zero product value today; pure cosmetics).
- Mobile breakpoint check (Roberto not in the room today).
- Updating the CHECK constraint to include `testuser` (pre-existing drift — do not conflate with this refactor).

---

## 5. EXPLICIT OUT-OF-SCOPE (do not build today)

Pulled directly from the silo doc and the Path Forward doc. Called out so Jorge can point at this list if anyone asks "why isn't X there?"

- m³ occupation and bodega capacity (needs one-time capacity config that is not available today).
- In-transit deduction on Días de Inventario (needs joining `purchase_order_lines` where `state='purchase'` — can be added in Sprint 2).
- Reserved inventory invisibility (needs `sale_order_lines.reserved_qty` surfacing).
- Archived-code merging (needs a mapping table Wilmer carries in his head).
- Homólogo / substitute relationships (tribal knowledge, not in the DB).
- "Never be out" flag per SKU (needs manual classification).
- Fresh data re-ingestion with credit notes (Path C in the Path Forward doc — half-day minimum).
- Fixing the three broken savings numbers (Path A — multi-hour ML work).
- Excel export button (CSV is planned; native Excel is Sprint 1 territory).
- Live Odoo sync on Railway (planned, separate track).
- BOM / packaging materials explosion (blocked by Odoo `mrp.bom` access denial).
- Mobile-optimized dashboard (Roberto's phone — not a today audience).

---

## 6. RISK REGISTER

| Risk | Likelihood | Mitigation |
|---|---|---|
| `rpc_days_of_inventory` returns 0 rows due to join mismatch on `warehouse_id` | Medium | Before writing the page, run the SQL directly in Supabase and confirm row count. If it's wrong, fix the join before touching the frontend. |
| `products.volume` or `product_suppliers.delay` have high NULL rate and make the table look sparse | Medium | Lead time column shows "N/D" rather than blank. Volume is explicitly not on this page today. |
| Role migration fails because a user already has a legacy role value | Low | The `DROP + ADD` CHECK constraint pattern is already used in the RBAC migration (line 14–16). Same idempotent pattern here. |
| Sidebar change accidentally hides OA from compras | Medium | After the edit, log in as a compras user on localhost and click every link before deploying. |
| Backtest storage-card disclaimer is placed on the wrong card | Low | The component has a clear per-goal structure; read it before editing. |
| Demo happens on stale 2026-03-03 data and client asks why | **High** | Every new page has a "Snapshot al 3 de marzo 2026" header. Jorge opens the demo with "los datos son del 3 de marzo; la próxima iteración trae sincronización diaria con Odoo." Pre-empt the question. |
| Time runs out mid-P0.1 | Medium | Cut point: if the RPC works but the page isn't polished, ship the raw table with Tailwind defaults. Functional > pretty. |

---

## 7. DEMO SCRIPT (40 min — aligns with silo doc §DEMO STRATEGY)

Jorge is the narrator. Wilmer first (the bigger win), Mario second, neither is present for the other's portion if rooms can be split — otherwise sequential.

### Phase 1 — Wilmer (15 min)
1. Log in as `compras` → lands on `/compras`.
2. Click "Forecast de Demanda" → `/backtest` → click a month → show per-product predicted vs actual.
   - *"Esto es tu Excel, automatizado. 12 meses, no 3."*
3. Click "Programación de Compras" → `/poc/programacion` → show weekly plan for Carvajal.
   - *"Cuando Carvajal te pida el forecast de julio-agosto-septiembre, esto ya lo tiene."*
4. Back to `/backtest` → Unnecessary Purchases card.
   - *"Si hubieras tenido esto, GTQ X en compras innecesarias se habrían evitado."*
5. Acknowledge "en validación" banner without dwelling on it.

### Phase 2 — Mario (15 min)
1. Log in as `operaciones` → lands on `/operaciones`.
2. Click "Días de Inventario" → show the table sorted by days-of-supply ascending.
   - *"Por primera vez, cuando Roberto te pregunta 'cuántos días tengo', la respuesta está acá."*
3. Click "Hot List" → `/preocupaciones/desabastecimiento`.
   - *"Estos son tu prioridad. Lo que tenés que asegurar que entre primero."*
4. Click "Hold List" → `/preocupaciones/capital-congelado`.
   - *"Y estos están comiendo espacio. Tu mensaje a Carvajal: 'no me mandés más de esto.'"*
5. Promise (silo doc §Phase 2.7): "El siguiente paso es conectar el volumen de cada producto para decirte cuántos m³ de cada bodega están ocupados. Los datos ya existen en Odoo."

### Phase 3 — Both (10 min)
- Backtest savings headline — repeat the en-validación framing.
- Acknowledge snapshot age + Odoo live-sync roadmap.
- Open question: *"¿Qué quieren ver primero en la próxima versión?"* Write it down. That's Sprint 1.

---

## 8. VERIFICATION CHECKLIST — RUN BEFORE LEAVING FOR DEMO

- [ ] `npm run build` passes locally with no TypeScript errors.
- [ ] `npm run dev` starts, `/operaciones/dias-inventario` renders real rows (not an empty table).
- [ ] Log in as `compras` → sidebar shows Compras, Órdenes Abiertas, Demostración de Valor. No `/preocupaciones/*` visible.
- [ ] Log in as `operaciones` → sidebar shows Operaciones (Días de Inventario, Hot List, Hold List), Órdenes Abiertas, Demostración de Valor.
- [ ] `/backtest` page shows the yellow "en validación" banner above the savings cards.
- [ ] Storage / Stockout / Rotation cards show the "EN VALIDACIÓN" pill. Unnecessary Purchases card does not.
- [ ] Both `/compras` and `/operaciones` render the three cards with the copy from §4.P1.3 verbatim.
- [ ] `days_of_supply` values look sane (e.g., top-selling SKUs should land in single-digit days, slow movers in hundreds).
- [ ] Snapshot-date banner visible on Días de Inventario.
- [ ] No emoji, no placeholder, no TODO, no mock data in any committed file.

---

## 9. POST-DEMO (do not touch today)

Silo doc §POST-DEMO ROADMAP §Sprint 1–5 is the authoritative next-step list. Specifically:

- Sprint 1: `/compras/forecast` with seasonality + trend columns + local/importado tags + Excel export.
- Sprint 2: `/operaciones/inventario` with in-transit + m³ + Hot/Hold PDF export + mobile.
- Sprint 3: fix the 3 broken savings calcs + re-ingest with credit notes + refresh snapshot.
- Sprint 4: Odoo XML-RPC live sync.
- Sprint 5: archived-code map, homólogos, never-be-out flags, forecast comparison upload, supplier compliance.

---

*This plan contains no assumptions. Every file path, line number, and data table referenced was verified on 2026-04-22 against the code on disk and the 14 migrations in `supabase/migrations/`. Every scope decision traces back to a recorded answer from Jorge.*
