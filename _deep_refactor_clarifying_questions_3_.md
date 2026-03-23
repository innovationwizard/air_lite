# Clarifying Questions 3

**1. Old code cleanup — timing**
The plan says "Remove api-node/ once all SQL patterns confirmed working in Supabase RPC." The RPC functions are deployed and the data is loaded. The old code adds ~1,100 files of noise to the repo and causes CI failures (the workflow no longer references it, but its presence can confuse future work).

Do you want me to delete api-node/, airefill_dagster/, frontend/src/services/, frontend/src/stores/auth-store.ts, and all other orphaned old code NOW as the first step? Or do you want to keep them as reference until the backtest has been validated end-to-end with real results?
--> Delete now. 

**2. /productos page — scope**
The plan describes a product list with current metrics and a deep-dive page per product (demand history, inventory history, forecast, ABC/XYZ, profitability). This is secondary navigation per the rationale ("one click away, not zero clicks away").

Is this page needed before you demo the backtest to decision makers? Or can it be deferred until after the backtest landing experience is proven working end-to-end?
--> After backtest is proven.

**3. /configuracion admin page — scope**
The plan describes: data status, import trigger, holding cost rate setting, user management. The holding cost rate is already surfaced on the backtest page itself (per your explicit instruction).

What specifically do you need on this page for the first production deploy? Just data status (row counts, date ranges) + user management? Or is there something else?
--> Defer. 

**4. Fear page components — what's actually needed**
The fear pages (/preocupaciones/*) exist as pages that fetch data from the KPI API routes. The frontend/src/components/fears/ directory is empty. The pages currently render the data inline.

Do you want me to extract reusable components from the existing fear pages, or are the pages working as-is and this is just a code-organization concern that can wait?
--> I don't know what this is. Delete it. 


**5. End-to-end backtest validation — the critical path**
The backtest is the killer feature. It's built (engine, savings, API, frontend), deployed (Railway + Vercel), and the database has 1.6M+ rows of real production data. But it has not been run yet. The first real backtest cycle — training on Oct-Dec 2024, predicting Jan 2025 — has not been executed.

Should validating the end-to-end backtest flow be the #1 priority before anything else? This means: create a Supabase Auth user → log in → trigger the backtest → verify the savings numbers make sense against the real data.
--> This is priority 2. 
--> Priority 1 is making sure that the numbers output by the app match the SSOT @_______Odoo.pdf

**6. CI pipeline — currently broken**
Both CI jobs fail (frontend lint warnings from old code, ML has no tests/ directory yet). The plan's Phase 7 includes tests.

Is fixing CI a priority now, or can it wait until Phase 7?
--> Can wait. 