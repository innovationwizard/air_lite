# AI Refill Lite — SUPERREADME

## Table of Contents

1. [What This App Is](#1-what-this-app-is)
2. [What This App Is NOT](#2-what-this-app-is-not)
3. [Architecture Overview](#3-architecture-overview)
4. [Tech Stack](#4-tech-stack)
5. [Repository Structure](#5-repository-structure)
6. [Database Schema](#6-database-schema)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [The Backtest Engine (Core ML)](#8-the-backtest-engine-core-ml)
9. [The Census Filter (Core IP)](#9-the-census-filter-core-ip)
10. [Savings Calculations (Contractual Goals)](#10-savings-calculations-contractual-goals)
11. [Frontend Application](#11-frontend-application)
12. [API Layer (Node.js / Fastify)](#12-api-layer-nodejs--fastify)
13. [Next.js API Routes (BFF)](#13-nextjs-api-routes-bff)
14. [Supabase RPC Functions](#14-supabase-rpc-functions)
15. [Data Flows](#15-data-flows)
16. [State Management](#16-state-management)
17. [UI Component System](#17-ui-component-system)
18. [Role-Based Dashboards](#18-role-based-dashboards)
19. [Fear-Based Navigation (Preocupaciones)](#19-fear-based-navigation-preocupaciones)
20. [External Integrations](#20-external-integrations)
21. [Environment Variables](#21-environment-variables)
22. [CI/CD Pipeline](#22-cicd-pipeline)
23. [Testing](#23-testing)
24. [Deployment Topology](#24-deployment-topology)
25. [Key Architectural Decisions](#25-key-architectural-decisions)

---

## 1. What This App Is

**AI Refill Lite** is an ML-driven inventory optimization and demand forecasting platform for a distribution/retail company operating in Guatemala (currency: GTQ). It answers one question for the business:

> "If you had been using AI Refill during month X, how much money would you have saved?"

It does this by running **backtests** — training a Prophet time-series model on historical sales data, predicting demand for a target month, and comparing what actually happened (real purchases, real stockouts, real storage costs) against what *would* have happened if the company had followed the ML recommendations.

The platform surfaces results through **four contractual savings goals**:

| # | Goal | Question It Answers |
|---|------|---------------------|
| 1 | Storage Cost Reduction | "How much less would you have spent holding inventory?" |
| 2 | Unnecessary Purchase Reduction | "How many GTQ of POs could you have avoided?" |
| 3 | Lost Sales Prevention | "How much revenue did you lose to stockouts that AI Refill would have prevented?" |
| 4 | Inventory Rotation Improvement | "How much faster would your inventory turn?" |

Beyond the backtest value demonstration, the app provides **live KPI dashboards** organized around business fears (stockout risk, frozen capital, slow-moving inventory) and **role-based views** for 7 departments (Purchasing, Sales, Inventory, Finance, Management, Admin, Superuser).

---

## 2. What This App Is NOT

- **Not a transactional ERP.** It does not create purchase orders, invoices, or stock movements. It reads data from Odoo exports and provides recommendations.
- **Not a real-time system.** Data is ingested via batch CSV pipelines, not live connectors. The freshest data depends on the last Odoo export.
- **Not multi-tenant (yet).** The `tenants` table exists but the system operates as a single-tenant deployment.
- **Not a general forecasting tool.** It is purpose-built for inventory/demand forecasting with the Census Filter, not generic time-series prediction.
- **Not a warehouse management system.** It does not manage bin locations, pick/pack/ship, or warehouse operations.
- **Not a customer-facing storefront.** There is no cart, checkout, or e-commerce functionality.
- **Does not do real-time inventory tracking.** Inventory levels are reconstructed daily from historical stock moves, not live-streamed.
- **Does not handle payments or accounting.** Financial KPIs are read-only analytics derived from Odoo accounting data.

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         BROWSER (User)                              │
│  Next.js 14 App Router + Zustand + Recharts + Shadcn/Radix UI      │
└───────────────┬─────────────────────────────────┬───────────────────┘
                │                                 │
                │ Supabase Auth (SSR cookies)      │ REST API calls
                │                                 │
┌───────────────▼─────────────┐   ┌───────────────▼───────────────────┐
│   SUPABASE (PostgreSQL)     │   │   NODE.JS API (Fastify on ECS)    │
│                             │   │                                   │
│  • 24 tables (RLS enabled)  │   │  • JWT auth (custom)              │
│  • 8 RPC functions          │   │  • RBAC middleware                 │
│  • Auth (email/password)    │   │  • Prisma ORM                     │
│  • Row-level security       │   │  • BI routes, export, admin       │
│                             │   │  • Aurora PostgreSQL (legacy)      │
└─────────────────────────────┘   └───────────────────────────────────┘
                │
                │ Supabase client (service role)
                │
┌───────────────▼─────────────┐
│   NEXT.JS API ROUTES (BFF)  │
│                             │
│  • /api/backtest/*          │
│  • /api/kpis/*              │
│  • /api/admin/*             │
│  • /api/export/*            │
│  Proxy to Railway + Supabase│
└───────────────┬─────────────┘
                │
                │ HTTP + X-API-Key
                │
┌───────────────▼─────────────┐
│   ML SERVICE (Railway)       │
│                             │
│  • Flask + Gunicorn          │
│  • Prophet forecasting       │
│  • Census Filter             │
│  • Savings calculations      │
│  • Background job execution  │
└─────────────────────────────┘
```

**Request flows:**
- **Auth** → Browser ↔ Supabase Auth (SSR cookies) + Zustand store + API JWT
- **Backtest** → Browser → Next.js API route → Railway ML service → Supabase (write results)
- **KPIs** → Browser → Next.js API route → Supabase RPC functions (direct SQL)
- **Department dashboards** → Browser → Fastify API → Aurora PostgreSQL (Prisma)
- **Export** → Browser → Next.js API route → Fastify API → file download

---

## 4. Tech Stack

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 14.2.18 | Full-stack React framework (App Router) |
| React | 18.3.1 | UI library |
| TypeScript | 5.4.5 | Type safety |
| Tailwind CSS | 3.4.4 | Utility-first styling |
| Shadcn/UI + Radix UI | various | Component primitives (dialog, dropdown, tabs, toast, etc.) |
| Zustand | 4.5.2 | Client state management |
| Recharts | 2.12.7 | Data visualization (area, bar, line charts) |
| Lucide React | 0.378.0 | Icon system |
| date-fns | 3.6.0 | Date manipulation |
| Supabase JS | 2.49.0 | Auth + database client |
| class-variance-authority | 0.7.0 | Component variant system |

### Backend API
| Technology | Version | Purpose |
|------------|---------|---------|
| Fastify | — | HTTP framework |
| Prisma | — | ORM for Aurora PostgreSQL |
| JOSE | — | JWT signing/verification |
| bcrypt | — | Password hashing |
| ioredis | — | Redis client (optional caching) |
| Zod | — | Request validation |
| ExcelJS / jsPDF | — | Report generation |
| Pino | — | Structured logging |
| AWS SDK | — | Secrets Manager integration |

### ML Service
| Technology | Version | Purpose |
|------------|---------|---------|
| Python | 3.11 | Runtime |
| Prophet | 1.1.6 | Time-series forecasting |
| Pandas + NumPy | — | Data manipulation |
| Flask + Gunicorn | — | HTTP API (2 workers, 600s timeout) |
| Supabase-py | — | Database reads/writes |

### Infrastructure
| Service | Purpose |
|---------|---------|
| Vercel | Frontend hosting (Next.js) |
| Supabase | PostgreSQL database + Auth + RPC functions |
| Railway | ML service hosting (Docker) |
| AWS ECS Fargate | Node.js API hosting |
| Aurora PostgreSQL | Legacy database (API) |
| ElastiCache Redis | Optional session/cache layer |
| AWS ALB | Load balancing for API |
| GitHub Actions | CI/CD |

---

## 5. Repository Structure

```
air_lite/
├── frontend/                    # Next.js 14 application
│   ├── src/
│   │   ├── app/                 # App Router (pages + API routes)
│   │   │   ├── (authenticated)/ # Protected route group
│   │   │   │   ├── backtest/    # Main backtest dashboard
│   │   │   │   ├── configuracion/
│   │   │   │   └── preocupaciones/  # Fear-based pages
│   │   │   │       ├── desabastecimiento/   # Stockout risk
│   │   │   │       ├── capital-congelado/    # Frozen capital
│   │   │   │       ├── costos-almacenamiento/ # Storage costs
│   │   │   │       └── compras-innecesarias/  # Unnecessary purchases
│   │   │   ├── api/             # Next.js API routes (BFF)
│   │   │   │   ├── backtest/    # ML service proxy
│   │   │   │   ├── kpis/        # Supabase RPC wrappers
│   │   │   │   ├── admin/       # Admin data endpoints
│   │   │   │   ├── auth/        # Auth proxy
│   │   │   │   └── export/      # Export proxy
│   │   │   ├── login/           # Public login page
│   │   │   └── maintenance/     # Maintenance page
│   │   ├── components/
│   │   │   ├── ui/              # Shadcn/Radix primitives
│   │   │   ├── layout/          # AppShell, FearsSidebar, UserMenu
│   │   │   ├── dashboard/       # KPI cards, data tables
│   │   │   ├── backtest/        # Savings cards, predict button
│   │   │   ├── charts/          # Recharts wrappers
│   │   │   ├── admin/           # User/role management modals
│   │   │   ├── superuser/       # Tenant/system modals
│   │   │   ├── fears/           # Fear-page components
│   │   │   └── shared/          # Cross-feature components
│   │   ├── services/            # API client + per-department services
│   │   ├── stores/              # Zustand (auth-store.ts)
│   │   ├── hooks/               # use-auth.ts
│   │   ├── lib/                 # utils, supabase clients, download, anonymize
│   │   └── types/               # TypeScript interfaces (api.ts, auth.ts)
│   ├── package.json
│   ├── next.config.mjs
│   ├── tailwind.config.ts
│   └── tsconfig.json
│
├── api-node/                    # Fastify backend API
│   ├── src/
│   │   ├── routes/              # Auth, admin, BI, department routes
│   │   ├── middleware/          # Auth, RBAC middleware
│   │   ├── utils/               # JWT, helpers
│   │   ├── db/                  # Prisma client
│   │   ├── config.ts            # Environment + AWS Secrets
│   │   └── index.ts             # Server entry point
│   ├── prisma/
│   │   └── schema.prisma        # 30+ table definitions
│   ├── Dockerfile
│   └── package.json
│
├── ml/                          # Python ML service
│   ├── api.py                   # Flask HTTP API
│   ├── backtest_engine.py       # Prophet training + prediction
│   ├── product_selector.py      # Revenue-ranked product selection
│   ├── census_filter.py         # Core IP: stockout-aware filtering
│   ├── savings/                 # 4 contractual savings calculators
│   │   ├── storage_cost.py
│   │   ├── unnecessary_purchases.py
│   │   ├── lost_sales.py
│   │   ├── inventory_rotation.py
│   │   └── summary_generator.py
│   ├── Dockerfile
│   └── requirements.txt
│
├── supabase/                    # Supabase configuration
│   ├── migrations/
│   │   ├── 20260322000001_initial_schema.sql       # 24 tables
│   │   ├── 20260322000002_reconstruction_functions.sql  # inventory rebuild
│   │   └── 20260322000003_rpc_functions.sql        # 8 RPC functions
│   └── config.toml
│
├── infra_cdk/                   # AWS CDK (12 stacks)
├── .github/workflows/ci.yml    # GitHub Actions CI
├── changelogs/                  # Detailed change documentation
├── docs/                        # Additional documentation
├── scripts/                     # Utility scripts
└── sql/                         # Standalone SQL scripts
```

---

## 6. Database Schema

### Supabase (Primary — 24 tables in 5 domains)

#### App & Auth (4 tables)
| Table | Purpose |
|-------|---------|
| `tenants` | Future multi-tenancy placeholder (single row) |
| `user_profiles` | Extends Supabase `auth.users` with display name, role, avatar |
| `app_settings` | System config: `holding_cost_rate` (25%), `backtest_max_products` (100), `service_level_z_score` (1.65) |
| `audit_log` | Activity tracking with actor, action, entity, details |

#### Core Business Data (7 tables)
| Table | Purpose |
|-------|---------|
| `units_of_measure` | UOM definitions with conversion factors |
| `products` | SKU, name, category, cost, list_price, shelf life, MOQ |
| `customers` | From Odoo `res.partner` (customer_rank > 0) |
| `suppliers` | Lead times, active flag |
| `product_suppliers` | Per-supplier pricing, lead time, min order qty |
| `warehouses` | Warehouse definitions |
| `stock_locations` | Internal/external locations within warehouses |

#### Transactions (7 tables)
| Table | Purpose | Scale |
|-------|---------|-------|
| `sale_orders` | Order headers (date, state, delivery) | — |
| `sale_order_lines` | Line items (qty, delivered, invoiced, price, discount) | — |
| `purchase_orders` | PO headers (date, confirmation, expected delivery) | — |
| `purchase_order_lines` | PO line items (qty, received, price) | — |
| `stock_moves` | **Source of truth for inventory** — every movement | ~967K rows |
| `stock_quants` | Point-in-time Odoo snapshot (for validation only) | — |
| `exchange_rates` | GTQ/USD daily rates | — |

#### Computed/Derived (2 tables)
| Table | Purpose |
|-------|---------|
| `inventory_daily` | Reconstructed daily inventory position per product/warehouse. Built by running `reconstruct_inventory_daily()` backwards from the `stock_quants` snapshot through all `stock_moves`. |
| `demand_daily` | Aggregated daily demand per product from `sale_order_lines`. The `is_censored` boolean marks days where inventory ≤ 0 AND sales = 0 (Census Filter). |

#### Backtest Engine (3 tables)
| Table | Purpose |
|-------|---------|
| `backtest_runs` | Cycle metadata: training window, prediction month, status, products modeled, duration |
| `backtest_results` | Per-product: predicted vs actual demand, error metrics, stockout days |
| `backtest_savings` | 4 savings goals with GTQ amounts, percentages, and Spanish-language reasoning |

### Aurora PostgreSQL (Legacy — via Prisma in api-node)

The Fastify API uses a separate PostgreSQL instance with 30+ tables managed by Prisma. Key additional tables not in Supabase:

- `users`, `roles`, `user_roles`, `permissions`, `role_permissions` — Full RBAC
- `api_keys` — API key management
- `clients` — With RFM metrics, lifetime value, churn risk
- `forecasts` — ML forecast results with confidence bounds
- `recommendations` — Purchase recommendations with confidence and reason
- `insights` — Typed business insights (JSON value)
- `dashboards`, `dashboard_permissions` — BI dashboard access control
- `pdf_jobs` — Async PDF generation queue
- `warehouse_locations` — Zone/aisle/rack/shelf/bin hierarchy

---

## 7. Authentication & Authorization

### Dual Auth System

The app uses **two authentication systems** that work in parallel:

#### 1. Supabase Auth (Frontend SSR)
- **Method:** Email + password via `supabase.auth.signInWithPassword()`
- **Session:** SSR cookies managed by `@supabase/ssr`
- **Middleware:** `src/middleware.ts` checks `supabase.auth.getUser()` on every request
- **Public routes:** `/login`, `/health`, `/api/*`, `/maintenance`
- **Redirect:** Unauthenticated → `/login`; authenticated at `/login` → `/backtest`

#### 2. Custom JWT (API)
- **Method:** Username + password via `POST /api/v1/auth/login`
- **Tokens:** Access token (15min) + Refresh token (7d), signed with JOSE
- **Storage:** Access token in `sessionStorage`, user object in `localStorage`
- **Transport:** httpOnly cookies (primary) + `Authorization: Bearer` header (fallback)
- **Payload:** `{ id, username, permissions[], roles[] }`

### Role-Based Access Control (RBAC)

**7 Roles:**

| Role | Access |
|------|--------|
| `SUPERUSER` | Everything — tenant management, system users, data sources, infrastructure |
| `Admin` | User/role management, business units, product categories, market segments, activity logs |
| `Compras` | Purchase orders, supplier scorecards, cost optimization |
| `Ventas` | Sales analytics, forecasts, RFM analysis, cross-sell opportunities |
| `Inventario` | Inventory levels, movements, cycle counts, reorder recommendations, warehouse map |
| `Finanzas` | Financial KPIs, accounting data, margin analysis |
| `Gerencia` | Executive dashboards, strategic reports, what-if scenarios |

**49 Granular Permissions** (e.g., `user:create`, `user:read`, `user:update`, `user:delete`, `role:create`, `product:read`, `recommendation:read`, `forecast:read`, `insight:read`, `kpi:read`, `dashboard:read`, `export:create`, etc.)

**Frontend enforcement:**
```typescript
// Hook-based permission checks
const canExport = useHasPermission('export:create');
const isAdmin = useIsAdmin();
const roles = useUserRoles(); // Set<RoleName>
```

---

## 8. The Backtest Engine (Core ML)

### What It Does

The backtest engine proves AI Refill's value by answering: *"What would have happened if you had used our predictions last month?"*

### Flow

```
1. User clicks "Run Backtest" on /backtest page
       │
2. POST /api/backtest/run
       │ (Next.js API route → Railway ML service)
       │
3. ML Service (background thread):
       │
   a. product_selector.py
       │  • Queries get_product_revenue_ranking() RPC
       │  • Selects top 100 products by revenue
       │  • Requires ≥ 30 non-censored observations
       │  • Reports coverage % and exclusion reasons
       │
   b. For each selected product:
       │  backtest_engine.py → train_and_predict_product()
       │  • Pulls demand_daily from Supabase
       │  • Applies Census Filter (drops censored rows)
       │  • Trains Prophet model on training window
       │  • Predicts daily demand for target month
       │  • Clamps negative predictions to 0
       │  • Compares predicted vs actual demand
       │
   c. savings/ calculators run on aggregate results
       │  • storage_cost.py
       │  • unnecessary_purchases.py
       │  • lost_sales.py
       │  • inventory_rotation.py
       │
   d. summary_generator.py produces Spanish headline
       │  "Si hubiera contado con AI Refill durante {mes},
       │   habría ahorrado GTQ {total}"
       │
   e. Results written to Supabase:
       │  • backtest_runs (status → completed)
       │  • backtest_results (per-product)
       │  • backtest_savings (4 goals + reasoning)
       │
4. Frontend polls GET /api/backtest/{runId} every 5s
       │
5. On completion, renders savings cards + timeline
```

### Auto-Run Behavior

On first visit to `/backtest`, if no previous runs exist, the system automatically triggers a backtest run. Subsequent visits show the timeline of completed runs.

---

## 9. The Census Filter (Core IP)

### The Problem

In demand forecasting, a **zero-sales day** can mean two different things:
1. **True zero demand** — nobody wanted the product.
2. **Suppressed demand** — people wanted it but it was out of stock (stockout).

Training a model on raw data treats both cases as "demand = 0", which biases predictions downward. This is called **demand censoring**.

### The Solution

The Census Filter identifies and marks censored observations:

```
A day is CENSORED when:
  inventory_on_hand ≤ 0  AND  sales_quantity = 0
```

These censored rows are:
1. **Flagged** in the `demand_daily` table (`is_censored = true`) during ETL
2. **Excluded** from Prophet training data in `backtest_engine.py`
3. **Handled by Prophet** — gaps in the time series cause Prophet to interpolate, naturally widening confidence intervals during uncertain periods

### Impact

Without the Census Filter, the model would:
- Underpredict demand for products that frequently stock out
- Recommend lower reorder quantities
- Create a self-reinforcing stockout cycle

With it, the model sees only genuine demand signals, producing more accurate forecasts.

---

## 10. Savings Calculations (Contractual Goals)

All calculations compare **what actually happened** (from real data) against **what would have happened** (using ML predictions + inventory optimization formulas).

### Goal 1: Storage Cost Reduction (`storage_cost.py`)

```
actual_cost     = avg_inventory_value × monthly_holding_rate
optimized_cost  = (cycle_stock/2 + safety_stock) × unit_cost × monthly_holding_rate
savings         = actual_cost - optimized_cost

Where:
  monthly_holding_rate = annual_rate / 12  (default annual = 25%)
  safety_stock = Z × σ_demand × √lead_time  (Z = 1.65 for 95% service level)
  cycle_stock  = predicted_monthly_demand (reorder once/month)
```

Calls Supabase RPC `get_avg_inventory_value()` for actual inventory data.

### Goal 2: Unnecessary Purchase Reduction (`unnecessary_purchases.py`)

```
needed_qty = max(predicted_demand - inventory_at_start + safety_stock, 0)
needed_qty = ceil(needed_qty / MOQ) × MOQ   # Round up to MOQ
savings    = (actual_purchased_value - needed_value)  [only when actual > needed]
```

Calls Supabase RPC `get_purchase_analysis()`.

### Goal 3: Lost Sales Prevention (`lost_sales.py`)

```
For each product with stockout_days > 0:
  lost_demand    = stockout_days × avg_daily_demand_non_stockout
  lost_revenue   = lost_demand × list_price
  lost_margin    = lost_demand × (list_price - cost)
  prevented      = lost_margin × 0.80   # 80% prevention assumption

savings = sum(prevented for all products)
```

Calls Supabase RPC `get_stockout_analysis()`.

### Goal 4: Inventory Rotation Improvement (`inventory_rotation.py`)

```
actual_turnover    = (COGS / actual_avg_inventory) × 12
optimized_turnover = (COGS / optimized_avg_inventory) × 12
improvement_pct    = (optimized - actual) / actual × 100

# Same COGS, lower optimized inventory → higher turnover
```

Calls Supabase RPC `get_rotation_metrics()`.

### Summary Output

All four goals are aggregated by `summary_generator.py` into a Spanish-language headline and four bullet points with GTQ amounts and percentages. Stored in `backtest_savings` table.

---

## 11. Frontend Application

### Routing (Next.js App Router)

| Route | Access | Purpose |
|-------|--------|---------|
| `/` | Public | Redirects to `/backtest` |
| `/login` | Public | Supabase email/password login |
| `/health` | Public | Health check |
| `/maintenance` | Public | Maintenance mode page |
| `/backtest` | Auth | Main value demonstration dashboard |
| `/configuracion/*` | Auth | System configuration |
| `/preocupaciones/desabastecimiento` | Auth | Stockout risk analysis |
| `/preocupaciones/capital-congelado` | Auth | Frozen capital (ABC/XYZ) |
| `/preocupaciones/costos-almacenamiento` | Auth | Slow-moving / dead stock |
| `/preocupaciones/compras-innecesarias` | Auth | Unnecessary purchase analysis |

### Page: `/backtest` (Main Dashboard)

The primary page. Shows:

1. **Headline savings banner** — Large green display: "GTQ X,XXX.XX" total savings
2. **Four expandable savings cards:**
   - Costos de Almacenamiento (Storage Costs)
   - Compras Innecesarias (Unnecessary Purchases)
   - Ventas Perdidas por Desabastecimiento (Lost Sales from Stockouts)
   - Rotación de Inventario (Inventory Rotation)
3. **Holding cost rate input** — Adjustable (default 25% annual)
4. **"Predict Next Month" button** — Triggers a new backtest cycle
5. **Timeline of completed runs** — Navigate between prediction months

### Page: Fear Pages (Preocupaciones)

Four standalone analysis pages, each powered by a Supabase RPC function:

| Page | RPC Function | Key Metrics |
|------|-------------|-------------|
| Desabastecimiento | `rpc_stockout_risks()` | Risk level (crítico/alto/medio/bajo), days of supply vs lead time |
| Capital Congelado | `rpc_abc_xyz_classification()` | ABC class (revenue), XYZ class (demand variability), confidence |
| Costos Almacenamiento | `rpc_slow_moving_items()` | Days since last sale, dead/slow classification, inventory value |
| Compras Innecesarias | — (from backtest) | Placeholder / derived from backtest analysis |

### Metadata & SEO

- **Title:** "AI Refill Lite — Optimización Inteligente de Inventarios"
- **Description:** "Sistema de predicción de demanda y optimización de inventarios impulsado por inteligencia artificial."
- **Locale:** `es_GT` (Spanish, Guatemala)
- **OG Image:** Dynamically generated (1200×630)
- **Rendering:** `force-dynamic` on all routes (no static prerendering)

---

## 12. API Layer (Node.js / Fastify)

### Base URL: `/api/v1/`

### Auth Routes (`/auth`)

| Method | Path | Purpose | Notes |
|--------|------|---------|-------|
| POST | `/login` | Authenticate | Rate limited: 10/15min. Returns JWT + refresh in httpOnly cookies |
| POST | `/logout` | Sign out | Clears cookies |
| POST | `/refresh` | Refresh token | Uses refresh token from cookie |
| GET | `/verify` | Verify session | Checks cookie or Authorization header |

### Department Routes

| Prefix | Department | Key Endpoints |
|--------|------------|---------------|
| `/compras` | Purchasing | Purchase orders, supplier performance, cost optimization |
| `/ventas` | Sales | Sales analytics, forecasts, customer segments |
| `/inventario` | Inventory | Levels, movements, cycle counts, warehouse map |
| `/finanzas` | Finance | Financial KPIs, margin analysis |
| `/gerencia` | Management | Executive metrics, strategic reports, what-if scenarios |
| `/admin` | Admin | User/role CRUD, activity logs, system metrics |
| `/superuser` | Superuser | Tenants, system users, data sources, infrastructure |

### BI Routes (`/bi`)

| Path | Purpose |
|------|---------|
| `/bi/dashboards` | At-a-glance dashboards |
| `/bi/drill-down/{metric}` | Detailed metric analysis |
| `/bi/deep-dive/{entity}` | Raw exportable data |
| `/bi/ai-explanation/{id}` | Explainable AI narratives |
| `/bi/feedback` | Human-in-the-loop feedback collection |
| `/bi/export` | Report generation (PDF/Excel/CSV) |
| `/bi/forecasts` | Demand forecasting data |
| `/bi/customers` | Customer analytics, RFM matrix, churn, CLV |
| `/bi/gerencia/strategic-reports` | Auto-generated strategic reports |
| `/bi/gerencia/what-if-analyses` | What-if scenario modeling |
| `/bi/gerencia/scenarios` | Predefined scenarios (RECESSION, SUPPLY_SHOCK, DEMAND_BOOM) |
| `/bi/compras/supplier-scorecard` | Supplier performance metrics |

### Key Middleware

- **`authenticate()`** — Verifies JWT from cookie or Authorization header, attaches `request.user`
- **`requirePermissions(...perms)`** — Enforces permission-based access
- **Rate limiting** — `@fastify/rate-limit` on auth endpoints

---

## 13. Next.js API Routes (BFF)

The frontend has its own API routes that act as a Backend-for-Frontend (BFF) layer:

### Backtest Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/backtest/run` | Proxy to Railway ML service. Forwards `training_months`, `max_products`, `holding_cost_rate` |
| GET | `/api/backtest/runs` | List completed backtest cycles from Supabase |
| GET | `/api/backtest/[runId]` | Poll Railway for run status |
| GET | `/api/backtest/[runId]/savings` | Fetch savings breakdown from Supabase `backtest_savings` |

### KPI Routes

| Method | Path | Supabase RPC Called |
|--------|------|---------------------|
| GET | `/api/kpis/stockout-risk` | `rpc_stockout_risks()` |
| GET | `/api/kpis/abc-xyz` | `rpc_abc_xyz_classification()` |
| GET | `/api/kpis/slow-moving` | `rpc_slow_moving_items()` |

### Other Routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | Returns `{status: 'ok', timestamp, service: 'ai-refill-frontend'}` |
| GET | `/api/admin/data-status` | Table row counts and date ranges (service role, bypasses RLS) |
| POST | `/api/export` | Proxy to Fastify export endpoint, forwards cookies |

---

## 14. Supabase RPC Functions

### Data Reconstruction (run once during ETL)

| Function | Purpose |
|----------|---------|
| `reconstruct_inventory_daily()` | Works backwards from `stock_quants` snapshot (2026-03-03) through ~967K `stock_moves` to rebuild daily inventory levels back to 2024-10-01. Populates `inventory_daily`. |
| `aggregate_demand_daily()` | Aggregates `sale_order_lines` into daily demand per product. Applies Census Filter: marks days as censored where inventory ≤ 0 AND sales = 0. Populates `demand_daily`. |
| `validate_reconstruction()` | Cross-checks reconstructed levels against `stock_quants` snapshot. Returns discrepancies for audit. |

### Backtest Support (called by ML service)

| Function | Parameters | Purpose |
|----------|------------|---------|
| `get_product_revenue_ranking()` | start_date, end_date, min_observations | Ranks products by total revenue with non-censored observation counts. Used by product selector. |
| `get_avg_inventory_value()` | product_ids[], start_date, end_date | Returns avg_qty, unit_cost, lead_time_days, demand_std per product. For storage cost calculation. |
| `get_purchase_analysis()` | product_ids[], start_date, end_date | Returns actual purchased qty/value, avg unit cost, inventory at start, MOQ. For unnecessary purchase calculation. |
| `get_stockout_analysis()` | product_ids[], start_date, end_date | Returns stockout_days, avg_daily_demand (non-stockout), list_price, cost. For lost sales calculation. |
| `get_rotation_metrics()` | run_id, start_date, end_date | Returns total COGS, actual vs optimized avg inventory value. For turnover calculation. |

### Live KPI (called by Next.js API routes)

| Function | Purpose |
|----------|---------|
| `rpc_stockout_risks()` | Products at risk with risk_level (crítico/alto/medio/bajo), current stock, avg daily demand, days of supply, lead time |
| `rpc_abc_xyz_classification()` | ABC class (revenue pareto), XYZ class (demand CV), observation days, statistical confidence |
| `rpc_slow_moving_items()` | Dead/slow stock identification with days since last sale, inventory value, classification |

---

## 15. Data Flows

### Flow 1: Data Ingestion (Batch)

```
Odoo ERP
  │
  ├─ Export CSV: products, sale_orders, sale_order_lines, purchase_orders,
  │              purchase_order_lines, stock_moves, stock_quants, customers,
  │              suppliers, exchange_rates
  │
  ▼
Python Ingest Script (~800 lines)
  │
  ├─ Parse CSVs
  ├─ Normalize UOMs
  ├─ Map Odoo IDs to Supabase IDs
  ├─ Upsert into 24 Supabase tables
  │
  ▼
Supabase PostgreSQL
  │
  ├─ Run reconstruct_inventory_daily()   → populates inventory_daily
  ├─ Run aggregate_demand_daily()         → populates demand_daily (with Census Filter)
  └─ Run validate_reconstruction()        → audit check
```

### Flow 2: Backtest Execution

```
User clicks "Run Backtest"
  │
  ▼
POST /api/backtest/run (Next.js)
  │
  ├─ Validates: training_months ≥ 3, max_products, holding_cost_rate
  │
  ▼
POST ${ML_SERVICE_URL}/backtest/run (Railway)
  │
  ├─ Authenticated via X-API-Key header
  ├─ Creates backtest_runs row (status: running)
  ├─ Launches background thread
  │     │
  │     ├─ product_selector.py → top 100 by revenue
  │     ├─ For each product:
  │     │   ├─ Pull demand_daily (non-censored only)
  │     │   ├─ Train Prophet
  │     │   ├─ Predict target month
  │     │   ├─ Compare predicted vs actual
  │     │   └─ Write to backtest_results
  │     ├─ Run 4 savings calculators
  │     ├─ Generate Spanish summary
  │     ├─ Write to backtest_savings
  │     └─ Update backtest_runs (status: completed)
  │
  ▼
Frontend polls GET /api/backtest/{runId} every 5s
  │
  ▼
On completion: render savings cards + timeline
```

### Flow 3: KPI Dashboard Load

```
User navigates to /preocupaciones/desabastecimiento
  │
  ▼
GET /api/kpis/stockout-risk (Next.js API route)
  │
  ├─ createServiceRoleClient() (bypasses RLS)
  ├─ supabase.rpc('rpc_stockout_risks')
  │
  ▼
SQL executes against inventory_daily + demand_daily + products
  │
  ▼
Returns: [{product, current_stock, avg_daily_demand, days_of_supply, lead_time, risk_level}, ...]
  │
  ▼
React renders table with color-coded risk levels
```

### Flow 4: Department Dashboard (via Fastify API)

```
User navigates to Sales dashboard
  │
  ▼
ventasService.getDashboardData(params) (frontend service)
  │
  ├─ apiClient.get('/api/v1/ventas/dashboard', params)
  ├─ Sends cookies + Authorization header
  │
  ▼
Fastify API
  │
  ├─ authenticate() middleware → verifies JWT
  ├─ requirePermissions('kpi:read') → checks RBAC
  ├─ Prisma query → Aurora PostgreSQL
  │
  ▼
Returns: {kpis, topProducts, topCustomers, salesTrend, ...}
  │
  ▼
React renders KPI cards + charts + data tables
```

### Flow 5: Export

```
User clicks Export button
  │
  ▼
ExportModal selects format (PDF/Excel/CSV) + date range
  │
  ▼
POST /api/export (Next.js API route)
  │
  ├─ Proxies to Fastify: POST /api/v1/bi/export
  ├─ Forwards cookies for auth
  │
  ▼
Fastify generates file (ExcelJS / jsPDF)
  │
  ▼
Binary response → downloadBlob() → browser save dialog
```

---

## 16. State Management

### Zustand Store: `auth-store.ts`

Single store managing authentication state:

```typescript
interface AuthStore {
  // State
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  // Actions
  login(username: string, password: string): Promise<void>;
  logout(): Promise<void>;
  refreshToken(): Promise<void>;
  checkAuth(): Promise<void>;
  setUser(user: AuthUser | null): void;
  setLoading(loading: boolean): void;
}
```

**Persistence strategy:**
- User object → `localStorage` (survives tab close)
- Access token → `sessionStorage` (cleared on tab close)
- Refresh token → httpOnly cookie (managed by API)

**Token refresh flow:**
1. `checkAuth()` runs on app mount
2. Checks `sessionStorage` for access token
3. Falls back to `localStorage` for user data (legacy migration)
4. Attempts `refreshToken()` if token expired
5. Calls `verifyToken()` to validate
6. On failure → redirects to `/login`

### Derived Hooks

```typescript
useHasPermission('export:create')      // → boolean
useHasRole('Admin')                     // → boolean
useHasAllPermissions(['user:read', 'user:update'])  // → boolean
useHasAnyPermission(['kpi:read', 'dashboard:read']) // → boolean
useIsAdmin()                            // → boolean
useUserPermissions()                    // → Set<PermissionName>
useUserRoles()                          // → Set<RoleName>
```

---

## 17. UI Component System

### Foundation: Shadcn/UI + Radix UI

All UI primitives are Shadcn/UI components built on Radix UI headless primitives:

| Component | Source | Usage |
|-----------|--------|-------|
| `Button` | `button.tsx` | 6 variants: default, destructive, outline, secondary, ghost, link |
| `Card` | `card.tsx` | Container with header, content, footer |
| `Dialog` | `dialog.tsx` | Modal dialogs (Radix) |
| `Input` | `input.tsx` | Text inputs |
| `Label` | `label.tsx` | Form labels |
| `Alert` | `alert.tsx` | Status messages |
| `Badge` | `badge.tsx` | Tags and status indicators |
| `Progress` | `progress.tsx` | Progress bars |
| `Separator` | `separator.tsx` | Visual dividers |
| `Skeleton` | `skeleton.tsx` | Loading placeholders |
| `Select` | Radix | Dropdown selections |
| `Tabs` | Radix | Tab navigation |
| `Toast` | Radix | Notification toasts |
| `DropdownMenu` | Radix | Context menus |

### Charts: Recharts

Three chart wrapper components in `src/components/charts/`:

| Component | Type | Features |
|-----------|------|----------|
| `AreaChart` | Area | Gradient fills, responsive |
| `BarChart` | Bar | Grouped/stacked |
| `LineChart` | Line | Multi-series |
| `CustomTooltip` | Tooltip | Unified style with data availability indicator |

### Design System

| Token | Value |
|-------|-------|
| Primary color | `#00aa44` (green) |
| Accent | `#16A34A` (green-600) |
| Background | `#F8FAFC` (slate-50) |
| Foreground | `#0F172A` (slate-900) |
| Font (body) | Inter |
| Border radius | CSS variable based |
| Dark mode | Supported (class-based toggle) |

### Styling Stack

```
Tailwind CSS (utility classes)
  + tailwind-merge (dedup conflicting classes)
  + clsx (conditional classes)
  + class-variance-authority (component variants)
  + tailwindcss-animate (animations)
  = cn() utility function
```

---

## 18. Role-Based Dashboards

Each department role maps to a service layer that fetches role-specific data:

| Role | Service File | Key Features |
|------|-------------|--------------|
| Admin | `adminService.ts` | User CRUD, role management, business units, product categories, market segments, activity logs, system health, bulk actions |
| Compras | `comprasService.ts` | Purchase orders, supplier performance, pending orders, cost optimization |
| Ventas | `ventasService.ts` | Sales KPIs, top products/customers, forecasts (with confidence intervals), RFM analysis, cross-sell opportunities, compare mode |
| Inventario | `inventarioService.ts` | Inventory levels, movements, discrepancies, AI anomaly detection, reorder recommendations, stock optimization, cycle counts, warehouse map |
| Finanzas | `finanzasService.ts` | Financial KPIs, accounting analysis |
| Gerencia | `gerenciaService.ts` | Executive metrics, AI-generated strategic reports, what-if analysis (demand/price/lead time/cost changes), predefined scenarios (RECESSION, SUPPLY_SHOCK, DEMAND_BOOM), PDF/PPTX export |
| Superuser | `superuserService.ts` | Tenant management (subscriptions, storage, API quotas), system users, data source config (postgres, mysql, mongodb, S3, API, SFTP), infrastructure metrics (CPU, memory, disk, network) |

### Navigation Structure

The authenticated layout (`AppShell.tsx`) renders:
- **Left sidebar** (`FearsSidebar.tsx`) — Fear-based navigation
- **Top bar** — App title + `UserMenu.tsx` with logout
- **Content area** — Role-filtered page content

Navigation items are filtered by the user's roles and permissions.

---

## 19. Fear-Based Navigation (Preocupaciones)

A distinctive UX decision: instead of organizing by department or data entity, the main navigation is organized around **business fears** (preocupaciones):

| Fear | Route | Question |
|------|-------|----------|
| Desabastecimiento | `/preocupaciones/desabastecimiento` | "Am I going to run out of stock?" |
| Capital Congelado | `/preocupaciones/capital-congelado` | "Is my money stuck in slow inventory?" |
| Costos de Almacenamiento | `/preocupaciones/costos-almacenamiento` | "Am I paying too much to store things?" |
| Compras Innecesarias | `/preocupaciones/compras-innecesarias` | "Am I buying things I don't need?" |

Each page provides actionable KPIs and product-level tables that directly address the fear. This design makes the app accessible to non-technical users who think in terms of business problems, not data models.

---

## 20. External Integrations

| System | Integration Type | Purpose |
|--------|-----------------|---------|
| **Odoo ERP** | Batch CSV export → Python ingest | Source of truth for products, sales, purchases, stock moves, customers, suppliers, accounting |
| **Supabase** | SDK (JS + Python) | Database, auth, RPC functions, row-level security |
| **Railway** | HTTP API + Docker | ML service hosting (Prophet forecasting, backtest engine) |
| **AWS Secrets Manager** | SDK | Production secrets for API (DB credentials, JWT secrets) |
| **Vercel** | Platform | Frontend hosting with automatic deployments |
| **Metabase** | Embedded iframe | Optional BI dashboard embedding (`metabase-embed.tsx`) |

### Data Anonymization (Demo Mode)

When `NEXT_PUBLIC_DEMO_MODE=true`:
- `anonymizeData()` replaces product names with generic labels
- Used for external demos and presentations
- Controlled via environment variable

---

## 21. Environment Variables

### Frontend (`.env.local`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anonymous key (client-side) |
| `NEXT_PUBLIC_API_URL` | Yes | Backend API URL (e.g., `https://api.airefill.app`) |
| `NEXT_PUBLIC_DEMO_MODE` | No | Enable data anonymization (`true`/`false`) |
| `ML_SERVICE_URL` | Yes | Railway ML service URL (server-side only) |
| `ML_SERVICE_API_KEY` | Yes | Shared secret for ML service auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (server-side, bypasses RLS) |

### API (`api-node`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `NODE_ENV` | Yes | `development` or `production` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Server port (default: 8080) |
| `JWT_SECRET` | Yes | Access token signing key |
| `JWT_REFRESH_SECRET` | Yes | Refresh token signing key |
| `COOKIE_SECRET` | Yes | Cookie encryption key |
| `DB_SECRET_NAME` | Prod | AWS Secrets Manager secret name |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` | Alt | Individual DB connection params |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_AUTH_TOKEN`, `REDIS_TLS` | No | Optional Redis cache |
| `AWS_REGION` | Prod | AWS region (default: `us-east-2`) |

### ML Service

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Yes | Service role key |
| `API_KEY` | Yes | Shared secret (must match `ML_SERVICE_API_KEY`) |

---

## 22. CI/CD Pipeline

### GitHub Actions (`.github/workflows/ci.yml`)

**Triggers:** Pull requests and pushes to `main`

**Jobs:**

| Job | Runtime | Steps |
|-----|---------|-------|
| Frontend | Node 20 | Install → Lint → Build → Test |
| ML Service | Python 3.11 | Install → Lint (ruff) → Test (pytest) |

**Frontend build** uses placeholder Supabase URL to allow build without real credentials.

**Deployment:**
- Frontend auto-deploys to Vercel on merge to `main`
- API deploys to ECS Fargate via CDK (manual or CI trigger)
- ML service deploys to Railway via Docker push

---

## 23. Testing

### Frontend

| Tool | Purpose |
|------|---------|
| Jest | Test runner |
| React Testing Library | Component testing |
| jest-environment-jsdom | Browser environment simulation |

```bash
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

Test files live alongside components in `__tests__/` directories.

### API

| Tool | Purpose |
|------|---------|
| Jest + ts-jest | TypeScript test runner |

### ML Service

| Tool | Purpose |
|------|---------|
| pytest | Python test runner |
| ruff | Python linter |

---

## 24. Deployment Topology

```
                    ┌──────────────┐
                    │   USERS      │
                    │  (Browser)   │
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
      ┌───────▼──────┐    │    ┌───────▼──────┐
      │   Vercel      │    │    │  Supabase    │
      │   (Frontend)  │    │    │  (Auth)      │
      │   Next.js 14  │    │    │  PostgreSQL  │
      │   air-lite    │    │    │  RPC funcs   │
      └───────┬───────┘    │    └──────────────┘
              │            │
    ┌─────────┼────────────┘
    │         │
    │  ┌──────▼──────┐     ┌──────────────┐
    │  │  Railway     │     │  AWS ECS     │
    │  │  (ML Svc)    │     │  (Fastify)   │
    │  │  Flask+      │     │  Fargate     │
    │  │  Prophet     │     │              │
    │  └─────────────┘     └──────┬───────┘
    │                             │
    │                      ┌──────▼───────┐
    │                      │ Aurora PG    │
    │                      │ (Legacy DB)  │
    │                      └──────────────┘
    │
    │                      ┌──────────────┐
    └──────────────────────│ ElastiCache  │
                           │ Redis (opt)  │
                           └──────────────┘
```

**URLs:**
- Frontend: `https://www.airefill.app` (Vercel)
- API: `https://api.airefill.app` (ALB → ECS Fargate)
- ML Service: Railway internal URL
- Database: Supabase hosted PostgreSQL + Aurora PostgreSQL

---

## 25. Key Architectural Decisions

### 1. Dual Authentication
Supabase Auth handles frontend SSR sessions (cookies), while the Fastify API uses its own JWT system. This allows the frontend to work independently of the API for Supabase-direct queries (KPIs, backtest data) while still supporting the full RBAC system through the API.

### 2. BFF Pattern (Next.js API Routes)
The frontend doesn't call Railway or Supabase service-role endpoints directly from the browser. All sensitive calls go through Next.js API routes, which hold server-side secrets and act as a Backend-for-Frontend.

### 3. Census Filter as Core IP
Rather than using off-the-shelf demand forecasting, the system implements a custom Census Filter that correctly handles demand censoring during stockouts — a problem most inventory tools ignore. This is the primary technical differentiator.

### 4. Fear-Based UX
Navigation is organized by business fears, not data entities. This makes the product immediately understandable to non-technical stakeholders without training.

### 5. Backtest-First Value Demonstration
Instead of saying "trust our predictions," the system proves value retroactively: "Here's what you would have saved last month." This de-risks the sales process.

### 6. Force-Dynamic Rendering
All routes use `force-dynamic` to prevent Next.js static prerendering, which would fail without runtime environment variables (Supabase keys, API URLs).

### 7. Spanish-First Content
All user-facing content, error messages, savings explanations, and KPI labels are in Spanish. The codebase (variable names, comments) is in English.

### 8. Transparent Savings Formulas
Every savings number includes a detailed reasoning breakdown in Spanish, stored alongside the amounts. The user can understand exactly how each GTQ figure was calculated — no black boxes.

### 9. Supabase + Aurora (Dual Database)
The system runs two PostgreSQL databases: Supabase (for backtest, KPIs, and new features) and Aurora (for legacy API features). This is a transitional architecture from the monolith refactor, not a long-term design.

### 10. Async ML with Polling
Backtest runs execute asynchronously on Railway (background thread) because they can take minutes. The frontend polls every 5 seconds rather than using WebSockets, keeping the architecture simple.
