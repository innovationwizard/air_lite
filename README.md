# AIRefill — AI-Powered Inventory Optimization

A full-stack, production-grade platform that replaces manual reorder decisions with ML-driven demand forecasting and automated purchase recommendations. Built as a monorepo with three deployable services and a complete AWS CDK infrastructure.

**Production:** `https://www.airefill.app` · `https://api.airefill.app`

---

## Table of Contents

1. [Overview](#1-overview)
2. [Architecture](#2-architecture)
3. [Repository Structure](#3-repository-structure)
4. [Prerequisites](#4-prerequisites)
5. [Local Development](#5-local-development)
   - [API](#api--node-20--fastify-4--prisma)
   - [Frontend](#frontend--nextjs-14)
   - [ML Pipeline](#ml-pipeline--dagster--prophet)
6. [Environment Variables](#6-environment-variables)
7. [API Reference](#7-api-reference)
8. [Role-Based Access Control](#8-role-based-access-control)
9. [Infrastructure — AWS CDK](#9-infrastructure--aws-cdk)
10. [First-Time Deployment](#10-first-time-deployment)
11. [Regular Deployments](#11-regular-deployments)
12. [CI/CD — GitHub Actions](#12-cicd--github-actions)
13. [Monitoring](#13-monitoring)
14. [Testing](#14-testing)
15. [Design System](#15-design-system)
16. [License](#16-license)

---

## 1. Overview

AIRefill ingests sales, returns, and inventory data from an Aurora PostgreSQL cluster, trains time-series forecasting models (Prophet) via AWS SageMaker, and surfaces actionable purchase recommendations through role-specific dashboards. The architecture runs as a single Fastify monolith on ECS Fargate, eliminating the cold starts and operational overhead of the previous 15-Lambda architecture.

**Core capabilities:**

- Demand forecasting per SKU using Facebook Prophet via SageMaker
- Automated purchase recommendations with configurable safety stock
- Role-gated dashboards for 7 business functions
- Immutable audit log for all mutations
- Scheduled ML pipeline at 3 AM UTC daily (EventBridge → ECS Fargate task)
- Redis-cached BI responses (5-minute TTL)

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                          Internet                            │
└────────────────────┬─────────────────────┬───────────────────┘
                     │ HTTPS               │ HTTPS
              ┌──────▼──────┐       ┌──────▼──────────┐
              │     ALB     │       │   App Runner    │
              │ api.airefill│       │  www.airefill   │
              │    .app     │       │      .app       │
              └──────┬──────┘       └─────────────────┘
                     │ /api/* → 8080     Next.js 14 Frontend
              ┌──────▼──────────┐
              │  ECS Fargate    │
              │  airefill-api   │  ← Node 20 · Fastify 4 · Prisma
              │  2–8 tasks      │
              └──────┬────┬─────┘
                     │    │
              ┌──────▼─┐  ┌▼──────────────────┐
              │ Redis  │  │  Aurora PostgreSQL  │
              │ 7.1    │  │  Serverless v2      │
              │ TLS+Auth│  │  PostgreSQL 15.4   │
              └────────┘  └────────────────────┘

   ┌────────────────────────────────────┐
   │  EventBridge cron(0 3 * * ? *)     │
   │  → Lambda trigger                  │
   │  → ECS Fargate task                │
   │    Dagster · Prophet · SageMaker   │
   └────────────────────────────────────┘

   ┌────────────────────────────────────┐
   │            S3 Buckets (KMS)        │
   │  audit-logs · app-data · ml-models │
   │  pipeline-artifacts · backups      │
   └────────────────────────────────────┘
```

**AWS Region:** `us-east-2` | **Account:** `200937443798`

---

## 3. Repository Structure

```
airefill/
├── api-node/                     # Node.js / Fastify API (ECS Fargate)
│   ├── src/
│   │   ├── index.ts              # App entry point (port 8080)
│   │   ├── config.ts             # Env vars + Secrets Manager loader
│   │   ├── db/client.ts          # Prisma client singleton
│   │   ├── middleware/
│   │   │   ├── auth.ts           # JWT authentication + RBAC
│   │   │   ├── audit.ts          # Request/response audit logging
│   │   │   └── errorHandler.ts   # Global error handler
│   │   ├── routes/
│   │   │   ├── auth.ts           # POST /v1/auth/{login,logout,refresh}
│   │   │   ├── admin.ts          # GET /v1/admin/{users,roles,permissions}
│   │   │   ├── compras.ts        # GET /v1/compras/{recommendations,forecasts,insights}
│   │   │   ├── finance.ts        # GET /v1/finance/kpis
│   │   │   ├── products.ts       # GET /v1/products
│   │   │   ├── inventory.ts      # GET /v1/inventory/current
│   │   │   └── bi.ts             # GET /v1/bi/dashboards
│   │   └── utils/
│   │       ├── jwt.ts            # Token creation / verification
│   │       ├── password.ts       # bcrypt helpers
│   │       ├── logger.ts         # Pino logger
│   │       └── responses.ts      # Standardised response shapes
│   ├── prisma/
│   │   ├── schema.prisma         # Full database schema
│   │   └── migrations/
│   │       ├── migration_lock.toml
│   │       └── 20260224000000_baseline/
│   │           └── migration.sql # Full initial schema SQL
│   ├── jest.config.ts
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/                     # Next.js 14 App Router (App Runner)
│   ├── src/
│   │   ├── middleware.ts         # Auth guard — redirects unauthenticated to /login
│   │   ├── app/
│   │   │   ├── page.tsx          # / → redirect to /login
│   │   │   ├── login/            # /login — auth form
│   │   │   ├── dashboard/        # /dashboard — role-specific landing
│   │   │   └── maintenance/      # /maintenance — engines-offline page (public)
│   │   ├── components/
│   │   │   ├── ui/               # Shadcn/UI components
│   │   │   ├── dashboard/        # Role-specific dashboard components
│   │   │   └── charts/           # Recharts wrappers
│   │   ├── hooks/                # Custom React hooks
│   │   ├── services/             # Axios API service layer
│   │   ├── stores/               # Zustand state stores
│   │   └── types/                # TypeScript type definitions
│   ├── Dockerfile
│   └── .env.example
│
├── airefill_dagster/             # Dagster ML pipeline (ECS Fargate task)
│   ├── airefill/
│   │   ├── assets.py             # Dagster asset definitions
│   │   ├── definitions.py        # Code location entrypoint
│   │   └── ml_pipelines.py       # SageMaker training job ops
│   ├── scripts/
│   │   └── train.py              # SageMaker container entrypoint (not imported)
│   ├── airefill_tests/           # pytest tests
│   └── pyproject.toml            # Python package + Dagster config
│
├── infra_cdk/                    # AWS CDK v2 (TypeScript, 12 stacks)
│   ├── bin/
│   │   └── airefill-cdk.ts       # CDK app — all 12 stacks wired together
│   └── lib/
│       ├── config/
│       │   ├── constants.ts      # Resource names, ARNs, thresholds
│       │   └── environments.ts   # Per-environment config (dev/staging/prod)
│       ├── core/
│       │   ├── network-stack.ts
│       │   ├── security-stack.ts
│       │   └── monitoring-stack.ts
│       ├── data/
│       │   ├── database-stack.ts
│       │   ├── cache-stack.ts
│       │   └── storage-stack.ts
│       ├── compute/
│       │   ├── ecs-cluster-stack.ts
│       │   ├── api-service-stack.ts
│       │   └── dagster-task-stack.ts
│       └── application/
│           ├── alb-stack.ts
│           ├── frontend-stack.ts
│           └── dns-stack.ts
│
└── .github/
    └── workflows/
        ├── ci.yml                        # PR/push: lint, test, build, cdk synth
        └── disaster-recovery-rebuild.yml # Manual: full infra rebuild from scratch
```

---

## 4. Prerequisites

| Tool | Minimum Version | Used for |
|------|----------------|----------|
| Node.js | 20 | API, Frontend, CDK |
| npm | 10+ | Package management |
| Python | 3.9–3.13 | Dagster ML pipeline |
| Docker | 24+ | Container builds |
| AWS CLI | 2.x | Deployments, Secrets Manager |
| AWS CDK CLI | latest | Infrastructure deployments |
| PostgreSQL | 15 | Local dev database |

```bash
npm install -g aws-cdk
```

---

## 5. Local Development

### API — Node 20 · Fastify 4 · Prisma

```bash
cd api-node

npm install

cp .env.example .env
# Edit .env: set DATABASE_URL to your local PostgreSQL instance

npx prisma migrate dev     # Apply migrations + generate client
npm run dev                # Hot reload via tsx watch
# → http://localhost:8080
```

| Script | Description |
|--------|-------------|
| `npm run dev` | `tsx watch` — hot reload |
| `npm run build` | `tsc` → `dist/` |
| `npm start` | `node dist/index.js` (production) |
| `npm run prisma:migrate` | `prisma migrate dev` |
| `npm run prisma:deploy` | `prisma migrate deploy` (production) |
| `npm run prisma:studio` | Open Prisma Studio (port 5555) |
| `npm run lint` | ESLint |
| `npm test` | Jest |

---

### Frontend — Next.js 14

```bash
cd frontend

npm install

cat > .env.local <<'EOF'
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080/v1
EOF

npm run dev
# → http://localhost:3000
```

| Script | Description |
|--------|-------------|
| `npm run dev` | Next.js dev server (port 3000) |
| `npm run build` | Production build |
| `npm start` | Production server |
| `npm run lint` | ESLint |
| `npm test` | Jest |
| `npm run test:watch` | Jest watch mode |
| `npm run test:coverage` | Jest with coverage report |
| `npm run storybook` | Storybook component explorer (port 6006) |
| `npm run build-storybook` | Build static Storybook |

---

### ML Pipeline — Dagster · Prophet

```bash
cd airefill_dagster

python -m venv .venv
source .venv/bin/activate      # macOS / Linux
# .venv\Scripts\activate        # Windows

pip install -e ".[dev]"        # Install package in editable mode + dev extras

dagster dev
# → Dagster UI + Daemon: http://localhost:3000
```

| Script | Description |
|--------|-------------|
| `dagster dev` | Starts Dagster webserver + daemon |
| `pytest airefill_tests` | Run test suite |

**Notes:**

- `airefill/definitions.py` is the code location entrypoint (configured in `pyproject.toml` under `[tool.dagster]`).
- `scripts/train.py` is the SageMaker training container entrypoint — it is executed inside a SageMaker container by `ml_pipelines.py` ops and is **not** imported by the Dagster package.
- Dagster Daemon (required for schedules and sensors) starts automatically with `dagster dev`.

---

## 6. Environment Variables

### API (`api-node/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | yes | `development` \| `production` |
| `PORT` | yes | Server port (default `8080`) |
| `LOG_LEVEL` | no | Pino level (`info`) |
| `DATABASE_URL` | local only | Full PostgreSQL connection string for local dev |
| `DB_SECRET_NAME` | prod | `airefill/database/credentials` |
| `DB_HOST` | prod | Aurora cluster writer endpoint |
| `DB_PORT` | no | PostgreSQL port (default `5432`) |
| `DB_NAME` | no | Database name (default `airefill`) |
| `DB_USER` | no | Database user (default `airefill_admin`) |
| `AWS_REGION` | prod | AWS region (`us-east-2`) |
| `JWT_SECRET` | yes | Access token signing secret |
| `JWT_REFRESH_SECRET` | yes | Refresh token signing secret |
| `COOKIE_SECRET` | yes | `@fastify/cookie` signing secret |

**Production:** All secrets (`JWT_SECRET`, `JWT_REFRESH_SECRET`, `COOKIE_SECRET`, `DATABASE_URL`) are stored in Secrets Manager (`airefill/api/*`, `airefill/database/credentials`) and injected by ECS as container secrets. Never put production values in `.env`.

Generate locally:
```bash
openssl rand -base64 32
```

---

### Frontend (`frontend/.env.local`)

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_API_BASE_URL` | yes | API base URL including `/v1` version prefix |

| Environment | Value |
|-------------|-------|
| Local dev | `http://localhost:8080/v1` |
| Production | `https://api.airefill.app/v1` |

All browser-accessible variables must be prefixed with `NEXT_PUBLIC_`.

---

## 7. API Reference

**Base URL:** `https://api.airefill.app/v1` (production) · `http://localhost:8080/v1` (local)

Authentication uses **httpOnly cookies** set on login:

| Cookie | TTL | Purpose |
|--------|-----|---------|
| `accessToken` | 15 min | Request authentication |
| `refreshToken` | 7 days | Silent token renewal |

Cookies are sent automatically by the browser. For server-to-server requests, include the `Cookie` header.

---

### Auth `POST /v1/auth/...`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/login` | Authenticate with username + password. Sets httpOnly cookies. Returns user profile. |
| POST | `/logout` | Clears `accessToken` and `refreshToken` cookies. |
| POST | `/refresh` | Exchanges `refreshToken` for a fresh `accessToken` cookie. |

**Authentication flow:**

```
Client                                     Server
  │── POST /v1/auth/login ───────────────► │
  │   { username, password }               │ validate bcrypt
  │                                        │ generate accessToken (15 min)
  │                                        │ generate refreshToken (7 d)
  │◄── 200 { user } + Set-Cookie ──────── │
  │
  │── GET /v1/compras/recommendations ──► │ (cookie sent automatically)
  │◄── 200 { data } ─────────────────────  │
  │
  │── POST /v1/auth/refresh ────────────► │ (when accessToken expired)
  │◄── 200 + new Set-Cookie accessToken ─ │
```

---

### Admin `GET /v1/admin/...`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/users` | `user:read` |
| GET | `/roles` | `role:read` |
| GET | `/permissions` | `permission:read` |
| GET | `/health` | Public |

### Compras `GET /v1/compras/...`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/recommendations` | `recommendation:read` |
| GET | `/forecasts` | `forecast:read` |
| GET | `/insights` | `insight:read` |

### Finance `GET /v1/finance/...`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/kpis` | `kpi:read` |

### Products `GET /v1/products/...`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/` | `recommendation:read` |
| GET | `/:id` | `recommendation:read` |

### Inventory `GET /v1/inventory/...`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/current` | `recommendation:read` |

### BI `GET /v1/bi/...`

| Method | Path | Permission |
|--------|------|------------|
| GET | `/dashboards` | `dashboard:read` |

---

## 8. Role-Based Access Control

Seven roles map directly to dashboard landing pages. Roles and their permission sets are stored in the database (`roles`, `permissions`, `user_roles`, `role_permissions` tables — see `prisma/schema.prisma`).

| Role | Business Function | Dashboard Focus |
|------|-------------------|-----------------|
| `SUPERUSER` | Platform admin / developer | System KPIs, live log feed, user impersonation, admin shortcuts |
| `Admin` | General manager | Business KPIs, Metabase BI embeds, delegation alerts |
| `Compras` | Purchasing | Actionable recommendations table, critical SKU inventory chart, PO quick links |
| `Ventas` | Sales | Sales KPIs, demand forecast vs. actuals chart, stock availability |
| `Inventario` | Warehouse | Logistics KPIs, arrival/shipment queues, discrepancy alerts |
| `Finance` | Financial controller | Financial KPIs, working capital trends, one-click reports |
| `Ejecutivo` | CEO / PM | Executive KPIs, business unit health summary, financial trend charts |

**Key tables:**

```
users              → id, username, email, password_hash
roles              → id, name (SUPERUSER, Admin, Compras, …)
permissions        → id, resource, action (e.g. recommendation:read)
user_roles         → user_id ↔ role_id
role_permissions   → role_id ↔ permission_id
```

---

## 9. Infrastructure — AWS CDK

The entire AWS infrastructure lives in `infra_cdk/` using CDK v2 (TypeScript). **All resources are owned by CDK** — no `fromLookup`, no hardcoded resource IDs. Twelve stacks are deployed in explicit dependency order.

### Stack Architecture

| # | Stack Name | Purpose |
|---|------------|---------|
| 1 | `AIRefill-{env}-network` | VPC (10.0.0.0/16), 2 AZs, 1 NAT gateway, VPC endpoints for S3, ECR, Secrets Manager, CloudWatch |
| 2 | `AIRefill-{env}-security` | Security groups (alb, ecs-api, dagster, rds, redis), GitHub Actions OIDC role, app secrets |
| 3 | `AIRefill-{env}-database` | Aurora PostgreSQL 15.4 Serverless v2; master credentials auto-generated at `airefill/database/credentials` |
| 4 | `AIRefill-{env}-cache` | ElastiCache Redis 7.1 — single-node replication group (`cache.t3.micro`), auth token in Secrets Manager |
| 5 | `AIRefill-{env}-storage` | 5 S3 buckets (audit-logs, app-data, ml-models, pipeline-artifacts, backups) — all KMS-encrypted, `enforceSSL`, `RETAIN` policy |
| 6 | `AIRefill-{env}-ecs-cluster` | ECS cluster `airefill-api-cluster`, task execution role, task role |
| 7 | `AIRefill-{env}-alb` | Internet-facing ALB, HTTPS listener (ACM cert), `/api/*` → API target group, HTTP→HTTPS redirect |
| 8 | `AIRefill-{env}-api-service` | Fargate service `airefill-api` (2–8 tasks), CPU + memory autoscaling, circuit breaker with rollback |
| 9 | `AIRefill-{env}-dagster` | Fargate task definition, Lambda trigger, EventBridge `cron(0 3 * * ? *)` |
| 10 | `AIRefill-{env}-frontend` | App Runner service `airefill-frontend` from ECR |
| 11 | `AIRefill-{env}-dns` | `api.airefill.app` → ALB alias A record; `www.airefill.app` → App Runner CNAME |
| 12 | `AIRefill-{env}-monitoring` | SNS topic + CloudWatch alarms (CPU, memory, 5xx, latency, DB capacity) + dashboard |

**ECR repositories** (must exist before ECS can pull images):

| Repository | Used by |
|------------|---------|
| `airefill-api` | API Fargate service |
| `dagster-airefill` | Dagster Fargate task |
| `airefill-frontend` | App Runner frontend |

### Per-Environment Configuration

| Setting | dev | staging | prod |
|---------|-----|---------|------|
| Aurora min ACU | 0.5 | 0.5 | 0.5 |
| Aurora max ACU | 0.5 | 1.0 | 1.0 |
| DB deletion protection | no | no | **yes** |
| API desired count | 1 | 2 | 2 |
| API CPU / memory | 256 / 512 MB | 512 / 1024 MB | 512 / 1024 MB |
| API autoscaling | 1–2 | 2–4 | 2–8 |
| Dagster CPU / memory | 1024 / 2048 MB | 2048 / 4096 MB | 2048 / 4096 MB |
| Termination protection | no | no | **yes** |
| Monitoring alarms | no | no | **yes** |

---

## 10. First-Time Deployment

### Step 1 — Bootstrap CDK

```bash
cd infra_cdk
npm install

cdk bootstrap aws://200937443798/us-east-2 \
  --qualifier airefill \
  --toolkit-stack-name CDKToolkit-airefill
```

### Step 2 — Create ECR Repositories

```bash
for REPO in airefill-api dagster-airefill airefill-frontend; do
  aws ecr create-repository \
    --repository-name "$REPO" \
    --image-scanning-configuration scanOnPush=true \
    --encryption-configuration encryptionType=AES256 \
    --region us-east-2
done
```

### Step 3 — Deploy All Stacks

```bash
# Deploy all 12 stacks (prod environment)
cdk deploy --all -c env=prod --require-approval never

# Or deploy individual stacks in order
cdk deploy AIRefill-prod-network -c env=prod
cdk deploy AIRefill-prod-security -c env=prod
# …etc.
```

### Step 4 — CRITICAL: Set DATABASE_URL

Aurora generates master credentials at deploy time. After the `database` stack completes, retrieve them and populate the `database-url` secret so the API can connect:

```bash
# Retrieve auto-generated credentials
CREDS=$(aws secretsmanager get-secret-value \
  --secret-id airefill/database/credentials \
  --query SecretString --output text)

DB_USER=$(echo "$CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])")
DB_PASS=$(echo "$CREDS" | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])")

# Get the Aurora cluster writer endpoint
DB_HOST=$(aws rds describe-db-clusters \
  --query 'DBClusters[?DatabaseName==`airefill`].Endpoint' \
  --output text --region us-east-2)

# Write the full connection URL
aws secretsmanager put-secret-value \
  --secret-id airefill/api/database-url \
  --secret-string "postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/airefill"
```

### Step 5 — Build and Push Container Images

```bash
ECR="200937443798.dkr.ecr.us-east-2.amazonaws.com"
aws ecr get-login-password --region us-east-2 \
  | docker login --username AWS --password-stdin "$ECR"

# API
docker build -t airefill-api:latest api-node/
docker tag airefill-api:latest "$ECR/airefill-api:latest"
docker push "$ECR/airefill-api:latest"

# Frontend
docker build -t airefill-frontend:latest frontend/
docker tag airefill-frontend:latest "$ECR/airefill-frontend:latest"
docker push "$ECR/airefill-frontend:latest"

# Dagster ML pipeline
docker build -t dagster-airefill:latest airefill_dagster/
docker tag dagster-airefill:latest "$ECR/dagster-airefill:latest"
docker push "$ECR/dagster-airefill:latest"
```

### Step 6 — Force ECS Re-Deploy

```bash
aws ecs update-service \
  --cluster airefill-api-cluster \
  --service airefill-api \
  --force-new-deployment \
  --region us-east-2
```

### Step 7 — Database Migrations

Migration history lives in `api-node/prisma/migrations/`. Prisma tracks applied migrations in the `_prisma_migrations` table.

**Brand-new database** — apply all migrations in order:

```bash
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/airefill"
cd api-node
npx prisma migrate deploy
```

**Existing database** (first time enabling migrations on a pre-existing schema) — baseline without re-running DDL:

```bash
export DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@${DB_HOST}:5432/airefill"
cd api-node
npx prisma migrate resolve --applied "20260224000000_baseline"
# Verify: npx prisma migrate status
```

**Creating a new migration after a schema change:**

```bash
cd api-node
npx prisma migrate dev --name <descriptive_name>   # dev only — generates SQL + applies
npx prisma migrate deploy                           # production — applies pending migrations
```

### Step 8 — Confirm SNS Email Subscription

After the `monitoring` stack deploys, check `admin@airefill.app` and confirm the SNS subscription to activate CloudWatch alarm notifications.

---

## 11. Regular Deployments

```bash
# Re-deploy a single service after a code change
cdk deploy AIRefill-prod-api-service -c env=prod

# Rollback to a specific ECS task definition revision
aws ecs update-service \
  --cluster airefill-api-cluster \
  --service airefill-api \
  --task-definition airefill-api:<REVISION> \
  --region us-east-2

# View recent ECR image tags for rollback selection
aws ecr describe-images \
  --repository-name airefill-api \
  --query 'sort_by(imageDetails, &imagePushedAt)[*].[imageTags[0], imagePushedAt]' \
  --output table --region us-east-2
```

---

## 12. CI/CD — GitHub Actions

### Continuous Integration

`.github/workflows/ci.yml` — triggers on every pull request and push to `main`.

Four jobs run in parallel:

| Job | Steps |
|-----|-------|
| `api` | `npm ci` → `prisma validate` → lint → `tsc` → Jest |
| `frontend` | `npm ci` → lint → `next build` → Jest |
| `dagster` | `pip install -e ".[dev]"` → `pytest airefill_tests` |
| `cdk` | `npm ci` → `tsc` → `cdk synth --all -c env=prod` |

In-progress runs on the same branch are cancelled automatically (`concurrency: cancel-in-progress: true`).

---

### Disaster Recovery Rebuild

`.github/workflows/disaster-recovery-rebuild.yml` — manual trigger via `workflow_dispatch`.

Rebuilds the entire infrastructure from scratch in 10 sequential phases:

| Phase | Job | What happens |
|-------|-----|--------------|
| 1 | `validate-inputs` | Confirms the `REBUILD` code, logs operator and timestamp |
| 2 | `bootstrap-aws-environment` | CDK bootstrap |
| 3 | `deploy-core-infrastructure` | Network + Security + Storage stacks |
| 4 | `deploy-data-layer` | Database + Cache stacks; creates Secrets Manager entries |
| 5 | `deploy-compute-layer` | ECS Cluster stack |
| 6 | `build-and-push-containers` | Builds and pushes all 3 images in parallel (matrix strategy) |
| 7 | `deploy-application-layer` | ALB + API Service + Dagster + Frontend stacks |
| 8 | `deploy-dns-and-monitoring` | DNS + Monitoring stacks |
| 9 | `restore-data` | (Optional) Restores S3 and RDS from backups |
| 10 | `verify-deployment` | Health checks: RDS, ElastiCache, ECS, ALB targets, App Runner, `GET /health` |
| 11 | `post-deployment-tasks` | Cache warm-up, Dagster initial run, alarm verification |

**Authentication — GitHub OIDC (no long-lived keys):**

AWS authentication uses GitHub's OIDC token exchange. No AWS credential secrets are stored in the repository. The `AiRefillGitHubActionsRole` IAM role — created and owned by the `AIRefill-{env}-security` CDK stack — trusts tokens issued by `token.actions.githubusercontent.com` scoped to the `innovationwizard/airefill` repository.

The role ARN is hardcoded in the workflow `env` block:

```yaml
env:
  AWS_ROLE_ARN: arn:aws:iam::200937443798:role/AiRefillGitHubActionsRole
```

The workflow declares the required OIDC permission at the top level:

```yaml
permissions:
  id-token: write   # required for OIDC token exchange
  contents: read
```

**No repository secrets are required for AWS authentication.** If you see `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the repo's Actions secrets, delete them — they are unused.

**Triggering the workflow:**

1. Go to Actions → "Disaster Recovery - Full Infrastructure Rebuild"
2. Click "Run workflow"
3. Select environment (`dev` / `staging` / `prod`)
4. Set `restore_data` to `true` if recovering from a snapshot
5. Optionally provide an `rds_snapshot_id`
6. Type `REBUILD` in `confirmation_code` — the workflow hard-fails if this does not match

---

## 13. Monitoring

### CloudWatch Alarms

| Alarm | Threshold | Notification |
|-------|-----------|--------------|
| ECS CPU utilization | > 85% for 15 min (3 × 5-min periods) | SNS → `admin@airefill.app` |
| ECS memory utilization | > 90% for 15 min | SNS → `admin@airefill.app` |
| ALB 5xx error count | > 20 in 10 min (2 periods) | SNS → `admin@airefill.app` |
| ALB p95 response time | > 3 s for 15 min | SNS → `admin@airefill.app` |
| Aurora Serverless capacity | > 0.8 ACU for 10 min | SNS → `admin@airefill.app` |

**Dashboard:** `airefill-operations` in CloudWatch (us-east-2)

### Useful CLI Commands

```bash
# Tail API logs in real time
aws logs tail /ecs/airefill-api --follow --region us-east-2

# Filter for errors only
aws logs tail /ecs/airefill-api --filter-pattern "ERROR" --region us-east-2

# Check ECS service health
aws ecs describe-services \
  --cluster airefill-api-cluster \
  --services airefill-api \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --region us-east-2

# Manual scale-up (emergency)
aws ecs update-service \
  --cluster airefill-api-cluster \
  --service airefill-api \
  --desired-count 5 \
  --region us-east-2

# Exec into a running container (debugging)
aws ecs execute-command \
  --cluster airefill-api-cluster \
  --task <task-id> \
  --container api \
  --interactive \
  --command "/bin/sh"
```

---

## 14. Testing

### API

```bash
cd api-node
npm test        # Jest
npm run lint    # ESLint
npm run build   # tsc — zero errors required before deploying
```

### Frontend

```bash
cd frontend
npm test                  # Jest + React Testing Library
npm run test:watch        # Watch mode
npm run test:coverage     # Coverage report
npm run lint
npm run build             # Verify production build
```

**Component test convention** — place each test file next to the component:

```
src/components/ui/
├── button.tsx
├── button.stories.tsx          # Storybook stories
└── __tests__/
    └── button.test.tsx         # Jest tests
```

### ML Pipeline

```bash
cd airefill_dagster
pytest airefill_tests
```

### Infrastructure (CDK)

```bash
cd infra_cdk
npm run build              # tsc — must produce zero errors
cdk synth -c env=prod      # Synthesise CloudFormation templates
cdk diff -c env=prod       # Preview pending infrastructure changes
```

---

## 15. Design System

### Color Tokens

| Token | Hex | Usage |
|-------|-----|-------|
| Primary | `#2563EB` (Blue 600) | Primary buttons, active nav, key highlights |
| Accent | `#16A34A` (Green 600) | Save, Confirm, Create actions |
| Background | `#F8FAFC` (Slate 50) | Page background |
| Border | `#E2E8F0` (Slate 200) | Card borders, dividers |
| Body text | `#334155` (Slate 700) | Paragraph text, labels |
| Headings | `#0F172A` (Slate 900) | H1–H3 |
| Destructive | Red | Delete, error states |
| Warning | Amber | Non-critical alerts |
| Info | Blue | Informational tips |

### Typography

| Role | Font | Weight |
|------|------|--------|
| Body / UI elements | Inter | 400, 500, 600 |
| Headings (H1–H3) | Figtree | 700 |

### Tech Stack

| Layer | Library | Version |
|-------|---------|---------|
| Framework | Next.js | 14.x |
| UI components | Shadcn/UI (Radix UI) | — |
| Styling | Tailwind CSS | 3.4.x |
| State management | Zustand | 4.5.x |
| HTTP client | axios | 1.7.x |
| Charts | Recharts + Plotly | 2.12.x + 3.x |
| Icons | lucide-react | 0.378.x |
| Testing | Jest + React Testing Library | 29.x + 15.x |
| Component dev | Storybook | 8.1.x |

---

## 16. License

Proprietary — Jorge Luis Contreras Herrera. All rights reserved.
