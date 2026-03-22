# AIRefill AWS Architecture Diagram

## High-Level Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    INTERNET LAYER                                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                           │
                                           ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   ROUTE 53 DNS (DNS STACK)                               │
│  ┌────────────────────────────────────────────────────────────────────────────────┐     │
│  │  • airefill.app           → App Runner Frontend                                │     │
│  │  • www.airefill.app       → App Runner Frontend                                │     │
│  │  • api.airefill.app       → Application Load Balancer                          │     │
│  │                                                                                 │     │
│  │  Hosted Zone: Z09453142M8URXXL7FSCB                                           │     │
│  └────────────────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────────────────┘
              │                                                    │
              │ api.airefill.app                                   │ www/apex
              ↓                                                    ↓
┌──────────────────────────────────────────┐      ┌────────────────────────────────────────┐
│     APPLICATION LOAD BALANCER            │      │     AWS APP RUNNER                     │
│          (ALB STACK)                     │      │    (FRONTEND STACK)                    │
│  ┌────────────────────────────────────┐  │      │  ┌──────────────────────────────────┐  │
│  │  HTTPS Listener (Port 443)         │  │      │  │  Service: ai-refill-frontend     │  │
│  │  ACM Certificate: ****75bc0f       │  │      │  │  Port: 3000 (Next.js)            │  │
│  │                                    │  │      │  │  CPU: 1 vCPU, RAM: 2 GB          │  │
│  │  ┌──────────────────────────────┐ │  │      │  │  Image: ECR/ai-refill-frontend   │  │
│  │  │  Routing Rules:              │ │  │      │  │  Auto-deploy: Enabled            │  │
│  │  │                              │ │  │      │  │                                  │  │
│  │  │  /api/* → API Target Group  │ │  │      │  │  ENV: NEXT_PUBLIC_API_URL        │  │
│  │  │  /*     → Frontend TG       │ │  │      │  └──────────────────────────────────┘  │
│  │  └──────────────────────────────┘ │  │      │                                        │
│  │                                    │  │      │  IAM: AppRunnerServicePolicyForECR     │
│  │  Public Subnets (us-east-2a/2b)   │  │      └────────────────────────────────────────┘
│  │  Security Group: sg-0d639...      │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
              │ /api/*
              ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        AWS REGION: us-east-2 (Ohio)                                      │
│                        ACCOUNT: 200937443798                                             │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                         VPC: vpc-0aee11e693755337f (BASE STACK)                    │ │
│  │                                                                                     │ │
│  │  ┌───────────────────────────────────────────────────────────────────────────────┐ │ │
│  │  │                         AVAILABILITY ZONE: us-east-2a                          │ │ │
│  │  │                                                                                │ │ │
│  │  │  ┌─────────────────────────┐          ┌──────────────────────────────────┐    │ │ │
│  │  │  │  PUBLIC SUBNET          │          │   PRIVATE SUBNET                 │    │ │ │
│  │  │  │  subnet-061cdf6a...     │          │   subnet-0980f1831e02ca8eb       │    │ │ │
│  │  │  │                         │          │                                  │    │ │ │
│  │  │  │  • NAT Gateway          │          │  ┌────────────────────────────┐  │    │ │ │
│  │  │  │  • ALB Nodes            │          │  │  ECS FARGATE TASKS         │  │    │ │ │
│  │  │  └─────────────────────────┘          │  │  (API SERVICE STACK)       │  │    │ │ │
│  │  │                                       │  │                            │  │    │ │ │
│  │  └───────────────────────────────────────┼──│  Container: airefill-api   │──┼────┘ │ │
│  │                                          │  │  Port: 8080                │  │      │ │
│  │  ┌───────────────────────────────────────┼──│  Desired: 2 tasks          │──┼────┐ │ │
│  │  │                         AVAILABILITY ZONE: us-east-2b                  │  │    │ │ │
│  │  │                                       │  │  CPU: 512, RAM: 1024 MB    │  │    │ │ │
│  │  │  ┌─────────────────────────┐          │  │  Autoscale: 2-8 (prod)     │  │    │ │ │
│  │  │  │  PUBLIC SUBNET          │          │  │                            │  │    │ │ │
│  │  │  │  subnet-0f810705...     │          │  │  Health: /health endpoint  │  │    │ │ │
│  │  │  │                         │          │  └────────────────────────────┘  │    │ │ │
│  │  │  │  • NAT Gateway          │          │                                  │    │ │ │
│  │  │  │  • ALB Nodes            │          │  ┌────────────────────────────┐  │    │ │ │
│  │  │  └─────────────────────────┘          │  │  ECS SCHEDULED TASK        │  │    │ │ │
│  │  │                                       │  │  (DAGSTER TASK STACK)      │  │    │ │ │
│  │  └───────────────────────────────────────┼──│                            │──┼────┘ │ │
│  │                                          │  │  Container: dagster        │  │      │ │
│  │                                          │  │  Schedule: Daily 2 AM UTC  │  │      │ │
│  │                                          │  │  CPU: 2048, RAM: 4096 MB   │  │      │ │
│  │                                          │  │                            │  │      │ │
│  │                                          │  │  Purpose: ML Pipeline      │  │      │ │
│  │                                          │  └────────────────────────────┘  │      │ │
│  │                                          │   PRIVATE SUBNET                 │      │ │
│  │                                          │   subnet-0b30e605818526676       │      │ │
│  │                                          └──────────────────────────────────┘      │ │
│  │                                                                                     │ │
│  │  ┌───────────────────────────────────────────────────────────────────────────────┐ │ │
│  │  │                            VPC ENDPOINTS (BASE STACK)                          │ │ │
│  │  │                                                                                │ │ │
│  │  │  • S3 Gateway Endpoint           • Secrets Manager Interface Endpoint        │ │ │
│  │  │  • ECR API Interface Endpoint    • CloudWatch Logs Interface Endpoint        │ │ │
│  │  │  • ECR Docker Interface Endpoint                                             │ │ │
│  │  └───────────────────────────────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## ECS Cluster Details

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                   ECS CLUSTER: airefill-api-cluster (ECS CLUSTER STACK)                  │
│                                                                                          │
│  Capacity Provider: Fargate (80% Spot + 20% On-Demand in prod)                          │
│  Container Insights: Enabled                                                             │
│  ECS Exec: Enabled                                                                       │
│                                                                                          │
│  ┌─────────────────────────────────────────┐    ┌──────────────────────────────────┐    │
│  │     ECS SERVICE: airefill-api           │    │  ECS SCHEDULED TASK: dagster     │    │
│  │                                         │    │                                  │    │
│  │  Task Definition: airefill-api          │    │  Task Definition: dagster        │    │
│  │  Launch Type: Fargate                   │    │  Launch Type: Fargate            │    │
│  │                                         │    │                                  │    │
│  │  ┌───────────────────────────────────┐  │    │  EventBridge Rule:               │    │
│  │  │  Task Role (Application)          │  │    │  cron(0 2 * * ? *)              │    │
│  │  │  • S3 Access                      │  │    │                                  │    │
│  │  │  • CloudWatch Metrics             │  │    │  ┌────────────────────────────┐  │    │
│  │  │  • X-Ray Tracing                  │  │    │  │  Dagster Task Role         │  │    │
│  │  └───────────────────────────────────┘  │    │  │  • SageMaker Full Access   │  │    │
│  │                                         │    │  │  • S3 Full Access          │  │    │
│  │  ┌───────────────────────────────────┐  │    │  │  • Glue Data Catalog       │  │    │
│  │  │  Task Execution Role              │  │    │  └────────────────────────────┘  │    │
│  │  │  • ECR Image Pull                 │  │    │                                  │    │
│  │  │  • Secrets Manager Read           │  │    │  CloudWatch Logs:                │    │
│  │  │  • CloudWatch Logs Write          │  │    │  /ecs/airefill/dagster           │    │
│  │  └───────────────────────────────────┘  │    └──────────────────────────────────┘    │
│  │                                         │                                            │
│  │  CloudWatch Logs:                       │                                            │
│  │  /ecs/airefill-api                      │                                            │
│  └─────────────────────────────────────────┘                                            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DATA LAYER                                             │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                     RDS AURORA POSTGRESQL SERVERLESS V2                            │ │
│  │                          (DATABASE STACK)                                          │ │
│  │                                                                                    │ │
│  │  Cluster: infrastack-databaseb269d8bb-zozevzisykrf                                │ │
│  │  Endpoint: *.cluster-cv0g4e6yao50.us-east-2.rds.amazonaws.com                    │ │
│  │  Port: 5432                                                                       │ │
│  │  Engine: PostgreSQL 15.4                                                          │ │
│  │                                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐     │ │
│  │  │  Configuration:                                                          │     │ │
│  │  │  • Database: airefill                                                    │     │ │
│  │  │  • Master User: airefill_admin                                           │     │ │
│  │  │  • Min Capacity: 0.5 ACUs                                                │     │ │
│  │  │  • Max Capacity: 1.0 ACUs                                                │     │ │
│  │  │  • Backup Retention: 7 days (prod), 1 day (dev)                         │     │ │
│  │  │  • Deletion Protection: ENABLED ⚠️                                        │     │ │
│  │  │  • Multi-AZ: Yes (us-east-2a, us-east-2b)                               │     │ │
│  │  │  • Security Group: sg-026f643368b3d29a7                                  │     │ │
│  │  │  • Private Subnets Only                                                  │     │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘     │ │
│  │                                                                                    │ │
│  │  CloudWatch Alarms:                                                               │ │
│  │  • ServerlessDatabaseCapacity (>80%)                                              │ │
│  │  • DatabaseConnections (>80)                                                      │ │
│  │  • DeadlockDetection                                                              │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                        ELASTICACHE REDIS 7.0                                       │ │
│  │                          (CACHE STACK)                                             │ │
│  │                                                                                    │ │
│  │  Port: 6379                                                                       │ │
│  │  AUTH Token: Enabled                                                              │ │
│  │  Encryption: Transit + At-Rest (prod)                                             │ │
│  │                                                                                    │ │
│  │  ┌────────────────────────────────────────────────────────────────────────┐       │ │
│  │  │  Development:                         Production:                      │       │ │
│  │  │  • Node Type: cache.t3.micro          • Node Type: cache.r6g.large    │       │ │
│  │  │  • Topology: Single-node              • Topology: Multi-AZ Failover   │       │ │
│  │  │  • Snapshots: Disabled                • Snapshots: Daily              │       │ │
│  │  │  • Encryption: Basic                  • Encryption: Full              │       │ │
│  │  └────────────────────────────────────────────────────────────────────────┘       │ │
│  │                                                                                    │ │
│  │  Security Group: Allows ECS API SG only                                           │ │
│  │  Private Subnets Only                                                             │ │
│  │  Removal Policy: RETAIN ⚠️                                                         │ │
│  │                                                                                    │ │
│  │  CloudWatch Alarms:                                                               │ │
│  │  • DatabaseMemoryUsagePercentage (>90%)                                           │ │
│  │  • Evictions (>1000 in 5 min)                                                     │ │
│  │  • CPUUtilization (>75% prod)                                                     │ │
│  │  • ReplicationLag (>5 seconds)                                                    │ │
│  │  • CurrConnections (>80% max)                                                     │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                        S3 BUCKETS + KMS ENCRYPTION                                 │ │
│  │                          (STORAGE STACK)                                           │ │
│  │                                                                                    │ │
│  │  KMS Key: alias/{stackName}/s3 (Auto-rotation enabled)                            │ │
│  │  Block Public Access: All enabled                                                 │ │
│  │  Versioning: Enabled (critical buckets)                                           │ │
│  │  Removal Policy: RETAIN ⚠️                                                          │ │
│  │                                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐     │ │
│  │  │  1. AUDIT LOGS BUCKET                                                    │     │ │
│  │  │     infrastack-loggingbucket1e5a6f3b-sunoakwzjvoa                        │     │ │
│  │  │     Lifecycle:                                                           │     │ │
│  │  │     • 30d → Infrequent Access                                            │     │ │
│  │  │     • 90d → Glacier                                                      │     │ │
│  │  │     • 365d → Glacier Deep Archive                                        │     │ │
│  │  │     • 2555d (7yr) → Expire                                               │     │ │
│  │  │     Object Lock: Enabled (compliance)                                    │     │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘     │ │
│  │                                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐     │ │
│  │  │  2. APPLICATION LOGS BUCKET                                              │     │ │
│  │  │     infrastack-loggingbucket1e5a6f3b-sunoakwzjvoa (shared)               │     │ │
│  │  │     Lifecycle:                                                           │     │ │
│  │  │     • 30d → Infrequent Access                                            │     │ │
│  │  │     • 90d → Glacier                                                      │     │ │
│  │  │     • 365d → Expire                                                      │     │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘     │ │
│  │                                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐     │ │
│  │  │  3. ML ARTIFACTS BUCKET                                                  │     │ │
│  │  │     ai-refill-ml-artifacts                                               │     │ │
│  │  │     Purpose: Trained models, checkpoints, feature stores                 │     │ │
│  │  │     Lifecycle:                                                           │     │ │
│  │  │     • 30d → Glacier (old versions)                                       │     │ │
│  │  │     • 365d → Keep (version retention)                                    │     │ │
│  │  │     Used by: Dagster pipeline, SageMaker                                 │     │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘     │ │
│  │                                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐     │ │
│  │  │  4. DATA PIPELINE BUCKET                                                 │     │ │
│  │  │     infrastack-rawdatabucket57f26c03-umubjwuv9zzw                        │     │ │
│  │  │     Purpose: Raw data ingestion, processing, staging                     │     │ │
│  │  │     Lifecycle:                                                           │     │ │
│  │  │     • 7d → Delete (temp files)                                           │     │ │
│  │  │     • 180d → Archive (processed data)                                    │     │ │
│  │  │     • 365d → Expire (raw data)                                           │     │ │
│  │  │     Glue Catalog Integration                                             │     │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘     │ │
│  │                                                                                    │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐     │ │
│  │  │  5. BACKUPS BUCKET                                                       │     │ │
│  │  │     infrastack-mlopsartifactsbucket86136dad-49wrz4gasqrj                 │     │ │
│  │  │     Purpose: Database backups, disaster recovery                         │     │ │
│  │  │     Lifecycle:                                                           │     │ │
│  │  │     • 7d → Glacier                                                       │     │ │
│  │  │     • 30d → Glacier Deep Archive                                         │     │ │
│  │  │     • 2555d (7yr) → Retain                                               │     │ │
│  │  │     Object Lock: Enabled                                                 │     │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘     │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Security & IAM Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               SECURITY STACK                                             │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                              SECURITY GROUPS                                        │ │
│  │                                                                                     │ │
│  │  1. RDS Security Group (sg-026f643368b3d29a7)                                      │ │
│  │     Inbound: Port 5432 from ECS API Security Group                                 │ │
│  │                                                                                     │ │
│  │  2. ECS API Security Group (sg-0a8f8fa3715bfcda3)                                  │ │
│  │     Inbound: Port 8080 from ALB Security Group                                     │ │
│  │     Outbound: Port 5432 to RDS, Port 6379 to ElastiCache, HTTPS to VPC Endpoints  │ │
│  │                                                                                     │ │
│  │  3. ALB Security Group (sg-0d639ce9f632194d9)                                      │ │
│  │     Inbound: Port 443 (HTTPS) from 0.0.0.0/0, Port 80 (HTTP) from 0.0.0.0/0       │ │
│  │     Outbound: Port 8080 to ECS API Security Group                                  │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                               IAM ROLES                                             │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  1. ECS TASK EXECUTION ROLE (Imported from ECS Cluster)                  │      │ │
│  │  │     Purpose: Pull images, write logs, fetch secrets                      │      │ │
│  │  │                                                                           │      │ │
│  │  │     Permissions:                                                          │      │ │
│  │  │     • ecr:GetAuthorizationToken                                          │      │ │
│  │  │     • ecr:BatchCheckLayerAvailability, ecr:GetDownloadUrlForLayer        │      │ │
│  │  │     • ecr:BatchGetImage                                                   │      │ │
│  │  │     • secretsmanager:GetSecretValue (airefill/*)                         │      │ │
│  │  │     • logs:CreateLogStream, logs:PutLogEvents                            │      │ │
│  │  │     • kms:Decrypt (for encrypted secrets)                                │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  2. ECS TASK ROLE (Application Permissions)                              │      │ │
│  │  │     Purpose: Runtime permissions for API application                     │      │ │
│  │  │                                                                           │      │ │
│  │  │     Permissions:                                                          │      │ │
│  │  │     • s3:GetObject (ML artifacts bucket)                                 │      │ │
│  │  │     • cloudwatch:PutMetricData                                           │      │ │
│  │  │     • xray:PutTraceSegments, xray:PutTelemetryRecords                   │      │ │
│  │  │     • secretsmanager:GetSecretValue (runtime secrets)                    │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  3. DAGSTER PIPELINE ROLE (ML Workloads)                                 │      │ │
│  │  │     Purpose: ML training, data processing                                │      │ │
│  │  │                                                                           │      │ │
│  │  │     Permissions:                                                          │      │ │
│  │  │     • sagemaker:* (Full ML training access)                              │      │ │
│  │  │     • s3:* on airefill-* buckets (data pipeline)                         │      │ │
│  │  │     • glue:GetTable, glue:GetDatabase (data catalog)                     │      │ │
│  │  │     • logs:CreateLogGroup, logs:CreateLogStream, logs:PutLogEvents       │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  4. GITHUB ACTIONS DEPLOYMENT ROLE (CI/CD)                               │      │ │
│  │  │     Purpose: Deploy from GitHub Actions workflows                        │      │ │
│  │  │                                                                           │      │ │
│  │  │     Permissions:                                                          │      │ │
│  │  │     • ecr:PutImage, ecr:InitiateLayerUpload (push images)                │      │ │
│  │  │     • ecs:UpdateService, ecs:DescribeServices                            │      │ │
│  │  │     • apprunner:UpdateService (frontend deployment)                      │      │ │
│  │  │     • iam:PassRole (for ECS task/execution roles)                        │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                         AWS SECRETS MANAGER                                         │ │
│  │                                                                                     │ │
│  │  Secrets (All imported):                                                           │ │
│  │  • airefill/dagster/db_credentials    (Database master password)                   │ │
│  │  • airefill/api/jwt-secret           (JWT signing key)                            │ │
│  │  • airefill/api/refresh-secret       (Refresh token key)                          │ │
│  │  • airefill/api/cookie-secret        (Session cookie secret)                      │ │
│  │  • ElastiCache AUTH token            (Generated by CDK)                           │ │
│  │                                                                                     │ │
│  │  KMS Encryption: Customer-managed key                                              │ │
│  │  Rotation: Manual (sensitive secrets)                                              │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           KMS ENCRYPTION KEYS                                       │ │
│  │                                                                                     │ │
│  │  1. S3 Data Encryption Key: alias/{stackName}/s3                                   │ │
│  │     • Auto-rotation: Enabled                                                       │ │
│  │     • Usage: All S3 buckets (audit, app logs, ML, pipeline, backups)              │ │
│  │     • Grants: CloudWatch Logs service access                                       │ │
│  │                                                                                     │ │
│  │  2. Secrets Manager Key: (Optional customer-managed)                               │ │
│  │     • Usage: Database credentials, API secrets                                     │ │
│  │                                                                                     │ │
│  │  3. ElastiCache At-Rest Key: (Production only)                                     │ │
│  │     • Usage: Redis data encryption                                                 │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Monitoring & Observability

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              MONITORING STACK                                            │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                      CLOUDWATCH DASHBOARD                                           │ │
│  │                      Name: airefill-monitoring-overview                             │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  METRICS DISPLAYED:                                                      │      │ │
│  │  │                                                                           │      │ │
│  │  │  ECS Service:                        ALB:                                │      │ │
│  │  │  • CPU Utilization                   • Target Response Time              │      │ │
│  │  │  • Memory Utilization                • Request Count                     │      │ │
│  │  │  • Running Task Count                • HTTP 5xx Errors                   │      │ │
│  │  │  • Pending Task Count                • Active Connections                │      │ │
│  │  │                                                                           │      │ │
│  │  │  RDS Aurora:                         ElastiCache:                        │      │ │
│  │  │  • Serverless Capacity (ACUs)        • CPU Utilization                   │      │ │
│  │  │  • Database Connections              • Memory Usage %                    │      │ │
│  │  │  • Read/Write Latency                • Cache Hit Rate                    │      │ │
│  │  │  • Deadlocks                         • Evictions                         │      │ │
│  │  │                                      • Replication Lag                   │      │ │
│  │  │                                                                           │      │ │
│  │  │  S3:                                 App Runner:                         │      │ │
│  │  │  • Bucket Size                       • Request Count                     │      │ │
│  │  │  • Request Count                     • Active Instances                  │      │ │
│  │  │                                      • CPU/Memory                        │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                      CLOUDWATCH ALARMS → SNS TOPIC                                  │ │
│  │                      Topic: airefill-alarms                                         │ │
│  │                      Subscription: admin@airefill.app (Email)                       │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  ECS API SERVICE ALARMS:                                                 │      │ │
│  │  │  • High CPU Usage (>80% for 5 min)                                       │      │ │
│  │  │  • High Memory Usage (>80% for 5 min)                                    │      │ │
│  │  │  • No Running Tasks (<1 for 2 min) → CRITICAL                           │      │ │
│  │  │  • Task Launch Failures                                                  │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  ALB ALARMS:                                                             │      │ │
│  │  │  • High Response Time (>2s for 3 min)                                    │      │ │
│  │  │  • HTTP 5xx Errors (>10 in 5 min)                                        │      │ │
│  │  │  • Unhealthy Targets (>0 for 3 min)                                      │      │ │
│  │  │  • Target Connection Errors                                              │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  RDS ALARMS:                                                             │      │ │
│  │  │  • High Capacity Usage (>80% ACU for 5 min)                              │      │ │
│  │  │  • High Connection Count (>80 for 5 min)                                 │      │ │
│  │  │  • Deadlock Detected (>0)                                                │      │ │
│  │  │  • Replication Lag (>10s prod only)                                      │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  │                                                                                     │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐      │ │
│  │  │  ELASTICACHE ALARMS:                                                     │      │ │
│  │  │  • High Memory Usage (>90% for 5 min)                                    │      │ │
│  │  │  • High Eviction Rate (>1000 in 5 min)                                   │      │ │
│  │  │  • High CPU Usage (>75% prod, >85% dev)                                  │      │ │
│  │  │  • Replication Lag (>5s for 3 min)                                       │      │ │
│  │  │  • High Connection Count (>80% max for 5 min)                            │      │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘      │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │                      CLOUDWATCH LOGS                                                │ │
│  │                                                                                     │ │
│  │  Log Groups:                                                                       │ │
│  │  • /ecs/airefill-api            (API application logs, 7d retention prod)          │ │
│  │  • /ecs/airefill/dagster        (ML pipeline logs, 7d retention prod)              │ │
│  │  • /ecs/clusters/{stackName}    (ECS cluster logs, 7d retention prod)              │ │
│  │  • /aws/apprunner/*             (Frontend App Runner logs)                         │ │
│  │  • /aws/elasticloadbalancing/   (ALB access logs)                                  │ │
│  │  • VPCFlowLogs                  (Network traffic logs)                             │ │
│  │                                                                                     │ │
│  │  Insights: Enabled for ECS cluster                                                 │ │
│  │  Encryption: KMS (S3 data key has access)                                          │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              REQUEST FLOW: API CALLS                                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘

User Request (https://api.airefill.app/api/endpoint)
    │
    ↓
┌─────────────────────┐
│   Route 53 DNS      │  Resolves api.airefill.app to ALB DNS
└─────────────────────┘
    │
    ↓
┌─────────────────────┐
│   ALB (Port 443)    │  SSL Termination (ACM Certificate)
│   Public Subnets    │  Listener rule: /api/* → API Target Group
└─────────────────────┘
    │
    ↓
┌─────────────────────┐
│  ECS Fargate Task   │  Container: airefill-api (Port 8080)
│  Private Subnets    │  Task receives request
└─────────────────────┘
    │
    ├────────────────────────────────────────┐
    │                                        │
    ↓                                        ↓
┌──────────────────────┐            ┌─────────────────────┐
│   ElastiCache Redis  │            │  Aurora PostgreSQL  │
│   Port 6379          │            │  Port 5432          │
│   (Cache layer)      │            │  (Primary data)     │
└──────────────────────┘            └─────────────────────┘
    │                                        │
    └──────────────┬─────────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │  Secrets Manager    │  JWT secrets, DB credentials
         └─────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │  CloudWatch Logs    │  /ecs/airefill-api
         └─────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │  Response to User   │
         └─────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        REQUEST FLOW: FRONTEND ACCESS                                     │
└─────────────────────────────────────────────────────────────────────────────────────────┘

User Request (https://airefill.app or https://www.airefill.app)
    │
    ↓
┌─────────────────────┐
│   Route 53 DNS      │  Resolves to App Runner URL
└─────────────────────┘
    │
    ↓
┌─────────────────────┐
│   App Runner        │  Next.js application (Port 3000)
│   (Managed)         │  ENV: NEXT_PUBLIC_API_URL=https://api.airefill.app
└─────────────────────┘
    │
    ↓ (Client-side API calls)
    │
ALB → ECS API (same flow as above)

┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                        DATA FLOW: ML PIPELINE (DAGSTER)                                  │
└─────────────────────────────────────────────────────────────────────────────────────────┘

EventBridge Rule (cron: 0 2 * * ? *) → Daily at 2 AM UTC
    │
    ↓
┌─────────────────────┐
│  ECS Scheduled Task │  Dagster container (CPU: 2048, RAM: 4096)
│  Private Subnets    │
└─────────────────────┘
    │
    ├──────────────────────────────────────────┐
    │                                          │
    ↓                                          ↓
┌──────────────────────┐              ┌─────────────────────┐
│  Aurora PostgreSQL   │              │  S3 Data Pipeline   │
│  (Read data)         │              │  (Raw data source)  │
└──────────────────────┘              └─────────────────────┘
    │                                          │
    └──────────────┬───────────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │  SageMaker Training │  ML model training
         └─────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │  S3 ML Artifacts    │  Store trained models
         │  ai-refill-ml-...   │  Feature stores, checkpoints
         └─────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │  CloudWatch Logs    │  /ecs/airefill/dagster
         └─────────────────────┘
                   │
                   ↓
         ┌─────────────────────┐
         │  Glue Data Catalog  │  Metadata registration
         └─────────────────────┘
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           CI/CD DEPLOYMENT FLOW                                          │
└─────────────────────────────────────────────────────────────────────────────────────────┘

GitHub Repository (main branch push/PR merge)
    │
    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              GITHUB ACTIONS WORKFLOW                                     │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Step 1: Build & Push Container Images                                             │ │
│  │                                                                                     │ │
│  │  Build API:                              Build Frontend:                           │ │
│  │  • docker build -t api .                 • docker build -t frontend .              │ │
│  │  • docker tag → ECR                      • docker tag → ECR                        │ │
│  │  • docker push to ECR                    • docker push to ECR                      │ │
│  │    airefill-api:latest                     ai-refill-frontend:latest               │ │
│  │                                                                                     │ │
│  │  Build Dagster:                                                                    │ │
│  │  • docker build -t dagster .                                                       │ │
│  │  • docker tag → ECR                                                                │ │
│  │  • docker push to ECR                                                              │ │
│  │    dagster-airefill:latest                                                         │ │
│  │                                                                                     │ │
│  │  IAM Role: GitHub Actions Deployment Role                                          │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Step 2: Deploy Services                                                            │ │
│  │                                                                                     │ │
│  │  API Deployment:                         Frontend Deployment:                      │ │
│  │  • aws ecs update-service                • aws apprunner update-service            │ │
│  │    --cluster airefill-api-cluster                                                  │ │
│  │    --service airefill-api-service                                                  │ │
│  │    --force-new-deployment                                                          │ │
│  │                                                                                     │ │
│  │  Dagster Update:                                                                   │ │
│  │  • Task definition auto-updates                                                    │ │
│  │    (next scheduled run uses new image)                                             │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  Step 3: Health Checks & Rollback                                                  │ │
│  │                                                                                     │ │
│  │  • ECS monitors target health (/health endpoint)                                   │ │
│  │  • If unhealthy > 3 consecutive checks → rollback                                  │ │
│  │  • CloudWatch alarms trigger on deployment failures                                │ │
│  │  • SNS notification to admin@airefill.app                                          │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
    │
    ↓
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              DEPLOYED INFRASTRUCTURE                                     │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  ECR Repositories:                                                                  │ │
│  │  • airefill-api              (API backend container)                                │ │
│  │  • ai-refill-frontend        (Next.js frontend container)                           │ │
│  │  • dagster-airefill          (ML pipeline container)                                │ │
│  │                                                                                     │ │
│  │  Image Scanning: Enabled (vulnerability detection)                                 │ │
│  │  Lifecycle Policy: Keep last 10 images, expire untagged after 7 days               │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  ECS Service Deployment:                                                            │ │
│  │  • Rolling update (25% at a time)                                                   │ │
│  │  • Desired: 2, Min healthy: 100%, Max: 200%                                        │ │
│  │  • Circuit breaker: Enabled (auto-rollback on failure)                             │ │
│  │  • Deployment timeout: 30 minutes                                                  │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  App Runner Deployment:                                                             │ │
│  │  • Automatic deployment on ECR image push                                           │ │
│  │  • Zero-downtime blue/green deployment                                              │ │
│  │  • Health check: TCP port 3000                                                     │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Cost Optimization Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           COST OPTIMIZATION FEATURES                                     │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  1. COMPUTE OPTIMIZATION                                                            │ │
│  │                                                                                     │ │
│  │  • ECS Fargate Spot (80% prod, 100% dev)    → ~70% compute cost savings            │ │
│  │  • Aurora Serverless v2 (scales to 0.5 ACU) → Pay only for actual usage            │ │
│  │  • App Runner autoscaling                   → Scale down during low traffic        │ │
│  │  • ElastiCache t3.micro (dev)               → Minimal cost for development         │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  2. STORAGE OPTIMIZATION                                                            │ │
│  │                                                                                     │ │
│  │  • S3 Lifecycle Policies:                                                          │ │
│  │    - 30d → Infrequent Access (40% cheaper)                                         │ │
│  │    - 90d → Glacier (85% cheaper)                                                   │ │
│  │    - 365d → Deep Archive (95% cheaper)                                             │ │
│  │                                                                                     │ │
│  │  • VPC S3 Gateway Endpoint                  → Free data transfer                   │ │
│  │  • ECS pulls via VPC Endpoints              → No NAT Gateway charges               │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  3. NETWORK OPTIMIZATION                                                            │ │
│  │                                                                                     │ │
│  │  • Private subnets for ECS                  → Reduced NAT charges                  │ │
│  │  • VPC Endpoints (ECR, Secrets, Logs)       → No internet gateway fees             │ │
│  │  • ALB in public subnets only               → Minimize cross-AZ data transfer      │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  4. MONITORING OPTIMIZATION                                                         │ │
│  │                                                                                     │ │
│  │  • Log retention: 7d (prod), 3d (dev)       → Reduce CloudWatch costs              │ │
│  │  • Container Insights: Prod only            → Minimize metric collection           │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐ │
│  │  ESTIMATED MONTHLY COSTS (Production):                                              │ │
│  │                                                                                     │ │
│  │  • ECS Fargate (2-8 tasks, 80% spot)        → $30-120/mo                           │ │
│  │  • Aurora Serverless v2 (0.5-1.0 ACU)       → $45-90/mo                            │ │
│  │  • ElastiCache r6g.large                    → $115/mo                              │ │
│  │  • ALB                                      → $20/mo                               │ │
│  │  • App Runner                               → $25-50/mo                            │ │
│  │  • S3 + Data Transfer                       → $10-30/mo                            │ │
│  │  • NAT Gateway                              → $32/mo                               │ │
│  │  • VPC Endpoints                            → $15/mo                               │ │
│  │  • CloudWatch                               → $10-20/mo                            │ │
│  │  • Route 53                                 → $1/mo                                │ │
│  │                                                                                     │ │
│  │  TOTAL ESTIMATED: $303-493/mo (varies with traffic)                                │ │
│  └────────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Legend

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  SYMBOLS & NOTATION                                                                      │
│                                                                                          │
│  → ↓ ←   Data flow direction                                                            │
│  ⚠️       Critical configuration (deletion protection, retention policies)               │
│  sg-*     Security Group ID                                                              │
│  vpc-*    VPC ID                                                                         │
│  subnet-* Subnet ID                                                                      │
│  ACU      Aurora Capacity Unit (serverless compute unit)                                 │
│  vCPU     Virtual CPU                                                                    │
│  ECR      Elastic Container Registry                                                     │
│  ECS      Elastic Container Service                                                      │
│  ALB      Application Load Balancer                                                      │
│  ACM      AWS Certificate Manager                                                        │
│  KMS      Key Management Service                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

**Document Generated:** 2025-11-25
**Infrastructure Version:** CDK 2.219.0
**AWS Account:** 200937443798
**Region:** us-east-2 (Ohio)
