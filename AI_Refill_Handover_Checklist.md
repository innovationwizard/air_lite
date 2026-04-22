 

**AI Refill Handover Checklist – 2026 FEB 23**  
 

*This checklist is designed to ensure that the transition from development environment to the client’s production environment is frictionless, ROI-positive, and reflects your authority as an **AI** Principal Architect.*

**Phase 1: Engine & Model Integrity** 

* **BSTS Imputation Validation:** Verified that NaN values are correctly generated in the data layer when Inventory ≤ 0 and Sales \== 0\.

* **Likelihood Robustness:** Confirmed the use of Student-T likelihood with degrees of freedom (ν) between 3 and 7 to handle Odoo clerical noise.

* **Backtest Fidelity:** Ensure the 12-month “Loss Dashboard” uses True Data (historical unit costs/prices) to prevent estimate-bloat.

* **Prior Anchoring:** Verified that the Trend Variance is rigorous and constrained enough to prevent “noise chasing” during the first 30 days of deployment.

**Phase 2: Technical Migration**

* **M1 Optimization:** Ensure the Python environment uses PyMC with the Nutpie or Blackjax sampler for Metal1 Pro speed.

* **Odoo API Persistence:** Configured the Config Panel to store encrypted API keys and Warehouse IDs (they are needed for API routing).

* **Sync Frequency Guardrails:** Implement idempotency and Last Sync timestamp to prevent the engine from running on stale data if the Odoo connection drops.

**Phase 3: ROI Masterpiece Dashboards**

* **The “Why” Decomposition:** Ensure the UI visually separates Baseline (Trend), Season (Cycles), and Events (Regressors).

* **The Uncertainty Signal:** Surface the Confidence Interval (P5 – P95). If the interval is wider than UI defined threshold (AI suggested %), a “Manual Review” flag must appear.

* **Retroactive Proof:** The “Loss Dashboard” must display a clear dollar amounts and clear explanations, for example: “In the last 12 months, $X was lost due to Stock-Outs that this engine would have prevented.”

**Phase 4: Administrative & Documentation**

* **The Master Code Log:** A JSON-structured audit trail recording every recommendation, the data quality at that moment, and the specific Bayesian posterior variance.

* **Turn-Key Commands:** A single README.md (or script) that allows the client to pip install and run the entire stack without any issues.

* **The AI Principal Architect Note”:** A 1-page executive summary explaining that the engine learns from uncertainty. The engine frames data gaps not as “bugs” but as “opportunities for the Bayesian model to protect ROI.”

**Final Strategy Check**

**By completing these 4 phases, the Engine guarantees:**

**1\. ROI is protected:** The Deep Learning Bayesian logic prevents “Negative ROI.”

**2\. Scale is ready:** The architecture is decoupled, making any future migration a “Copy-Paste” task.

**3\. Authority is established:** The “Reasoning Dashboard” is the unique differentiator. Instead of the black-box-model all other solutions offer, this dashboard explains how calculations are made and why its recommendations are truly Intelligent. 

   
**Industry Best Practices: The “Clean Handover” Architecture**  
 

*The “AI Authority” approach isn’t just handing over a root password; it’s handing over an Automated Environment.*

**1\. The Multi-Account Strategy (AWS Organizations)**

Instead of a single root user for everything, use AWS Control Tower to create a dedicated Child Account within your organization for the client/app.

* **The Benefit:** You can develop in your sandbox, then “move” the account to the client’s own AWS Organization later.

* **The “Masterpiece” Move:** Keep the Management Account (Root) separate from the Workload Account (where the AI Refill engine lives).

**2\. Infrastructure as Code (IaC) – The “One-Click” Reality**

A “Masterpiece” of infrastructure is disposable. You shouldn’t hand over a pre-configured server; you should hand over a Terraform repository.

* **The Benefit:** The client can see every permission, VPC, and database setting in code.

* **The ROI:** It proves that the N-th deployment costs near-zero.

**3\. The “Root User” Trap**

Never develop using the Root User. In a professional handover:

**1\. Create** an IAM Identity Center (SSO).

**2\. Define** a Principal-Architect role with the necessary permissions.

**3\. On handover day,** rotate the Root password, enable MFA for the client, and delete your IAM user.

**The SDD for “Independent Infra” (Step-by-Step)**

**High-Level: The “Venture Engine” Setup**

* **Step A:** Create a brand new AWS Account (not just a user) under your current Organization.

* **Step B:** Deploy all resources (RDS, EC2/Lambda, S3) using Terraform.

* **Step C:** Use AWS Secrets Manager for the Odoo API keys.

**Mid-Level: The Migration Workflow**

**1\. Isolation:** Ensure the app has zero dependencies on your personal AWS (e.g., no shared S3 buckets or cross-account IAM roles).

**2\. State Portability:** Store the Terraform state file in an S3 bucket within that new account.

**3\. Bootstrap Script:** Create a setup.sh that installs the CLI and runs terraform apply.

**Low-Level: Handover Mechanics**

* **The Credentials:** Provide a “Vault” (Bitwarden/1Password) containing:

* **Root Email/Password.**

* **MFA Recovery Codes.**

* **IAM Admin credentials for their technical lead.**

* **Tagging:** Every resource must have a Project: AI-Refill and Environment: Production tag.

**Principal Note: The “YES, BUT” Compliance**

You can just build everything in a single account and hand over the root user (the “Hacky” way). It is the fastest path to turn-key handover.

**BUT: This is a Security Debt. If the client loses that root user, or if a secret is hardcoded, the entire infrastructure is compromised. The “International AI Authority” standard is to provide the Terraform scripts so the client can recreate the “Masterpiece” in any account they own.**

