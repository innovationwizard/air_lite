aid-saas-prod (single AWS account, Jorge owns)
│
├── DATA PLANE (tenant: plasticentro)
│   ├── App Runner         ← Next.js frontend (standalone output already working from N6 fix)
│   ├── Aurora Serverless v2  ← PostgreSQL (same engine as Supabase, just managed by AWS)
│   └── Secrets Manager    ← connection strings, API keys, tenant config
│
├── ML PLANE (shared, multi-tenant)
│   ├── App Runner         ← ML API (Flask/gunicorn, Census Filter, serving)
│   ├── S3                 ← serialized weights per tenant
│   ├── Lambda / Fargate   ← scheduled training pipeline
│   └── EventBridge        ← training scheduler (weekly/nightly cron)
│
├── SHARED
│   ├── SES               ← email (already on your migration backlog)
│   ├── CloudWatch         ← logs, metrics, alarms — one place for everything
│   └── ECR               ← container images for both App Runners
│
└── ESTIMATED MONTHLY COST
    ├── Aurora Serverless v2    ~$50-80  (scales to zero when idle)
    ├── App Runner (frontend)   ~$25-50  (0.5-1 vCPU)
    ├── App Runner (ML API)     ~$50-100 (1-2 vCPU, memory for Prophet)
    ├── S3 + Lambda + EventBridge  ~$5-10
    ├── SES + CloudWatch + ECR     ~$5-15
    └── TOTAL                   ~$150-260 (well within $500)

---

Addendum: 

What we actually want is the split-plane made literal across two AWS accounts, so that :

PLASTICENTRO'S AWS ACCOUNT (their card, their bill)
├── App Runner       ← Next.js frontend
├── Aurora Serverless ← their data (PostgreSQL)
└── Secrets Manager  ← their connection strings
    ~$100-150/month — they see it, they pay it, no invoicing from you

JORGE'S AWS ACCOUNT (your cost, absorbed into SaaS margin)
├── App Runner       ← ML API (Census Filter, serving)
├── S3               ← weights (all tenants)
├── Lambda/EventBridge ← training pipeline
└── ECR, CloudWatch, SES
    ~$60-120/month — your cost of running the SaaS

We control deployment into their account via cross-account IAM roles. 
They give us a deployment role. 
Our CI/CD pushes container images and infra updates. 
They can't modify our code (it's in our repo). 
They can see their running services and pay their bill.

This is the correct architecture because their account contains zero moats. 
Frontend code is the perpetual license they'd get anyway. Their data is theirs. 
The Census Filter and weights never touch their account. 
If the relationship ends, they keep their account, we revoke the ML API key.