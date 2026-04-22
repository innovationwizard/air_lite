# AI Refill / air_lite — Handover for Dedicated Conversation

**Date:** April 21, 2026
**Author context:** I'm stuck. This document exists to start a focused conversation to get unstuck.

---

## 1. CURRENT STATUS

### Two Systems Exist

**AI Refill (Original)** — Production, broken
- Stack: Node.js/Fastify on ECS Fargate, Next.js on App Runner, Aurora PostgreSQL, Prisma
- URL: https://airefill.app
- Data: 94,322+ sales records, 5 dashboards (Ventas, Gerencia, Finanzas, Compras, Inventario)
- AI features built: RFM segmentation, demand forecasting, cross-sell analysis, supplier scorecard, GMROI matrix, stock optimization
- **Known bugs that block trust:**
  - UOM (unit of measure) ratios not applied in calculations (fardo conversion ratios ignored)
  - Suspicious products inflating totals (~Q33M dirty vs ~Q28M clean)
  - Revenue mismatch with IVA expectations
  - Cash conversion cycle returning ~48M days (absurd)
  - Inventory efficiency returning zero
  - Missing fields: `promise_signed_date`, `bank_disbursement_date`
  - Time navigation broken (dashboards hardcoded to current dates, data is from 2022-2023)
  - Export broken (cross-origin cookie issue between www.airefill.app ↔ api.airefill.app)

**AI Refill Lite (air_lite)** — Developed, not deployed
- Stack: Next.js 14 (App Router) on Vercel, Supabase PostgreSQL (24 tables, RLS) + Aurora PostgreSQL (legacy), Flask + Prophet on Railway, Fastify on ECS Fargate
- SUPERREADME: Complete 1,157-line architectural spec (attached separately)
- Data: ~967K stock moves, batch CSV ingestion from Odoo
- **What works (architecturally):**
  - Census Filter (core IP — demand censoring correction)
  - Backtest Engine (Prophet training → prediction → comparison → 4 savings calculations in GTQ)
  - Fear-Based UX (Preocupaciones: desabastecimiento, capital congelado, costos almacenamiento, compras innecesarias)
  - 7 role-based dashboards
  - Dual auth (Supabase SSR + custom JWT)
  - BFF pattern (Next.js API routes → Railway + Supabase)
  - Async ML with 5s polling
  - Spanish-first content with transparent savings formulas
- **What's NOT done:**
  - Not deployed to production (Vercel + Railway + Supabase not live)
  - No real backtest run with client data completed
  - No client demo delivered
  - Automated Odoo data pipeline not built (currently manual CSV exports)
  - Decision pending: sunset original or maintain both?

### Client

- **Companies:** Plasticentro / Suplicentro (distribution/retail, Guatemala, currency GTQ)
- **Key contact:** David (Project Manager at Suplicentro)
- **David has asked** to be taught how to consume his Odoo REST API to produce custom charts/graphs/reports

### Contractual Goals (from client proposal)

1. Reduce storage costs by 15% (6 months)
2. Increase inventory rotation by 20% (12 months)
3. Reduce unnecessary purchases by 20% (9 months)
4. Reduce lost sales from stockouts by 15% (6 months)

### The Core Problem That Started This

> I was not able to do a backtest from the user UI during the decision meeting with the decision makers. It really haunts me.

> AI Refill Lite should have as first mission to demonstrate its own monetary value, month by month, for all the months for which we have data, even if those are just a few months.

> The main backtest UI should run a cycle and return: "Had you had AI Refill this month, you would've saved GTQ (range or approximate number) due to... (very briefly explain the reasoning AND very clearly explain the calculations of the range or approximate number)."

### Strategic Decision (March 31, 2026)

**PROTECT THE MOAT AT ALL COSTS.** The Census Filter is core IP. Productization model is hosted SaaS with Stripe recurring subscriptions. No source code distribution. No downloadable packages.

---

## 2. MOST LIKELY PATHS FORWARD

### Path A: Fix the Original, Abandon Lite
- Fix UOM ratios, filter suspicious SKUs, correct KPIs in the existing production system
- Pros: Already deployed, already has data, client has seen it
- Cons: Architecture has deep issues (dual DB, cross-origin auth, hardcoded dates), fixing it is patching a sinking ship. The original was overbuilt — too many features, benefits unclear to decision makers.

### Path B: Deploy Lite As-Is, Iterate From There
- Get air_lite to production on Vercel + Railway + Supabase
- Run the first real backtest with client data
- Demo to client, collect feedback, iterate
- Pros: Clean architecture, backtest-first UX is the right product, fear-based navigation is intuitive
- Cons: Need to ensure data pipeline works (Odoo → CSV → Supabase), dual DB is transitional debt, some features exist only in original (RFM, cross-sell, supplier scorecard — may not be needed for Lite's mission)

### Path C: Hybrid — Deploy Lite for Backtest, Keep Original for Dashboards
- Lite handles the backtest demo and fear-based pages (its core mission)
- Original stays alive for the 5 department dashboards until Lite absorbs them
- Pros: Delivers the backtest immediately without waiting to rebuild all dashboards
- Cons: Two systems to maintain, two URLs, confusing for client

### Path D: Start Fresh on Lite, Scoped to Backtest Only
- Strip Lite down even further — kill the 7 role-based dashboards for now
- Ship ONLY: backtest engine + 4 savings cards + fear pages
- Minimal viable surface area
- Pros: Fastest to deploy, proves the one thing that matters (monetary value demo)
- Cons: Client may expect the dashboards they've already seen

**My recommendation: Path B or D depending on what's actually blocking you.**

---

## 3. CRITICAL CLARIFYING QUESTIONS

Answer these to determine the path:

1. **What specifically is blocking you right now?** Is it code, data, deployment, architecture confusion, motivation, or unclear next step?

2. **Has the client seen air_lite at all?** Or only the original?

3. **Is the Odoo → CSV → Supabase data pipeline working?** Can you get fresh data from the client's Odoo into Supabase today?

4. **Is the ML service (Flask + Prophet on Railway) deployed and functional?** Or is it local only?

5. **Have you run a single successful backtest — even locally — with real client data?** If yes, what were the results? If no, what broke?

6. **What's the client's current temperature?** Are they waiting patiently, getting frustrated, or have they stopped asking?

7. **Is the dual database (Supabase + Aurora) causing confusion or bugs?** Would you be better off consolidating to Supabase-only for Lite?

8. **David wants to learn Odoo REST API for custom reports.** Is this an opportunity to align — teach him while building the data pipeline you need?

---

## 4. OTHER THOUGHTS, INSIGHTS, AND RECOMMENDATIONS

### The Real Blocker Might Be Scope Creep

The original AI Refill failed in the demo because it had too many features and the value was unclear. Lite was created to fix that. But Lite's SUPERREADME describes 24 tables, 7 dashboards, 8 RPC functions, dual auth, dual databases, and 4 separate services. That's not "lite" — that's a second enterprise system.

If you're stuck, it might be because Lite grew back into the same complexity trap. Consider: what's the absolute minimum to walk into a room, press one button, and show "You would have saved GTQ X,XXX last month"? That's probably:

- 1 page (backtest dashboard)
- 1 button (run backtest)
- 1 ML service (Prophet on Railway)
- 1 database (Supabase)
- 4 savings cards with reasoning
- Data already loaded

Everything else is phase 2.

### The Census Filter Is Worth More Than the App

The Census Filter solves a real problem (demand censoring during stockouts) that most inventory tools ignore. This is publishable, sellable IP. Even if the app struggles, the algorithm has standalone value for the productized SaaS.

### David Is an Asset, Not a Task

Teaching David to consume Odoo REST API isn't a distraction — it's alignment. If David can pull data from Odoo, he can help you validate the data pipeline. Turn the tutorial into a working session that produces the automated Odoo → Supabase ingestion pipeline.

### The Dual Database Is Technical Debt

Supabase (for backtest/KPIs/new features) + Aurora (for legacy API) is explicitly called "transitional architecture" in the SUPERREADME. If this is causing friction, now is the time to consolidate. Lite should be Supabase-only. The Fastify/Aurora/Prisma layer is legacy weight from the original that doesn't serve Lite's mission.

### Timeline Pressure

The contractual goals have timelines: 15% storage cost reduction in 6 months, 15% stockout reduction in 6 months. If the contract started in late 2025, you're approaching or past those windows. The backtest is your defense: "Here's the proof that the model works. Deployment delay ≠ model failure."

---

## ATTACHED FILES FOR THE NEW CONVERSATION

1. **This document** (AIREFILL_HANDOVER_APR21.md)
2. **SUPERREADME.md** (1,157-line architectural spec — upload separately)
3. **Artificial_Intelligence_Refill_v_final.pptx** (contractual goals from client proposal)
4. **Any code files or error logs** from whatever is currently blocking you
