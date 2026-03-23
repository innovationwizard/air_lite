# Clarifying Questions

**1. Role definitions**
The old system had 7 roles. The plan said 2 (admin, viewer). You now want superuser. I need to know the exact role hierarchy for air_lite:

Superuser (you, the developer): What specifically should this role see/do that others can't?
Admin (client-side administrator): What can they do that a viewer can't?
Viewer (standard user): Read-only access to backtest + fear pages?
Or do you want a different structure entirely?
--> It was my mistake to not read the plan thoroughly. I didn't notice it said 2 roles. 
--> I need: 
--> Superuser, me, developer: In addition to everything every other role can see and do, I need basic system health and performance kpis. 
--> Admin, client-side "app owner" has all app management pages with client specific crud: users, market segments, product categories, supplier classifications and sub-clasiffications.
--> Gerencia, client-side decision makers, read only access to all kpis of all roles. 
--> Compras, purchasing manager, up front: "The app tells me what to buy, how much to buy, and when to buy it."
--> Ventas, sales manager, up front: "The app predicts demand with all levels of granularity, clearly labeling how reliable the on screen prediction is."
--> Inventario, warehouses manager, up front: "The app tells me what to move from where to where and when, and why."
--> Financiero, CFO, up front: "The app tells me what to do to increase the company ROI, and what not to do to increase the company ROI."

**2. Superuser dashboard — what data?**
The old changelog described AI model metrics (accuracy, WMAPE, bias, latency), system overview (API calls, uptime), data quality scores, and model alerts. All of those were powered by old api-node endpoints that no longer exist.

On our current stack (Supabase + Railway), what real data can the superuser dashboard show? I can pull:

Database table row counts and date ranges (data freshness)
Backtest run history (which cycles ran, duration, products modeled)
Railway ML service health
User list from Supabase Auth
App settings (holding cost rate, etc.)
Is this the right scope? Or do you have specific metrics in mind?
--> Data freshness
--> Backtest stats
--> ML health, highlighting when something went wrong
--> User crud
--> App settings
--> No additional metrics in mind for now

**3. User management — Supabase Auth Admin API**
Supabase Auth has an admin API (via service role key) that supports creating, listing, updating, and deleting users. Should user management go through this API? Or do you want a separate users table in our schema?

We already have user_profiles (extends auth.users with role and tenant_id). My plan would be: Supabase Auth for authentication, user_profiles.role for authorization, admin API for user CRUD.
--> Users table in our schema

**4. RLS enforcement**
Currently RLS policies are permissive (service role bypasses). Should the RBAC enforce row-level security based on role? For example, should viewers be blocked from accessing certain API routes, or is this purely UI-level (hide nav items)?
--> Enforce RLS based on role. 