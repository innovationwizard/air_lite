# Gap Analysis: COMPRAS & OPERACIONES vs. Best-in-Class
**Date:** 2026-05-08  
**Scope:** COMPRAS and OPERACIONES navigation sections — full feature gap analysis against world-class supply chain planning software  
**Context:** These are demo pages built on a real March 3, 2026 data snapshot from an actual client (PLASTICENTRO, S.A.). The demo must convince the client's decision makers to purchase the platform. Odoo live sync is a post-sale implementation deliverable, not a demo prerequisite. Every gap below is evaluated against: "does this gap make the demo less convincing?"  
**Benchmarks:** SAP Ariba/S4HANA, Oracle Fusion Procurement, Kinaxis Maestro, o9 Solutions, Blue Yonder Luminate, Anaplan Supply Chain, Slim4 (Slimstock), Streamline (GMDH), NetSuite Supply Planning, Coupa/Llamasoft

---

## 1. Current State: What the App Actually Does Today

### COMPRAS

| Navigation Item | Route | What the user sees | What the user can do | Data source |
|---|---|---|---|---|
| **Inicio Compras** | `/compras` | Static page. "Silo de Compras" header. Hardcoded "Wilmer, empecemos acá." 4 navigation cards (Forecast, Programación, Ahorro, OA). Footer note about March 3 snapshot. | Click cards to navigate. Nothing else. | None — purely static HTML |
| **Forecast de Demanda** | `/backtest` | "Demostración de Valor" playback. Sequential slideshow of historical backtest months (Oct 2024–Feb 2026). 4 savings estimate cards (Storage, Unnecessary Purchases, Stockout Losses, Inventory Turnover). 3 of 4 metrics marked "en validación". | Click "Siguiente mes" to advance. Jump to month via breadcrumbs. "Reiniciar". Adjust holding cost rate (no DB effect). | `/api/backtest/runs`, `/api/backtest/{id}` — pre-computed historical backtest rows |
| **Programación de Compras** | `/poc/programacion` | "Programación de Compras Semanal" playback. Sequential slideshow of historical weekly purchase schedules. Carvajal + Reyma only. Max 14-day inventory policy. Supplier summary cards, daily breakdown table, expandable reasoning per line. | Click "Siguiente semana" to advance. Jump via breadcrumbs. Click rows to expand. "Reiniciar". | `/api/poc/purchase-schedule` — pre-computed historical POC data |

**Observation:** Both "Forecast de Demanda" and "Programación de Compras" are historical playback demos of pre-computed results. The actual live Prophet forecast lives at `/gerencia/forecast` (Gerencia/Superuser section only — inaccessible to a buyer with the COMPRAS role). No purchasing action exists anywhere in COMPRAS.

---

### OPERACIONES

| Navigation Item | Route | What the user sees | What the user can do | Data source |
|---|---|---|---|---|
| **Inicio Operaciones** | `/operaciones` | Static page. "Silo de Operaciones" header. Hardcoded "Mario, empecemos acá." 4 navigation cards (Días, Hot, Hold, OA). Footer note about March 3 snapshot. | Click cards to navigate. Nothing else. | None — purely static HTML |
| **Días de Inventario** | `/operaciones/dias-inventario` | Snapshot inventory table. 4 status KPI cards (Hot/OK/Hold/Sin demanda). Warehouse dropdown. Search box. 100-row table of (SKU, bodega, stock, demanda/día, días, lead time, estado). | Click status cards to filter. Select warehouse. Type to search. "Limpiar filtros". View 100 rows max. | `/api/kpis/days-of-inventory` — March 3 snapshot |
| **Hot List** | `/preocupaciones/desabastecimiento` | Stockout risk table. 3 KPI cards (Crítico count, Alto count, Total monitoreado). 50-row table with risk badges (Crítico/Alto/Medio/Bajo). | Scroll and read. No filters. No actions. | `/api/kpis/stockout-risk` — March 3 snapshot |
| **Hold List** | `/preocupaciones/capital-congelado` | ABC/XYZ classification table. 3 KPI cards (A count, C count, C revenue). 100-row table with ABC+XYZ badges and CV de demanda. | Scroll and read. No filters. No actions. | `/api/kpis/abc-xyz` — March 3 snapshot |

**Observation:** Hot List and Hold List have zero interactive filters and no action capability. Días de Inventario has filters but no actions. No page in OPERACIONES shows financial impact (GTQ) of any operational situation. No page lets a decision maker answer "how much money is this costing us right now?"

---

## 2. What Best-in-Class Tools Actually Do

### 2.1 Purchasing Command Center (vs. "Inicio Compras")

**Current:** Static card navigation. Zero data. Zero KPIs. Looks like a sitemap.

**Best-in-class (SAP S/4HANA Procurement Overview Page, Oracle Fusion Redwood):**
- Live KPI row visible without drilling: P2P cycle time, Spend Under Management %, On-Time Delivery %, Maverick Spend %
- Exceptions requiring immediate action: overdue POs, items requiring acknowledgment, pending approvals with dollar value and age
- Supplier risk alerts (flagged suppliers with deteriorating delivery performance)
- Quick-action shortcuts from the home page — no menu traversal
- "What needs my attention today?" — not a menu, a mission brief

**Demo gap:** A decision maker landing on the current Inicio Compras sees a card grid that says "here is where things are." Best-in-class landing pages say "here is what is on fire today, and here is what you do about it." The current page does not demonstrate the value of the platform — it demonstrates the existence of the platform.

---

### 2.2 Demand Forecast (vs. "Forecast de Demanda")

**Current:** Sequential playback of historical savings estimates. 3 of 4 metrics "en validación." The label says "Forecast de Demanda" but the page demonstrates past calculated savings, not the forecast itself. The actual live Prophet forecast is behind a Gerencia/Superuser gate that a buyer with the COMPRAS role never reaches.

**Best-in-class (Blue Yonder, Kinaxis Maestro, o9 Solutions):**
- *Blue Yonder:* Probabilistic forecast — not a single number but a range with percentile bands. "Glass box" explainability: lists which factors (seasonality, promotions, competitor events) drove each forecast change with relative weights. Planner efficiency improvement: 75%.
- *Kinaxis:* Exception Review screen — anomalies surfaced with explainable drivers. MAPE + bias tracking per SKU. Unlimited scenario comparison ("what if demand spikes 30%?").
- *o9:* Consensus Planning — Sales, Marketing, and Finance each contribute assumptions to a shared number. Published customer outcome: +11 pp forecast accuracy (to 87%), 99.5% service levels.

**Demo gap:** The current "Forecast de Demanda" page does not show a forecast. It shows a slideshow of historical savings estimates, which is valuable for ROI demonstration but leaves a critical question unanswered: *"What is the forecast telling me to do next month?"* A decision maker who asks this question cannot answer it from the current COMPRAS section.

---

### 2.3 Purchase Scheduling / Replenishment (vs. "Programación de Compras")

**Current:** Historical POC playback locked to Carvajal + Reyma, 14-day policy, historical weeks. No buyer can answer "what should I order this week?" from this page.

**Best-in-class (Slim4 — most relevant for FMCG distribution):**
- Replenishment recommendations generated continuously per SKU per warehouse
- Supplier constraints encoded: MOQ, price breaks, packing multiples, lead time variability
- Explainability per line: "Why Q240? Current stock 180 units, 6-day demand = 43 units/day × 7 days target − 180 = 121 → rounded up to packing multiple of 40 = 160 → MOQ compliance → 240"
- Order batching to hit freight break points
- Published outcomes: up to 50% fewer stockouts, 30% inventory reduction, up to 50% efficiency gain

*Streamline (GMDH — direct Odoo competitor, mid-market):*
- Native Odoo connector (directly competitive)
- Combines forecast + MRP in one platform
- Published: 90% reduction in manual planning time, 36% inventory reduction

**Demo gap:** The current POC playback shows *that* the system can generate a weekly schedule. It does not show *what the schedule looks like for the full product catalog* or let a decision maker ask "what about this SKU?" The demo is a predetermined film strip, not an interactive tool.

---

### 2.4 Inventory Health Dashboard (vs. "Inicio Operaciones")

**Current:** Static card navigation. Zero data. Zero KPIs.

**Best-in-class (Slim4, Kinaxis Control Tower):**
- Live inventory coverage heat map: SKUs × warehouses, color-coded by days of supply vs. policy
- Working capital breakdown in currency: optimal stock vs. excess vs. at-risk
- Fill rate actual vs. target, updated daily
- Top exceptions with recommended action and financial impact
- "What needs my attention today?" — same mission-brief pattern as purchasing command center

**Demo gap:** Same as Inicio Compras — the page is a sitemap, not a command center. Decision makers evaluating the platform see no demonstration of analytical capability on landing.

---

### 2.5 Stockout Risk Management (vs. "Hot List")

**Current:** Read-only flat table. 4 risk level labels (Crítico/Alto/Medio/Bajo). No filters. No financial context (no GTQ). No recommended action. No projected date of stockout.

**Best-in-class (Kinaxis Control Tower, Slim4, o9):**
- Exceptions ranked by **financial impact** (GTQ revenue at risk), not just urgency label
- Projected stockout date per SKU ("runs out June 12") — not a label, a date
- Recommended action per exception: expedite existing PO / create new PO / transfer from warehouse B / substitute with SKU XXXXX
- Root cause per exception: missed forecast (+30%) / supplier short (-40% of PO qty) / demand spike
- Historical frequency: "this SKU has been Crítico 4 times in the last 90 days"
- Financial quantification: GTQ revenue at risk = `(days_short × avg_daily_demand × unit_price)` for each item

**Demo gap:** The current Hot List tells a decision maker that something is Crítico. Best-in-class tells them it is Q47,000 in revenue at risk by June 12 because the last Carvajal order came in 40% short, and the recommended action is to place a Q12,000 emergency order today to cover the gap. The difference between a risk label and a decision brief is the difference between a report and a tool.

---

### 2.6 Excess Inventory & Working Capital (vs. "Hold List")

**Current:** Read-only ABC/XYZ table. Visual labels only. No filters. No financial context. Classification has no operational consequence in the app — a CZ item looks identical to an AX item except for badge color.

**Best-in-class (Slim4, Anaplan, StockIQ):**

*ABC/XYZ with multidimensional criteria (Slim4):*
- ABC is not just revenue — also order line frequency and gross margin contribution
- The 9-cell matrix (AX/AY/AZ/BX/BY/BZ/CX/CY/CZ) drives automatic stocking parameters: service level target, safety stock method, reorder frequency — all flow from the cell
- Policy changes applied in bulk when an SKU moves cells (seasonal items auto-adjust)

*Excess quantification:*
- GTQ inmovilizado per item: units above max policy × unit cost
- Daily carrying cost: GTQ inmovilizado × holding cost rate
- Disposition options per item: return to supplier / markdown / transfer to location with shortage / do nothing (with cost of inaction shown)
- Inventory aging: 0-30 / 31-60 / 61-90 / 90+ day buckets, each with GTQ value

**Demo gap:** The current Hold List classifies. Best-in-class quantifies and prescribes. A decision maker looking at the current Hold List sees that some SKUs are CZ. They cannot answer "how much of my working capital is frozen in slow-moving inventory right now?" That question — which every CFO and operations director asks — goes unanswered.

---

### 2.7 Days of Inventory (vs. "Días de Inventario")

**Current:** Filterable table. Columns: SKU, bodega, stock, demand/day, days, lead time, status. 100-row cap. No actions. No financial context. No policy compliance view.

**Best-in-class additions (Slim4, Kinaxis, NetSuite):**
- Policy compliance view: current days vs. min/max policy per SKU — "34 days (max is 14)" is more actionable than just "34 days"
- Lead-time-adjusted coverage: effective days before a new order could arrive = days of supply minus lead time. A SKU at 8 days with a 10-day lead time is already past its reorder point.
- Location imbalance detection: same SKU with 45 days in Bodega 1 and 2 days in Bodega 2 — flag before buying more
- Financial context per row: GTQ value of current stock, GTQ excess above max policy

**Demo gap:** The current table shows raw days. Best-in-class contextualizes days relative to policy targets, lead times, and multi-location imbalances. A decision maker looking at "34 días" for a given SKU cannot tell if that is a problem or not without knowing the policy target.

---

## 3. Cross-Cutting Gaps (Affect Both Sections)

### Gap A — No financial quantification anywhere
No page in COMPRAS or OPERACIONES expresses operational state in GTQ terms. The data to compute these numbers — unit costs, demand rates, days of supply — already exists in Supabase. The computation is arithmetic. Yet every KPI in the current app is operational (count of items, days of supply, risk label) rather than financial (GTQ at risk, GTQ frozen, GTQ per day of delay).

**Why this matters for the demo:** Decision makers who approve software purchases are CFOs, operations directors, and founders. They do not act on "Crítico." They act on "Q47,000 in revenue at risk this week." The current app speaks a language that operations planners understand but that budget-holders do not.

### Gap B — No interactive filters on Hot List and Hold List
Hot List: no filters. Hold List: no filters. The decision maker can only scroll.

**Why this matters for the demo:** When a decision maker says "show me only Carvajal items" or "filter to just Bodega 2," the current app cannot respond. The demo breaks at the first natural follow-up question.

### Gap C — Buyers cannot access the live forecast
The live Prophet forecast lives at `/gerencia/forecast`. The COMPRAS role sees `/backtest` — a historical playback. A buyer at the demo cannot navigate to the actual AI forecast output.

**Why this matters for the demo:** The AI forecast is the core value proposition. If the decision maker who will approve the purchase (likely the COMPRAS or operations lead) cannot see it from their role's navigation, the demo fails to deliver the core value message to the right person.

### Gap D — No export
No CSV or Excel export exists on any page.

**Why this matters for the demo:** Executives and planners instinctively reach for "export" to bring data into their existing workflow. When that button does not exist, the implicit message is: "this tool does not integrate with how you actually work." This is a trust-and-professionalism signal, not just a feature gap.

### Gap E — Inicio pages are navigation menus, not command centers
Both Inicio Compras and Inicio Operaciones are card grids pointing to other pages. They contain no data, no KPIs, no live state.

**Why this matters for the demo:** The first screen a decision maker sees after clicking COMPRAS or OPERACIONES should demonstrate analytical capability immediately. A card grid that says "here are 4 sections" communicates a POC. A dashboard that says "5 items are Crítico today, Q82,000 in revenue at risk, 3 orders require your attention" communicates a production system.

### Gap F — ABC/XYZ classification has no operational consequence
The Hold List labels SKUs with their ABC/XYZ class. The classification does not drive any visible stocking policy, parameter, or recommendation in the app.

**Why this matters for the demo:** A CFO or operations director who understands ABC/XYZ will ask: "OK, so what do you do differently for a CZ item vs. an AX item?" The current app has no answer. Best-in-class connects classification directly to policy parameters (service level target, safety stock days, reorder frequency).

---

## 4. Quantified Gap Summary (Demo Impact)

| Feature Area | Current State | Best-in-Class | Demo impact if gap remains |
|---|---|---|---|
| GTQ financial context on Hot List | None | GTQ at risk per item + sort by financial impact | Decision maker cannot act — "Crítico" is not a budget trigger |
| GTQ financial context on Hold List | None | GTQ inmovilizado + daily carrying cost | CFO question "how much is frozen?" goes unanswered |
| Filters on Hot List | None | Supplier, warehouse, category, GTQ threshold | Demo breaks on first follow-up question |
| Filters on Hold List | None | Same | Demo breaks on first follow-up question |
| Forecast accessible to COMPRAS role | Gerencia only | Buyer-accessible forecast view | Core value prop not visible to buyer |
| Hub pages: Inicio Compras / Operaciones | Static card grid | Live KPI command center | First impression is "POC", not "production system" |
| ABC/XYZ policy consequence | Visual label only | Parameters flow from cell assignment | Classification without operational meaning undermines credibility |
| Export to CSV | None | All tables | Trust signal — "this doesn't connect to my workflow" |
| Días de Inventario: policy context | Raw days | Days vs. policy min/max | 34 days means nothing without knowing if 14 is the target |
| Projected stockout date on Hot List | Risk label only | "Runs out June 12" | Urgency is felt, not just labeled |

---

## 5. Most Relevant Benchmarks for This Demo

The platforms most directly comparable to this app's target market (Guatemalan FMCG distributor, Odoo backend, mid-market scale):

1. **Slim4 by Slimstock** — Best UI in the market per independent reviews; FMCG/fresh shelf-life built-in; ABC/XYZ with full policy automation; MEIO. Published: 50% fewer stockouts, 30% inventory reduction. The direct competitor a client might be shown if they do a competitive evaluation.

2. **Streamline (GMDH)** — Native Odoo connector; forecast + MRP combined; targets distributors who outgrew spreadsheets. Published: 90% stockout reduction, 36% inventory reduction. Closest technical competitor.

3. **NetSuite Supply Planning** — ERP-native (no sync problem by definition); time-phased inventory balance; DRP. The incumbent the client may be offered by their ERP vendor.

If a decision maker is evaluating air_lite against any of the above, the gaps documented in section 2 are the gaps that would lose the evaluation.

---

*Sources: SAP Ariba documentation 2025, Oracle Fusion Procurement What's New 25A, Kinaxis Maestro platform pages, o9 Solutions demand planning pages, Blue Yonder Luminate demand planning documentation, Anaplan Inventory Planning App 2025, NetSuite demand planning portal pages, Streamline supply chain planning site, Slimstock Slim4 platform documentation, Coupa Inspire 2025 announcements, Deloitte Agentic Supply Chain 2026.*
