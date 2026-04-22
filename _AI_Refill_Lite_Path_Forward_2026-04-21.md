# AI Refill Lite — Path Forward

**Date:** 2026-04-21
**Sources:** [SUPERREADME.md](SUPERREADME.md) + everything under [changelogs/](changelogs/)
**Purpose:** Take stock, name the next fork in the road, and surface the questions that unblock it.

---

## 1. Current Status

### 1.1 What is built and working

The deep refactor from the original `airefill` monolith to **AI Refill Lite** is effectively complete. The system described in [SUPERREADME.md](SUPERREADME.md) exists as three deployed services plus a cleaned repo:

| Service | Stack | Status |
|---|---|---|
| Frontend | Next.js 14 App Router on Vercel | Built, auto-deploys from `main` ([2026-03-22](changelogs/2026-03-22_deep-refactor-phases-0-6.md)) |
| ML service | Flask + Prophet + Gunicorn on Railway | Deployed, Prophet backend issue resolved ([2026-03-23](changelogs/2026-03-23_prophet-docker-fix-and-precomputation.md)) |
| Database | Supabase PostgreSQL (24 tables, 8 RPCs, RLS) | Migrated, seeded, validated against Odoo SSOT ([2026-03-23](changelogs/2026-03-23_ssot-validation-and-cleanup.md)) |

Core proof points already shipped:

- **Backtest engine:** 14 cycles pre-computed (Jan 2025 → Feb 2026), 1,400 per-product predictions, cumulative savings demonstrated **GTQ 14,632,624** ([2026-03-23](changelogs/2026-03-23_prophet-docker-fix-and-precomputation.md)).
- **Purchase Scheduling POC (Carvajal + Reyma):** 61 weeks pre-computed, 0 failed cycles, 2.3M units / GTQ 217M recommended, respects the 14-day ceiling / 7-day reorder policy ([2026-03-24](changelogs/2026-03-24_purchase-scheduling-poc.md)).
- **Census Filter** extracted and active in `ml/census_filter.py` — the core IP that differentiates the forecast.
- **SSOT validation:** revenue within −3.91%, quantity within +1.83%, inventory within −0.67%, product ranking exact match vs the Odoo 2026-03-03 snapshot ([2026-03-23](changelogs/2026-03-23_ssot-validation-and-cleanup.md)).
- **RBAC:** 7 roles defined, `route_permissions` table, RLS policies on all business tables, user CRUD page at [/admin/usuarios](frontend/src/app/(authenticated)/admin/usuarios/page.tsx) ([2026-03-23](changelogs/2026-03-23_rbac-superuser-user-management.md)).
- **Superuser dashboard:** real ML health, backtest history, data freshness — no mock data ([2026-03-23](changelogs/2026-03-23_rbac-superuser-user-management.md)).

### 1.2 Known defects (called out in the changelogs themselves)

From [2026-03-23_prophet-docker-fix-and-precomputation.md](changelogs/2026-03-23_prophet-docker-fix-and-precomputation.md), under "Known issues in results (to investigate)":

| Defect | Symptom | Blast radius |
|---|---|---|
| `storage_savings_pct` = 0% across all 14 cycles | Storage card reads zero | Goal 1 (Storage Cost Reduction) is currently vapor |
| `stockout_savings_pct` flat 80% | Same value every cycle | Goal 3 (Lost Sales) looks hardcoded, not modeled |
| `rotation_improvement_pct` flat 53.85% | Same value every cycle | Goal 4 (Inventory Rotation) looks like a placeholder |
| Jul 2025 shows GTQ 0 total savings | One of 14 cycles is empty | Breaks the timeline narrative for that month |

Three of the four contractual savings goals are currently suspect. This is the single biggest credibility risk on the landing page.

### 1.3 Known data gaps

- **Credit notes** ("Nota de crédito de cliente") were excluded from the Odoo `account.move` export. Closes roughly 1.85pp of the aggregate margin gap and ~5% of revenue ([2026-03-05 UoM fix](changelogs/2026-03-05_uom-normalization-fix.md), [2026-03-05 ventas SSOT](changelogs/2026-03-05_fix-ventas-ssot-alignment.md)). Still open as of 2026-03-24.
- **`stock_quants` snapshot** is frozen at 2026-03-03. Every day that passes widens the gap between our "current" state and true current state.

### 1.4 Documentation drift (important)

[SUPERREADME.md](SUPERREADME.md) describes a **dual-database architecture** (Supabase + Aurora), a **Fastify API on ECS Fargate**, **Prisma in `api-node/`**, and a **CDK infra stack** — all of which were deleted in [2026-03-23_ssot-validation-and-cleanup.md](changelogs/2026-03-23_ssot-validation-and-cleanup.md). Sections 3 (Architecture Overview), 4 (Tech Stack → Backend API), 5 (Repo Structure → `api-node/`), 6 (Database Schema → Aurora), 12 (API Layer / Fastify), 18 (Role-Based Dashboards via Fastify), 21 (API env vars), 24 (Deployment Topology → ECS/Aurora/ALB), and 25 #9 (Dual Database) all reflect state that no longer exists on disk.

The README is the first thing anyone new (or future-you) will read. It currently misrepresents the system.

### 1.5 Deferred scope (self-declared)

From the refactor plan and the RBAC changelog:

- `/productos` and `/productos/[id]` — not built
- `/configuracion` — not built
- Dashboards for **Compras, Ventas, Inventario, Financiero** — RBAC rows exist but no pages; these users currently see the same screen as Gerencia ([2026-03-23 RBAC](changelogs/2026-03-23_rbac-superuser-user-management.md), "Deferred" section)
- Phase 7 hardening list (error boundaries, skeletons, ISR, indexes, rate limiting, input validation, unit tests, integration test, E2E test, `validate-data.ts`) — entirely pending

---

## 2. Most Likely Paths Forward

These are not mutually exclusive, but budget is. Ranked by the leverage they give the next client conversation.

### Path A — Fix the four savings numbers (highest leverage, smallest surface)

The backtest is the app's single most compelling surface. Three of its four headline numbers are currently static or zero. This is a credibility landmine that will get noticed in the first serious demo.

**Scope:**
- Diagnose and fix `storage_savings_pct` (likely a null-join on inventory value in `ml/savings/storage_cost.py` or the `get_avg_inventory_value()` RPC).
- Replace the hardcoded 80% prevention rate in `ml/savings/lost_sales.py` with something data-driven (e.g. per-product historical fill-rate once inventory is available).
- Investigate the flat `rotation_improvement_pct` — whether it's a constant or a ratio that collapses to a constant.
- Resolve the Jul 2025 zero-savings cycle.
- Re-run the 14-cycle pre-computation once fixes land.

**Why first:** cheaper than building new pages, and the landing page does not work credibly until this is done.

### Path B — Ship the Purchase Scheduling POC to the client

Per user memory, the client's #1 pain is truck/container loading scheduling. The [2026-03-24 POC](changelogs/2026-03-24_purchase-scheduling-poc.md) is the most direct answer the app has to that pain. It's pre-computed and visible at [/poc/programacion](frontend/src/app/(authenticated)/poc/programacion/page.tsx).

**Scope:**
- Client walkthrough / packaging (slides, screen recording, stakeholder list).
- Tighten the Carvajal/Reyma scope: the changelog notes Reyma is identified by name substring, not `product_suppliers` — fragile.
- Decide whether to generalize the POC into a `Compras` dashboard (Path D1 below) or keep it as a standalone demo.

**Why second:** proves forward-looking value, not just retrospective savings — and maps directly onto the client's stated pain.

### Path C — Refresh the data and close the credit-note gap

The `stock_quants` snapshot is from 2026-03-03; today is 2026-04-21. A ~7-week-old snapshot with missing credit notes is a hard ceiling on how defensible the numbers are.

**Scope:**
- Re-export `account.move` from Odoo including `Nota de crédito de cliente`.
- Re-run `scripts/ingest.py`, `reconstruct_inventory_daily()`, `aggregate_demand_daily()`, `validate_reconstruction()`.
- Re-run the 14-cycle backtest pre-computation and the 61-week purchase schedule pre-computation.
- Decide on a refresh cadence (weekly? monthly?) and whether it's automated or manual for now.

**Why third:** underpins both A and B. If the data is stale at the client meeting, everything else is undermined.

### Path D — Build the role-specific dashboards

The RBAC infrastructure is ready; the pages are not. Users assigned `Compras`, `Ventas`, `Inventario`, `Financiero` today see the same backtest + fear pages as `Gerencia`. Mentioned as deferred in the [2026-03-23 RBAC changelog](changelogs/2026-03-23_rbac-superuser-user-management.md).

**Four dashboards, each with a single sentence of value:**
- **D1. Compras:** "What to buy, how much, when" — natural home for the purchase scheduling POC.
- **D2. Ventas:** "Demand predictions with granularity and reliability labels."
- **D3. Inventario:** "What to move from where to where, and why."
- **D4. Financiero:** "ROI impact analysis."

**Why fourth:** these are net-new surface area. Each one is a several-day build and worth doing only after Paths A/B/C land — otherwise we're building more pages on top of suspect numbers.

### Path E — Phase 7 hardening + update SUPERREADME

Listed last not because it's unimportant but because nothing in it moves the client conversation. The one sub-item that is high-leverage:

- **Update SUPERREADME.md** to reflect the post-cleanup architecture. Every day it stays stale is a day onboarding / context-loading gets harder.

The rest of Phase 7 (error boundaries, skeletons, ISR, indexes, rate limiting, tests) is table stakes for production but not a gating item for the next client milestone.

---

## 3. Critical Clarifying Questions

Ordered so the first few unblock the most decisions.

1. **Is there a scheduled client meeting?** If yes, when, and what must be demo-ready by that date? This single answer reorders every path above.
2. **Which demo vehicle is the client closure pitch — the retrospective backtest, the forward-looking purchase scheduler, or both?** Path A vs Path B vs "do both" has materially different budgets.
3. **Are the four known savings-calculation defects acceptable to show the client, or blockers?** The changelog flags them explicitly; we need an explicit call.
4. **Have credit notes been re-exported from Odoo yet?** Two separate changelogs name this as an action item; unclear if it's been done.
5. **What is the current refresh posture — one-shot demo data, or is someone supposed to be refreshing it?** The 2026-03-03 snapshot is getting stale.
6. **Does the client expect the four departmental dashboards (Compras / Ventas / Inventario / Financiero) for this milestone, or is single-surface (backtest + fears + POC) enough?**
7. **What does "live" mean for this project right now — are Vercel / Railway / Supabase all actually serving real traffic on `airefill.app`, or is the app still pre-launch?**
8. **For the Purchase Scheduling POC: is the current Reyma identification (name-substring match) acceptable, or do we need proper `product_suppliers` linkage before client demo?**
9. **7-role RBAC: are there real users for `Compras`, `Ventas`, `Inventario`, `Financiero` today, or only `superuser` / `admin`?** Drives whether Path D is real or theoretical.
10. **Is the `airefill_dagster/` inventory-optimization logic that wasn't extracted to `ml/` still needed anywhere, or is it safe to retire?** The refactor changelog kept it "for reference" but the cleanup changelog didn't delete it.

---

## 4. Other Thoughts, Insights, Recommendations

### 4.1 The backtest narrative is the thesis — protect it

"Si hubiera contado con AI Refill durante {mes}, habría ahorrado GTQ {X}" is the app's signature claim. Three of the four goals feeding that number are currently broken or hardcoded. Until Path A lands, the product is one curious client question away from an uncomfortable meeting. Fix-before-feature.

### 4.2 Pre-computation was a smart bet, but it's now technical debt

14 backtest cycles + 61 purchase-schedule cycles are pre-computed and pinned to a 2026-03-03 snapshot. That was the right call for a deterministic demo. It also means: every data refresh is a ~25-minute recompute, and every schema change to `backtest_results` or `purchase_schedule_lines` invalidates pre-computed state. Worth naming a policy: *"pre-computed fixtures live until the next Odoo export; then they regenerate."*

### 4.3 The fear-based UX is a genuine differentiator — but it's also underbuilt

Four fear pages exist. The UX bet ([SUPERREADME §19](SUPERREADME.md)) is that non-technical users think in fears, not entities. That's a strong framing, but the surface is thin: if a client adopts the product seriously, they will ask for more fears (supplier risk, margin compression, customer churn, exchange-rate exposure). Worth deciding whether this is a 4-fear product or a growing taxonomy.

### 4.4 Dual-auth is listed as a feature — but after the cleanup it's really single-auth

[SUPERREADME §7](SUPERREADME.md) describes "Supabase Auth + Custom JWT (API)". The custom JWT path lived in `api-node/`, which was deleted. The app is now **Supabase Auth only**. Worth aligning the README and confirming no stray code (middleware, cookies) still references the deleted JWT flow.

### 4.5 Holding cost rate is a nice piece of transparency

Exposing `holding_cost_rate` as an input the user can override ([backtest page](frontend/src/app/(authenticated)/backtest/page.tsx)) is a smart trust-building move — it lets the client argue with the assumption instead of with the system. Consider whether the other constants (`service_level_z_score = 1.65`, `stockout prevention 80%`, `max_products = 100`) deserve the same treatment.

### 4.6 The purchase-scheduling POC is a stronger commercial hook than the backtest

The backtest answers "what would you have saved last month?" The POC answers "what should you buy next Monday?" The second is the one a buyer writes a check for. If one surface is going to get promoted to a real dashboard, [2026-03-24 POC](changelogs/2026-03-24_purchase-scheduling-poc.md) is the one.

### 4.7 Suggested next-two-weeks sequencing (if no client deadline forces otherwise)

1. **This week:** Path A (fix the four savings numbers), plus update SUPERREADME.md as a side task. Low surface, highest credibility gain.
2. **Next week:** Path C (re-ingest with credit notes, refresh snapshots, re-run pre-computation), then Path B packaging (client walkthrough of the purchase scheduler).
3. **After that, gated on answers to §3:** Path D1 (Compras dashboard as the home for the POC) is the highest-ROI new surface.

Phase 7 hardening slots in opportunistically alongside all of the above — not as its own sprint.

---

*Grounded only in SUPERREADME.md and changelogs/. Anything outside those sources is explicitly flagged above.*
