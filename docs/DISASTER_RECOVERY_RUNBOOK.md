# Disaster Recovery Runbook
## Complete Infrastructure Rebuild Procedure

**Owner:** Platform Engineering Team
**Last Updated:** November 25, 2025
**Review Frequency:** Quarterly

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Recovery Objectives](#recovery-objectives)
4. [Pre-Disaster Preparation](#pre-disaster-preparation)
5. [Disaster Scenarios](#disaster-scenarios)
6. [Recovery Procedures](#recovery-procedures)
7. [Verification Steps](#verification-steps)
8. [Post-Recovery Tasks](#post-recovery-tasks)
9. [Testing Schedule](#testing-schedule)

---

## Overview

This runbook provides step-by-step procedures for recovering the AI Refill platform infrastructure in the event of a catastrophic failure. The automated workflow rebuilds the entire AWS infrastructure from code and restores data from backups.

### Recovery Strategy
**Type:** Automated Infrastructure Rebuild + Data Restoration
**Primary Tool:** GitHub Actions Workflow
**Automation Level:** 95% automated, 5% manual verification

---

## Prerequisites

### Required Access

1. **GitHub Repository Access**
   - Permissions: Write access to repository
   - Can trigger GitHub Actions workflows
   - Location: `https://github.com/<org>/airefill`

2. **AWS Console Access**
   - Account: 200937443798
   - Region: us-east-2 (Ohio)
   - Required IAM permissions:
     - CloudFormation: Full access
     - ECS: Full access
     - RDS: Full access
     - ElastiCache: Full access
     - S3: Full access
     - Secrets Manager: Full access
     - Route 53: Full access

3. **GitHub Secrets Configuration**
   Ensure these secrets are configured in GitHub repository settings:
   ```
   AWS_ACCESS_KEY_ID: <IAM user access key>
   AWS_SECRET_ACCESS_KEY: <IAM user secret key>
   ```

   To verify:
   ```bash
   # Go to: GitHub Repo → Settings → Secrets and variables → Actions
   # Required secrets:
   # - AWS_ACCESS_KEY_ID
   # - AWS_SECRET_ACCESS_KEY
   ```

### Required Backups

Before disaster occurs, ensure these backups exist:

1. **RDS Snapshots**
   - Automated snapshots: Daily (7-day retention)
   - Manual snapshots: Weekly recommended
   - Location: RDS Console → Snapshots
   - Naming: `airefill-manual-YYYY-MM-DD`

   ```bash
   # Create manual snapshot
   aws rds create-db-cluster-snapshot \
     --db-cluster-identifier infrastack-databaseb269d8bb-zozevzisykrf \
     --db-cluster-snapshot-identifier airefill-manual-$(date +%Y-%m-%d)
   ```

2. **S3 Data**
   - Backup bucket: `infrastack-mlopsartifactsbucket86136dad-49wrz4gasqrj`
   - Versioning enabled: Yes
   - Cross-region replication: Recommended (not yet implemented)

3. **Container Images**
   - ECR repositories with all image tags
   - Repositories:
     - `airefill-api`
     - `ai-refill-frontend`
     - `dagster-airefill`

4. **Infrastructure Code**
   - CDK code in Git repository
   - Branch: `main` (or disaster recovery branch)
   - All environment configurations committed

5. **Secrets Backup**
   - Export secrets from Secrets Manager (encrypted)
   - Store in secure location (1Password, LastPass, AWS Secrets Manager in different region)

   ```bash
   # Export secrets (encrypt before storing!)
   aws secretsmanager get-secret-value --secret-id airefill/api/jwt-secret
   aws secretsmanager get-secret-value --secret-id airefill/api/refresh-secret
   aws secretsmanager get-secret-value --secret-id airefill/api/cookie-secret
   aws secretsmanager get-secret-value --secret-id airefill/dagster/db_credentials
   ```

---

## Recovery Objectives

### RTO (Recovery Time Objective)
**Target:** 2-4 hours
**Breakdown:**
- Phase 1-2 (Core Infrastructure): 30 minutes
- Phase 3-4 (Data Layer): 45 minutes
- Phase 5-6 (Application Layer): 60 minutes
- Phase 7-9 (DNS, Monitoring, Verification): 45 minutes
- Phase 10 (Post-deployment): 30 minutes

### RPO (Recovery Point Objective)
**Target:** < 24 hours (can be improved to <15 minutes with DR recommendations)
**Current:**
- Database: Up to 24 hours (automated daily snapshots)
- S3 Data: Real-time (versioning enabled)
- Application state: Stateless (no data loss)

---

## Pre-Disaster Preparation

### Monthly Tasks

1. **Verify Backups**
   ```bash
   # Check latest RDS snapshot
   aws rds describe-db-cluster-snapshots \
     --db-cluster-identifier infrastack-databaseb269d8bb-zozevzisykrf \
     --query 'DBClusterSnapshots[0].[DBClusterSnapshotIdentifier,SnapshotCreateTime,Status]' \
     --output table

   # Verify S3 backup bucket
   aws s3 ls s3://infrastack-mlopsartifactsbucket86136dad-49wrz4gasqrj/ --recursive | wc -l
   ```

2. **Test Workflow Execution** (on staging environment)
   - Run DR workflow in staging
   - Verify all phases complete successfully
   - Document any issues or improvements

3. **Update Documentation**
   - Review and update this runbook
   - Update contact list
   - Document any infrastructure changes

### Quarterly Tasks

1. **Full DR Drill** (see Testing Schedule section)
2. **Review and Update RTO/RPO**
3. **Audit IAM Permissions**
4. **Test Data Restoration**

---

## Disaster Scenarios

### Scenario 1: Complete Region Failure
**Probability:** Very Low (0.01% annually)
**Impact:** Complete service outage

**Response:**
- Execute full DR workflow to alternate region (requires pre-configured DR region)
- Restore from cross-region backups
- Update Route 53 to point to DR region

**Current Gap:** DR region not yet implemented (see assessment recommendations)

### Scenario 2: Complete Account Compromise
**Probability:** Low (0.1% annually)
**Impact:** All resources potentially deleted or modified

**Response:**
- Isolate compromised account
- Execute DR workflow in clean AWS account
- Restore data from off-site backups
- Conduct security audit

### Scenario 3: Accidental Infrastructure Deletion
**Probability:** Medium (1-2% annually)
**Impact:** Partial or complete infrastructure loss

**Response:**
- Identify scope of deletion
- Execute DR workflow
- Restore affected components
- Implement additional safeguards (deletion protection, MFA)

### Scenario 4: Database Corruption
**Probability:** Medium (2-3% annually)
**Impact:** Data integrity issues, application errors

**Response:**
- Stop all write operations
- Restore RDS from latest clean snapshot
- Validate data integrity
- Resume operations

### Scenario 5: Ransomware Attack
**Probability:** Low but increasing (0.5% annually)
**Impact:** Encrypted data, service outage

**Response:**
- Do NOT pay ransom
- Isolate affected systems
- Execute DR workflow with clean backups
- Conduct forensic analysis
- Implement enhanced security controls

---

## Recovery Procedures

### Step 1: Assess the Situation

**Time Estimate:** 15-30 minutes

1. **Determine Scope of Disaster**
   ```bash
   # Check if AWS region is accessible
   aws sts get-caller-identity --region us-east-2

   # Check CloudFormation stacks
   aws cloudformation list-stacks --region us-east-2

   # Check RDS clusters
   aws rds describe-db-clusters --region us-east-2

   # Check ECS clusters
   aws ecs list-clusters --region us-east-2
   ```

2. **Identify Available Backups**
   ```bash
   # List RDS snapshots
   aws rds describe-db-cluster-snapshots \
     --query 'DBClusterSnapshots[?DBClusterIdentifier==`infrastack-databaseb269d8bb-zozevzisykrf`].[DBClusterSnapshotIdentifier,SnapshotCreateTime,Status]' \
     --output table

   # Check S3 backup bucket
   aws s3 ls s3://infrastack-mlopsartifactsbucket86136dad-49wrz4gasqrj/
   ```

3. **Notify Stakeholders**
   - Send incident notification to team
   - Update status page (if applicable)
   - Activate incident response team

4. **Document Incident**
   - Record timestamp of discovery
   - Document affected components
   - Note any error messages or symptoms

### Step 2: Initiate Recovery Workflow

**Time Estimate:** 2-4 hours (automated)

1. **Navigate to GitHub Actions**
   ```
   https://github.com/<org>/airefill/actions/workflows/disaster-recovery-rebuild.yml
   ```

2. **Trigger Workflow**
   - Click "Run workflow"
   - Select inputs:
     - **Environment:** Choose `prod`, `staging`, or `dev`
     - **Restore data:** Check ✅ (recommended)
     - **RDS snapshot ID:** Enter specific snapshot ID or leave empty for latest
       - Example: `airefill-manual-2025-11-25`
     - **Confirmation code:** Type `REBUILD`
   - Click "Run workflow"

3. **Monitor Workflow Execution**
   - Watch real-time logs in GitHub Actions UI
   - Each phase will complete sequentially
   - Estimated duration: 2-4 hours

4. **Phases Overview**
   ```
   Phase 1: Validate inputs               (1 min)
   Phase 2: Bootstrap AWS environment      (5 min)
   Phase 3: Deploy core infrastructure    (15 min)
   Phase 4: Deploy data layer             (30 min)
   Phase 5: Deploy compute layer          (10 min)
   Phase 6: Build & push containers       (20 min)
   Phase 7: Deploy application layer      (40 min)
   Phase 8: Deploy DNS & monitoring       (10 min)
   Phase 9: Restore data                  (30 min)
   Phase 10: Verify deployment            (15 min)
   Phase 11: Post-deployment tasks        (10 min)
   ```

### Step 3: Monitor Recovery Progress

**Watch for Phase Failures**

If any phase fails:

1. **Check Logs**
   - Expand failed job in GitHub Actions
   - Review error messages
   - Check AWS CloudFormation events

2. **Common Issues & Solutions**

   **Issue:** CDK Bootstrap Fails
   ```
   Solution: Manually bootstrap CDK
   cdk bootstrap aws://200937443798/us-east-2
   ```

   **Issue:** RDS Snapshot Not Found
   ```
   Solution: List available snapshots and update workflow input
   aws rds describe-db-cluster-snapshots \
     --query 'DBClusterSnapshots[].[DBClusterSnapshotIdentifier,SnapshotCreateTime]' \
     --output table
   ```

   **Issue:** Container Image Build Fails
   ```
   Solution: Check Dockerfile syntax, rebuild locally and push manually
   docker build -t airefill-api .
   aws ecr get-login-password | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-2.amazonaws.com
   docker tag airefill-api:latest <account>.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest
   docker push <account>.dkr.ecr.us-east-2.amazonaws.com/airefill-api:latest
   ```

   **Issue:** ECS Tasks Fail Health Checks
   ```
   Solution: Check CloudWatch logs for application errors
   aws logs tail /ecs/airefill-api --follow
   ```

3. **Retry Failed Phase**
   - Fix the underlying issue
   - Re-run the workflow
   - Previous successful phases will skip or update

---

## Verification Steps

### Automated Checks

The workflow automatically performs these checks (Phase 9):
- ✅ RDS cluster status
- ✅ ElastiCache status
- ✅ ECS service health
- ✅ ALB target health
- ✅ App Runner status
- ✅ API endpoint availability

### Manual Verification Checklist

#### 1. Database Verification (15 minutes)

```bash
# Connect to database
psql -h infrastack-databaseb269d8bb-zozevzisykrf.cluster-cv0g4e6yao50.us-east-2.rds.amazonaws.com \
     -U airefill_admin \
     -d airefill

# Run verification queries
SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM products;
SELECT COUNT(*) FROM orders;
SELECT MAX(created_at) FROM orders; -- Check latest data timestamp

# Verify critical tables exist
\dt

# Check for any errors
SELECT * FROM error_logs ORDER BY timestamp DESC LIMIT 10;
```

#### 2. Application Testing (30 minutes)

**API Endpoints:**
```bash
# Health check
curl https://api.airefill.app/health

# Authentication test
curl -X POST https://api.airefill.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'

# Dashboard data test
curl -H "Authorization: Bearer $TOKEN" \
  https://api.airefill.app/api/dashboards/ventas
```

**Frontend Testing:**
1. Navigate to https://airefill.app
2. Test user login
3. Verify dashboard loads
4. Check data visualization
5. Test navigation between pages

**ML Pipeline Testing:**
```bash
# Verify Dagster task definition
aws ecs list-task-definitions --family-prefix dagster

# Check recent Dagster runs (CloudWatch Logs)
aws logs tail /ecs/airefill/dagster --since 1h
```

#### 3. Data Integrity Checks (20 minutes)

**S3 Data:**
```bash
# Verify ML artifacts
aws s3 ls s3://ai-refill-ml-artifacts/models/ --recursive

# Check data pipeline bucket
aws s3 ls s3://infrastack-rawdatabucket57f26c03-umubjwuv9zzw/ --recursive
```

**Compare Record Counts:**
```sql
-- Compare against pre-disaster metrics
SELECT
  (SELECT COUNT(*) FROM users) as user_count,
  (SELECT COUNT(*) FROM products) as product_count,
  (SELECT COUNT(*) FROM orders) as order_count;

-- Expected counts (update with actual values):
-- users: ~100
-- products: ~500
-- orders: ~10000
```

#### 4. Monitoring & Alerts (10 minutes)

```bash
# Verify CloudWatch alarms
aws cloudwatch describe-alarms --alarm-name-prefix airefill

# Check SNS topic
aws sns list-subscriptions-by-topic \
  --topic-arn arn:aws:sns:us-east-2:200937443798:airefill-alarms

# Test alarm notification
aws cloudwatch set-alarm-state \
  --alarm-name airefill-test-alarm \
  --state-value ALARM \
  --state-reason "Testing DR recovery notifications"
```

**CloudWatch Dashboard:**
- Navigate to: https://console.aws.amazon.com/cloudwatch/home?region=us-east-2#dashboards:name=airefill-monitoring-overview
- Verify all widgets load
- Check for any error spikes

#### 5. Security Verification (15 minutes)

```bash
# Verify secrets exist
aws secretsmanager list-secrets --query 'SecretList[?contains(Name, `airefill`)]'

# Verify IAM roles
aws iam list-roles --query 'Roles[?contains(RoleName, `airefill`)]'

# Check security group rules
aws ec2 describe-security-groups \
  --filters "Name=group-name,Values=*airefill*" \
  --query 'SecurityGroups[*].[GroupName,GroupId]'
```

---

## Post-Recovery Tasks

### Immediate (0-2 hours after recovery)

1. **Update Status Page**
   - Mark incident as resolved
   - Provide brief summary

2. **Notify Stakeholders**
   - Send recovery completion email
   - Include verification results
   - Note any data loss or issues

3. **Monitor for Issues**
   - Watch CloudWatch alarms closely
   - Monitor application error rates
   - Check user feedback/support tickets

### Short-term (2-24 hours after recovery)

1. **Performance Optimization**
   - Monitor query performance
   - Check cache hit rates
   - Optimize slow queries if needed

2. **Data Reconciliation**
   - Compare data with backup timestamps
   - Identify any gaps in data
   - Document data loss (if any)

3. **User Communication**
   - Notify users of service restoration
   - Explain any data inconsistencies
   - Provide support for issues

### Long-term (1-7 days after recovery)

1. **Post-Incident Review**
   - Schedule team meeting (within 48 hours)
   - Document timeline of events
   - Identify root cause
   - Create action items for prevention

2. **Update Documentation**
   - Update this runbook with lessons learned
   - Document any manual steps taken
   - Update RTO/RPO based on actual results

3. **Implement Improvements**
   - Address gaps identified during recovery
   - Implement recommended DR enhancements (see assessment)
   - Schedule next DR drill

---

## Testing Schedule

### Quarterly DR Drills

**Objective:** Validate DR procedures and identify gaps

**Drill 1 (Q1): Staging Environment Full Rebuild**
- Date: First week of January, April, July, October
- Scope: Complete infrastructure rebuild in staging
- Duration: 4 hours
- Validation: All automated checks + manual verification

**Drill 2 (Q2): Database Restoration Only**
- Date: Second week of February, May, August, November
- Scope: RDS snapshot restoration
- Duration: 1 hour
- Validation: Data integrity checks

**Drill 3 (Q3): Component-Level Recovery**
- Date: Third week of March, June, September, December
- Scope: Rebuild individual components (ECS, ALB, etc.)
- Duration: 2 hours
- Validation: Service-specific health checks

### Annual Full Production DR Test

**When:** Once per year (recommended: December, during low-traffic period)
**Scope:** Full production infrastructure rebuild in DR region
**Prerequisites:**
- DR region fully configured (us-east-1)
- Cross-region replication enabled
- All stakeholders notified

**Procedure:**
1. Schedule maintenance window (4-hour window)
2. Create final backup of production
3. Execute DR workflow in alternate region
4. Validate functionality
5. Failback to primary region (or keep DR as new primary)

---

## Roles & Responsibilities

### Incident Commander
**Role:** Overall coordination
**Responsibilities:**
- Declare disaster
- Initiate DR workflow
- Coordinate team
- Communicate with stakeholders
- Make final decisions

### Technical Lead
**Role:** Execute recovery
**Responsibilities:**
- Trigger GitHub Actions workflow
- Monitor progress
- Troubleshoot failures
- Perform verification tests

### Database Administrator
**Role:** Data restoration
**Responsibilities:**
- Identify appropriate snapshot
- Verify data integrity
- Run database migrations
- Validate queries

### Application Owner
**Role:** Application validation
**Responsibilities:**
- Test application functionality
- Verify business logic
- Coordinate with users
- Sign off on recovery

### Communications Lead
**Role:** Stakeholder communication
**Responsibilities:**
- Update status page
- Notify users
- Prepare incident report
- Coordinate PR if needed

---

## Contact Information

### Emergency Contacts

**Incident Commander:**
- Name: [Your Name]
- Phone: [Phone Number]
- Email: [Email]

**Technical Lead:**
- Name: [Engineer Name]
- Phone: [Phone Number]
- Email: [Email]

**On-Call Rotation:**
- PagerDuty: [URL]
- Slack Channel: #incident-response

### Escalation Path

1. **L1:** On-call engineer (respond within 15 min)
2. **L2:** Technical lead (respond within 30 min)
3. **L3:** CTO/VP Engineering (respond within 1 hour)
4. **L4:** CEO (for business continuity decisions)

---

## Appendix

### A. Pre-Disaster Checklist

```
☐ AWS account credentials accessible
☐ GitHub repository accessible
☐ Latest RDS snapshot exists (< 24 hours old)
☐ S3 backup bucket has recent data
☐ Container images in ECR
☐ Secrets exported and stored securely
☐ CDK code up to date in Git
☐ Team members trained on DR procedures
☐ RTO/RPO documented and approved
☐ Stakeholder contact list updated
```

### B. Quick Reference Commands

**Trigger DR Workflow:**
```bash
# Via GitHub CLI
gh workflow run disaster-recovery-rebuild.yml \
  -f environment=prod \
  -f restore_data=true \
  -f rds_snapshot_id=airefill-manual-2025-11-25 \
  -f confirmation_code=REBUILD
```

**Check Infrastructure Status:**
```bash
# All CloudFormation stacks
aws cloudformation list-stacks --query 'StackSummaries[?contains(StackName, `airefill`) && StackStatus!=`DELETE_COMPLETE`].[StackName,StackStatus]' --output table

# RDS status
aws rds describe-db-clusters --query 'DBClusters[*].[DBClusterIdentifier,Status]' --output table

# ECS services
aws ecs list-services --cluster airefill-api-cluster | xargs -I {} aws ecs describe-services --cluster airefill-api-cluster --services {}
```

**Emergency Rollback:**
```bash
# If DR fails catastrophically, restore from point-in-time
aws rds restore-db-cluster-to-point-in-time \
  --db-cluster-identifier airefill-restored \
  --source-db-cluster-identifier infrastack-databaseb269d8bb-zozevzisykrf \
  --restore-to-time "2025-11-25T12:00:00Z"
```

### C. Estimated Costs

**One-time DR Rebuild:**
- GitHub Actions minutes: $0 (included in free tier)
- Data transfer (S3): $5-10
- RDS snapshot restore: $0
- Total: $5-10

**Monthly DR Infrastructure (if DR region implemented):**
- Cross-region RDS replica: $90-120/month
- S3 cross-region replication: $10-20/month
- VPC/networking: $50-70/month
- Total: $150-210/month

### D. Change Log

| Date | Version | Changes | Author |
|------|---------|---------|--------|
| 2025-11-25 | 1.0 | Initial runbook creation | Platform Team |
| | | | |
| | | | |

---

**Document Status:** ✅ Active
**Next Review Date:** February 25, 2026
**Distribution:** All engineering team members, on-call rotation
