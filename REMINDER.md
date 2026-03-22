# Reminders

## Rotate Redis Cloud credential

The root `.env` file (now deleted) contained a Redis Cloud password in plain text:

```
REDIS_HOST=redis-19623.c309.us-east-2-1.ec2.redns.redis-cloud.com
REDIS_PORT=19623
REDIS_PASSWORD=J7BFmFhezNXhH9BLp6cL54vsvtcQDBYd
```

This was for the old pre-ECS infrastructure. Even though that Redis Cloud instance is
decommissioned, rotate or invalidate this credential if it is reused anywhere.

## Run database seed after first deploy

After `prisma migrate deploy` creates the schema, seed roles, permissions, and the default admin user:

```bash
cd api-node
DATABASE_URL="postgresql://..." npx prisma db seed
```

Default credentials: `admin` / `ChangeMe123!` — **change the password immediately after first login.**

## Delete stale GitHub Actions secrets

The DR workflow now uses OIDC (`AiRefillGitHubActionsRole`) — long-lived key secrets
are no longer referenced anywhere. Delete them from the repo:

GitHub → Settings → Secrets and variables → Actions → delete:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`

## Enable IAM Identity Center before deploying identity-center stack

The `AIRefill-prod-identity-center` CDK stack requires IAM Identity Center (SSO) to be
manually enabled in the AWS Console **before** running `cdk deploy`.

Steps:
1. AWS Console → IAM Identity Center → **Enable**
2. Copy the **Instance ARN** (`arn:aws:sso:::instance/ssoins-XXXXXXXXXXXXXXXX`)
3. Deploy the stack once:
   ```bash
   cd infra_cdk
   cdk deploy AIRefill-prod-identity-center \
     -c env=prod \
     -c ssoInstanceArn=arn:aws:sso:::instance/ssoins-XXXXXXXXXXXXXXXX
   ```
4. In IAM Identity Center → Users → **create human operator accounts** (no more IAM users)
5. Assign the `PrincipalArchitect` permission set to admin users, `AIRefillReadOnly` to observers
6. Distribute sign-in URL: `https://<your-sso-portal>.awsapps.com/start`

This stack is intentionally excluded from `cdk deploy --all` — it is a one-time manual step.

## Deploy AWS Organizations stack (OUs + SCPs)

The org-level CDK app (`bin/org.ts`) runs from the **InnovationWizard management account**
(`524390297512`) and targets `us-east-1` (Organizations API region).

Prerequisites (one-time, from the management account):
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

Deploy:
```bash
cd infra_cdk
AWS_PROFILE=<management-account-profile> \
  npx cdk --app 'npx ts-node bin/org.ts' deploy --all
```

After deploy — move the AI-Refill account into the Prod OU:
```bash
# Copy ProdOuId from the stack outputs, then:
aws organizations move-account \
  --account-id 200937443798 \
  --source-parent-id r-etp3 \
  --destination-parent-id <ProdOuId> \
  --region us-east-1
```

SCPs (DenyRootUser, DenyDisableCloudTrail, RequireHTTPS, DenyLeaveOrg, DenyDisableGuardDuty)
activate automatically once the account is in the Workloads OU.

---

## Session Summary — 2026-02-24: Organizations, CDK Pre-deploy Validation, Bug Fixes

### What was accomplished

1. **Fixed `environments.ts` prod `backupRetentionDays`**: Changed from `7` to `30` (was overriding the constant we set last session).

2. **Updated `REMINDER.md`** with:
   - IAM Identity Center pre-requisite steps (6-step procedure)
   - AWS Organizations deploy instructions (prerequisites + deploy + move-account command)

3. **Created `HANDOVER.md`** — comprehensive 9-section handover document:
   - Architecture at a Glance
   - AWS Organizations Structure (ASCII account hierarchy + SCP table + deploy instructions)
   - CDK Infrastructure Stack Map (all 12 stacks, their dependencies, deploy order)
   - Credentials Vault (root account, Secrets Manager, DB, seed admin, GitHub, DNS)
   - First-Deploy Runbook (bootstrap → ECR → Docker → CDK → migrate → seed)
   - IAM Identity Center Setup
   - Day-One Checklist (12 checkbox items)
   - Ongoing Operations
   - Emergency Contacts & Escalation

4. **Added AWS Organizations CDK infrastructure**:
   - New file: `infra_cdk/lib/org/organization-stack.ts` — OUs + 5 SCPs
   - New file: `infra_cdk/bin/org.ts` — management account entry point (`524390297512`, `us-east-1`)
   - Updated `HANDOVER.md` §2 with org structure

5. **Pre-deploy validation**: `tsc --noEmit` → `cdk synth --all` — caught and fixed two real bugs before touching AWS.

---

### Bugs fixed

#### Bug 1: `CfnPolicyAttachment` does not exist in the installed CDK version

- **Error**: TypeScript compilation failed — `organizations.CfnPolicyAttachment` is not available in the CDK version installed.
- **Available constructs** (verified via `node -e "console.log(Object.keys(require('aws-cdk-lib/aws-organizations')).filter(k => k.startsWith('Cfn')))"`):
  `CfnAccount`, `CfnOrganization`, `CfnOrganizationalUnit`, `CfnPolicy`, `CfnResourcePolicy`
- **Fix**: `CfnPolicy` has a `targetIds: string[]` prop — attach SCP directly on the policy object, no separate attachment resource needed. Removed all `CfnPolicyAttachment` blocks and dropped unused `const` variable assignments for each policy.

```typescript
// WRONG (CfnPolicyAttachment doesn't exist):
const denyRootPolicy = new organizations.CfnPolicy(this, 'DenyRootUserPolicy', { ... });
new organizations.CfnPolicyAttachment(this, 'DenyRootAttachment', {
  policyId: denyRootPolicy.attrId, targetId: this.workloadsOu.attrId,
});

// CORRECT (targetIds inline on CfnPolicy):
new organizations.CfnPolicy(this, 'DenyRootUserPolicy', {
  name: 'AIRefill-DenyRootUserActions',
  type: 'SERVICE_CONTROL_POLICY',
  targetIds: [this.workloadsOu.attrId],  // attachment is inline
  content: JSON.stringify({ ... }),
});
```

#### Bug 2: Cyclic dependency between `AIRefill-prod-ecs-cluster` ↔ `AIRefill-prod-api-service`

- **Error**: `cdk synth` failed with:
  `Adding this dependency (AIRefill-prod-ecs-cluster -> AIRefill-prod-api-service/ApiLogGroup/Resource.Arn) would create a cyclic reference`
- **Root cause**: In `api-service-stack.ts`, passing a CDK `LogGroup` object to `ecs.LogDrivers.awsLogs({ logGroup: this.logGroup })` triggers an automatic `grantWrite` call. That auto-grant adds an IAM policy statement to `ecsClusterStack.taskExecutionRole` (which lives in `ecs-cluster-stack`) with `Resource = this.logGroup.logGroupArn` — a CloudFormation cross-stack token from `api-service-stack`. This makes `ecs-cluster-stack` depend on `api-service-stack`, creating the cycle.
- **Fix**: Use `logs.LogGroup.fromLogGroupName()` instead. This produces a static ARN string — no CloudFormation export/import, no cross-stack dependency. The execution role already has an `/ecs/*` wildcard grant.

```typescript
// BEFORE (causes cyclic dependency):
logging: ecs.LogDrivers.awsLogs({
  streamPrefix: 'api',
  logGroup: this.logGroup,  // CDK object → auto grantWrite → cross-stack token → CYCLE
}),

// AFTER (no cycle):
logging: ecs.LogDrivers.awsLogs({
  streamPrefix: 'api',
  // fromLogGroupName produces static ARN — no CloudFormation export/import, no cycle.
  // The execution role already has /ecs/* wildcard in ecs-cluster-stack.
  logGroup: logs.LogGroup.fromLogGroupName(this, 'ApiLogGroupRef', '/ecs/airefill-api'),
}),
```

---

### Credentials needed for deployment

#### Verify current identity
```bash
aws sts get-caller-identity
```

#### Deploy 1 — Workload stacks (`bin/airefill-cdk.ts`) → account `200937443798` (AI-Refill), region `us-east-2`

Get credentials for the AI-Refill account via one of:
- **IAM user**: AWS Console (`200937443798`) → IAM → Users → create user → Security credentials → Create access key
- **Cross-account role assumption**: From management account, assume `OrganizationAccountAccessRole` in `200937443798`
  ```bash
  aws sts assume-role \
    --role-arn arn:aws:iam::200937443798:role/OrganizationAccountAccessRole \
    --role-session-name airefill-deploy \
    --region us-east-1
  # Export the returned AccessKeyId / SecretAccessKey / SessionToken as env vars
  ```
- **SSO** (once Identity Center is set up): `aws sso login --profile airefill-prod`

Configure as a named profile in `~/.aws/credentials`:
```ini
[profile airefill-prod]
aws_access_key_id     = AKIA...
aws_secret_access_key = ...
region                = us-east-2
```

One-time CDK bootstrap (if not done):
```bash
AWS_PROFILE=airefill-prod npx cdk bootstrap aws://200937443798/us-east-2
```

Deploy all workload stacks:
```bash
cd infra_cdk
AWS_PROFILE=airefill-prod npx cdk deploy --all -c env=prod --require-approval never
```

Post-deploy: run database migrations and seed:
```bash
# Get DATABASE_URL from Secrets Manager (airefill/prod/database-url)
aws secretsmanager get-secret-value \
  --secret-id airefill/prod/database-url \
  --query SecretString --output text \
  --profile airefill-prod

cd api-node
DATABASE_URL="<value-from-above>" npx prisma migrate deploy
DATABASE_URL="<value-from-above>" npx prisma db seed
# Default login: admin / ChangeMe123! — CHANGE IMMEDIATELY
```

#### Deploy 2 — Org stack (`bin/org.ts`) → account `524390297512` (InnovationWizard management), region `us-east-1`

Already authenticated as `Filomena_Cli` in this account. Prerequisites (one-time):
```bash
# Enable All Features (required for SCPs)
aws organizations enable-all-features --region us-east-1

# Enable SCP policy type on the Root
aws organizations enable-policy-type \
  --root-id r-etp3 \
  --policy-type SERVICE_CONTROL_POLICY \
  --region us-east-1

# Bootstrap CDK in management account
npx cdk bootstrap aws://524390297512/us-east-1
```

Deploy:
```bash
cd infra_cdk
AWS_PROFILE=<innovationwizard-profile> \
  npx cdk --app 'npx ts-node bin/org.ts' deploy --all
```

Post-deploy — move AI-Refill account into the Prod OU:
```bash
# Get ProdOuId from the stack outputs, then:
aws organizations move-account \
  --account-id 200937443798 \
  --source-parent-id r-etp3 \
  --destination-parent-id <ProdOuId-from-output> \
  --region us-east-1
```

SCPs (DenyRootUser, DenyDisableCloudTrail, RequireHTTPS, DenyLeaveOrg, DenyDisableGuardDuty)
activate automatically once the account is in the Workloads OU.

---

### Key architectural decisions made this session

- `HANDOVER.md` is NOT gitignored — private repo, no new secrets beyond what already exists in code.
- Organizations scope: just OUs + SCPs (no new accounts created), separate `bin/org.ts` app.
- AWS Organizations API is a global service — always target `us-east-1` regardless of workload region.
- CDK pattern: never pass CDK `LogGroup` objects to `awsLogs()` when the log group is in a different stack than the IAM role — always use `fromLogGroupName()` to avoid auto-grant cyclic dependencies.

---

## Deploy strategy: two-wave required (Docker images blocker)

`cdk deploy --all` will fail midway on a first deploy because two stacks require Docker images
to exist in ECR before CloudFormation can complete them:

| Stack | Why it fails without an image |
|---|---|
| `AIRefill-prod-api-service` | ECS Fargate **service** — CloudFormation waits for tasks to reach RUNNING. No image → tasks fail → stack rolls back. |
| `AIRefill-prod-frontend` | App Runner — service creation fails if `latest` tag doesn't exist in ECR. `AIRefill-prod-dns` cascades from this. |

`AIRefill-prod-dagster` is safe — it's a task definition + Lambda + EventBridge, not a running service.

### Wave 1 — pure infrastructure (no images needed)
```bash
cd infra_cdk
AWS_PROFILE=airefill-prod npx cdk deploy \
  AIRefill-prod-ecr \
  AIRefill-prod-network \
  AIRefill-prod-security \
  AIRefill-prod-database \
  AIRefill-prod-cache \
  AIRefill-prod-storage \
  AIRefill-prod-ecs-cluster \
  AIRefill-prod-alb \
  AIRefill-prod-dagster \
  -c env=prod
```

### Push images (after Wave 1 ECR stack is deployed)
```bash
aws ecr get-login-password --region us-east-2 --profile airefill-prod \
  | docker login --username AWS --password-stdin 200937443798.dkr.ecr.us-east-2.amazonaws.com

docker build -t 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest ./api-node
docker push 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest

docker build -t 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-frontend:latest ./frontend
docker push 200937443798.dkr.ecr.us-east-2.amazonaws.com/airefill-frontend:latest
```

### Wave 2 — service stacks (need images)
```bash
AWS_PROFILE=airefill-prod npx cdk deploy \
  AIRefill-prod-api-service \
  AIRefill-prod-frontend \
  AIRefill-prod-dns \
  AIRefill-prod-monitoring \
  -c env=prod
```

### Post Wave 2 — migrate and seed
```bash
# Get DATABASE_URL from Secrets Manager
aws secretsmanager get-secret-value \
  --secret-id airefill/prod/database-url \
  --query SecretString --output text \
  --profile airefill-prod

cd api-node
DATABASE_URL="<value-from-above>" npx prisma migrate deploy
DATABASE_URL="<value-from-above>" npx prisma db seed
# Default login: admin / ChangeMe123! — CHANGE IMMEDIATELY
```

---

<!-- ✋ INSERT NEW REMINDERS ABOVE THIS LINE — keep the two backlog items below last -->

## BACKLOG: Test coverage (~0%)

The only test file in the entire codebase is `frontend/src/components/ui/__tests__/button.test.tsx`.
No API route tests, no auth tests, no integration tests exist.

Priority areas:
- `api-node/src/routes/auth.ts` — login, logout, refresh, verify
- `api-node/src/middleware/auth.ts` — JWT verification, permission checks
- `api-node/src/routes/compras.ts`, `finanzas.ts`, `bi/` — happy path + auth guard

Run: `cd api-node && npm test -- --coverage`

## BACKLOG: CDK snapshot tests

No CDK assertion or snapshot tests exist in `infra_cdk/`. Infrastructure changes are only
caught by `cdk diff` — there is no automated regression test for the 12 stacks.

Starting point:
```typescript
// infra_cdk/test/security-stack.test.ts
import { Template } from 'aws-cdk-lib/assertions';
// assert security groups, OIDC provider, secrets exist
```

Run: `cd infra_cdk && npm test`
