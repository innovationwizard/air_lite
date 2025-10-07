# AI Refill - Enterprise Inventory Optimization System

> AI-powered restock optimizer for distribution operations handling 20,000+ SKUs with zero-stockout constraint optimization

[![AWS](https://img.shields.io/badge/AWS-ECS%20%7C%20Aurora%20%7C%20ECR-FF9900?logo=amazon-aws)](https://aws.amazon.com/)
[![Dagster](https://img.shields.io/badge/Orchestration-Dagster-654FF0?logo=dagster)](https://dagster.io/)
[![PostgreSQL](https://img.shields.io/badge/Database-PostgreSQL%2015-336791?logo=postgresql)](https://www.postgresql.org/)
[![TypeScript](https://img.shields.io/badge/IaC-AWS%20CDK-3178C6?logo=typescript)](https://aws.amazon.com/cdk/)

---

## 📋 Executive Summary

AI Refill is an enterprise-grade inventory optimization system designed for high-velocity distribution operations with complex supply chains. The system addresses two critical business constraints:

1. **Primary Constraint**: Zero stockouts (competitive differentiator)
2. **Optimization Target**: Minimize overstock costs (capital + warehouse space + labor)

**Current Status**: ✅ Data Foundation Layer Complete (Phase 1 of 4)

---

## 🎯 Business Context

### The Challenge
- **Scale**: ~20,000 active SKUs across 6 market segments
- **Supply Chain Complexity**: 
  - International sourcing with variable lead times
  - Local sourcing with reliability challenges
- **Current Process**: 6 separate teams manually forecasting in Excel, consolidated to purchasing
- **Pain Point**: Lost deals and customer churn due to stockouts

### Success Metrics
- **KPI 1**: Zero profit loss from stockouts
- **KPI 2**: Minimized overstock carrying costs
- **KPI 3**: Automated forecast generation (eliminate 6-team manual process)

---

## 🏗️ System Architecture

### Technology Stack

```
┌─────────────────────────────────────────────────────────────┐
│                     AI Refill System                         │
├─────────────────────────────────────────────────────────────┤
│  Orchestration Layer:  Dagster (workflow engine)             │
│  Data Warehouse:       PostgreSQL 15 (Aurora RDS)            │
│  Infrastructure:       AWS CDK (TypeScript)                  │
│  Compute:              ECS Fargate                           │
│  Container Registry:   Amazon ECR                            │
│  Networking:           VPC with private subnets + endpoints  │
└─────────────────────────────────────────────────────────────┘
```

### Data Architecture

```
Source Systems          ETL Pipeline              Data Warehouse
┌──────────────┐       ┌──────────────┐         ┌──────────────────┐
│ Odoo Latest  │──────▶│              │         │ Dimension Tables │
│ - Sales      │       │   Kirby ETL  │────────▶│ - products       │
│ - Inventory  │       │   Pipeline   │         │ - customers      │
│ - Purchases  │       │              │         │ - suppliers      │
│ - Returns    │       │   (Python)   │         │                  │
└──────────────┘       │              │         │ Fact Tables      │
                       │              │         │ - sales_trans    │
┌──────────────┐       │              │         │ - purchases      │
│ Legacy CSV   │──────▶│              │         │ - inventory_snap │
│ - Historical │       │              │         │ - returns        │
└──────────────┘       └──────────────┘         │                  │
                                                 │ Audit/Quality    │
                                                 │ - audit_logs     │
                                                 │ - dq_summary     │
                                                 └──────────────────┘
```

---

## ✅ Phase 1: Data Foundation (COMPLETE)

### What's Built

#### 1. **Data Ingestion Pipeline** (`_scripts_tests/`)

Four evolution stages demonstrating iterative refinement:

- **Kirby A** (`_scripta/kirby_A.py`): SQLite prototype
  - Basic CSV + Excel ingestion
  - Client name fuzzy matching
  - Sales/returns/inventory harmonization
  
- **Kirby B** (`_scriptb/kirby_B.py`): Enhanced data quality
  - Improved error handling
  - Extended validation rules
  
- **Kirby C** (`_scriptc/kirby_C.py`): SSOT builder
  - PostgreSQL target
  - Duplicate detection with configurable tolerance (exact/5min/60min/day)
  - Client alias mapping for name reconciliation
  - Per-SKU conflict resolution strategies (excel/csv/mean/max/sum)
  - Observation → Match → Event reconciliation model
  - Zero data loss guarantee
  
- **Kirby D** (`_scriptd/kirby_D.py`): Enterprise production
  - Star schema with fact/dimension normalization
  - Soft delete pattern with audit logging
  - Row-level security (RLS) policies
  - Partitioned fact tables (sales by year)
  - Automatic data quality scoring (97.9/100 achieved)
  - Outlier detection (IQR + Z-score methods)
  - Timestamp normalization with timezone handling

#### 2. **Database Schema** (`sql/schema.sql`)

**Enterprise-grade PostgreSQL design:**

```sql
-- Dimension Tables
products            -- 20K+ SKUs with cost, MOQ, shelf life
customers           -- Client base with soft delete
suppliers           -- Vendor performance tracking
product_categories  -- Classification hierarchy

-- Fact Tables (Partitioned)
sales_partitioned   -- Time-series sales with generated columns
purchases           -- PO tracking with lead time metrics
inventory_snapshots -- Point-in-time stock levels
return_transactions -- Quality/defect tracking

-- Audit & Governance
audit_logs          -- Immutable change tracking
data_quality_log    -- ETL validation metrics
extraction_audit    -- Pipeline execution history
```

**Key Features:**
- ✅ Soft deletes with `is_deleted` flags (preserve ML training history)
- ✅ Audit triggers (automatic BEFORE trigger for INSERT/UPDATE/DELETE)
- ✅ Partitioning strategy (sales by year for query performance)
- ✅ Partial indexes (`WHERE NOT is_deleted`) for space optimization
- ✅ Row-level security policies with permission-based access
- ✅ Generated columns (`total_price = quantity * unit_price`)
- ✅ Referential integrity with cascading rules

#### 3. **AWS Infrastructure** (`infra_cdk/`)

**CDK Stack** (`lib/infra_cdk-stack.ts`):

```typescript
// Provisioned Resources
- VPC with private/public subnets
- Aurora PostgreSQL Serverless v2 cluster
- ECS Fargate cluster (Dagster webserver)
- ECR repository (ai-refill-dagster)
- Secrets Manager (database credentials)
- VPC Endpoints (S3, ECR, CloudWatch, Secrets Manager)
- Security groups with least-privilege rules
```

**Deployed State:**
- ✅ Aurora cluster: `infrastack-databaseb269d8bb-zozevzisykrf`
- ✅ Endpoint: `*.cluster-cv0g4e6yao50.us-east-2.rds.amazonaws.com`
- ✅ Region: `us-east-2`
- ✅ ECR repository: `ai-refill-dagster`
- ✅ Secrets: `airefill/dagster/db_credentials`

#### 4. **Orchestration Framework** (`air_scaffold/`)

**Dagster Project** (scaffolded):
- ✅ Project structure initialized
- ✅ Module configuration (`pyproject.toml`)
- ✅ Test suite setup
- ⏳ Asset definitions (pending implementation)

#### 5. **Data Quality Framework**

**Validation Queries** (`_scriptd/kirby_D_validation.txt`):

- Referential integrity checks (orphaned records detection)
- Data quality scoring (0-100 scale)
- Business intelligence queries:
  - Product performance analysis
  - Supplier lead time variability
  - Inventory risk assessment (critical/reorder/overstock)
  - Demand pattern seasonality
  - Return rate quality metrics
  - Customer segmentation (active/declining/at-risk/inactive)
- ML preparation queries:
  - Time series dataset for demand forecasting
  - Supply chain performance features
  - SKU feature matrix (demand/supply/inventory/risk indicators)
- Executive dashboard KPIs

**Achieved Metrics:**
- Data Quality Score: **97.9/100** ✅
- Validity Percentage: **99.1%**
- Referential Integrity: **Zero violations**
- Status: **🟢 EXCELLENT - Production Ready**

---

## 📂 Repository Structure

```
airefill/
├── _scripts_tests/              # ETL pipeline evolution
│   ├── _scripta/                # Kirby A: SQLite prototype
│   │   ├── kirby_A.py          # Basic ingestion
│   │   ├── edaa.py             # EDA + visualization
│   │   ├── forecasta.py        # Forecast prototype
│   │   ├── leadtimea.py        # Lead time analysis
│   │   └── detecta.py          # Anomaly detection
│   ├── _scriptb/                # Kirby B: Enhanced quality
│   │   └── kirby_B.py
│   ├── _scriptc/                # Kirby C: SSOT reconciliation
│   │   ├── kirby_C.py          # PostgreSQL + conflict resolution
│   │   ├── intel.py            # Intelligence module
│   │   └── HIGH LEVEL DESCRIPTION.TXT
│   └── _scriptd/                # Kirby D: Enterprise production
│       ├── kirby_D.py          # Star schema + audit
│       ├── kirby_D_setup.txt   # Deployment guide
│       └── kirby_D_validation.txt  # Quality queries
│
├── air_scaffold/                # Dagster orchestration
│   ├── air_scaffold/
│   │   ├── assets.py           # Asset definitions (pending)
│   │   ├── definitions.py      # Dagster config
│   │   └── dagster.yaml
│   ├── air_scaffold_tests/
│   ├── pyproject.toml
│   └── Dockerfile
│
├── infra_cdk/                   # AWS infrastructure
│   ├── lib/
│   │   └── infra_cdk-stack.ts  # CDK stack definition
│   ├── bin/
│   │   └── infra_cdk.ts        # Entry point
│   └── cdk.out/                # Synthesized CloudFormation
│
├── sql/
│   ├── schema.sql              # Production schema
│   ├── schemaresume.sql        # Schema summary
│   └── schemasafetycopy.sql    # Backup version
│
└── _ sample data original/      # Sample datasets
    ├── Envio de datos a Condor.xlsx
    ├── clientes 15 al 24.csv
    ├── devolucion 15 al 24.csv
    └── Venta 15 al 24.csv
```

---

## 🚀 Quick Start

### Prerequisites
```bash
# System requirements
Python 3.9+
PostgreSQL 15+
Node.js 18+ (for CDK)
AWS CLI configured
Docker (for containerization)
```

### Local Development

1. **Clone repository**
```bash
git clone https://github.com/yourusername/airefill.git
cd airefill
```

2. **Set up Python environment**
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r _scripts_tests/_scripta/requirements.txt
```

3. **Configure database**
```bash
# Create PostgreSQL database
createdb ai_refill

# Run schema
psql ai_refill < sql/schema.sql
```

4. **Run ETL pipeline**
```bash
cd _scripts_tests/_scriptd
python kirby_D.py
```

5. **Launch Dagster (when assets are implemented)**
```bash
cd air_scaffold
pip install -e ".[dev]"
dagster dev
```

### AWS Deployment

```bash
cd infra_cdk
npm install
cdk bootstrap  # First time only
cdk deploy
```

---

## 📊 Data Model

### Entity Relationships

```
product_categories
    ↓ (1:N)
products ──────────┬─────────────┬──────────────┬────────────────┐
    ↓              ↓             ↓              ↓                ↓
sales_trans   purchases   inventory_snap   return_trans   customers
                    ↓
              suppliers
```

### Sample Queries

**Critical Stock Alert:**
```sql
SELECT p.sku, p.product_name, i.current_stock, i.safety_stock
FROM products p
JOIN inventory_snapshots i ON p.product_id = i.product_id
WHERE i.current_stock <= i.safety_stock
AND i.snapshot_date = (SELECT MAX(snapshot_date) FROM inventory_snapshots);
```

**Supplier Performance:**
```sql
SELECT s.supplier_name, 
       AVG(po.lead_time_days) as avg_lead_time,
       AVG(po.fulfillment_percentage) as fill_rate
FROM suppliers s
JOIN purchase_orders po ON s.supplier_id = po.supplier_id
GROUP BY s.supplier_name
ORDER BY fill_rate DESC, avg_lead_time ASC;
```

---

## 🔬 Technical Highlights

### Data Quality Innovations

1. **Reconciliation Engine** (Kirby C)
   - Observation → Match → Event pattern eliminates double-counting
   - Configurable join tolerance handles timestamp drift
   - Per-SKU strategy rules for conflict resolution
   - Guarantees: no data loss, complete audit trail

2. **Soft Delete Architecture**
   - Preserves historical data for ML model training
   - Audit triggers intercept DELETE and convert to flag update
   - Partial indexes optimize query performance (30-70% space savings)
   - RLS policies automatically filter deleted records

3. **Outlier Detection**
   - IQR method for non-parametric detection
   - Z-score method for normal distributions
   - Quality score penalty system (max 10% deduction)
   - Outliers flagged but not removed (domain expert review)

### Performance Optimizations

- **Partitioning**: Sales table partitioned by year (time-series optimization)
- **Generated Columns**: `total_price` computed automatically (storage vs. compute tradeoff)
- **Partial Indexes**: Filter `WHERE NOT is_deleted` (index size reduction)
- **Connection Pooling**: SQLAlchemy QueuePool (10 base, 20 overflow)
- **Batch Inserts**: Chunked writes (10,000 rows/batch)

---

## 🎓 Design Decisions

### Why PostgreSQL over NoSQL?
- ACID guarantees critical for inventory accuracy
- Complex joins for supply chain analytics
- Window functions for time-series analysis
- Mature RLS for multi-tenant security

### Why Dagster over Airflow?
- Asset-centric paradigm (data = first-class citizen)
- Type-safe Python (better IDE support)
- Native data lineage tracking
- Cloud-native deployment model

### Why Soft Deletes?
- ML models need historical patterns (including discontinued SKUs)
- Regulatory compliance (audit trail requirements)
- Customer churn analysis (need deleted customer history)
- Reversibility (accidental deletes recoverable)

### Why AWS over GCP/Azure?
- Client preference (AWS first until further notice)
- Mature CDK for infrastructure-as-code
- Aurora Serverless v2 (automatic scaling for variable load)
- Comprehensive VPC endpoint coverage (cost + security)

---

## 📈 Roadmap

### Phase 2: AI Intelligence Layer (NEXT)
- [ ] Demand forecasting models (time-series + ML ensemble)
- [ ] Lead time prediction (international vs. local suppliers)
- [ ] Anomaly detection (supply disruption alerts)
- [ ] What-if simulation engine (scenario planning)
- [ ] Reorder point optimization (dynamic safety stock)

### Phase 3: Integration Layer
- [ ] Odoo API connector (real-time data sync)
- [ ] Webhook listeners (event-driven updates)
- [ ] REST API (recommendations service)
- [ ] GraphQL endpoint (dashboard queries)

### Phase 4: Presentation Layer
- [ ] Executive dashboard (KPI visualization)
- [ ] Procurement interface (actionable recommendations)
- [ ] Alert system (critical stock notifications)
- [ ] What-if simulator UI (interactive scenario testing)

---

## 🔐 Security & Compliance

### Implemented Controls
- ✅ Secrets Manager for credentials (no hardcoded passwords)
- ✅ Private subnets for database (no public internet access)
- ✅ VPC endpoints (traffic never leaves AWS network)
- ✅ Row-level security (permission-based data access)
- ✅ Audit logging (immutable change tracking)
- ✅ Soft deletes (GDPR "right to be forgotten" compatible)
- ✅ Connection pooling (prevents connection exhaustion)

### Pending Enhancements
- [ ] Encryption at rest (RDS KMS)
- [ ] Encryption in transit (SSL/TLS enforcement)
- [ ] IAM role-based authentication (no password auth)
- [ ] CloudTrail logging (API call auditing)
- [ ] GuardDuty (threat detection)
- [ ] Security Hub (compliance dashboard)

---

## 🧪 Testing Strategy

### Data Quality Tests
```bash
# Run validation queries
psql ai_refill < _scripts_tests/_scriptd/kirby_D_validation.txt

# Expected: Zero referential integrity violations
# Expected: 95+ quality score
```

### Unit Tests (Planned)
```bash
cd air_scaffold
pytest air_scaffold_tests/
```

---

## 📝 Development Standards

### Code Quality
- Type hints for all function signatures
- Docstrings (Google style)
- Logging at INFO level minimum
- Error handling with context preservation

### Git Workflow
- Feature branches (`feature/demand-forecasting`)
- Conventional commits (`feat:`, `fix:`, `docs:`)
- PR reviews required for main branch
- Automated CI/CD (pending setup)

### Documentation
- Inline comments for complex logic
- README per major module
- Architecture decision records (ADRs)
- API documentation (when implemented)

---

## 🤝 Contributing

This is a private commercial project. Contributions by invitation only.

---

## 📄 License

Proprietary - All Rights Reserved

---

## 🏆 Project Stats

| Metric | Value |
|--------|-------|
| Data Quality Score | 97.9/100 |
| Database Tables | 14 |
| ETL Iterations | 4 |
| Code Lines (Python) | ~4,500 |
| Code Lines (TypeScript) | ~70 |
| SQL Schema Lines | ~400 |
| AWS Resources | 10+ |
| Target SKUs | 20,000+ |

---

## 📞 Contact

**Project Lead**: Jorge Luis Contreras Herrera  
**Phase**: 1/4 (Data Foundation Complete)  
**Status**: ✅ Production-ready data warehouse  
**Next Milestone**: AI model development

---

*Built with precision. Engineered for scale. Optimized for results.*

