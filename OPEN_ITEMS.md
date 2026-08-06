# OPEN ITEMS — AI Refill Lite (single live index)

**Last updated:** 2026-07-29

> **⚡ Active workstream since 2026-07-23 — COMPRAS / Wilmer xlsx elimination (client-committed: live by Aug 31).** Not tracked in the tables below; its own trackers own the detail: [docs/compras/WILMER_COMPRAS_PROGRESS.md](docs/compras/WILMER_COMPRAS_PROGRESS.md) (xlsx replica — page shipped, engine 99.85% parity) and [docs/compras/REABASTECIMIENTO_LIVE_PROGRESS.md](docs/compras/REABASTECIMIENTO_LIVE_PROGRESS.md) (live-Odoo endpoint — schema applied, sync in design). Open questions: [docs/compras/OPEN_QUESTIONS.md](docs/compras/OPEN_QUESTIONS.md).
> **⚡ Active workstream since 2026-08-04 — ALEXIS xlsx elimination (modelo Reyma, same replicate→replace approach as Wilmer; Wilmer mission still open, runs in parallel).** Exploration complete 2026-08-04; sources + findings live in `20260804/` (gitignored client drop): `MANIFEST.md`, `UNDERSTANDING-ALEXIS.md` (needs/rules from 2026-08-03 call), `DEEP-MANIFEST-XLSX.md` (17-sheet formula map + parity findings), `DEEP-MANIFEST-SALDOS-PEDIDO.md` (Alexis' Claude skill = his approved business rules). **Phase-1 replica BUILT 2026-08-04:** `/inventarios/reyma` live in-app (Inventarios silo, RBAC `CAN_VIEW_INVENTARIOS`) — parity **2,752/2,752 derived cells** vs Alexis' frozen workbook (Python + TS engine, Jest-gated). Plan: [docs/inventarios/ALEXIS_REYMA_REPLICA_PLAN.md](docs/inventarios/ALEXIS_REYMA_REPLICA_PLAN.md) · Tracker: [docs/inventarios/ALEXIS_REYMA_PROGRESS.md](docs/inventarios/ALEXIS_REYMA_PROGRESS.md). Shipped `8bb53e0`; walkthrough held 2026-08-04 — **all 7 open questions answered** ([docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md](docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md): 10 executable phase-2 rules incl. 8-day pendientes age, Z11=entregas directas, NC net-price mechanics, 6 furgones/day shared with Wilmer, per-bodega MRP scope). **Phase 2 unblocked 2026-08-05:** prod creds delivered (`.env.prod`, uid 199, read-only verified — write/create/unlink all denied) and probe confirmed every data need (bodega mapping incl. PAT=1CET/Entrada, Z11=entregas directas, pendientes with dates for the 8-day rule, volumes=cubicajes already in Odoo). Plan: [docs/inventarios/ALEXIS_REYMA_LIVE_PLAN.md](docs/inventarios/ALEXIS_REYMA_LIVE_PLAN.md). **L0+L1 DONE 2026-08-05:** `reyma_*` schema live (migration `20260805000001`, CLI bookkeeping repaired) + `ml/odoo_sync_reyma.py` first sync success (55 products, tránsito=facturado−recibido semantics measured, ventas=delivered). **L2+L3 DONE 2026-08-05:** `/inventarios/reyma-vivo` live through the untouched phase-1 engine (VT10: PM2 7,036 ≈ Alexis' 7,500) **+ write-paths**: proyección overrides con historial/autor, NC Duroport vivo (facturas de proveedor sincronizadas, tarifa/fecha-fin editables, verificación de precios), ETA por furgón, y plan semanal de despacho (bin-packing testeado: 100 m³, VT10 dedicado, sin jueves, máx/día compartido con Wilmer). Next: L3.5 per-bodega MRP (needs ventas por bodega en el sync) → L4 mail ingestion → L5 parallel-run agosto. ⛔ External: David owes the category load — table ready: [docs/inventarios/CATEGORIAS_PARA_DAVID.md](docs/inventarios/CATEGORIAS_PARA_DAVID.md) (0/55 loaded, verified).
**Purpose:** one file to open when returning to this project. Consolidates every live open item across all trackers.
**Context:** live delivery to the client (Plasticentro / Suplicentro) began **2026-07-13**. Production stack today = **Vercel** (frontend) + **Railway** (ML) + **Supabase** (DB/auth).

> **This is an index, not a source of truth.** Each item links to the tracker that owns the detail. Update status here when you update the source doc.
> Historical/superseded plans (`_qci/plan-*`, `docs/april_jumpstart/*`, `changelogs/*`) are deliberately **excluded** — they contain stale checkboxes that are not live work.

---

## At a glance

| Track | Open | State |
|---|---|---|
| **D — Forecasting delivery** | 4 | D1 + D3 startable now; D2 blocked; D4 last |
| **M — AWS migration** | 12 (+M0) | Not started; M0 blocked on external prereqs |
| **H — Hardening** | 2 | H1 done; H2/H3 deferred post-cutover |
| **F — Audit findings (new, untracked)** | 7 | Found 2026-07-13; none previously recorded |
| **C — Commercial / legal** | 6 | #4 closed 2026-07-13 |

---

## 🔴 Blockers & external prerequisites

| Blocker | Blocks | Status |
|---|---|---|
| 2 AWS accounts + cross-account role | M0 → all of Track M | ⛔ Outstanding |
| WorkOS account | M4 | ⛔ Outstanding |
| ~~Odoo API credentials~~ | ~~M0, D3~~ | ✅ **RESOLVED 2026-07-13** — verified live (uid 198, 1,597 products readable). See [SUPABASE_KEY_MIGRATION.md](SUPABASE_KEY_MIGRATION.md) session notes. **D3 is now unblocked.** |

---

## Track D — Forecasting delivery (highest client value)
Source: [june_delivery/TECH_DEBT_PROGRESS.md](june_delivery/TECH_DEBT_PROGRESS.md)

- [ ] **D1 — Derived-ratio verify + Tier-3 fallback.** `forecast_purchases_derived.py` + `/forecast/purchases-derived` + route orchestration are **mostly built**; verify against harness and add Tier-3 fallback (CARVAJAL/REYMA) for 6 SKUs → target +1,069% → ±15%. **Startable now, no blockers.**
  - ⚠️ **Design constraint added 2026-07-29 (Wilmer, verbatim: "hemos comprado mal y re mal, históricamente"):** purchase-history-derived forecasts may inform/reference, but **must NOT determine the purchase recommendation (Sugerido)** — recommendations are demand(ventas)-driven; purchases' one sanctioned use is fill-rate-based safety adjustment. Source: `docs/compras/OPEN_QUESTIONS.md` H1.
- [ ] **D2 — Weight persistence serving.** Load serialized weights from S3 (cached) → millisecond responses. ⚠️ Today Prophet retrains from ~967K stock-move rows on *every* prediction request — **minutes, not milliseconds**. Real UX risk for live use. *Blocked by M7 + M9.*
- [ ] **D3 — Odoo sync Feb–Jun 2026.** Post-sale; respect blind-test cutoff discipline and `_qci/` gates. **Now unblocked** (creds verified 2026-07-13).
- [ ] **D4 — Acid Test 2.** Feb/Mar actuals → predicted-vs-actual report → gain-sharing backtest → present → **sign baseline** (§6.1). *Needs D1–D3 + actuals.*

## Track M — AWS two-account split-plane migration
Source: [june_delivery/TECH_DEBT_PROGRESS.md](june_delivery/TECH_DEBT_PROGRESS.md) · architecture: [Full-AWS-architecture-for-Air-3_0.md](june_delivery/Full-AWS-architecture-for-Air-3_0.md)

**None started.** Sequence: M1 → (M2‖H1) → M3 → M4 → M5 → M6 → M7/M8 → M9 → M10/M11 → M12.

- [!] **M0** — Prereqs. Decisions all locked 2026-07-01; blocked on **external only** (AWS accts, WorkOS, ~~Odoo creds~~).
- [ ] **M1** — AWS foundation, both accounts + cross-account trust
- [ ] **M2** — Aurora Serverless v2 + schema (38 tables / 57 functions) · *data risk*
- [ ] **M3** — Data migration Supabase → Aurora (row-count + checksum parity) · *data risk*
- [ ] **M4** — Auth → WorkOS (SSO + DAL single authz gate + 16 sites) · *authz risk*
- [ ] **M5** — Authz defense-in-depth: least-privilege DB roles, `tenant_id` first-class, real RLS, **remove service-role-from-serving** · *authz risk*
- [ ] **M6** — Data-access layer swap (71 `.from` + 25 `.rpc` FE, 21 ML, 3 storage→S3) · ⚠️ *big code change*
- [ ] **M7** — ML API on App Runner + S3 `air3-weights` + revocable ML API key · *forecast parity*
- [ ] **M8** — Frontend on App Runner (standalone build, cross-account deploy)
- [ ] **M9** — Training pipeline (Lambda/Fargate) + EventBridge cron · *forecast*
- [ ] **M10** — SES email + storage → S3 (tenant-scoped)
- [ ] **M11** — Observability (CloudWatch per account; 5xx/latency/training-fail alarms)
- [ ] **M12** — Cutover blue-green + decommission Railway/Vercel/Supabase · ⚠️ *live client*

## Track H — Hardening
Source: [june_delivery/TECH_DEBT_PROGRESS.md](june_delivery/TECH_DEBT_PROGRESS.md)

- [x] **H1 — Test coverage gate.** Complete, verified, committed `721de37` (34 new tests).
- [ ] **H2 — Pandas 3.0.** Build image → CoW audit → golden-backtest diff → apply. Pandas deliberately held `<3.0` (Batch 5.4). *After H1.*
- [ ] **H3 — Frontend majors.** React 18→19 · Next 15→16 (incl. `next lint` → ESLint CLI) · Tailwind 3→4 · zustand/date-fns/echarts/lucide/TS/ESLint — one at a time, gated by tests. *Deferred until after cutover.*

---

## Track F — Audit findings (2026-07-13) — **not previously tracked anywhere**
Surfaced by a go-live readiness audit. None of these were in an existing tracker.

- [ ] **F1 — `localhost:5000` fallback reaches production.** [backtest/run/route.ts:5](frontend/src/app/api/backtest/run/route.ts#L5) and `backtest/[runId]/route.ts:5` default `ML_SERVICE_URL` to `http://localhost:5000`. If the env var is ever unset, the app silently calls localhost instead of failing loudly. *Fix: fail fast, no fallback.*
- [ ] **F2 — ML coverage gate is nearly cosmetic.** CI enforces `--cov=census_filter --cov-fail-under=95` — a single **17-statement** module. `api.py`, `backtest_engine.py`, `purchase_scheduler.py`, `forecast_*`, `savings/`, and the Odoo modules have **no enforced coverage**. *Ratchet outward.*
- [ ] **F3 — Thin frontend test breadth.** Only 2 test files (`button.test.tsx`, `roles.test.ts`) → 22 tests; the coverage threshold applies to `roles.ts` only.
- [ ] **F4 — Deployment docs contradict reality.** Frontend `Dockerfile` + [frontend/README.md](frontend/README.md) describe AWS App Runner/ECR; the app actually runs on **Vercel**, and `ci.yml` contains **no deploy step** — so the real release mechanism isn't in the repo. *Document the actual path.*
- [ ] **F5 — Stale top-level docs.** [HANDOVER.md](HANDOVER.md), [SUPERREADME.md](SUPERREADME.md), [README.md](README.md) carry "STALE — DO NOT FOLLOW" banners and describe retired AWS architecture. Misleading for any new contributor. *Rewrite or archive.*
- [ ] **F6 — Stray tracked file.** `frontend/temp_fix.txt` — a loose TS snippet committed at the frontend root, wired into nothing. *Delete.*
- [ ] **F7 — Silent `run_id: null`.** [ml/api.py](ml/api.py) `/backtest/run` starts a daemon thread and `join(timeout=5)`; if the run record isn't created within 5s it returns `run_id: null` with no error. *Return an explicit error/202.*

---

## Track C — Commercial / legal
Source: [june_delivery/AIR3_DELIVERY_PLAN.md](june_delivery/AIR3_DELIVERY_PLAN.md) §6

| # | Item | Owner | Deadline |
|---|---|---|---|
| 1 | Sign baseline measurement document | Both parties | "This week" (as of 2026-06-30) — **overdue, tied to D4** |
| 2 | Draft software escrow clause | Jorge (legal) | Before balance hits zero |
| 3 | Define post-balance usage cap | Jorge | After 2–3 months usage data |
| ~~4~~ | ~~Odoo API credentials — verify sync capability~~ | ~~Jorge~~ | ✅ **DONE 2026-07-13** |
| 5 | AWS account setup for ML plane | Jorge | Phase 1 — *gates all of Track M* |
| 6 | Client AWS billing arrangement (invoice format) | Jorge | Phase 1 |
| 7 | Formal contract addendum: IP ownership incl. **weight ownership clause** | Jorge (legal) | Before weight persistence (D2) goes live |

---

## ✅ Recently closed (2026-07-13)

- **ML API auth bypass — FIXED & deployed.** `verify_api_key()` had been hard-coded `return True` since a 2026-04-24 demo, leaving every ML endpoint publicly callable. Restored constant-time `X-API-Key` check, fail-closed when unconfigured. Live-verified: 401 without key. Commit `b295bd7`.
- **Supabase publishable/secret key migration — COMPLETE.** All env vars renamed repo-wide (46 files), Railway + Vercel + local updated, legacy anon/service_role keys **disabled** in the dashboard, `_THE_RULES.MD` flag updated. See [SUPABASE_KEY_MIGRATION.md](SUPABASE_KEY_MIGRATION.md).
- **Odoo connectivity verified** — correct URL/DB/API-key combination established (uid 198, 1,597 products). Unblocks D3.
- **H1 test coverage gate** — committed `721de37`.

### Optional / low priority
- [ ] Browser-login spot-check on `airefill.app` (all server-side signals already green).
- [ ] Retire `_THE_RULES.MD` §ACTIVE-CONTEXT Supabase note once it's no longer newsworthy.

---

## Source documents
| Doc | Owns |
|---|---|
| [june_delivery/TECH_DEBT_PROGRESS.md](june_delivery/TECH_DEBT_PROGRESS.md) | Tracks M / D / H status board — **primary tracker** |
| [june_delivery/AIR3_DELIVERY_PLAN.md](june_delivery/AIR3_DELIVERY_PLAN.md) | Commercial terms, open items §6, scope exclusions §7 |
| [june_delivery/Full-AWS-architecture-for-Air-3_0.md](june_delivery/Full-AWS-architecture-for-Air-3_0.md) | Target AWS architecture |
| [june_delivery/TECH_DEBT_ADDENDUM_2026-06-30.md](june_delivery/TECH_DEBT_ADDENDUM_2026-06-30.md) | Audit addendum |
| [SUPABASE_KEY_MIGRATION.md](SUPABASE_KEY_MIGRATION.md) | Supabase key migration (complete) |
| [_THE_RULES.MD](_THE_RULES.MD) | Operating contract |
