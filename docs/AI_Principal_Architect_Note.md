# AI Principal Architect Note
## AI Refill – Bayesian Demand Intelligence Engine

**Author:** Jorge Luis Contreras Herrera, AI Principal Architect
**Date:** February 2026
**Audience:** Executive Leadership, Client Administration

---

### The Core Insight: Uncertainty Is the Signal, Not the Bug

Every conventional inventory system treats data gaps the same way: it fills them with zeros, averages, or estimates. This destroys the most valuable information in the dataset.

When a product records **zero sales while its stock is also zero**, that zero is not a demand signal — it is a *censored observation*. The product could not sell because there was nothing to sell. A standard model trained on this data learns the wrong lesson: "demand was zero." Our engine learns the correct lesson: "demand was unknown — the distribution must widen."

This distinction is the foundation of the entire system's ROI advantage.

---

### How the Engine Thinks

The engine operates in three conceptual layers:

**1. The Observability Layer (What actually happened?)**

Raw Odoo data passes through a **Census Filter** before it reaches any model. Each (day, SKU) pair is classified:

- **Reliable** — stock was available AND a sales quantity was recorded.
- **Censored** — stock was at zero AND sales were zero. Demand is marked `NaN` (missing), not zero.
- **Anomalous** — quantity is a statistical outlier (IQR rule). Logged and excluded.

Only *Reliable* records enter the demand model. The model is therefore trained on reality, not on the artefacts of past stock-outs.

**2. The Inference Engine (What will happen?)**

The demand model (Facebook Prophet with Bayesian priors) produces a **probability distribution** for future demand — not a single point estimate. This distribution has three interpretable components:

- **Baseline (Trend):** The long-run growth or decline of the product's popularity.
- **Season (Cycles):** Weekly and monthly recurring patterns (e.g. weekend spikes, month-end purchasing).
- **Events (Regressors):** External drivers — price changes, promotions, local holidays.

The output is a forecast band: a P5 lower bound and a P95 upper bound. The **width of this band is a decision signal**. A narrow band means high confidence; a wide band means the model has limited information and a human should review before committing a purchase order.

**3. The ROI Validator (What would have happened?)**

A backtest engine replays the last 12 months of history, comparing:

- *Engine decision*: the recommended order quantity based on P95 demand + safety stock.
- *Actual decision*: the client's historical purchase quantity.

The delta is translated into GTQ (Guatemalan Quetzal) using actual unit costs and margins — no estimates, no proxies. The **Loss Dashboard** shows the quantified cost of stock-outs that the engine would have prevented.

---

### Why This Is Not a Black Box

Every other AI inventory solution on the market delivers a number and asks the client to trust it. This engine shows its reasoning:

| Traditional System | AI Refill Engine |
|-------------------|-----------------|
| "Order 47 units." | "Order 47 units. Trend is flat, season is +12%, no events detected. Confidence: 91%." |
| No explanation for uncertainty | "Flag: Revisión Manual – CI width exceeds 50% of forecast. Model needs more data for this SKU." |
| Black-box model | Trend / Season / Events decomposed and visible in the dashboard |

The **Reasoning Dashboard** is the client's audit trail of the engine's intelligence. It is the differentiator.

---

### What the Engine Guarantees

1. **ROI is protected.** The Census Filter prevents the model from learning false demand lows. The P95 service level (Z = 1.65) ensures stock-out protection at 95% confidence.

2. **Scale is ready.** The architecture is decoupled: Dagster (ETL + ML) is independent of the API (serving) and the UI (display). Any future migration is a configuration change, not a rebuild.

3. **The client owns it.** Every credential, every infrastructure resource, every Terraform/CDK stack is delivered as code. The client can recreate the entire environment in any AWS account they own. Nothing is locked to the vendor's infrastructure.

---

### A Final Note on Data Gaps

The engine is designed to *thrive* on imperfect data — because all real-world inventory data is imperfect. Gaps in the Odoo history are not a problem to be fixed before delivery. They are the raw material the Bayesian model uses to calibrate its uncertainty. The wider the uncertainty, the more conservative the recommendation. This is the correct behaviour.

The engine does not need clean data to be valuable. It needs *honest* data — and the Census Filter guarantees that honesty.

---

*This document is part of the AI Refill handover package. For technical implementation details, see the SDD and README.md.*
