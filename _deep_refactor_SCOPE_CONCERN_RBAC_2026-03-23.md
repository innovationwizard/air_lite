# Scope Concern — RBAC & Role-Specific Dashboards

**Date:** 2026-03-23
**Context:** User requested 7 roles with role-specific dashboards
**Decision:** Build RBAC infrastructure for all 7 roles now; defer role-specific dashboards for Compras/Ventas/Inventario/Financiero

---

## The Concern

The deep refactor rationale explicitly states:

> "AI Refill grew too complex. Too many features crammed in → benefits became unclear to decision makers."
> "Strip down to ONE clear value proposition"
> "Dramatically reduced scope"

The 7 roles requested (Superuser, Admin, Gerencia, Compras, Ventas, Inventario, Financiero) with role-specific dashboards represents the original airefill's feature set rebuilt on the new stack. This risks repeating the exact problem the refactor was created to solve.

## Feature Gap Analysis

| Role | What they need | Exists in air_lite? |
|------|---------------|-------------------|
| Superuser | System health, user CRUD, settings | No — being built now |
| Admin | User CRUD, market segments, categories | No — being built now |
| Gerencia | Read-only all KPIs | Partially (backtest + fear pages) |
| Compras | "What to buy, how much, when" | No — requires purchase recommendation engine |
| Ventas | Demand predictions with granularity | No — requires per-product forecast UI |
| Inventario | "What to move from where to where" | No — requires multi-warehouse optimization |
| Financiero | "ROI impact analysis" | No — requires financial modeling |

## Decision Taken

**Build now (2026-03-23):**
- RBAC infrastructure for all 7 roles (schema, middleware, RLS policies)
- Superuser dashboard (data freshness, backtest stats, ML health, user CRUD, app settings)
- Admin user management (user CRUD via Supabase Auth admin API + user_profiles)
- Role-based sidebar navigation
- API route protection via role middleware

**Defer to air_prime or future air_lite iterations:**
- Compras-specific dashboard ("what to buy, how much, when")
- Ventas-specific dashboard ("demand predictions with granularity and reliability labels")
- Inventario-specific dashboard ("what to move from where to where and when, and why")
- Financiero-specific dashboard ("what to do to increase ROI")
- Admin market segments, product categories, supplier classifications CRUD

**Interim behavior for deferred roles:**
Compras, Ventas, Inventario, and Financiero users see the backtest landing page + fear pages (same content as Gerencia). Their sidebar will show the appropriate section label for their role. When their role-specific features are built, they will be wired into the existing RBAC without any migration.

## Why This Is The Right Call

1. **The backtest demo is the #1 priority.** The user explicitly stated: "I was not able to do a backtest from the user UI during the decision meeting with the decision makers. It really haunts me." Building 4 role-specific dashboards before validating the backtest end-to-end delays the core value proposition.

2. **RBAC infrastructure is cheap; features are expensive.** Defining roles in a database table and checking them in middleware takes hours. Building a purchase recommendation engine takes weeks. We build the infrastructure now so features can be plugged in incrementally.

3. **The original failure mode was feature bloat, not missing RBAC.** The client meeting failed because the app couldn't demonstrate value, not because it lacked role-specific dashboards. Get the value demonstration right first, then add role-specific views.

---

*This concern was raised per _THE_RULES.MD rule 5: "If my premise, instruction, or design appears incorrect, risky, or inconsistent, say so clearly and explain why."*
