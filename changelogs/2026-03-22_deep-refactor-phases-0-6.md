# Deep Refactor — Phases 0–6 Complete

**Date:** 2026-03-22
**Scope:** Full architecture migration from airefill → AI Refill Lite
**Source:** `_DEEP_REFACTOR_PLAN.md`, `_deep_refactor_rationale.md`, `_THE_RULES.MD`

---

## What Changed

### Architecture Migration

| Before | After |
|--------|-------|
| Fastify monolith on ECS Fargate | Next.js API Routes on Vercel |
| Aurora PostgreSQL + Prisma ORM | Supabase PostgreSQL + direct SQL/RPC |
| Dagster + Prophet + SageMaker | Python Flask service on Railway (Prophet) |
| ElastiCache Redis | Next.js ISR + Supabase connection pooling |
| 8-layer AWS CDK infrastructure | Vercel + Supabase + Railway (3 services) |
| Custom JWT + 7-role RBAC | Supabase Auth + 2 roles (admin, viewer) |
| Department-oriented UI (7 dashboards) | Fear-oriented UI + backtest landing page |

### Phase 0: Infrastructure Foundation

**Deleted:**
- `infra_cdk/` — entire directory (8-layer AWS CDK stack)

**Created:**
- `supabase/config.toml` — Supabase local dev config
- `.env.example` — root-level environment template (Supabase + Railway vars)
- `frontend/.env.example` — frontend environment template (updated for Supabase)
- `ml/` — entire directory structure for Railway Python service
  - `ml/Dockerfile` — Railway container (Python 3.11, gunicorn, 600s timeout)
  - `ml/requirements.txt` — prophet, pandas, numpy, supabase-py, flask, gunicorn, openpyxl
  - `ml/requirements-dev.txt` — pytest, ruff

**Modified:**
- `frontend/next.config.mjs` — removed `output: 'standalone'` and AWS API rewrites
- `.github/workflows/ci.yml` — removed CDK, ECR scan, Dagster jobs; added ML lint+test job; updated frontend env vars for Supabase
- `frontend/package.json` — renamed to `air-lite-frontend`, added `@supabase/supabase-js` + `@supabase/ssr`, removed `axios`, `plotly.js-dist-min`, `react-plotly.js`, all Storybook dependencies, Plotly type defs

**Created (Supabase client utilities):**
- `frontend/src/lib/supabase/client.ts` — browser-side Supabase client
- `frontend/src/lib/supabase/server.ts` — server-side client + service role client

### Phase 1: Database Schema (24 tables)

**Created:**
- `supabase/migrations/001_initial_schema.sql`

**Tables by domain:**

| Domain | Tables |
|--------|--------|
| App & Auth | `tenants`, `user_profiles`, `app_settings`, `audit_log` |
| Core Business | `units_of_measure`, `products`, `customers`, `suppliers`, `product_suppliers`, `warehouses`, `stock_locations` |
| Transactions | `sale_orders`, `sale_order_lines`, `purchase_orders`, `purchase_order_lines`, `stock_moves`, `stock_quants`, `exchange_rates` |
| Computed/Derived | `inventory_daily`, `demand_daily` |
| Backtest | `backtest_runs`, `backtest_results`, `backtest_savings` |

**Design decisions:**
- Every business table has `tenant_id UUID NULL` for future multi-tenancy
- Odoo IDs preserved as `odoo_id` columns for traceability
- RLS enabled on all business tables; permissive policy for service role active now
- Default `app_settings` rows inserted: holding cost rate (25%), backtest config, service level Z-score (1.65)
- `inventory_daily` is THE critical table for backtest — reconstructed from stock_moves
- `demand_daily` includes `is_censored` boolean for Census Filter

### Phase 2: Data Ingestion Pipeline

**Created:**
- `scripts/convert_xlsx.py` — converts `account.move.line_2026.xlsx` to CSV using openpyxl
- `scripts/ingest.py` — full CSV ingestion pipeline (~800 lines)
  - Handles hierarchical CSV format (sale.order.line, purchase.order.line — ID only on first row, carry-forward)
  - Extracts SKU from bracket notation: `[77201063] TAPA P/ENV...`
  - Maps Spanish Odoo states to normalized English: `Orden de venta` → `sale`, `Cancelado` → `cancel`
  - Maps Spanish location types: `Ubicación interna` → `internal`
  - Loads in dependency order across 12 entity types
  - Batch inserts (500 records) with per-record fallback on error
  - Builds in-memory lookup maps for foreign key resolution (name→id, sku→id, odoo_id→id)

- `supabase/migrations/002_reconstruction_functions.sql`
  - `reconstruct_inventory_daily()` — works backwards from stock.quant snapshot (2026-03-03) through ~967K stock_moves to reconstruct daily inventory levels back to 2024-10-01
  - `aggregate_demand_daily()` — aggregates sale_order_lines into daily demand per product, applies Census Filter (marks days as censored where inventory ≤ 0 AND sales = 0)
  - `validate_reconstruction()` — cross-checks reconstructed values against stock.quant snapshot, returns discrepancies

### Phase 3: Backtest Engine

**Created:**
- `ml/backtest_engine.py` — core engine
  - `run_backtest_cycle()`: trains on months 1..N, predicts month N+1, compares to actuals, calculates savings
  - `train_and_predict_product()`: Prophet per-product with censored-day exclusion
  - `get_prophet_config()`: adapts to data availability (yearly_seasonality only when ≥ 12 months)
  - Clamps negative predictions to zero
  - Stores per-product results + aggregate savings in Supabase
  - Async execution via background thread (Railway has no timeout)

- `ml/product_selector.py` — selects top 100 products by revenue with ≥ 30 non-censored observations; reports coverage metrics and exclusion reasons in Spanish

- `ml/census_filter.py` — core IP extracted from old `airefill_dagster/airefill/pipelines.py` (lines 104-129); marks stockout periods as censored observations so Prophet interpolates rather than training on suppressed zeros

- `ml/api.py` — Flask HTTP API for Railway
  - `POST /backtest/run` — triggers async backtest, returns run_id immediately
  - `GET /backtest/status/<run_id>` — polls for completion, returns savings when done
  - `GET /health` — health check
  - API key auth via `X-API-Key` header

### Phase 4: Savings Calculation Engine

**Created (all in `ml/savings/`):**

| File | Goal | Method |
|------|------|--------|
| `storage_cost.py` | Reduced storage costs | actual_holding_cost vs optimized (cycle_stock/2 + safety_stock) × monthly_rate |
| `unnecessary_purchases.py` | Reduced unnecessary purchases | actual PO values vs needed (predicted_demand − inventory + safety_stock), respects MOQ |
| `lost_sales.py` | Reduced lost sales from stockouts | estimates lost demand from nearby non-stockout days × margin; 80% prevention rate |
| `inventory_rotation.py` | Increased inventory rotation | (COGS / avg_inventory) × 12, same COGS with lower optimized inventory |
| `summary_generator.py` | Spanish headline | "Si hubiera contado con AI Refill durante {mes}, habría ahorrado GTQ {X}" with 4 bullet points |

**Holding cost rate:** defaults to 25% annual, surfaced to user with full transparency and recalculate input.

### Phase 5: Backend API (Next.js API Routes + Supabase RPC)

**Created (API routes in `frontend/src/app/api/`):**
- `backtest/run/route.ts` — POST, forwards to Railway ML service
- `backtest/runs/route.ts` — GET, lists completed backtest cycles
- `backtest/[runId]/route.ts` — GET, polls Railway for status
- `backtest/[runId]/savings/route.ts` — GET, returns savings breakdown from Supabase
- `kpis/stockout-risk/route.ts` — GET, calls `rpc_stockout_risks()`
- `kpis/abc-xyz/route.ts` — GET, calls `rpc_abc_xyz_classification()`
- `kpis/slow-moving/route.ts` — GET, calls `rpc_slow_moving_items()`
- `admin/data-status/route.ts` — GET, returns table row counts and date ranges

**Created (Supabase RPC functions in `supabase/migrations/003_rpc_functions.sql`):**
- `get_product_revenue_ranking()` — ranks products by revenue with observation counts
- `get_avg_inventory_value()` — average inventory + lead times + demand std for storage calc
- `get_purchase_analysis()` — actual purchases + inventory at start + MOQ for purchase calc
- `get_stockout_analysis()` — stockout days + avg non-stockout demand for lost sales calc
- `get_rotation_metrics()` — COGS + actual/optimized avg inventory for turnover calc
- `rpc_stockout_risks()` — products at risk with risk level (crítico/alto/medio/bajo)
- `rpc_abc_xyz_classification()` — ABC by revenue + XYZ by demand CV + statistical confidence indicator
- `rpc_slow_moving_items()` — dead/slow stock with days since last sale + classification

### Phase 6: Frontend Rebuild

**Deleted:**
- `frontend/src/app/dashboard/` — entire directory (7 department-oriented dashboards: admin, compras, finanzas, gerencia, inventario, superuser, ventas)

**Created (layout):**
- `frontend/src/components/layout/AppShell.tsx` — main layout with sidebar
- `frontend/src/components/layout/FearsSidebar.tsx` — fear-oriented navigation with icons and Spanish subtitles
- `frontend/src/components/layout/UserMenu.tsx` — logout via Supabase Auth
- `frontend/src/app/(authenticated)/layout.tsx` — route group wrapping AppShell around all authenticated pages

**Created (backtest — the landing experience):**
- `frontend/src/app/(authenticated)/backtest/page.tsx` — THE killer feature page
  - Auto-triggers first backtest (3 months → predict month 4) on page load
  - Headline: "Si hubiera contado con AI Refill, habría ahorrado GTQ X" on emerald gradient
  - 4 savings cards with expandable reasoning
  - "¿Predecir siguiente mes?" prominent CTA button
  - Timeline scrubber for completed cycles
  - Coverage metrics: "Modelando X de Y productos"
  - Polls Railway every 5s during execution
- `frontend/src/components/backtest/BacktestSavingsCard.tsx` — savings metric card with expandable calculation transparency
- `frontend/src/components/backtest/PredictNextButton.tsx` — prominent CTA with loading state
- `frontend/src/components/backtest/HoldingCostInput.tsx` — transparent holding cost rate with explanation and recalculate input

**Created (fear pages):**
- `frontend/src/app/(authenticated)/preocupaciones/desabastecimiento/page.tsx` — stockout risks table with KPI cards (critical/high counts) and risk level badges
- `frontend/src/app/(authenticated)/preocupaciones/costos-almacenamiento/page.tsx` — slow-moving/dead stock table with inventory value KPIs
- `frontend/src/app/(authenticated)/preocupaciones/capital-congelado/page.tsx` — ABC/XYZ classification grid with statistical confidence indicators
- `frontend/src/app/(authenticated)/preocupaciones/compras-innecesarias/page.tsx` — links to backtest for purchase analysis

**Modified:**
- `frontend/src/app/layout.tsx` — simplified, lang="es", removed Figtree font, updated metadata to Spanish
- `frontend/src/app/page.tsx` — redirects to `/backtest` (was `/login`)
- `frontend/src/app/login/page.tsx` — rebuilt for Supabase Auth (was custom JWT via useAuth hook)
- `frontend/src/middleware.ts` — rebuilt for Supabase session-based auth (was cookie-based access_token check)

**Navigation structure:**
```
DEMOSTRACIÓN DE VALOR → /backtest (landing)
MIS PREOCUPACIONES
  Desabastecimiento → /preocupaciones/desabastecimiento
  Costos de Almacenamiento → /preocupaciones/costos-almacenamiento
  Capital Congelado → /preocupaciones/capital-congelado
  Compras Innecesarias → /preocupaciones/compras-innecesarias
PRODUCTOS → /productos (pending)
CONFIGURACIÓN → /configuracion (pending)
```

---

## What Was NOT Changed (Intentionally Preserved)

- `real_data/` — all CSV/xlsx data files untouched
- `frontend/src/components/ui/` — Radix + Tailwind design system primitives kept
- `frontend/src/lib/utils.ts` — `cn()` utility kept
- `frontend/src/app/globals.css` — Tailwind globals kept
- `frontend/src/app/error.tsx`, `loading.tsx`, `not-found.tsx` — error boundary pages kept
- `airefill_dagster/` — old pipeline kept for reference (Census Filter logic extracted to `ml/census_filter.py`)
- `api-node/` — old Fastify backend kept for reference (SQL patterns extracted to Supabase RPC functions)

---

## Next Steps (Phase 7 + Manual Setup)

### Manual Setup Required (before anything runs)

1. **Create Supabase project** at supabase.com
   - Get project URL, anon key, and service role key
   - Run migrations: `001_initial_schema.sql`, `002_reconstruction_functions.sql`, `003_rpc_functions.sql`
   - Create a user in Supabase Auth dashboard for login

2. **Create Railway project** at railway.app
   - Deploy the `ml/` directory
   - Set environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ML_SERVICE_API_KEY`
   - Get the deployed URL

3. **Create Vercel project** at vercel.com
   - Connect the repo, set root directory to `frontend/`
   - Set environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ML_SERVICE_URL`, `ML_SERVICE_API_KEY`

4. **Point DNS** — `airefill.app` CNAME to Vercel

5. **Install dependencies** — `cd frontend && npm install`

### Data Loading

6. **Convert xlsx** — `cd scripts && python convert_xlsx.py`
7. **Run ingestion** — `python scripts/ingest.py --supabase-url <URL> --supabase-key <KEY>`
8. **Reconstruct inventory** — run in Supabase SQL editor: `SELECT * FROM reconstruct_inventory_daily();`
9. **Aggregate demand** — run in Supabase SQL editor: `SELECT * FROM aggregate_demand_daily();`
10. **Validate** — run in Supabase SQL editor: `SELECT * FROM validate_reconstruction();`

### Phase 7: Production Hardening (Pending)

- [ ] Error boundaries with Spanish messages
- [ ] Skeleton loading states on all data-dependent components
- [ ] Next.js ISR for fear pages (5-min revalidation)
- [ ] Supabase index optimization on `inventory_daily`, `demand_daily`, `stock_moves`
- [ ] Rate limiting via Vercel Edge Middleware
- [ ] Input validation on all API routes
- [ ] Unit tests for savings calculations
- [ ] Integration test for one backtest cycle
- [ ] E2E test with Playwright: load backtest → click predict → verify savings
- [ ] `scripts/validate-data.ts` — data integrity checks after import

### Remaining Frontend Pages (Pending)

- [ ] `/productos` — product list with current metrics
- [ ] `/productos/[id]` — single product deep dive (demand history, inventory history, forecast, ABC/XYZ)
- [ ] `/configuracion` — admin page (data status, import trigger, holding cost rate, user management)

### Old Code Cleanup (After Validation)

- [ ] Remove `api-node/` once all SQL patterns confirmed working in Supabase RPC
- [ ] Remove `airefill_dagster/` once Census Filter and inventory optimization logic confirmed in `ml/`
- [ ] Remove old frontend services (`frontend/src/services/`) — no longer needed with Supabase client
- [ ] Remove old frontend stores/hooks (`auth-store.ts`, `use-auth.ts`) — replaced by Supabase Auth
- [ ] Remove old frontend types that reference Fastify API (`types/api.ts`)
- [ ] Remove orphaned components that referenced old dashboards

---

*All user-facing text is in Latin American Spanish. No mock data. No sample data. Production-first.*
