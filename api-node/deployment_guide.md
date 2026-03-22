# API Deployment Guide

Architecture: Fastify monolith on ECS Fargate behind ALB.
Domain: `https://api.airefill.app` (Route 53 → ALB).

## Quick Deploy (code changes only, no migrations)

```bash
cd ~/Documents/_git/airefill/api-node
./deploy_script.sh          # builds, pushes to ECR, restarts ECS
```

## Full Deploy (migration + code)

When a deploy includes new Prisma migrations (e.g. new tables, views, indexes):

### 1. Run migration via ECS one-off task

Migrations cannot run locally — Aurora is in a private VPC. Follow the [ECS One-Off Task SOP](../memory/ecs-one-off-sop.md) with the migration command:

```bash
# Override the container command to run migrations:
npx prisma@5.22.0 migrate deploy
```

**Why pin `prisma@5.22.0`?** The prod image uses `--omit=dev`, so bare `npx prisma` downloads the latest version (7.x), which has breaking changes.

### 2. Deploy the API code

```bash
cd ~/Documents/_git/airefill/api-node
./deploy_script.sh
```

### 3. Verify

```bash
# Health check
curl -s https://api.airefill.app/api/v1/health | jq

# Smoke test (replace credentials)
TOKEN=$(curl -s -X POST https://api.airefill.app/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"<user>","password":"<pass>"}' | jq -r '.data.accessToken')

curl -s https://api.airefill.app/api/v1/ventas/resumen?fechaInicio=2026-01-01&fechaFin=2026-01-31 \
  -H "Authorization: Bearer $TOKEN" | jq
```

## Rollback

```bash
# List recent images
aws ecr describe-images \
  --repository-name airefill-api \
  --query 'sort_by(imageDetails,&imagePushedAt)[-5:].[imageTags[0],imagePushedAt]' \
  --output table \
  --region us-east-2 --profile airefill-prod

# Deploy a previous tag
./deploy_script.sh <previous-tag>
```

For migration rollbacks, write a reverse migration SQL and run it via the one-off task SOP.

## Monitoring

```bash
# Tail logs
aws logs tail /ecs/airefill-api --follow --region us-east-2 --profile airefill-prod

# Filter errors
aws logs tail /ecs/airefill-api --filter-pattern "ERROR" --region us-east-2 --profile airefill-prod

# Service status
aws ecs describe-services \
  --cluster airefill-api-cluster \
  --services airefill-api-service \
  --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}' \
  --region us-east-2 --profile airefill-prod
```

## Recurring Gotchas

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Missing `--platform linux/amd64` | `exec format error` on Fargate | Always build with `--platform linux/amd64` (dev machine is Apple Silicon) |
| `docker push` without `--provenance=false` | ECR rejects attestation manifests | Use `docker buildx build --push --provenance=false` (the deploy script does this) |
| Bare `npx prisma` in container | Downloads Prisma 7.x, breaking changes | Pin: `npx prisma@5.22.0` |
| Running migration locally | Connection refused / timeout | DB is in private VPC — run migrations via ECS one-off task |
| Missing `--profile airefill-prod` | Uses wrong AWS account | All AWS commands need `--profile airefill-prod` |
| Using seed credentials on prod | Auth fails | Seed credentials (`admin`/`ChangeMe123!`) were never seeded to prod — ask for real creds |
| `HOME` not set in container | Prisma / npm cache errors | Set `HOME=/tmp` in task definition env vars |

## Infrastructure

| Resource | Value |
|----------|-------|
| AWS Account | `200937443798` |
| Region | `us-east-2` |
| ECR Repo | `airefill-api` |
| ECS Cluster | `airefill-api-cluster` |
| ECS Service | `airefill-api` |
| ALB DNS | Route 53 `api.airefill.app` → ALB |
| Log Group | `/ecs/airefill-api` |
| AWS Profile | `airefill-prod` |
| Fargate Config | 0.25 vCPU / 0.5 GB RAM, auto-scaling 1–10 tasks |
