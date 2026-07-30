# AIR 3.0 — Delivery & Architecture Plan

**Date:** June 30, 2026
**Author:** Jorge Luis Contreras Herrera — AI Director
**Client:** Plasticentro / Suplicentro
**Status:** Active — First payment received. Shipping in progress.

---

> ### 📌 AMENDMENT 2026-07-01 — architecture + delivery superseded below
>
> Per this document's own rule ("all changes to scope, timeline, or architecture are amendments to this document"), the following sections are **superseded** by the reconciled Phase-2 plan in [TECH_DEBT_REMEDIATION_PLAN.md](./TECH_DEBT_REMEDIATION_PLAN.md) → "Phase 2 — Full AWS Migration" and tracked in [TECH_DEBT_PROGRESS.md](./TECH_DEBT_PROGRESS.md):
>
> - **§1 (Split-Plane) → literal two-account AWS split-plane.** Client account (`plasticentro`): frontend App Runner + **Aurora Serverless v2** + Secrets Manager (their card, they pay directly). Jorge's account: ML API App Runner + S3 weights + Lambda/EventBridge training + ECR/CloudWatch/SES. Cross-account deploy IAM; moats (Census Filter + weights) never enter the client account.
> - **§1 "keep Supabase for now" + "keep Vercel" → reversed.** Migrating to **Aurora** (DB), **WorkOS** (auth), and **App Runner** (frontend). §7's "Aurora migration NOT included" no longer holds.
> - **§5 billing → client pays their own AWS bill directly** (no $500-budget invoicing); Jorge absorbs the ML plane into SaaS margin. The escrow/IP framing simplifies — the client account holds **zero moats** by construction.
> - **M0 decisions locked (2026-07-01):** data access = direct-Postgres DAL rewrite; authz = defense-in-depth DB-enforced tenant/role isolation (least-privilege, real RLS); cutover = blue-green short-freeze with checksum + golden-backtest parity gates.
> - **Tech-debt remediation (§3) → DONE** (all 6 batches shipped; see the tracker). **Phase-2 hardening H1 (test coverage) → DONE & committed** (`721de37`).
>
> The prose below is retained as the original record of intent; where it conflicts with this amendment, the amendment governs.

## 1. Architecture Decision: Split-Plane SaaS

Air 3.0 operates as two independent planes connected by API.

```
┌─────────────────────────────────────────────────────┐
│  DATA PLANE (Client Infrastructure)                 │
│                                                     │
│  ┌──────────┐   ┌───────────┐   ┌───────────────┐  │
│  │ Next.js  │   │ Supabase  │   │  Odoo v15/19  │  │
│  │ Frontend │◄─►│ Auth + DB │   │  (data source)│  │
│  │ (Vercel) │   │ (Postgres)│   └───────┬───────┘  │
│  └────┬─────┘   └───────────┘           │          │
│       │                                  │          │
│       │  Budget: ~$500/month             │          │
│       │  Owner: Jorge's AWS              │          │
│       │  Billing: invoiced to client     │          │
└───────┼──────────────────────────────────┼──────────┘
        │ HTTPS (predictions, forecasts)   │ ETL sync
        ▼                                  ▼
┌─────────────────────────────────────────────────────┐
│  ML PLANE (Jorge's SaaS Infrastructure)             │
│                                                     │
│  ┌──────────────┐  ┌─────────────┐  ┌───────────┐  │
│  │  ML API       │  │  S3 Bucket  │  │  Training │  │
│  │  (App Runner) │  │  (Weights)  │  │  Pipeline │  │
│  │              │◄─┤             │◄─┤  (Batch)  │  │
│  │  Census      │  │  Serialized │  │  Prophet + │  │
│  │  Filter      │  │  Prophet    │  │  Derived   │  │
│  │  Logic       │  │  models per │  │  Ratios    │  │
│  │              │  │  tenant +   │  │           │  │
│  └──────────────┘  │  SKU        │  └───────────┘  │
│                     └─────────────┘                  │
│  Owner: Jorge (permanent)                            │
│  Cost: absorbed into SaaS margin                     │
│  Moats: Census Filter (logic) + Weights (data)       │
└─────────────────────────────────────────────────────┘
```

### Why Split-Plane

The Census Filter algorithm and the trained model weights are the two defensible moats. The Census Filter is IP embedded in code. The weights are IP embedded in data — 18+ months of demand patterns, seasonal corrections, and outlier exclusions baked into serialized model artifacts. Neither ever touches the client's infrastructure.

The client's data (SKUs, sales, purchase orders, Odoo sync) stays in their plane. Predictions are served via API. If the client relationship ends, they keep the frontend and their data. They lose access to the prediction API. The moats remain.

### Bus Factor Mitigation

Software escrow agreement — NOT architectural surrender. Source code deposited with a neutral third party. Release conditions: death, incapacitation, dissolution without successor. While Jorge is alive, they never see the code. This gives them MORE protection than owning the infra (they'd also get the source to maintain it), while preserving IP control.

---

## 2. Weight Persistence Design

### Current State (Problem)

Prophet retrains from ~967K raw stock moves on every prediction request. This means:

- Every query waits for a full training cycle (minutes, not milliseconds)
- Compute cost scales linearly with query volume
- No accumulated learning — each run is stateless
- No second moat — nothing to protect beyond the algorithm itself

### Target State

```
TRAINING (scheduled, weekly or nightly)
  │
  │  1. Pull latest data from Supabase (revenue_daily_for_ml)
  │  2. Apply Census Filter (exclude censored periods)
  │  3. Fit Prophet on sales data
  │  4. Compute derived ratios for purchase metrics
  │  5. Apply Tukey fence for outlier exclusion
  │  6. Serialize fitted models + ratio tables
  │  7. Upload to S3: s3://air3-weights/{tenant_id}/{sku}/{version}/
  │
  ▼
SERVING (on-demand, per request)
  │
  │  1. Load serialized model from S3 (cached in memory)
  │  2. Call model.predict() for requested date range
  │  3. Apply derived ratio for purchase metrics
  │  4. Return prediction (milliseconds, not minutes)
  │
  ▼
RESULT: Predictions are fast, compute is cheap, weights accumulate value.
```

### S3 Key Structure

```
s3://air3-weights/
  └── {tenant_id}/              # plasticentro, client-2, client-3...
      └── {sku}/                # 77205207, 77201046...
          └── {version}/        # 2026-06-30T03:00:00Z
              ├── prophet_sales.pkl        # serialized Prophet model
              ├── derived_ratios.json       # PO/Sales ratios per metric
              ├── census_mask.json          # which periods were censored
              ├── training_metadata.json    # data range, row counts, config
              └── validation_snapshot.json  # backtest results at train time
```

Every model version is immutable. New training creates a new version. Rollback = point to previous version. Reproducibility = guaranteed.

### Multi-Tenant by Design

Each tenant gets an isolated key prefix. When client #2 onboards, their weights go to `s3://air3-weights/client-2/`. No data leakage between tenants. Training pipeline is parameterized by tenant_id. Serving layer loads the correct tenant's models based on the API key.

---

## 3. Tech Debt Remediation (Pre-Delivery)

Sequenced so each step is independently shippable and verifiable. Items from the DEPENDENCIES_AND_TECH_DEBT audit, prioritized for delivery timeline.

### Phase 1 — Critical (Do First)

| # | Item | Why Now |
|---|---|---|
| 1 | Node 18 → 22 (Docker + CI + .nvmrc + engines) | Shipping on dead software (EOL Apr 2025). Blocks all future upgrades. |
| 2 | Python 3.11 → 3.12 (ML Docker + CI) | EOL Oct 2026. Inside the delivery horizon. |
| 3 | Pin `prophet>=1.3.0,<1.4.0` | Unpinned = non-reproducible builds for the forecasting core. |
| 4 | Widen `numpy>=1.26,<3.0` | Current `<2.0` cap blocks the entire 2.x line. **Diff backtest output before/after.** |
| 5 | Environment parity: dev = CI = Docker | Three different Node versions today. Pin everywhere identically. |

### Phase 2 — High (Restore Quality Gates)

| # | Item | Why Now |
|---|---|---|
| 6 | Re-enable ESLint at build time + upgrade to ESLint 9 | Currently suppressed. Lint problems accumulate invisibly. |
| 7 | Fix Jest major mismatch (jest 29 + jsdom 30 → both 30) | Latent break waiting on any minor bump. |
| 8 | Remove `recharts` (zero imports) | Dead weight in bundle. One-line fix. |
| 9 | Widen Python caps: pandas, gunicorn, pytest | Unnecessarily locked out of current majors. |

### Deferred — Plan But Don't Execute Yet

| # | Item | When |
|---|---|---|
| 10 | React 18→19 + Next 15→16 + Tailwind 3→4 | After delivery stabilizes. Coordinated pass, not piecemeal. |
| 11 | zustand 4→5, date-fns 3→4, echarts 5→6 | Bundle with #10. |

---

## 4. Delivery Roadmap

### Chapter 1: Infrastructure & Reliability — Phases 1–2

**What client sees:** "Moving from prototype hosting to enterprise-grade AWS. Your data on production infrastructure."

**What we're doing:**

1. Provision AWS infrastructure:
   - ML API on AWS App Runner (Jorge's account, ML plane)
   - S3 bucket for weight storage (Jorge's account)
   - Keep Supabase for now (auth + database — working, no reason to migrate mid-delivery)
   - Keep Vercel for frontend (working, within budget)

2. Execute tech debt Week 1 items (Node 22, Python 3.12, pin Prophet, widen numpy)

3. Deploy ML service to App Runner with health checks, auto-scaling, and proper environment configuration

4. Verify: run existing prediction pipeline end-to-end on new infrastructure. Compare output against Railway baseline. Identical results = green.

**Milestone:** ML API serving from AWS. CI/CD pipeline green. Runtime parity achieved.

### Chapter 2: Forecasting Engine Upgrade — Phases 2–3

**What client sees:** "Purchase forecast accuracy dramatically improved. New method eliminates the catastrophic overestimates."

**What we're doing:**

1. Deploy derived-ratio refactor (`forecast_purchases_derived.py` + API endpoint + route.ts)
   - Sequence: ML service first → test endpoint → swap frontend route
   - Implement Tier 3 fallback: cross-SKU median ratio by supplier class (CARVAJAL/REYMA) for the 6 insufficient-data SKUs

2. Implement weight persistence:
   - Training pipeline: scheduled job (weekly) that fits Prophet + computes ratios + serializes to S3
   - Serving endpoint: loads stored model, returns predictions in milliseconds
   - First run: train all 23 demo SKUs, store initial weights

3. Execute tech debt Week 2 items (ESLint, Jest, recharts, Python caps)

4. Sync Feb–Jun 2026 data from Odoo using new API credentials

**Milestone:** Derived-ratio method live. Weight persistence operational. Predictions served from stored models. Full Odoo data sync complete.

### Chapter 3: Acid Test & Validation — Phases 3–4

**What client sees:** "Side-by-side proof. Our forecasts vs your actuals. Transparent, verifiable, auditable."

**What we're doing:**

1. Run Acid Test 2 with complete ground truth (Feb/Mar 2026 actuals from Odoo)
2. Generate backtest report: predicted vs actual, per SKU, per metric, with error analysis
3. Run the gain-sharing backtest: "Had you had Air 3.0 this month, you would have saved GTQ X"
4. Present results to purchasing team + management
5. Sign off on the measurement baseline document

**Milestone:** Acid Test 2 scored. Backtest value demonstrated. Baseline document signed.

### Chapter 4: Monorepo & Multi-Tenant Foundation — Phases 4–5

**What client sees:** Nothing — this is invisible to them.

**What we're doing:**

1. Create enterprise monorepo structure (first app = Air 3.0)
2. Abstract tenant-specific configuration (Plasticentro config → tenant config pattern)
3. Extract shared libraries: auth, Odoo connector, Census Filter, ML serving client
4. Define CI/CD pipeline for monorepo (build only changed packages)
5. Ensure Air 3.0 runs identically from monorepo as it did standalone

**Milestone:** Air 3.0 running from enterprise monorepo. Tenant config abstracted. Ready for client #2.

---

## 5. Revenue & Commercial Terms (Locked)

| Term | Value |
|---|---|
| Infrastructure budget | ~$500/month (client pays) |
| Software fee | 50% of hours saved (gain-sharing) |
| Measurement authority | Client's Project Manager |
| Baseline | Signed document — one month of hourly measurement |
| Payment balance | Monthly installments until zero (~12 months) |
| Post-balance | Perpetual license + continued API access (usage cap TBD) |
| IP ownership | 100% Jorge / AID — all source code, algorithms, models, weights |
| Bus factor protection | Software escrow agreement (to be formalized) |
| Exit clause | Client can opt out at any time, no penalties |

### Post-Balance-Zero Usage Cap (To Be Defined)

After the payment balance reaches zero, Plasticentro retains perpetual free access to the Air 3.0 API under a defined usage tier:

- API calls per month: [TBD — benchmark current usage, set cap at 2× current]
- SKUs tracked: [TBD — cap at current count or reasonable growth]
- Prediction requests per day: [TBD]
- Version: always current (same as all other tenants)
- SLA: best-effort (no guaranteed uptime for free tier)

Usage beyond the cap or premium SLA = paid upgrade. Define these numbers after 2–3 months of production usage data.

---

## 6. Open Items

| # | Item | Owner | Deadline |
|---|---|---|---|
| 1 | Sign baseline measurement document | Both parties | This week |
| 2 | Draft software escrow clause | Jorge (legal) | Before balance hits zero |
| 3 | Define post-balance usage cap | Jorge | After 2-3 months of usage data |
| ~~4~~ | ~~Odoo API credentials — verify sync capability~~ — ✅ **DONE 2026-07-13**: verified live (Odoo 17.0+e, uid 198, 1,597 products). Host `…34516586.dev.odoo.com`; DB must match host subdomain; API keys are per-database. **Unblocks D3.** | Jorge | ~~Phase 1~~ closed |
| 5 | AWS account setup for ML plane | Jorge | Phase 1 |
| 6 | Client AWS billing arrangement (invoice format) | Jorge | Phase 1 |
| 7 | Formal contract addendum: IP ownership in correct legal form (existing agreement is CEO high-level terms only) including weight ownership clause | Jorge (legal) | Before weight persistence goes live |

---

## 7. What This Plan Deliberately Does NOT Include

- React 19 / Next 16 / Tailwind 4 upgrade (deferred — coordinated pass after delivery stabilizes)
- Database migration from Supabase to Aurora (unnecessary complexity right now — Supabase works)
- Self-service SaaS onboarding for new tenants (Chapter 4 lays the foundation; actual self-service is a separate project)
- Mobile app (not discussed, not in scope)
- Automated Odoo data pipeline (currently manual sync via API credentials; automation is a future improvement)

---

*This document is to become the single source of truth for Air 3.0 delivery. All changes to scope, timeline, or architecture are amendments to this document.*
