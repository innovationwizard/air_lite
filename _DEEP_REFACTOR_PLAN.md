# AI REFILL LITE — DEEP REFACTOR IMPLEMENTATION PLAN

**Date:** March 22, 2026
**Status:** Approved for execution
**Source documents:** `_deep_refactor_rationale.md`, `_deep_refactor_ref_doc_proposal.txt`, `_THE_RULES.MD`, `_odoo_market_research.md`

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [What Gets KEPT, REMOVED, REBUILT](#2-what-gets-kept-removed-rebuilt)
3. [Phase 0: Infrastructure — Vercel + Supabase + Railway](#3-phase-0-infrastructure)
4. [Phase 1: Database Schema Redesign](#4-phase-1-database-schema)
5. [Phase 2: Data Ingestion Pipeline](#5-phase-2-data-ingestion)
6. [Phase 3: Backtest Engine (Core ML)](#6-phase-3-backtest-engine)
7. [Phase 4: Savings Calculation Engine](#7-phase-4-savings-calculations)
8. [Phase 5: Backend API](#8-phase-5-backend-api)
9. [Phase 6: Frontend Rebuild](#9-phase-6-frontend-rebuild)
10. [Phase 7: Production Hardening](#10-phase-7-production-hardening)
11. [Feature Scoping: air_lite vs air_prime](#11-feature-scoping)
12. [Dependency Graph](#12-dependency-graph)

---

## 1. Architecture Overview

### Current Stack (to be replaced)
- Frontend: Next.js 14 on AWS AppRunner
- Backend: Fastify monolith on ECS Fargate
- Database: Aurora PostgreSQL Serverless v2 via Prisma ORM
- ML Pipeline: Dagster + Prophet + SageMaker
- Cache: ElastiCache Redis
- Infrastructure: 8-layer AWS CDK
- Auth: Custom JWT + 7-role RBAC

### Target Stack
- **Frontend:** Next.js 14 on Vercel (Server Components + Server Actions)
- **Backend:** Next.js API Routes on Vercel (replaces Fastify monolith)
- **Database:** Supabase PostgreSQL + direct SQL/RPC (replaces Prisma on Aurora)
- **ML Engine:** Python service on Railway (Prophet, pandas, numpy) — no execution time limits
- **Auth:** Supabase Auth + 2 roles (admin, viewer)
- **Cache:** Next.js ISR + Supabase connection pooling via Supavisor (replaces Redis)
- **File Storage:** Supabase Storage (replaces S3)
- **Infrastructure:** Vercel + Supabase + Railway (3 services, replaces 8-layer CDK)

### Why Railway for ML
Prophet model training on 3-6 months of daily data for the top 100+ qualifying products can take 1-10 minutes. Vercel's 300s serverless limit is too tight. Railway has no execution time limits, which is critical for the backtest engine.

---

## 2. What Gets KEPT, REMOVED, REBUILT

### KEPT (logic preserved, code refactored)

| Component | Current Location | Reason |
|-----------|-----------------|--------|
| Census Filter logic | `airefill_dagster/airefill/pipelines.py` lines 104-129 | Core IP: stockout-period detection prevents demand model bias. Rewrite as pure Python function. |
| Inventory optimization formulas | `airefill_dagster/airefill/inventory_optimization.py` | ROP, safety stock, EOQ calculations are sound. Extract and refactor. |
| SQL query patterns (sales metrics) | `api-node/src/routes/bi/queries/sales.queries.ts` | Sales trends, top products, category contribution. Translate to Supabase RPC. |
| SQL query patterns (inventory metrics) | `api-node/src/routes/bi/queries/inventory.queries.ts` | Stockout risk, days of supply, turnover. Adapt for new schema. |
| UI component primitives (Radix + Tailwind) | `frontend/src/components/ui/` | Keep the design system. |

### REMOVED (no longer needed)

| Component | Current Location | Reason |
|-----------|-----------------|--------|
| Entire AWS CDK infrastructure | `infra_cdk/` | Replaced by Vercel + Supabase + Railway |
| Fastify monolith | `api-node/` (entire directory) | Replaced by Next.js API Routes |
| Prisma ORM + schema | `api-node/prisma/` | Replaced by Supabase client + direct SQL |
| SageMaker integration | `airefill_dagster/airefill/ml_pipelines.py` | Replaced by Railway Python service |
| Dagster orchestration | `airefill_dagster/airefill/definitions.py`, `resources.py` | Replaced by on-demand invocation |
| Redis caching layer | `api-node/src/routes/bi/services/cache.service.ts` | Replaced by Next.js ISR + Supabase |
| 7-role RBAC system | `api-node/src/routes/auth.ts`, `admin.ts` | Replaced by Supabase Auth + 2 roles |
| Department-oriented dashboards | `frontend/src/app/dashboard/{compras,finanzas,gerencia,inventario,admin}/` | Replaced by fear-oriented navigation |
| PDF generation | `pdf_jobs`, export generators | Defer to air_prime |
| Cycle counts | `cycle_counts` model | Defer to air_prime |
| Warehouse locations (detailed) | `warehouse_locations` model | Defer to air_prime |
| SNS alerting | Pipeline SNS integration | Replaced by simpler notification |
| Customer segments (RFM) | `customer_segments` model | Defer to air_prime |
| Forecast scenarios | `forecast_scenarios` model | Replaced by `backtest_runs` |

### REBUILT (new implementation)

| Component | What's New |
|-----------|-----------|
| Database schema | 24-table Supabase schema, backtest-first, future air_prime extensibility |
| Backtest engine | Python on Railway: iterative train-predict-compare with savings calculations |
| Frontend | Fear-oriented navigation, backtest landing page, stripped-down KPI views |
| Data ingestion | CSV loader (+ xlsx conversion), historical inventory reconstruction |
| Auth | Supabase Auth with 2 roles (admin, viewer) |
| API layer | Next.js API Routes calling Supabase + Railway |

---

## 3. Phase 0: Infrastructure

**Goal:** Set up Vercel + Supabase + Railway, CI/CD, environment configuration, DNS.

### Deliverables
1. Supabase project created (us-east-1 or nearest to Guatemala)
2. Supabase Auth configured with email/password provider
3. Vercel project linked to `air_lite` repo
4. Railway project for Python ML service
5. Environment variables configured across all services
6. GitHub Actions CI updated
7. Domain `airefill.app` DNS pointed to Vercel

### Steps
- Create Supabase project
- Create Vercel project, connect to repo
- Create Railway project with Python runtime
- Update `frontend/next.config.mjs` — remove AWS-specific rewrites
- Update DNS: `airefill.app` CNAME to Vercel
- Remove `infra_cdk/` directory entirely
- Remove Docker configs, ECS task definitions
- Create `.env.example` with Supabase + Railway vars
- Create `supabase/` directory for migrations

### Files Affected
- DELETE: `infra_cdk/` (entire directory)
- MODIFY: `frontend/next.config.mjs`
- MODIFY: `.github/workflows/ci.yml`
- CREATE: `.env.example` (root-level, Supabase + Railway vars)
- CREATE: `supabase/config.toml`

**Depends on:** Nothing.

---

## 4. Phase 1: Database Schema

**Goal:** Clean PostgreSQL schema in Supabase optimized for: (a) backtest engine queries, (b) 4 savings calculations, (c) fear-oriented KPIs, (d) future air_prime extensibility.

### Design Principles
1. **Odoo IDs as first-class citizens** — every entity keeps `odoo_id` for traceability and future Odoo API sync
2. **Historical inventory reconstruction** — `stock_moves` is source of truth; `inventory_daily` is a materialized reconstruction
3. **Backtest-aware** — `backtest_runs`, `backtest_results`, `backtest_savings` store each cycle's outputs
4. **Multi-tenancy ready** — every business table has `tenant_id` (nullable for now, RLS policies prepared but not enforced)
5. **No soft deletes** — use `archived_at` timestamp (allows index filtering)

### Schema: 24 Tables

#### Core Business Data (from Odoo CSV import)

```sql
-- Products & Categories
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  sku VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100),
  subcategory VARCHAR(100),
  cost NUMERIC(15,4),
  list_price NUMERIC(15,4),
  stock_uom VARCHAR(50),
  stock_uom_ratio NUMERIC(10,4) DEFAULT 1.0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  archived_at TIMESTAMPTZ NULL
);
CREATE INDEX idx_products_category ON products(category);
CREATE INDEX idx_products_sku ON products(sku);

-- Customers
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  city VARCHAR(100),
  department VARCHAR(100),
  customer_rank INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Suppliers
CREATE TABLE suppliers (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  lead_time_days INT DEFAULT 30,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Product-Supplier relationships
CREATE TABLE product_suppliers (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id),
  supplier_id INT REFERENCES suppliers(id),
  supplier_price NUMERIC(15,4),
  lead_time_days INT DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'GTQ',
  min_order_qty NUMERIC(12,4) DEFAULT 1,
  UNIQUE(product_id, supplier_id)
);

-- Warehouses
CREATE TABLE warehouses (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  odoo_id VARCHAR(50) UNIQUE,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(20),
  is_active BOOLEAN DEFAULT true
);

-- Stock Locations (within warehouses)
CREATE TABLE stock_locations (
  id SERIAL PRIMARY KEY,
  odoo_id VARCHAR(50) UNIQUE,
  name VARCHAR(255) NOT NULL,
  warehouse_id INT REFERENCES warehouses(id),
  location_type VARCHAR(50),
  is_active BOOLEAN DEFAULT true
);

-- Units of Measure
CREATE TABLE units_of_measure (
  id SERIAL PRIMARY KEY,
  odoo_id INT UNIQUE,
  name VARCHAR(100) NOT NULL,
  category VARCHAR(50),
  ratio NUMERIC(10,4) DEFAULT 1.0
);
```

#### Transaction Data

```sql
-- Sales Orders (header)
CREATE TABLE sale_orders (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  order_ref VARCHAR(50) NOT NULL,
  customer_id INT REFERENCES customers(id),
  order_date TIMESTAMPTZ NOT NULL,
  delivery_date TIMESTAMPTZ,
  effective_date TIMESTAMPTZ,
  state VARCHAR(30) NOT NULL,
  warehouse_id INT REFERENCES warehouses(id),
  total NUMERIC(15,4),
  subtotal NUMERIC(15,4),
  salesperson VARCHAR(100),
  sales_team VARCHAR(100),
  pricelist VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sale_orders_date ON sale_orders(order_date);
CREATE INDEX idx_sale_orders_state ON sale_orders(state);
CREATE INDEX idx_sale_orders_customer ON sale_orders(customer_id);

-- Sales Order Lines
CREATE TABLE sale_order_lines (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES sale_orders(id),
  product_id INT REFERENCES products(id),
  quantity NUMERIC(12,4) NOT NULL,
  delivered_qty NUMERIC(12,4) DEFAULT 0,
  invoiced_qty NUMERIC(12,4) DEFAULT 0,
  uom VARCHAR(50),
  unit_price NUMERIC(15,4) NOT NULL,
  subtotal NUMERIC(15,4),
  discount_pct NUMERIC(5,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sol_product ON sale_order_lines(product_id);
CREATE INDEX idx_sol_order ON sale_order_lines(order_id);

-- Purchase Orders (header)
CREATE TABLE purchase_orders (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  odoo_id VARCHAR(50) UNIQUE NOT NULL,
  order_ref VARCHAR(50) NOT NULL,
  supplier_id INT REFERENCES suppliers(id),
  order_date TIMESTAMPTZ,
  confirmation_date TIMESTAMPTZ,
  expected_delivery TIMESTAMPTZ,
  state VARCHAR(30) NOT NULL,
  total NUMERIC(15,4),
  currency VARCHAR(10) DEFAULT 'GTQ',
  exchange_rate NUMERIC(15,12),
  buyer VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_po_date ON purchase_orders(order_date);
CREATE INDEX idx_po_state ON purchase_orders(state);
CREATE INDEX idx_po_supplier ON purchase_orders(supplier_id);

-- Purchase Order Lines
CREATE TABLE purchase_order_lines (
  id SERIAL PRIMARY KEY,
  order_id INT REFERENCES purchase_orders(id),
  product_id INT REFERENCES products(id),
  description TEXT,
  quantity NUMERIC(12,4) NOT NULL,
  received_qty NUMERIC(12,4) DEFAULT 0,
  uom VARCHAR(50),
  unit_price NUMERIC(15,4) NOT NULL,
  expected_delivery TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_pol_product ON purchase_order_lines(product_id);

-- Stock Moves (~967K rows — the basis for inventory reconstruction)
CREATE TABLE stock_moves (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  odoo_id VARCHAR(50) UNIQUE,
  product_id INT REFERENCES products(id),
  quantity NUMERIC(12,4) NOT NULL,
  uom VARCHAR(50),
  from_location_id INT REFERENCES stock_locations(id),
  to_location_id INT REFERENCES stock_locations(id),
  move_date TIMESTAMPTZ NOT NULL,
  state VARCHAR(20) NOT NULL,
  origin VARCHAR(255),
  picking_ref VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sm_date ON stock_moves(move_date);
CREATE INDEX idx_sm_product ON stock_moves(product_id);
CREATE INDEX idx_sm_product_date ON stock_moves(product_id, move_date);
CREATE INDEX idx_sm_state ON stock_moves(state);

-- Stock Quants (point-in-time snapshot, used for validation)
CREATE TABLE stock_quants (
  id SERIAL PRIMARY KEY,
  odoo_id VARCHAR(50) UNIQUE,
  product_id INT REFERENCES products(id),
  location_id INT REFERENCES stock_locations(id),
  quantity NUMERIC(12,4),
  reserved_qty NUMERIC(12,4) DEFAULT 0,
  entry_date TIMESTAMPTZ,
  uom VARCHAR(50),
  snapshot_date DATE NOT NULL
);

-- Exchange Rates
CREATE TABLE exchange_rates (
  id SERIAL PRIMARY KEY,
  currency_from VARCHAR(10) DEFAULT 'USD',
  currency_to VARCHAR(10) DEFAULT 'GTQ',
  rate NUMERIC(15,8),
  rate_date DATE NOT NULL,
  UNIQUE(currency_from, currency_to, rate_date)
);
```

#### Computed / Derived (built by data pipeline)

```sql
-- Daily Inventory Position (reconstructed from stock_moves)
-- THE critical table for backtest
CREATE TABLE inventory_daily (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id),
  warehouse_id INT REFERENCES warehouses(id),
  snapshot_date DATE NOT NULL,
  quantity_on_hand NUMERIC(12,4),
  quantity_incoming NUMERIC(12,4),
  quantity_outgoing NUMERIC(12,4),
  net_available NUMERIC(12,4),
  unit_cost NUMERIC(15,4),
  inventory_value NUMERIC(15,4),
  UNIQUE(product_id, warehouse_id, snapshot_date)
);
CREATE INDEX idx_invd_date ON inventory_daily(snapshot_date);
CREATE INDEX idx_invd_product_date ON inventory_daily(product_id, snapshot_date);

-- Daily Demand (aggregated from sale_order_lines, Census Filter applied)
CREATE TABLE demand_daily (
  id SERIAL PRIMARY KEY,
  product_id INT REFERENCES products(id),
  demand_date DATE NOT NULL,
  quantity_sold NUMERIC(12,4),
  revenue NUMERIC(15,4),
  is_censored BOOLEAN DEFAULT false,
  orders_count INT DEFAULT 0,
  UNIQUE(product_id, demand_date)
);
CREATE INDEX idx_dd_date ON demand_daily(demand_date);
CREATE INDEX idx_dd_product_date ON demand_daily(product_id, demand_date);
```

#### Backtest Engine

```sql
-- Backtest Runs (each cycle of the interactive backtest)
CREATE TABLE backtest_runs (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NULL,
  training_start_date DATE NOT NULL,
  training_end_date DATE NOT NULL,
  prediction_month DATE NOT NULL,
  model_params JSONB,
  training_duration_ms INT,
  products_modeled INT,
  products_by_category INT DEFAULT 0,
  products_total_eligible INT,
  status VARCHAR(20) DEFAULT 'running',
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID
);
CREATE INDEX idx_br_prediction ON backtest_runs(prediction_month);

-- Backtest Results (per-product predictions for each run)
CREATE TABLE backtest_results (
  id SERIAL PRIMARY KEY,
  run_id INT REFERENCES backtest_runs(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  model_type VARCHAR(20) DEFAULT 'individual',
  predicted_demand NUMERIC(12,4),
  actual_demand NUMERIC(12,4),
  predicted_demand_lower NUMERIC(12,4),
  predicted_demand_upper NUMERIC(12,4),
  error_absolute NUMERIC(12,4),
  error_percentage NUMERIC(8,4),
  predicted_reorder_point NUMERIC(12,4),
  predicted_safety_stock NUMERIC(12,4),
  actual_stockout_days INT DEFAULT 0,
  predicted_stockout_days INT DEFAULT 0
);
CREATE INDEX idx_bres_run ON backtest_results(run_id);
CREATE INDEX idx_bres_product ON backtest_results(product_id);

-- Backtest Savings (the headline numbers — 4 contractual goals)
CREATE TABLE backtest_savings (
  id SERIAL PRIMARY KEY,
  run_id INT REFERENCES backtest_runs(id) ON DELETE CASCADE,

  -- Goal 1: Reduced storage costs
  actual_storage_cost NUMERIC(15,4),
  optimized_storage_cost NUMERIC(15,4),
  storage_savings_gtq NUMERIC(15,4),
  storage_savings_pct NUMERIC(8,4),
  storage_reasoning TEXT,
  holding_cost_rate_used NUMERIC(8,4),

  -- Goal 2: Reduced unnecessary purchases
  actual_purchase_value NUMERIC(15,4),
  optimized_purchase_value NUMERIC(15,4),
  purchase_savings_gtq NUMERIC(15,4),
  purchase_savings_pct NUMERIC(8,4),
  purchase_reasoning TEXT,

  -- Goal 3: Reduced lost sales from stockouts
  actual_stockout_events INT,
  predicted_stockout_events INT,
  lost_revenue_actual NUMERIC(15,4),
  lost_revenue_optimized NUMERIC(15,4),
  stockout_savings_gtq NUMERIC(15,4),
  stockout_savings_pct NUMERIC(8,4),
  stockout_reasoning TEXT,

  -- Goal 4: Increased inventory rotation
  actual_turnover_rate NUMERIC(8,4),
  optimized_turnover_rate NUMERIC(8,4),
  rotation_improvement_pct NUMERIC(8,4),
  rotation_reasoning TEXT,

  -- Headline
  total_savings_gtq NUMERIC(15,4),
  summary_text TEXT
);
```

#### App & Auth

```sql
-- Tenants (future multi-tenancy, single row for now)
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(50) UNIQUE NOT NULL,
  odoo_url VARCHAR(255),
  odoo_db VARCHAR(100),
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- User Profiles (extends Supabase auth.users)
CREATE TABLE user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  tenant_id UUID REFERENCES tenants(id),
  display_name VARCHAR(100),
  role VARCHAR(20) DEFAULT 'viewer',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Audit Log
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID,
  action VARCHAR(50),
  resource VARCHAR(100),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- App Settings (holding cost rate, etc. — user-configurable)
CREATE TABLE app_settings (
  id SERIAL PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  key VARCHAR(100) NOT NULL,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, key)
);
```

### Deliverable
- `supabase/migrations/001_initial_schema.sql`

**Depends on:** Phase 0.

---

## 5. Phase 2: Data Ingestion Pipeline

**Goal:** Load all CSV data from `real_data/` into Supabase, convert the xlsx file, reconstruct historical daily inventory, compute daily demand with Census Filter.

### Step 2a: xlsx → CSV Conversion

Use `openpyxl` (Python) to convert `account.move.line_2026.xlsx` to CSV. One-time script.

- `scripts/convert_xlsx.py`

### Step 2b: CSV Parser + Loader

TypeScript/Node.js script (`scripts/ingest-csv.ts`) that:
1. Reads each CSV from `real_data/`
2. Maps Spanish Odoo field names to new schema columns
3. Resolves foreign keys (product references in sale order lines contain SKU in brackets: `[77201039]`)
4. Handles UOM conversion
5. Loads in dependency order:
   `units_of_measure` → `products` → `customers` → `suppliers` → `product_suppliers` → `warehouses` → `stock_locations` → `sale_orders` → `sale_order_lines` → `purchase_orders` → `purchase_order_lines` → `stock_moves` → `stock_quants` → `exchange_rates`

**Critical parsing challenges identified:**
- `sale.order.line` CSV: hierarchical format where order reference only on first row, subsequent lines blank. Must carry forward parent order ID.
- `stock.move` CSVs: Product column embeds SKU in brackets: `[77201063] TAPA P/ENV 1/2...`. Must extract SKU and join to products.
- `purchase.order` CSV: exchange rate as column, amounts may be USD or GTQ.
- `account.move.line` files split across quarterly/yearly files — must concatenate.
- Order states in Spanish: `Orden de venta` = confirmed, `Cancelado` = cancelled, `Cotización` = draft. Map to normalized English states.

### Step 2c: Historical Inventory Reconstruction

The most critical data engineering step. `stock.quant1` is only a point-in-time snapshot (2026-03-03). Historical levels reconstructed from `stock_moves`:

```
Algorithm:
  For each (product, warehouse):
    current_qty = stock_quants quantity as of 2026-03-03
    For each day from 2026-03-03 backwards to 2024-10-01:
      moves_out = SUM(qty) WHERE from_location = warehouse internal loc AND date = day AND state = 'done'
      moves_in  = SUM(qty) WHERE to_location   = warehouse internal loc AND date = day AND state = 'done'

      Store (product, warehouse, day, current_qty) in inventory_daily
      current_qty = current_qty + moves_out - moves_in  (reversing the day's effect)
```

Implemented as a Supabase SQL function for performance (~967K stock moves).

**Validation:** Cross-check reconstructed values for 2026-03-03 against `stock_quants` — they must match within tolerance. Log discrepancies.

### Step 2d: Daily Demand Aggregation with Census Filter

```
1. JOIN sale_order_lines with sale_orders
2. Filter: state IN ('sale', 'done') — exclude 'cancel', 'draft'
3. GROUP BY (product_id, DATE(order_date))
4. Apply Census Filter:
   For each product-day:
     IF inventory_daily.quantity_on_hand <= 0 AND quantity_sold = 0:
       SET is_censored = true
       (Prophet will treat these as gaps, interpolate through them,
        and widen confidence intervals — preventing downward bias)
```

### Deliverables
- `scripts/convert_xlsx.py` — xlsx to CSV conversion
- `scripts/ingest-csv.ts` — CSV parser and loader
- `supabase/migrations/002_inventory_reconstruction.sql` — SQL function
- `supabase/migrations/003_demand_aggregation.sql` — SQL function with Census Filter

**Depends on:** Phase 1.

---

## 6. Phase 3: Backtest Engine (Core ML)

**Goal:** Build the iterative train-predict-compare engine. Deployed on Railway (Python).

### Architecture

Railway Python service exposing an HTTP API:
- `POST /backtest/run` — trigger a new backtest cycle
- `GET /backtest/status/:run_id` — check progress
- `GET /health` — health check

Frontend calls Next.js API route → Next.js API route calls Railway service → Railway writes results to Supabase → frontend polls for completion.

### Product Selection for Backtest

Not all 1,654 products qualify. The engine:
1. Orders all products by total revenue (top products first)
2. For each product, checks if it has >= 30 non-censored daily observations in the training window
3. Selects the first 100 products that qualify (configurable via `app_settings`)
4. For remaining products that fall into categories well-represented by selected products, uses category-level aggregate models
5. **Surfaces clearly to the user:**
   - Which products are included and why (sufficient data, top revenue)
   - Which products are excluded and why (insufficient observations)
   - Coverage metrics: "Modelando X de Y productos (Z% de los ingresos totales)"

### Core Backtest Logic

```python
def run_backtest_cycle(training_months: int, data_start: date) -> BacktestResult:
    """
    Train on months 1..N, predict month N+1, compare to actuals.
    """
    # 1. Date boundaries
    training_start = data_start                              # 2024-10-01
    training_end = data_start + training_months              # e.g., 2024-12-31
    prediction_month_start = first_day_of_next_month         # 2025-01-01
    prediction_month_end = last_day_of_that_month            # 2025-01-31

    # 2. Select top products by revenue that have >= 30 observations
    eligible_products = select_top_qualifying_products(
        training_start, training_end,
        min_observations=30,
        max_products=100
    )

    # 3. Per-product Prophet modeling
    for product in eligible_products:
        df = load_demand_daily(product, training_start, training_end)
        df = df[~df.is_censored]  # Drop censored periods

        model = Prophet(
            yearly_seasonality=(training_months >= 12),
            weekly_seasonality=True,
            daily_seasonality=False,
            changepoint_prior_scale=0.1,
            seasonality_prior_scale=5.0,
        )
        model.fit(df[['ds', 'y']])

        future = model.make_future_dataframe(periods=days_in_prediction_month)
        forecast = model.predict(future)
        predicted = forecast[forecast.ds in prediction_month]
        actuals = load_demand_daily(product, prediction_month_start, prediction_month_end)

        store_backtest_result(run_id, product, predicted, actuals)

    # 4. Category-level models for remaining products
    for category in categories_with_enough_data:
        # Aggregate demand at category level, train, predict, disaggregate
        ...

    # 5. Run savings calculations (Phase 4)
    savings = calculate_all_savings(run_id, prediction_month)

    # 6. Generate summary in Spanish
    summary = generate_spanish_summary(savings)

    return BacktestResult(run_id, savings, eligible_products, coverage_metrics)
```

### Prophet Configuration Rationale

| Parameter | Value | Why |
|-----------|-------|-----|
| `yearly_seasonality` | `False` when < 12 months training, `True` when >= 12 | Cannot estimate yearly patterns with < 1 year of data |
| `weekly_seasonality` | `True` | PLASTICENTRO has clear weekday/weekend sales patterns |
| `daily_seasonality` | `False` | Too much noise at daily level with this data volume |
| `changepoint_prior_scale` | `0.1` | Conservative to avoid overfitting on short history |
| `seasonality_prior_scale` | `5.0` | Allow moderate seasonality strength |

### Deliverables
- `ml/backtest_engine.py` — core backtest logic
- `ml/product_selector.py` — top-product selection with coverage reporting
- `ml/census_filter.py` — extracted Census Filter
- `ml/prophet_config.py` — configuration per data availability
- `ml/api.py` — Flask/FastAPI HTTP wrapper for Railway
- `ml/requirements.txt` — Prophet, pandas, numpy, supabase-py, flask/fastapi
- `Dockerfile.ml` — Railway deployment container

**Depends on:** Phase 1 (schema), Phase 2 (data loaded).

---

## 7. Phase 4: Savings Calculation Engine

**Goal:** For each backtest cycle, compute 4 contractual savings with transparent, auditable reasoning in Spanish.

### Important: Holding Cost Rate

The holding cost rate is surfaced to the user with full transparency:
- Default: 25% annually (~2.08% monthly) — conservative industry estimate
- UI shows: *"Estoy usando una tasa de costo de almacenamiento del 25% anual porque es el estándar conservador de la industria para productos plásticos y desechables en climas tropicales."*
- Below that: *"Ingrese su tasa real de costo de almacenamiento para recalcular:"* [input field]
- When the user inputs their rate, all storage savings recalculate instantly
- The rate used is stored in `backtest_savings.holding_cost_rate_used` for audit

### Calculation 1: Reduced Storage Costs

```python
def calculate_storage_savings(run_id, prediction_month, holding_rate_annual=0.25):
    monthly_rate = holding_rate_annual / 12

    for product in backtest_products:
        # Actual: what they actually held in inventory
        actual_avg_value = AVG(inventory_daily.inventory_value) for prediction_month
        actual_holding_cost = actual_avg_value * monthly_rate

        # Optimized: what AI Refill would recommend holding
        predicted_daily_demand = backtest_results.predicted_demand / days_in_month
        lead_time = product_suppliers.lead_time_days
        demand_std = STDDEV(demand_daily.quantity_sold) over training period
        safety_stock = 1.65 * demand_std * sqrt(lead_time)  # 95% service level
        optimal_avg_inventory = (predicted_daily_demand * lead_time / 2) + safety_stock
        optimized_value = optimal_avg_inventory * product.cost
        optimized_holding_cost = optimized_value * monthly_rate

    storage_savings = SUM(actual) - SUM(optimized)

    reasoning = (
        f"El costo actual de almacenamiento fue de GTQ {actual:,.0f} "
        f"(tasa aplicada: {holding_rate_annual*100:.0f}% anual). "
        f"Con AI Refill, los niveles de inventario optimizados habrían reducido "
        f"el inventario promedio de {actual_avg_units:,.0f} a {optimized_avg_units:,.0f} "
        f"unidades, resultando en un costo de almacenamiento de GTQ {optimized:,.0f}. "
        f"Ahorro: GTQ {savings:,.0f} ({pct:.1f}%)."
    )
```

### Calculation 2: Reduced Unnecessary Purchases

```python
def calculate_purchase_savings(run_id, prediction_month):
    for product with purchases in prediction_month:
        actual_purchased_value = SUM(pol.quantity * pol.unit_price)

        # What was actually needed?
        predicted_demand = backtest_results.predicted_demand
        inventory_at_start = inventory_daily(product, first_day_of_month).quantity_on_hand
        safety_stock = calculated_safety_stock
        needed_qty = max(0, predicted_demand - inventory_at_start + safety_stock)
        # Apply MOQ from product_suppliers
        needed_qty = round_up_to_moq(needed_qty)
        optimized_value = needed_qty * avg_purchase_unit_cost

        if actual > optimized: excess identified

    reasoning = (
        f"Se realizaron compras por GTQ {actual:,.0f}. "
        f"Basado en la demanda predicha y los niveles de inventario existentes, "
        f"las compras optimizadas habrían sido GTQ {optimized:,.0f}. "
        f"Se identificaron {n} productos con compras excesivas, "
        f"siendo los principales: {top_3}. "
        f"Ahorro estimado: GTQ {savings:,.0f} ({pct:.1f}%)."
    )
```

### Calculation 3: Reduced Lost Sales from Stockouts

```python
def calculate_stockout_savings(run_id, prediction_month):
    for product-day where inventory_daily.quantity_on_hand <= 0:
        # Estimate lost demand from non-stockout days nearby
        avg_daily_demand = AVG(demand from non-stockout days in same week)
        lost_units = avg_daily_demand per stockout day
        lost_revenue = lost_units * product.list_price
        lost_margin = lost_units * (product.list_price - product.cost)

    # With AI Refill: optimized reorder points prevent most stockouts
    predicted_stockout_days = days where optimized_inventory <= 0

    reasoning = (
        f"Se identificaron {n_events} eventos de desabastecimiento en "
        f"{n_products} productos durante el mes. La demanda estimada no "
        f"satisfecha fue de {lost_units:,.0f} unidades, con ingresos perdidos "
        f"estimados de GTQ {lost_revenue:,.0f} (margen perdido: GTQ {lost_margin:,.0f}). "
        f"Con los puntos de reorden optimizados de AI Refill, se habrían "
        f"prevenido {prevented_pct:.0f}% de estos eventos. "
        f"Ahorro: GTQ {savings:,.0f}."
    )
```

### Calculation 4: Increased Inventory Rotation

```python
def calculate_rotation_improvement(run_id, prediction_month):
    actual_cogs = SUM(sol.quantity * product.cost) for the month
    actual_avg_inventory = AVG(inventory_daily.inventory_value)
    actual_turnover = (actual_cogs / actual_avg_inventory) * 12  # annualized

    optimized_avg_inventory = AVG(optimized values)
    optimized_turnover = (actual_cogs / optimized_avg_inventory) * 12

    improvement = (optimized_turnover - actual_turnover) / actual_turnover * 100

    reasoning = (
        f"La rotación de inventario actual fue de {actual:.1f}x anualizada "
        f"(inventario promedio: GTQ {actual_inv:,.0f}). "
        f"Con niveles optimizados, la rotación habría sido {optimized:.1f}x "
        f"(inventario promedio: GTQ {optimized_inv:,.0f}). "
        f"Mejora: {improvement:.1f}%."
    )
```

### Headline Summary

```python
def generate_spanish_summary(savings, month_name):
    return (
        f"Si hubiera contado con AI Refill durante {month_name}, "
        f"habría ahorrado aproximadamente GTQ {savings.total:,.0f}:\n"
        f"• GTQ {savings.storage:,.0f} en costos de almacenamiento "
        f"({savings.storage_pct:.0f}% de reducción)\n"
        f"• GTQ {savings.purchase:,.0f} en compras innecesarias "
        f"({savings.purchase_pct:.0f}% de reducción)\n"
        f"• GTQ {savings.stockout:,.0f} en ventas perdidas evitadas "
        f"({savings.stockout_pct:.0f}% de reducción)\n"
        f"• Rotación de inventario mejorada en {savings.rotation_pct:.0f}%"
    )
```

### Deliverables
- `ml/savings/storage_cost.py`
- `ml/savings/unnecessary_purchases.py`
- `ml/savings/lost_sales.py`
- `ml/savings/inventory_rotation.py`
- `ml/savings/summary_generator.py`

**Depends on:** Phase 3 (backtest results must exist).

---

## 8. Phase 5: Backend API

**Goal:** Next.js API Routes calling Supabase + Railway. Replaces Fastify monolith entirely.

### Route Structure

```
app/api/
  auth/
    login/route.ts           -- Supabase signInWithPassword
    logout/route.ts          -- Supabase signOut
    me/route.ts              -- Get current user profile

  backtest/
    run/route.ts             -- POST: trigger new cycle (calls Railway)
    runs/route.ts            -- GET: list all completed runs
    [runId]/route.ts         -- GET: full results for a run
    [runId]/savings/route.ts -- GET: savings breakdown
    recalculate/route.ts     -- POST: recalculate savings with new holding cost rate

  kpis/
    stockout-risk/route.ts   -- Products at risk of stockout
    storage-cost/route.ts    -- Current storage cost metrics
    excess-inventory/route.ts -- Frozen capital / slow movers
    demand-forecast/route.ts -- Forward-looking demand predictions
    inventory-health/route.ts -- Turnover, fill rate, DOS
    abc-xyz/route.ts         -- ABC/XYZ classification

  products/
    route.ts                 -- GET: product list with current metrics
    [id]/route.ts            -- GET: single product deep dive
    [id]/demand/route.ts     -- GET: demand time series
    [id]/inventory/route.ts  -- GET: inventory time series

  admin/
    data-status/route.ts     -- GET: data freshness, row counts, coverage
    import/route.ts          -- POST: trigger CSV re-import
    settings/route.ts        -- GET/PUT: app settings (holding cost rate, etc.)
```

### Key Patterns
- **No separate backend server** — Next.js API routes on Vercel serverless
- **Supabase client** — `@supabase/supabase-js` with service role key server-side
- **No ORM** — direct SQL via `supabase.rpc()` for complex queries
- **Heavy queries as Supabase RPC functions** — inventory metrics, stockout risk, ABC/XYZ

### Supabase RPC Functions (adapted from current codebase)

| New RPC | Adapted From | Purpose |
|---------|-------------|---------|
| `rpc_stockout_risks()` | `sales.queries.ts:getStockoutRisks` | Products at risk now |
| `rpc_inventory_metrics()` | `inventory.queries.ts:getInventoryMetrics` | Turnover, DOS, fill rate |
| `rpc_slow_moving_items()` | `inventory.queries.ts:getSlowMovingItems` | Dead/slow stock |
| `rpc_category_contribution()` | `sales.queries.ts:getCategoryContribution` | Revenue by category |
| `rpc_abc_xyz_classification()` | New | ABC by revenue + XYZ by demand variability |

### ABC/XYZ Classification (included in air_lite)

```sql
-- ABC: by cumulative revenue contribution
-- A = top 80% of revenue, B = next 15%, C = bottom 5%
-- XYZ: by coefficient of variation (CV) of demand
-- X = CV < 0.5 (stable), Y = 0.5 <= CV < 1.0 (variable), Z = CV >= 1.0 (erratic)
-- Statistical significance indicator: based on number of observations
-- "Alta confianza" (>= 90 days), "Confianza media" (30-89 days), "Datos insuficientes" (< 30 days)
```

### Deliverables
- `app/api/` — all route handlers
- `lib/supabase/server.ts` — server-side Supabase client
- `lib/supabase/client.ts` — browser-side Supabase client
- `supabase/migrations/004_rpc_functions.sql` — all RPC functions

**Depends on:** Phase 1, Phase 2. Can proceed in parallel with Phases 3+4.

---

## 9. Phase 6: Frontend Rebuild

**Goal:** Sales-oriented, fear-based navigation with backtest as landing experience. All text in Latin American Spanish.

### Page Structure

```
/ (root)
  → Redirect to /backtest if authenticated, /login if not

/login
  → Supabase Auth login (email/password). Clean, professional.

/backtest (THE LANDING PAGE — THE KILLER FEATURE)
  On load: auto-runs first available backtest (months 1-3 → predict month 4)
  Shows:
    • Headline: "Si hubiera contado con AI Refill durante [mes], habría ahorrado GTQ X"
    • 4 savings cards (one per contractual goal) with expandable reasoning
    • "¿Predecir siguiente mes?" button (prominent CTA)
    • Timeline scrubber: all available months
    • Chart: predicted vs actual demand (aggregate)
    • Chart: cumulative savings across all cycles
    • Product coverage: "Modelando X de Y productos (Z% de ingresos)"
    • Holding cost rate input: transparent, user-configurable, with explanation
    • Expandable per-product results table

/preocupaciones (Fears Hub)
  /preocupaciones/desabastecimiento
    "No quiero perder ventas"
    → Products at risk NOW
    → Stockout history heatmap (product × month)
    → Lost sales estimates
    → Safety stock recommendations per product
    → KPIs: stockout rate, fill rate, service level

  /preocupaciones/costos-almacenamiento
    "Estoy gastando mucho en bodega"
    → Current inventory value by category
    → Days of supply distribution
    → Holding cost estimate (monthly/annual)
    → Overstock alerts: products > 90 DOS
    → KPIs: inventory value, holding cost, avg DOS

  /preocupaciones/capital-congelado
    "Tengo inventario que no se mueve"
    → Slow-moving inventory (> 90 days no movement)
    → Dead stock value
    → ABC/XYZ classification grid (with statistical confidence indicator)
    → Excess inventory value
    → KPIs: slow-moving %, dead stock value, excess value

  /preocupaciones/compras-innecesarias
    "Estoy comprando de más"
    → Recent purchases: needed vs excess
    → Supplier lead time reliability
    → Optimal reorder points vs current
    → KPIs: purchase accuracy, supplier OTIF

/productos (Product Deep Dive — secondary)
  /productos/[id]
    → Demand history chart
    → Inventory history chart
    → Forecast
    → Stockout events
    → Purchase history
    → ABC/XYZ classification
    → Profitability

/configuracion (Admin only)
  → Data status, import trigger, settings (holding cost rate), user management
```

### Navigation (Sidebar)

```
DEMOSTRACIÓN DE VALOR (home icon, primary)
  → /backtest

MIS PREOCUPACIONES (section header)
  Desabastecimiento (AlertTriangle icon)
    "No quiero perder ventas"
  Costos de Almacenamiento (Warehouse icon)
    "Estoy gastando mucho en bodega"
  Capital Congelado (Snowflake icon)
    "Tengo inventario que no se mueve"
  Compras Innecesarias (ShoppingCart icon)
    "Estoy comprando de más"

PRODUCTOS (Package icon, secondary)
  → /productos

CONFIGURACIÓN (Gear icon, admin only)
  → /configuracion
```

### Component Architecture

```
components/
  backtest/
    BacktestTimeline.tsx          -- Interactive month timeline
    BacktestSavingsCard.tsx       -- Single savings metric + expandable reasoning
    BacktestSavingsTotal.tsx      -- Headline total with 4 sub-cards
    BacktestPredictionChart.tsx   -- Predicted vs actual demand (Recharts)
    BacktestCumulativeChart.tsx   -- Cumulative savings over cycles
    PredictNextButton.tsx         -- "¿Predecir siguiente mes?" CTA
    BacktestReasoningPanel.tsx    -- Expandable calculation transparency
    HoldingCostInput.tsx          -- User-configurable rate with explanation
    ProductCoveragePanel.tsx      -- Which products included and why

  fears/
    StockoutRiskTable.tsx         -- Products ranked by stockout risk
    StockoutHeatmap.tsx           -- Product × Month heatmap
    InventoryValueChart.tsx       -- Inventory by category
    DaysOfSupplyDistribution.tsx  -- DOS histogram
    SlowMovingTable.tsx           -- Slow/dead stock list
    ABCXYZGrid.tsx                -- ABC × XYZ matrix with confidence indicators
    PurchaseAnalysisTable.tsx     -- Needed vs excess
    SupplierLeadTimeChart.tsx     -- Supplier reliability

  shared/
    KpiCard.tsx                   -- Reusable KPI (keep from current)
    DataTable.tsx                 -- Sortable/filterable (Radix + Tailwind)
    ChartContainer.tsx            -- Consistent chart wrapper
    CurrencyFormat.tsx            -- GTQ formatting
    ConfidenceIndicator.tsx       -- Statistical significance badge
    EmptyState.tsx

  layout/
    AppShell.tsx                  -- Main layout with sidebar
    FearsSidebar.tsx              -- Fear-oriented nav
    UserMenu.tsx
```

### Charts
Keep Recharts only. Remove Plotly (3MB+ bundle, unnecessary).

### Deliverables
- Complete frontend rebuild in `frontend/src/`
- All user-facing text in Latin American Spanish
- Responsive: desktop-first, tablet-friendly for meeting presentations

**Depends on:** Phase 5 (API), Phase 4 (backtest data).

---

## 10. Phase 7: Production Hardening

**Goal:** Enterprise-grade production readiness.

### Checklist

1. **Error handling**
   - Global error boundary (`error.tsx`)
   - Supabase error mapping → user-friendly Spanish messages
   - Railway service health checks + retry logic

2. **Loading states**
   - Skeleton loaders on all data-dependent components
   - Backtest progress indicator (% products modeled)

3. **Performance**
   - Next.js ISR for `/preocupaciones/*` pages (revalidate 5 min)
   - Supabase connection pooling via Supavisor
   - Index optimization on `inventory_daily`, `demand_daily`, `stock_moves`
   - Consider range partitioning on `stock_moves` by quarter

4. **Security**
   - Supabase RLS policies on all business tables (prepared, not enforced until multi-tenancy)
   - API route auth via Supabase session verification
   - Rate limiting via Vercel Edge Middleware
   - Input validation on all API routes

5. **Observability**
   - Vercel Analytics
   - Supabase Dashboard for DB metrics
   - Railway logs for ML service
   - Structured logging in API routes

6. **Data validation**
   - `scripts/validate-data.ts` — integrity checks after import
   - Cross-check `inventory_daily` reconstruction against `stock_quants` snapshot for 2026-03-03

7. **Testing**
   - Unit tests: savings calculations (deterministic math, must be exact)
   - Integration test: one backtest cycle on known data
   - E2E: Playwright — load backtest, click "Predecir siguiente mes", verify savings

**Depends on:** All prior phases.

---

## 11. Feature Scoping: air_lite vs air_prime

### air_lite (include now)

| Feature | Justification |
|---------|---------------|
| Backtest with savings demonstration | Core value prop, closes deals |
| Demand forecasting (Prophet) | Table stakes for AI inventory app |
| Stockout risk alerts | Tier 1 most-requested KPI |
| Days of Supply per product | Tier 1 most-requested KPI |
| Inventory Turnover | Tier 1, contractual goal |
| Fill Rate / Service Level | Tier 1 most-requested KPI |
| Safety Stock recommendations | Tier 1 most-requested |
| Optimal Reorder Point | Tier 2 high-value differentiator |
| Lost Sales Estimate | Tier 2, required for backtest savings |
| Excess Inventory Value | Tier 2, required for frozen capital page |
| Dead/Slow-Moving Stock detection | Tier 2, required for frozen capital page |
| ABC classification | Tier 2, extremely requested, simple to compute |
| XYZ classification (with confidence indicator) | Tier 2, complements ABC, shows statistical reliability |
| Lead Time tracking | Tier 2, feeds safety stock calc |
| Census Filter | Core IP |
| CSV data import | First integration path |
| Forecast Accuracy (WMAPE) | Tier 1, builds trust in the model |
| Configurable holding cost rate | User transparency |

### air_prime (defer)

| Feature | Reason to Defer |
|---------|----------------|
| Odoo direct API integration | Requires credentials not yet granted |
| Multi-tenancy | No revenue yet |
| Automated PO generation | High-risk, needs deep Odoo integration |
| DDMRP | Complex enterprise feature |
| Multi-warehouse optimization | Requires per-location forecasting |
| What-If Scenario Modeling | Tier 3, complex UI |
| Demand Sensing (real-time 4-8 week) | Requires live data feed |
| Cash-to-Cash Cycle Time | Needs deep accounting integration |
| Perishable/FEFO optimization | Niche, needs shelf-life data |
| Supplier Scorecards | Nice-to-have, not core |
| RFM Customer Segmentation | Analytics feature, not inventory optimization |
| Custom alerts/notifications | Nice-to-have |
| PDF report generation | Nice-to-have |
| Promotions-aware forecasting | Needs promotional calendar data |
| Forecast Value Added (FVA) | Tier 3 advanced metric |

---

## 12. Dependency Graph

```
Phase 0: Infrastructure (Vercel + Supabase + Railway)
  │
  ▼
Phase 1: Database Schema (24 tables)
  │
  ▼
Phase 2: Data Ingestion (CSV → Supabase, inventory reconstruction, demand aggregation)
  │
  ├─────────────────────────┐
  ▼                         ▼
Phase 3: Backtest Engine    Phase 5: Backend API
(Railway/Python)            (Next.js routes + Supabase RPC)
  │                         │
  ▼                         │
Phase 4: Savings            │
Calculations                │
  │                         │
  ├─────────────────────────┘
  ▼
Phase 6: Frontend Rebuild
  │
  ▼
Phase 7: Production Hardening
```

### Parallelization Opportunities
- **Phase 5** (KPI endpoints) runs in parallel with **Phase 3+4** (backtest engine)
- Within Phase 2, CSV loader development can overlap with Phase 1 migration testing
- Frontend components for fear pages can begin once API endpoints are defined (Phase 5)

### Critical Path
Phase 0 → Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 6 (backtest page) → Phase 7

---

## Critical Files to Preserve / Reference During Implementation

| File | Purpose |
|------|---------|
| `airefill_dagster/airefill/pipelines.py` (lines 104-129) | Census Filter logic — core IP to extract |
| `airefill_dagster/airefill/inventory_optimization.py` | ROP, safety stock, EOQ formulas to extract |
| `api-node/src/routes/bi/queries/inventory.queries.ts` | SQL patterns for inventory metrics → Supabase RPC |
| `api-node/src/routes/bi/queries/sales.queries.ts` | SQL patterns for sales metrics → Supabase RPC |
| `api-node/prisma/schema.prisma` | Reference for schema redesign (35+ tables → 24) |
| `real_data/stock.move_2024.csv` | Representative stock.move format for CSV parser |
| `real_data/sale.order.line_20260303.csv` | Hierarchical format requiring carry-forward logic |
| `frontend/src/components/ui/` | Design system primitives to keep |

---

*This plan is designed for a production-deployed, turnkey system. No mock data. No shortcuts. Every artifact serves a valid production purpose.*
