# SSOT Validation & Old Code Cleanup

**Date:** 2026-03-23
**Commits:** 762a120 and predecessors
**Scope:** Data integrity validation against Odoo production dashboard, demand aggregation fix, old code removal

---

## Why This Change Was Necessary

### Problem 1: User-facing numbers did not match Odoo

The `demand_daily` table — the foundation for ALL user-facing calculations (backtest savings, ABC/XYZ classification, stockout risk, slow-moving detection, inventory rotation) — was built using the wrong query logic:

| Field | What we used (WRONG) | What Odoo uses (CORRECT) |
|-------|---------------------|-------------------------|
| **Date** | `order_date` (when order was placed) | `effective_date` (when delivery was confirmed) |
| **Quantity** | `quantity` (ordered amount) | `delivered_qty` (actually delivered amount) |
| **Revenue** | `subtotal` on all confirmed lines | `subtotal` only on lines with `delivered_qty > 0` |

This caused our January 2026 numbers to be **+39% on quantity** and **+11% on revenue** vs the Odoo SSOT dashboard (frozen 2026-03-03 22:51:11). The client would have immediately noticed these discrepancies in a live meeting — exactly the scenario described in `_deep_refactor_rationale.md` ("I was not able to do a backtest from the user UI during the decision meeting").

### Problem 2: ~1,100 files of dead code

The old airefill codebase (Fastify backend, Dagster pipeline, old frontend services/stores/components) was still in the repo. This caused:
- CI failures from orphaned imports
- Confusion about which code is active
- 22MB+ of unnecessary code in every clone/deploy
- Security risk: old code contained hardcoded Stripe test keys (caught by GitHub push protection)

---

## What Changed

### 1. SSOT Validation (new file: `SSOT_VALIDATION.md`)

Created a comprehensive validation document comparing our database against the Odoo production dashboard. Three revenue calculation methods were tested:

| Method | Revenue | Diff vs Odoo Q25,086,052 |
|--------|---------|--------------------------|
| A: Stored subtotal (selected) | Q24,104,138 | **-3.91%** |
| B: Proportional subtotal | Q23,747,039 | -5.34% |
| C: Computed from delivered | Q26,594,834 | +6.02% |

**Method A was selected** as the closest match achievable with our CSV export data.

**Final validation results:**

| Metric | Our DB | Odoo SSOT | Difference | Pass? |
|--------|--------|-----------|------------|-------|
| Quantity | 249,236 | 244,752 | +1.83% | PASS (±5%) |
| Revenue | Q24,104,138 | Q25,086,052 | -3.91% | PASS (±5%) |
| Inventory | 250,715 | 252,401 | -0.67% | PASS (±1%) |
| Product ranking | Exact match | — | — | PASS |

### 2. Demand Aggregation Fix (new migration: `20260323000001_fix_demand_ssot.sql`)

**Dropped and recreated** `aggregate_demand_daily()` function with corrected logic:

**Before (wrong):**
```sql
-- Used order_date → attributed demand to wrong month
-- Used sol.quantity → included undelivered ordered amounts
-- Included lines with zero deliveries
SELECT sol.product_id, DATE(so.order_date), SUM(sol.quantity), SUM(sol.subtotal)
FROM sale_order_lines sol JOIN sale_orders so ON so.id = sol.order_id
WHERE so.state IN ('sale', 'done')
```

**After (correct, matches Odoo SSOT):**
```sql
-- Uses effective_date → demand attributed to delivery month
-- Uses delivered_qty → only actually-delivered quantities
-- Filters delivered_qty > 0 → excludes undelivered lines
SELECT sol.product_id, DATE(so.effective_date), SUM(sol.delivered_qty), COALESCE(SUM(sol.subtotal), 0)
FROM sale_order_lines sol JOIN sale_orders so ON so.id = sol.order_id
WHERE so.state IN ('sale', 'done')
  AND sol.delivered_qty > 0
  AND so.effective_date IS NOT NULL
```

**Census Filter preserved:** Censored days (inventory ≤ 0 AND no deliveries) are still correctly identified and marked as `is_censored = true`.

**Cascading effect:** All 8 downstream RPC functions that read from `demand_daily` are automatically corrected:
- `get_product_revenue_ranking()` — backtest product selection
- `get_avg_inventory_value()` — storage cost savings
- `get_purchase_analysis()` — unnecessary purchase savings
- `get_stockout_analysis()` — lost sales savings
- `get_rotation_metrics()` — inventory turnover savings
- `rpc_stockout_risks()` — stockout risk KPI page
- `rpc_abc_xyz_classification()` — ABC/XYZ classification page
- `rpc_slow_moving_items()` — slow-moving/dead stock page

**Demand aggregation re-run results:**
- 1,083 products processed (was 1,193 — 110 products had orders but no deliveries)
- 145,286 daily demand records (was 163,839 — fewer records because effective_date is null for some orders)
- 43,746 censored days (30% — stockout periods correctly identified)

### 3. Old Code Deletion (188 files removed)

**Deleted directories:**

| Directory | Contents | Reason |
|-----------|----------|--------|
| `api-node/` | Fastify monolith, Prisma ORM, 9 route modules, BI handlers, export generators | Replaced by Next.js API routes + Supabase RPC functions |
| `airefill_dagster/` | Dagster orchestration, Prophet pipelines, SageMaker integration | Replaced by Railway Python service (`ml/`) |
| `frontend/src/services/` | 9 API service files (384K total): adminService, comprasService, finanzasService, gerenciaService, inventarioService, superuserService, ventasService, auth, api-client | Replaced by direct Supabase client calls |
| `frontend/src/stores/` | Zustand auth store (7.6K) with JWT token management, permission arrays, role checks | Replaced by Supabase Auth session management |
| `frontend/src/components/admin/` | 7 modal components for user/role/permission management | Old RBAC system removed; Supabase Auth handles users |
| `frontend/src/components/superuser/` | 4 modal components for tenant/datasource/job management | Superuser features deferred to air_prime |
| `frontend/src/components/charts/` | 4 Recharts wrapper components (area, bar, line, tooltip) | Not imported by any active page |
| `frontend/src/components/dashboard/` | 4 components (layout, data-table, kpi-card, metabase-embed) | Not imported by any active page; new pages use inline components |
| `docs/` | 16 files: AWS architecture docs, disaster recovery runbooks, strategic audits | All reference old CDK infrastructure that no longer exists |
| `sql/` | Empty directory | No content |

**Deleted individual files:**

| File | Reason |
|------|--------|
| `frontend/src/hooks/use-auth.ts` | Old JWT auth hook; replaced by Supabase Auth |
| `frontend/src/stores/auth-store.ts` | Old Zustand JWT store; replaced by Supabase Auth |
| `frontend/src/types/api.ts` | Types for old Fastify API responses |
| `frontend/src/types/auth.ts` | Types for old JWT auth system |
| `frontend/src/types/navegacion-temporal.ts` | Types for old temporal navigation feature |
| `frontend/src/types/react-plotly.d.ts` | Type defs for Plotly (removed from package.json) |
| `frontend/src/components/AtRiskShipmentsModal.tsx` | Old procurement feature; not imported |
| `frontend/src/components/ExportModal.tsx` | Old export feature; deferred to air_prime |
| `frontend/src/components/ForecastDecompositionChart.tsx` | Old analytics chart; not imported |
| `frontend/src/components/SalesForecastChart.tsx` | Old analytics chart; not imported |
| `frontend/src/components/SupplierScorecardModal.tsx` | Old procurement feature; deferred to air_prime |
| `frontend/src/components/TimeNavigationComponent.tsx` | Old temporal navigation; not imported |
| `frontend/src/app/(authenticated)/superuser/page.tsx` | Old superuser page; imported deleted services |
| `frontend/src/app/(authenticated)/admin/usuarios/page.tsx` | Old user management page; imported deleted services |

**Deleted old changelogs from original airefill:** No — kept all changelogs including the two from 2026-03-05 as historical record.

### 4. FearsSidebar Fix

**Before:** Imported `useAuthStore` from the deleted `@/stores/auth-store`, checked old RBAC permissions (`user:read`, `SUPERUSER`), and rendered nav links to deleted pages (`/admin/usuarios`, `/superuser`).

**After:** Removed auth store dependency entirely. Navigation is now static — all authenticated users see the same sidebar:
- Demostración de Valor → `/backtest`
- Mis Preocupaciones (4 fear pages)
- ~~Productos~~ (deferred)
- ~~Configuración~~ (deferred)

Role-based nav will be re-added when Supabase Auth roles (admin/viewer) are implemented in air_prime.

---

## What Was NOT Changed

- `frontend/src/components/ui/` — Radix + Tailwind design system primitives (actively used)
- `frontend/src/components/backtest/` — 3 backtest components (actively used)
- `frontend/src/components/layout/` — AppShell, FearsSidebar (fixed), UserMenu (actively used)
- `frontend/src/lib/` — Supabase clients, utils (actively used)
- `ml/` — Railway Python service (actively deployed)
- `supabase/` — All migrations (actively applied)
- `scripts/` — Ingestion pipeline (already executed)
- `real_data/` — Production CSV data (gitignored, not in repo)
- `changelogs/` — All entries preserved

---

## Build Verification

After all deletions, `npm run build` passes clean with zero errors. The only remaining warnings are from `next.config.mjs` ESLint ignore (documented, intentional until Phase 7 cleanup).

---

## Impact on Running Services

- **Vercel (frontend):** Auto-deploys from push. Sidebar now renders without old auth store import. All pages functional.
- **Railway (ML service):** Unaffected — `ml/` directory was not modified.
- **Supabase (database):** `demand_daily` table was rebuilt with corrected logic. All RPC functions return SSOT-aligned numbers.

---

*No mock data. No assumptions. All changes validated against Odoo production dashboard.*
