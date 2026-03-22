# 🚨 DISASTER RECOVERY - QUICK REFERENCE CARD

**Print this page and keep it accessible**

---

## EMERGENCY: Infrastructure Destroyed

### Step 1: Access GitHub (2 minutes)
```
URL: https://github.com/<org>/airefill/actions/workflows/disaster-recovery-rebuild.yml
```

### Step 2: Run Workflow (1 minute)
1. Click **"Run workflow"** button
2. Fill inputs:
   - **Environment:** `prod` (or `staging`/`dev`)
   - **Restore data:** ✅ Check this box
   - **RDS snapshot ID:** Leave empty (uses latest) OR specify: `airefill-manual-YYYY-MM-DD`
   - **Confirmation:** Type `REBUILD`
3. Click **"Run workflow"** button

### Step 3: Wait (2-4 hours)
- Workflow runs automatically
- Monitor progress in GitHub Actions
- ☕ Coffee time - system rebuilds itself

### Step 4: Verify (30 minutes)
```bash
# Test API
curl https://api.airefill.app/health

# Test frontend
open https://airefill.app
```

---

## What Gets Restored?

| Component | Restored? | Time | Notes |
|-----------|-----------|------|-------|
| VPC & Network | ✅ | 5 min | Imported (pre-existing) |
| Security Groups | ✅ | 5 min | Recreated from code |
| RDS Database | ✅ | 30 min | From snapshot (daily) |
| ElastiCache | ✅ | 15 min | New (cache rebuilds naturally) |
| S3 Data | ✅ | 15 min | From backup bucket |
| ECS Services | ✅ | 40 min | Rebuilt and deployed |
| Container Images | ✅ | 20 min | Rebuilt from code |
| ALB | ✅ | 10 min | Recreated |
| Route 53 DNS | ✅ | 10 min | Recreated |
| CloudWatch | ✅ | 10 min | Dashboards & alarms |

---

## Recovery Time

- **RTO (Recovery Time Objective):** 2-4 hours
- **RPO (Recovery Point Objective):** Up to 24 hours (daily snapshots)

---

## If Workflow Fails

### Check AWS Status
```bash
aws sts get-caller-identity --region us-east-2
```
✅ Works? AWS credentials OK
❌ Fails? Check AWS keys in GitHub Secrets

### Check Recent Snapshot
```bash
aws rds describe-db-cluster-snapshots \
  --db-cluster-identifier infrastack-databaseb269d8bb-zozevzisykrf \
  --query 'DBClusterSnapshots[0].[DBClusterSnapshotIdentifier,SnapshotCreateTime]'
```

### Common Issues

| Error | Solution |
|-------|----------|
| "CDK bootstrap failed" | Run: `cdk bootstrap aws://200937443798/us-east-2` |
| "Snapshot not found" | Specify snapshot ID in workflow input |
| "Container build failed" | Check Dockerfile, rebuild locally |
| "Health check failed" | Check CloudWatch logs: `/ecs/airefill-api` |

---

## Emergency Contacts

**On-Call:** [PagerDuty URL or Phone]
**Slack:** `#incident-response`
**Email:** `platform-team@company.com`

---

## Manual Snapshot Creation (Pre-Disaster)

Run monthly:
```bash
aws rds create-db-cluster-snapshot \
  --db-cluster-identifier infrastack-databaseb269d8bb-zozevzisykrf \
  --db-cluster-snapshot-identifier airefill-manual-$(date +%Y-%m-%d)
```

---

## Verification Checklist

After recovery completes:

```
☐ API health check returns 200: curl https://api.airefill.app/health
☐ Frontend loads: https://airefill.app
☐ User can login
☐ Database has data: SELECT COUNT(*) FROM users;
☐ CloudWatch dashboard shows metrics
☐ No alarms firing
☐ DNS resolves correctly: nslookup api.airefill.app
```

---

## Data Loss Estimate

**Daily Snapshots:**
- Worst case: Up to 24 hours of data
- Typical case: 12 hours of data

**How to minimize:**
1. Enable Point-in-Time Recovery (not yet implemented)
2. Cross-region replication (not yet implemented)
3. More frequent snapshots

---

## Post-Recovery Actions

**Immediate (0-2 hours):**
1. ☐ Notify users via email/status page
2. ☐ Monitor CloudWatch for anomalies
3. ☐ Check support tickets for user issues

**Short-term (24 hours):**
1. ☐ Schedule post-incident review
2. ☐ Document timeline
3. ☐ Update this runbook with lessons learned

**Long-term (1 week):**
1. ☐ Implement improvements
2. ☐ Schedule next DR drill
3. ☐ Update RTO/RPO based on actual performance

---

## Key Files

**Workflow:** `.github/workflows/disaster-recovery-rebuild.yml`
**Runbook:** `docs/DISASTER_RECOVERY_RUNBOOK.md`
**Assessment:** `docs/AWS_INFRASTRUCTURE_ASSESSMENT.md`

---

## What NOT to Do

❌ **DO NOT** delete existing resources unless absolutely necessary
❌ **DO NOT** pay ransomware demands
❌ **DO NOT** restore to wrong environment (dev/staging/prod)
❌ **DO NOT** skip verification steps
❌ **DO NOT** rush - follow checklist

---

## Cost of Recovery

**One-time rebuild:** ~$5-10 (data transfer)
**Time cost:** 2-4 hours automated + 1 hour manual verification
**Business impact:** Service downtime during recovery

---

## Prevention > Recovery

**Monthly:**
- ✅ Verify backups exist
- ✅ Test workflow in staging
- ✅ Review and update contacts

**Quarterly:**
- ✅ Full DR drill
- ✅ Review RTO/RPO
- ✅ Update documentation

**Annually:**
- ✅ Production DR test
- ✅ Implement DR improvements
- ✅ Train new team members

---

**Last Updated:** November 25, 2025
**Version:** 1.0
**Keep this document accessible during emergencies**
