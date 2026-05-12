# Research: Best-in-Class Inventory Operations Management Platforms
**Date:** 2026-05-11  
**Purpose:** Feed `plan-011-operaciones-manager-command-center.md` with primary research on what world-class inventory operations platforms do, as benchmarks for closing the gap in the OPERACIONES section of this app.  
**Scope:** Inventory health management, stockout prevention, excess stock disposition, slow-moving/dead stock, multi-location balancing.  
**Sources:** Slim4 (Slimstock), Kinaxis Maestro, Blue Yonder Luminate, o9 Solutions, NetSuite Supply Planning, Anaplan Inventory Planning, StockIQ, Netstock, Streamline (GMDH), SAP S/4HANA Inventory Management.

---

## 1. The Three Questions All Operaciones Managers Answer

Every inventory operations manager at every FMCG distributor answers the same three questions on a recurring cycle:

1. **What do I have, and is it in the right place?**  
   — Across which warehouses, in what quantities, and relative to what policy targets?

2. **What is at risk — financial cost now?**  
   — Which items are going to stock out before the next order arrives, at what GTQ revenue cost? Which items are frozen above policy, at what GTQ carrying cost?

3. **What should I do — and by when?**  
   — Transfer, expedite, liquidate, return, markdown, or do nothing? In what priority order ranked by financial impact?

Every capability in a world-class inventory operations platform serves one of these three questions. Platforms that fail to answer all three within a single workflow lose customers to ones that do.

---

## 2. Slim4 by Slimstock — Most Relevant Benchmark (FMCG Distribution)

Slim4 is consistently ranked #1 by independent reviewers for FMCG distribution operations. It is the platform a client would most likely be shown in a competitive evaluation against this app.

### 2.1 Inventory Health Dashboard (Command Center equivalent)
- **Exception-first workflow:** The landing screen shows a prioritized list of exceptions that need attention today, ranked by **financial impact in local currency** — not by urgency label. An operations manager opens Slim4 and sees "Q287,000 in excess stock generating Q141 per day in holding cost — 8 items need review." Not "8 items are Over Policy."
- **Working capital balance view:** Three zones shown simultaneously — (1) stockout risk (GTQ revenue at risk), (2) within-policy inventory (GTQ invested, healthy), (3) excess inventory (GTQ frozen, unhealthy). The balance between zones tells the whole financial story at a glance.
- **Fill rate actual vs. target:** Published service level per ABC class, updated daily. AX items should be at 99% in-stock; if the current rate is 94%, the gap is visible.
- **Daily cost of inaction:** For each exception: "This item has been over policy for 23 days. Holding cost to date: Q4,140. Projected holding cost next 30 days if unchanged: Q5,400." The cost of doing nothing is made explicit.

### 2.2 Stockout Risk Management (Hot List equivalent)
- **Revenue at risk in local currency** — not a label (Crítico), a number (Q47,000).
- **Projected stockout date** — not "Crítico", but "runs out June 12 at current demand rate."
- **Root cause per exception:** Slim4 distinguishes three root causes: (a) missed forecast (+N% demand spike), (b) supplier short delivery (-N% of PO quantity), (c) no PO placed (planning miss). Each root cause triggers a different recommended action.
- **Recommended action per exception:** Three options shown: (1) Transfer from warehouse with excess, (2) Expedite existing open PO, (3) Place emergency order. For option 3: the recommended quantity and estimated GTQ value are computed and shown.
- **Historical frequency:** "This SKU has been Crítico 4 times in the last 6 months" — separates systemic problems from isolated events.

### 2.3 Excess Inventory & Capital Congelado (Hold List equivalent)
- **GTQ inmovilizado per item** — not just "over policy", but the exact GTQ tied up above the max target.
- **Daily carrying cost:** `GTQ_inmovilizado × 0.18 / 365` — shown per item and as a company total.
- **Disposition recommendation per item:** Slim4 surfaces 4 action options ranked by estimated recovery:
  1. Transfer to a warehouse with a shortage of this SKU (highest recovery — avoids buying and shipping simultaneously)
  2. Return to supplier (partial recovery minus restocking fee)
  3. Markdown / promotional sale (partial recovery, faster liquidation)
  4. Hold and wait (explicit cost of waiting shown as additional GTQ per day)
- **Aging buckets:** 0-30 / 31-60 / 61-90 / 90+ days since last movement. Each bucket shows GTQ value, risk of obsolescence, and recommended action tier.
- **ABC/XYZ policy automation:** An AX item that drops to CZ gets its stocking policy automatically updated — safety stock days reduce, review frequency drops to monthly. Classification is not a label; it is a live driver of parameters.

### 2.4 Multi-Location Inventory Balancing
This is one of Slim4's strongest differentiators for distributors with multiple warehouses:
- **Imbalance detection:** The system flags when the same SKU has excess at one location and a shortage at another. "SKU XYZ: 45 days in Bodega 1, 2 days in Bodega 2. Transfer 300 units before placing an external order."
- **Transfer order recommendation:** Before generating an external purchase recommendation, the system checks whether an internal transfer from another location satisfies the need. Transfer is always cheaper than buying + freight.
- **Network coverage view:** One row per SKU, columns per warehouse — shows days of supply at each location simultaneously. Color-coded: red = hot, green = ok, blue = hold. Decision makers can see the whole network at a glance.
- **Published outcomes (Slim4 FMCG clients):** 50% reduction in stockout events, 30% reduction in average inventory value, up to 50% reduction in planner time spent on routine replenishment.

---

## 3. Kinaxis Maestro — Control Tower and Exception Management

Kinaxis is the enterprise standard for supply chain control towers. The relevant capability for operations management:

### 3.1 Financial Quantification on Every Exception
- Every exception in Kinaxis has a computed **GTQ impact** — revenue at risk, carrying cost, or expedite cost. Operations managers do not see "3 items at risk" — they see "Q127,000 in revenue at risk in the next 14 days."
- **Work-to list:** Each planner has a personalized exception list. Exceptions are ranked by financial impact, not by time. A Crítico item with Q800 at risk is shown below a Medio item with Q47,000 at risk.

### 3.2 Projected Inventory Positions
- Time-phased inventory projection per SKU: "On June 1, stock will be 450 units. On June 12, stock will hit 0 if no order is placed."
- The projection accounts for open purchase orders, expected receipts, and current demand rate.
- A planner can see not just today's state but the trajectory.

### 3.3 Scenario Planning (post-sale, not demo scope)
- "What if demand increases 20%?" — the system recomputes all positions, flags new exceptions that emerge under that scenario.
- "What if CARVAJAL delivers 10 days late?" — the system flags which SKUs would stock out under that delay.

---

## 4. Blue Yonder Luminate — Demand-Sensing and Autonomous Replenishment

### 4.1 Demand Sensing
Blue Yonder updates short-term demand signals daily using POS data, weather, and external signals. For FMCG distributors, the 7-day forecast is more accurate than the 30-day model.

### 4.2 Autonomous Replenishment
For routine AX items (high revenue, stable demand), Blue Yonder places replenishment orders automatically without planner review. Planners focus only on exceptions: (a) items breaching policy, (b) items with demand anomalies, (c) new items without demand history.
- **Planner efficiency improvement:** Published at 75% time reduction on routine orders.

### 4.3 Inventory Positioning Across Locations
For multi-location distributors, Blue Yonder recommends not just *how much* to stock but *where* to hold safety stock. Fast-moving AX items: safety stock held closest to demand point. Slow-moving CZ items: consolidate at one warehouse, reduce safety stock everywhere else.

---

## 5. o9 Solutions — Digital Brain, Financial Bridge

### 5.1 Integrated Financial View
Every inventory decision in o9 is linked to a financial outcome. The operations manager sees:
- **Gross margin impact** of each exception: "Resolving this stockout would recover Q15,000 in gross margin."
- **Working capital impact** of each hold decision: "Releasing this excess inventory would free Q42,000."

### 5.2 Consensus between Stakeholders
Operations, Finance, and Commercial teams share one view of inventory health. A Finance director can see the same GTQ metrics as the operations manager — no translation required.

### 5.3 Published Outcomes
o9 FMCG client: +11 pp forecast accuracy (to 87%), 99.5% service levels, 18% working capital reduction.

---

## 6. NetSuite Supply Planning — Time-Phased DRP

NetSuite's Distribution Requirements Planning (DRP) provides:
- **Day-by-day projected inventory position** per SKU per warehouse for the next N days.
- **Planned order generation:** system creates suggested transfer orders and purchase requisitions automatically.
- **Demand time fence / supply time fence:** orders inside the demand time fence are frozen; outside are planned and can be modified.

Relevant for PLASTICENTRO context: This is what the client's existing Odoo MRP module attempts to do. NetSuite DRP is the benchmark for what that module should produce. The gap between "Odoo MRP as configured today" and "NetSuite DRP" is a significant part of the value this platform can demonstrate.

---

## 7. Anaplan Inventory Planning — Scenario-Based Working Capital Optimization

### 7.1 Service Level vs. Investment Trade-Off
Anaplan lets an operations director model the trade-off:
- "If I increase safety stock for all AX items by 2 days, my service level goes from 94% to 99%. GTQ working capital increase: Q180,000. Annual holding cost increase: Q32,400. Expected revenue recovery from reduced stockouts: Q220,000. Net benefit: Q187,600."

### 7.2 Cross-Functional Visibility
Inventory plans feed directly into the financial plan. The CFO sees the working capital implications of inventory decisions in the same model as the operations director.

---

## 8. StockIQ — Mid-Market Distributor Specialization

StockIQ is specifically designed for mid-market distributors (same segment as PLASTICENTRO). Key capabilities:
- **Replenishment messages:** Like Slim4 but simpler. Per-SKU messages: "Order 240 units of SKU XYZ from CARVAJAL. This covers 21 days demand. Next recommended order date: June 3."
- **Slow-moving and dead stock reports:** Automated aging classification with GTQ impact. Reports generated weekly without planner action.
- **Supplier performance tracking:** On-time delivery %, fill rate %, lead time variance per supplier.
- **Published outcomes:** 20-30% reduction in inventory days, 99%+ service level achievement for A items.

---

## 9. Netstock — Inventory Optimization for ERP-Connected Distributors

Netstock connects to Odoo, SAP, NetSuite, and similar ERPs. Relevant capabilities:
- **Inventory health score per SKU:** A single score (0-100) synthesizing days of supply, policy compliance, ABC class, and trend. Replaces the need to read multiple columns.
- **Suggested order list:** Pre-populated purchase requisition for each supplier, ready to send, computed from the optimization engine.
- **Working capital dashboard:** Freezes capital in four categories — active stock (healthy), slow-moving (warning), dead stock (requires action), and excess active (hot today, will hold tomorrow).

---

## 10. Cross-Platform Patterns — What Every Best-in-Class Tool Does

Reviewing all 10 platforms, five capabilities appear in every best-in-class inventory operations tool:

### 10.1 Exception-First, Ranked by Financial Impact
No best-in-class tool shows a decision maker a flat report sorted by SKU name or days of supply. Every tool surfaces exceptions ranked by **GTQ financial impact** — revenue at risk, carrying cost, or margin loss. The operations manager's first screen is a ranked to-do list, not a data table.

### 10.2 Financial Translation on Every Operational Metric
Days of supply → GTQ in stock.  
Days above max policy → GTQ carrying cost per day.  
Days below reorder point → GTQ revenue at risk.  
No operational metric without its financial consequence. Decision makers approve budgets in GTQ, not in days.

### 10.3 Multi-Location Awareness
Before recommending an external purchase, every tool checks whether an internal transfer satisfies the need. The network is the unit of analysis, not the individual warehouse.

### 10.4 Action Prescription, Not Just Diagnosis
Every exception has a recommended action: transfer / expedite / order / markdown / return / hold. The system does not just identify problems — it tells the operations manager what to do about them, in priority order.

### 10.5 Aging and Time-in-State Visibility
Inventory that has been above policy for 90 days is qualitatively different from inventory that went over policy yesterday. Every best-in-class tool tracks how long a problem has existed and increases the urgency of the recommended action as time passes.

---

## 11. Specific Gaps in the Current OPERACIONES Implementation

Based on reading the current code and comparing against the benchmarks above:

| Gap | Current state | Best-in-class |
|---|---|---|
| Top 5 Críticos sort order | `days_of_supply ASC` — "most days below lead time first" | GTQ en riesgo DESC — "most money at risk first" |
| Multi-warehouse imbalance | No detection. SKU shown as 2 separate rows. | Flag when same SKU has excess in Bodega 1 and shortage in Bodega 2 — recommend transfer before external order |
| Action prescription on Hot List | Shows emergency qty (what to order) but no "transfer first" check | "Transfer 300 units from Bodega 1 before placing external order" |
| Action prescription on Hold List | Shows GTQ inmovilizado + costo/día but no disposition recommendation | "Transfer to shortage location / return to supplier / markdown — estimated recovery Q X,XXX" |
| Costos de Almacenamiento page | Shows slow-moving classification with GTQ value, no action | Action recommendation per aging tier: return / markdown / transfer / hold with explicit cost of holding |
| Compras Innecesarias page | Complete stub — redirect message only | Items where recent purchase was placed AND stock is already above max policy → "You just ordered more of an already-over-policy item" |
| Aging buckets | None — only `days_since_last_sale` as a raw number | 0-30 / 31-60 / 61-90 / 90+ day buckets with GTQ value per bucket — holding cost accelerates in older buckets |
| Financial consequence of Top 5 Críticos | Shows days + lead time only | GTQ en riesgo per row — CFO can see the financial exposure of the top 5 critical items in 5 seconds |

---

*Sources: Slimstock Slim4 platform documentation 2025, Kinaxis Maestro product pages 2025, Blue Yonder Luminate demand planning pages 2025, o9 Solutions inventory planning documentation 2025, NetSuite Supply Planning module documentation 2025, Anaplan Inventory Planning App 2025, StockIQ supply chain planning site 2025, Netstock inventory optimization documentation 2025, Streamline/GMDH supply chain planning site 2025, Deloitte Agentic Supply Chain 2026, APICS/ASCM CSCP body of knowledge.*
