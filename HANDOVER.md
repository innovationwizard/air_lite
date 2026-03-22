# AIRefill — Handover Document

> **Audience:** Client technical lead / incoming infrastructure owner
> **Last updated:** 2026-02-24
> **Workload account:** `200937443798` (AI-Refill) | **Management account:** `524390297512` (InnovationWizard)
> **Region:** `us-east-2` | **Domain:** `airefill.app` | **Org root:** `r-etp3`

---

## Table of Contents

1. [Architecture at a Glance](#1-architecture-at-a-glance)
2. [AWS Organizations Structure](#2-aws-organizations-structure)
3. [CDK Infrastructure Stack Map](#3-cdk-infrastructure-stack-map)
4. [Credentials Vault](#4-credentials-vault)
5. [First-Deploy Runbook](#5-first-deploy-runbook)
6. [IAM Identity Center Setup](#6-iam-identity-center-setup)
7. [Day-One Checklist (Handover Day)](#7-day-one-checklist-handover-day)
8. [Ongoing Operations](#8-ongoing-operations)
9. [Emergency Contacts & Escalation](#9-emergency-contacts--escalation)

---

## 1. Architecture at a Glance

```
Internet
  │
  ▼
Route 53 (airefill.app)
  ├── api.airefill.app  → ALB → ECS Fargate (api-node, port 8080)
  └── www.airefill.app  → App Runner (Next.js frontend)
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
              Aurora PG   ElastiCache  S3 Buckets
             Serverless v2  Redis     (data / ML / backups)
                    │
                    ▼
          Dagster ECS Task (scheduled ML pipeline, 3 AM daily)
```

**Services:**
| Service | Technology | Where |
|---|---|---|
| API | Node.js / Fastify / Prisma | ECS Fargate (`AIRefill-prod-api-service`) |
| Frontend | Next.js (App Router) | AWS App Runner (`AIRefill-prod-frontend`) |
| ML Pipeline | Python / Dagster | ECS Fargate scheduled task (`AIRefill-prod-dagster`) |
| Database | Aurora PostgreSQL Serverless v2 | `AIRefill-prod-database` |
| Cache | ElastiCache Redis (`cache.t3.micro`) | `AIRefill-prod-cache` |
| Container Registry | Amazon ECR | `airefill-api`, `airefill-frontend`, `dagster-airefill` |
| CI/CD | GitHub Actions + OIDC | `.github/workflows/ci.yml` |

---

## 2. AWS Organizations Structure

### Account hierarchy

```
Root (r-etp3)
├── InnovationWizard  [management account]  524390297512  aws@ndor.co
│     └── (billing only — no workloads ever deployed here)
│
├── Workloads OU
│   └── Prod OU
│         └── AI-Refill  [workload account]  200937443798  aws@airefill.app
│
└── Security OU  (reserved — future audit/GuardDuty account)
```

### Service Control Policies (SCPs)

All SCPs are attached to the **Workloads OU** and cascade to every account beneath it.

| SCP | Effect |
|---|---|
| `AIRefill-DenyRootUserActions` | Denies all API calls made with root credentials in member accounts |
| `AIRefill-DenyDisableCloudTrail` | Prevents stopping, deleting, or modifying CloudTrail |
| `AIRefill-RequireHTTPS` | Rejects S3 requests that don't use TLS |
| `AIRefill-DenyLeaveOrganization` | Prevents accounts from detaching from the org |
| `AIRefill-DenyDisableGuardDuty` | Prevents disabling GuardDuty detectors |

### Deploying the Organizations stack

The org-level CDK app is separate from the workload CDK app. It deploys from the **management account** to `us-east-1` (where the Organizations API lives).

**Prerequisites (one-time):**
```bash
# 1. Enable All Features (required for SCPs)
aws organizations enable-all-features --region us-east-1

# 2. Enable SCP policy type on the Root
aws organizations enable-policy-type \
  --root-id r-etp3 \
  --policy-type SERVICE_CONTROL_POLICY \
  --region us-east-1

# 3. Bootstrap CDK in management account
npx cdk bootstrap aws://524390297512/us-east-1
```

**Deploy:**
```bash
cd infra_cdk
AWS_PROFILE=<management-account-profile> \
  npx cdk --app 'npx ts-node bin/org.ts' deploy --all
```

**After deploy — move the AI-Refill account into Prod OU:**

Copy the `ProdOuId` from the stack outputs, then:
```bash
aws organizations move-account \
  --account-id 200937443798 \
  --source-parent-id r-etp3 \
  --destination-parent-id <ProdOuId> \
  --region us-east-1
```

---

## 3. CDK Infrastructure Stack Map

All infrastructure is defined in `infra_cdk/` and deployed as 12 CDK stacks.

```
AIRefill-prod-network          VPC, subnets, NAT, VPC endpoints
AIRefill-prod-security         Security groups, IAM roles, Secrets Manager secrets
AIRefill-prod-database         Aurora PostgreSQL Serverless v2
AIRefill-prod-cache            ElastiCache Redis
AIRefill-prod-storage          S3 buckets (data, ML, backups, audit logs)
AIRefill-prod-ecs-cluster      ECS cluster with Fargate capacity providers
AIRefill-prod-alb              Application Load Balancer (HTTPS, port 443)
AIRefill-prod-api-service      API Fargate service, autoscaling 2→8 tasks
AIRefill-prod-dagster          Dagster ML pipeline (scheduled ECS task)
AIRefill-prod-frontend         Next.js on App Runner
AIRefill-prod-dns              Route 53 A records (api. and www.)
AIRefill-prod-monitoring       CloudWatch alarms, dashboard, SNS alerts
AIRefill-prod-identity-center  IAM Identity Center permission sets (deploy separately)
```

**Deploy all stacks (except identity-center):**
```bash
cd infra_cdk
npm ci
cdk deploy --all -c env=prod --require-approval never
```

**Diff before any change:**
```bash
cdk diff --all -c env=prod
```

---

## 4. Credentials Vault

> **IMPORTANT:** Store ALL of the following in a password manager (1Password, Bitwarden, or AWS Secrets Manager) before handover. Never leave credentials in plain text files, Slack, or email.

### 4.1 AWS Root Account

| Field | Value |
|---|---|
| Root email | *(the email used to create the AWS account — do not share; store in 1Password)* |
| Account ID | `200937443798` |
| MFA | Hardware MFA or virtual (Authenticator app) — **must be enabled** |
| Root password | Rotate on handover day; store in 1Password |

**Root user must only be used for:**
- Enabling/disabling IAM Identity Center
- Account closure
- Billing contact updates

**Do NOT use root for day-to-day operations.** Use IAM Identity Center SSO instead.

### 4.2 AWS Secrets Manager — Production Secrets

All application secrets are stored in AWS Secrets Manager in `us-east-2`. They are automatically injected into ECS containers at runtime.

| Secret Name | Description | Rotation |
|---|---|---|
| `airefill/api/database-url` | PostgreSQL connection string (full URL) | Rotate via Aurora console |
| `airefill/dagster/db_credentials` | JSON `{ host, port, dbname, username, password }` | Rotate via Aurora console |
| `airefill/api/jwt-secret` | JWT signing secret (HS256) | Rotate and redeploy |
| `airefill/api/refresh-secret` | Refresh token signing secret | Rotate and redeploy |
| `airefill/api/cookie-secret` | Fastify cookie signing secret | Rotate and redeploy |
| `airefill/cache/auth-token` | ElastiCache Redis auth token | Rotate via ElastiCache console |

**How to rotate a secret:**
```bash
# Generate a new secret
openssl rand -base64 48

# Update in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id airefill/api/jwt-secret \
  --secret-string "NEW_SECRET_VALUE" \
  --region us-east-2

# Force new ECS task deployment to pick up the new value
aws ecs update-service \
  --cluster airefill-prod \
  --service airefill-api-prod \
  --force-new-deployment \
  --region us-east-2
```

### 4.3 Database Master Credentials

| Field | Value |
|---|---|
| Engine | Aurora PostgreSQL 15.4 Serverless v2 |
| Master username | `airefill_admin` |
| Master password | Auto-generated by CDK; retrieve from Secrets Manager: `airefill/dagster/db_credentials` |
| Database name | `airefill` |
| Port | `5432` |
| Cluster endpoint | Found in: AWS Console → RDS → `AIRefill-prod-database` → Endpoint |

### 4.4 Application Default Admin User (Seed)

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `ChangeMe123!` |
| Action | **Change immediately after first login** |

See [§5.5](#55-seed-the-database) for seed instructions.

### 4.5 GitHub Repository Secrets

| Secret | Description |
|---|---|
| `AWS_ROLE_ARN` | `arn:aws:iam::200937443798:role/AiRefillGitHubActionsRole` (OIDC, no long-lived keys) |

**Stale secrets to delete (if present):**
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

Navigate to: GitHub → Settings → Secrets and variables → Actions → delete the above.

### 4.6 Domain & DNS

| Item | Value |
|---|---|
| Registrar | *(check with Jorge — domain may be in Route 53 or external)* |
| Hosted Zone | `airefill.app` — `Z09453142M8URXXL7FSCB` |
| ACM Certificate ARN | `arn:aws:acm:us-east-2:200937443798:certificate/15edb928-485b-4212-81ae-828b4a777a40` |

---

## 5. First-Deploy Runbook

Follow these steps in order when deploying to a fresh AWS account or after a full teardown.

### 5.1 Bootstrap CDK

```bash
cd infra_cdk
npm ci
cdk bootstrap aws://200937443798/us-east-2 --profile <your-aws-profile>
```

### 5.2 Create ECR Repositories (if not yet created)

```bash
aws ecr create-repository --repository-name airefill-api --region us-east-2
aws ecr create-repository --repository-name airefill-frontend --region us-east-2
aws ecr create-repository --repository-name dagster-airefill --region us-east-2
```

### 5.3 Build and Push Docker Images

```bash
# Authenticate
aws ecr get-login-password --region us-east-2 | \
  docker login --username AWS --password-stdin 200937443798.dkr.ecr.us-east-2.amazonaws.com

# API
cd api-node
docker build -t 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest .
docker push 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest

# Frontend
cd ../frontend
docker build -t 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-frontend:latest .
docker push 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-frontend:latest

# Dagster
cd ../airefill_dagster
docker build -t 200937443798.dkr.ecr.us-east-2.amazonaws.com/dagster-airefill:latest .
docker push 200937443798.dkr.ecr.us-east-2.amazonaws.com/dagster-airefill:latest
```

### 5.4 Deploy CDK Stacks

```bash
cd infra_cdk
cdk deploy --all -c env=prod --require-approval never
```

Stack creation order is enforced by explicit CDK dependencies; CDK will deploy them in the correct sequence automatically.

### 5.5 Seed the Database

After the database stack is deployed and the schema is migrated:

```bash
cd api-node

# Run Prisma migrations
DATABASE_URL="$(aws secretsmanager get-secret-value \
  --secret-id airefill/api/database-url \
  --query SecretString --output text \
  --region us-east-2)" \
  npx prisma migrate deploy

# Seed roles, permissions, and default admin user
DATABASE_URL="$(aws secretsmanager get-secret-value \
  --secret-id airefill/api/database-url \
  --query SecretString --output text \
  --region us-east-2)" \
  npx prisma db seed
```

**Immediately after seeding:** log in as `admin` / `ChangeMe123!` and change the password.

---

## 6. IAM Identity Center Setup

> This is a one-time manual step. IAM Identity Center cannot be enabled via CloudFormation/CDK — it must be enabled in the console first.

### 6.1 Enable IAM Identity Center

1. AWS Console → **IAM Identity Center** → **Enable**
2. Choose **Enable with AWS Organizations** (or standalone if not in an org)
3. Go to **Settings** → copy the **Instance ARN**: `arn:aws:sso:::instance/ssoins-XXXXXXXXXXXXXXXX`

### 6.2 Deploy the Permission Sets Stack

```bash
cd infra_cdk
cdk deploy AIRefill-prod-identity-center \
  -c env=prod \
  -c ssoInstanceArn=arn:aws:sso:::instance/ssoins-XXXXXXXXXXXXXXXX
```

This creates two permission sets:
- **PrincipalArchitect** — `AdministratorAccess`, 8-hour sessions (for the developer, pre-handover)
- **AIRefillReadOnly** — `ReadOnlyAccess` + `AWSBillingReadOnlyAccess`, 4-hour sessions (for client review)

### 6.3 Create Users

In IAM Identity Center → **Users** → **Add user**:

| User | Permission Set | Session Duration |
|---|---|---|
| Developer (Jorge) | PrincipalArchitect | 8 hours |
| Client Technical Lead | AIRefillReadOnly | 4 hours |

### 6.4 Assign Users to the Account

1. IAM Identity Center → **AWS accounts** → Select `AIRefill (200937443798)`
2. **Assign users or groups** → select each user → assign the appropriate permission set

### 6.5 SSO Sign-In Portal

The sign-in URL is displayed in IAM Identity Center → **Dashboard** → **AWS access portal URL**.
Format: `https://<your-d-xxxxxxxx>.awsapps.com/start`

Store this URL alongside the credentials in 1Password.

---

## 7. Day-One Checklist (Handover Day)

Complete these tasks on the day of handover, in order.

- [ ] **Rotate root account password** — Log in as root → My Account → Change password → store new password in 1Password
- [ ] **Verify root MFA is active** — My Security Credentials → MFA device must be registered
- [ ] **Delete or disable the `AIRefill-GitHub-OIDC` IAM user** (if any long-lived IAM users remain) — IAM → Users → check for any non-service users
- [ ] **Rotate application secrets** — Rotate JWT, refresh, and cookie secrets in Secrets Manager (see §4.2); force redeploy of API service
- [ ] **Remove developer's PrincipalArchitect SSO assignment** — IAM Identity Center → AWS accounts → AIRefill → remove `PrincipalArchitect` assignment from developer user (Jorge Luis Contreras)
- [ ] **Transfer GitHub repository ownership** (if applicable) — GitHub → Settings → Transfer to client org
- [ ] **Seed default admin user password changed** — Confirm the `admin` / `ChangeMe123!` password has been updated or the account disabled
- [ ] **Verify CI is green** — GitHub Actions → confirm the latest `ci.yml` run passes all 5 jobs
- [ ] **Confirm monitoring alerts are routed to client email** — CloudWatch → `AIRefill-prod-monitoring` → SNS topic subscription confirmed for `admin@airefill.app` (update to client email)
- [ ] **Hand off 1Password vault / Bitwarden collection** with all credentials listed in §4
- [ ] **Confirm client can log into AWS SSO portal** and see the account
- [ ] **Decommission old Redis Cloud credential** — REMINDER.md has the stale credential; confirm it is rotated/invalidated

---

## 8. Ongoing Operations

### Deploying a new API version

```bash
# CI pipeline handles build + push automatically on merge to main.
# To manually force a redeploy:
aws ecs update-service \
  --cluster airefill-prod \
  --service airefill-api-prod \
  --force-new-deployment \
  --region us-east-2
```

### Running a Dagster pipeline manually

```bash
aws ecs run-task \
  --cluster airefill-prod \
  --task-definition airefill-dagster-prod \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-XXXX],securityGroups=[sg-XXXX],assignPublicIp=DISABLED}" \
  --region us-east-2
```

(Replace `subnet-XXXX` and `sg-XXXX` with values from the network and security stacks — use `cdk ls` or the CloudFormation Outputs tab.)

### Applying a database migration

```bash
cd api-node
# Add migration files, then:
DATABASE_URL="<connection-string>" npx prisma migrate deploy
```

### Scaling the API

API autoscaling is configured (min 2, max 8 tasks). To manually adjust:
```bash
aws application-autoscaling register-scalable-target \
  --service-namespace ecs \
  --resource-id service/airefill-prod/airefill-api-prod \
  --scalable-dimension ecs:service:DesiredCount \
  --min-capacity 2 \
  --max-capacity 12 \
  --region us-east-2
```

### Checking CloudWatch alarms

```bash
aws cloudwatch describe-alarms \
  --alarm-name-prefix AIRefill \
  --state-value ALARM \
  --region us-east-2
```

### Cost monitoring

- AWS Console → **Cost Explorer** → filter by tag `Service = AIRefill`
- Monthly budget alert is configured via the Monitoring stack

---

## 9. Emergency Contacts & Escalation

| Role | Name | Contact |
|---|---|---|
| Principal Architect | Jorge Luis Contreras | *(add email / phone)* |
| AWS Support | — | [AWS Support Console](https://console.aws.amazon.com/support/home) |
| DNS Registrar | — | *(add registrar login / support contact)* |

### Common incidents

| Symptom | First step |
|---|---|
| API returning 502 | Check ECS task health: `aws ecs describe-services --cluster airefill-prod --services airefill-api-prod` |
| Database connection errors | Check Aurora cluster status; verify Secrets Manager secret value |
| Frontend down | Check App Runner service status in console |
| CI failing on ECR scan | Check ECR scan findings: `aws ecr describe-image-scan-findings --repository-name airefill-api --image-id imageTag=latest` |
| Alarms firing | Check CloudWatch dashboard: `AIRefill-Operations` |

---

*This document was generated as part of the AIRefill project handover. Keep it up to date as the infrastructure evolves.*
