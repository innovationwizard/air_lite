# AI Refill API - Node.js Monolith

TypeScript/Fastify API replacing 15 Lambda functions. Production-ready for ECS Fargate deployment.

## Stack

- **Runtime:** Node.js 20
- **Framework:** Fastify 4
- **ORM:** Prisma
- **Database:** PostgreSQL (Aurora Serverless V2)
- **Auth:** JWT with httpOnly cookies
- **Validation:** Zod

## Project Structure

```
src/
├── index.ts              # Application entry point
├── config.ts             # Configuration (env + Secrets Manager)
├── db/
│   └── client.ts         # Prisma client instance
├── middleware/
│   ├── auth.ts           # JWT authentication & RBAC
│   ├── audit.ts          # Request/response logging
│   └── errorHandler.ts   # Global error handling
├── routes/
│   ├── auth.ts           # /v1/auth (login, logout, refresh)
│   ├── admin.ts          # /v1/admin (users, roles, permissions)
│   ├── compras.ts        # /v1/compras (recommendations, forecasts)
│   ├── finance.ts        # /v1/finance (KPIs)
│   ├── products.ts       # /v1/products (CRUD)
│   ├── inventory.ts      # /v1/inventory (current stock)
│   └── bi.ts             # /v1/bi (dashboards)
└── utils/
    ├── jwt.ts            # JWT creation/verification
    ├── password.ts       # bcrypt hashing
    ├── logger.ts         # Pino logger
    └── responses.ts      # Standardized API responses
```

## Setup

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your local PostgreSQL credentials

# Run Prisma migrations
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Start development server (with hot reload)
npm run dev
```

### Production Build

```bash
# Build TypeScript
npm run build

# Run migrations on production DB
npx prisma migrate deploy

# Start server
npm start
```

### Docker Build

```bash
# Build image
docker build -t airefill-api:latest .

# Run container
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="..." \
  -e JWT_REFRESH_SECRET="..." \
  -e COOKIE_SECRET="..." \
  airefill-api:latest
```

## Deployment to ECS

1. **Build and push image to ECR:**
   ```bash
   aws ecr get-login-password --region us-east-2 | docker login --username AWS --password-stdin 200937443798.dkr.ecr.us-east-2.amazonaws.com
   docker build -t airefill-api:latest .
   docker tag airefill-api:latest 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest
   docker push 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest
   ```

2. **CDK Stack (see `/infra_cdk/lib/api-ecs-stack.ts`):**
   - ECS Fargate service
   - Application Load Balancer
   - Security group with DB access
   - Auto-scaling (CPU/memory based)
   - CloudWatch logs

3. **Environment variables in ECS:**
   - `NODE_ENV=production`
   - `DB_SECRET_NAME=airefill/dagster/db_credentials`
   - `DB_HOST=<aurora-cluster-endpoint>`
   - `JWT_SECRET=<from-secrets-manager>`
   - `JWT_REFRESH_SECRET=<from-secrets-manager>`
   - `COOKIE_SECRET=<from-secrets-manager>`

## API Endpoints

### Auth (`/v1/auth`)
- `POST /login` - Authenticate user (sets httpOnly cookies)
- `POST /logout` - Clear auth cookies
- `POST /refresh` - Refresh access token

### Admin (`/v1/admin`)
- `GET /users` - List users (requires `user:read`)
- `GET /roles` - List roles (requires `role:read`)
- `GET /permissions` - List permissions (requires `permission:read`)
- `GET /health` - Health check

### Compras (`/v1/compras`)
- `GET /recommendations` - Purchase recommendations (requires `recommendation:read`)
- `GET /forecasts` - Demand forecasts (requires `forecast:read`)
- `GET /insights` - AI insights (requires `insight:read`)

### Finance (`/v1/finance`)
- `GET /kpis` - Financial KPIs (requires `kpi:read`)

### Products (`/v1/products`)
- `GET /` - List products (requires `recommendation:read`)
- `GET /:id` - Get product by ID

### Inventory (`/v1/inventory`)
- `GET /current` - Current inventory levels (requires `recommendation:read`)

### BI (`/v1/bi`)
- `GET /dashboards` - Dashboard data (requires `dashboard:read`)

## Authentication Flow

1. Client sends `POST /v1/auth/login` with username/password
2. Server validates credentials against database
3. Server generates:
   - Access token (15min, httpOnly cookie)
   - Refresh token (7d, httpOnly cookie)
   - API key (7d, regular cookie for API Gateway)
4. Client receives user profile + cookies
5. Subsequent requests use cookies automatically
6. When access token expires, use `POST /v1/auth/refresh`

## Database Schema

See `prisma/schema.prisma` for complete schema.

**Key tables:**
- `users`, `roles`, `permissions` - RBAC system
- `user_roles`, `role_permissions` - Many-to-many mappings
- `products`, `clients` - Core business entities
- `sales_partitioned`, `returns`, `purchases` - Transactions
- `inventory_snapshots` - Point-in-time inventory
- `audit_logs` - Immutable audit trail

## Migrations from Lambda

**Changes:**
- ✅ 15 Lambda functions → 1 Fastify app
- ✅ Lambda layers → npm packages
- ✅ API Gateway → ALB (or keep API Gateway with HTTP integration)
- ✅ Cold starts eliminated (always-on Fargate)
- ✅ Shared DB connection pool (better performance)
- ✅ Single codebase (easier to maintain)

**Unchanged:**
- ✅ Same database schema
- ✅ Same RBAC logic
- ✅ Same JWT/cookie authentication
- ✅ Same Aurora PostgreSQL cluster
- ✅ Same security groups

## Next Steps

1. Deploy ECR repository in CDK
2. Create ECS stack (Fargate + ALB)
3. Update Route 53 to point to ALB
4. Run Prisma migrations on production DB
5. Build and push Docker image
6. Deploy ECS service
7. Test endpoints
8. Monitor CloudWatch logs
9. Gradually migrate traffic from Lambda
10. Decommission Lambda functions once stable

## License

Proprietary - Jorge Luis Contreras Herrera