# Clarifying Questions

## A. Scope & Identity

1. Is air_lite a completely separate product from airefill, or will it eventually replace it? This determines whether we rip out everything non-essential or maintain compatibility for a potential merge-back.
→ The plan is to launch air_lite as entry level app, and to comfortable more advanced users upsell a much more powerful air_prime . This does not imply a merge-back. If you find the current structure robust and solid to handle both air_lite and air_prime, keep it. If you find a BETTER structure, more robust and more technologically solid to handle both air_lite and air_prime, then rip out the old structure and build the BETTER ONE. At this point, no scope whatsoever has been defined for air_prime. My mistake with the original airefill was adding everything *I* would like to see, adding features *I* would understand. Wrong approach. The approach for air_lite and air_prime must be demand based. What are real Odoo users really asking for? What are they begging for? What have they found missing or disappointing in currently available Odoo market apps? I'm sure you can do some research to get a good idea. 

2. Domain/branding: Will this deploy to airefill.app (same domain) or a new domain (e.g., airefilllite.com)? This affects CDK DNS, ALB, and frontend config.
→ Same domain, for speed to prod. If money flows, then we get it its own domain and make the corresponding changes. 

3. Multi-tenancy: The current codebase has superuser/tenant management. Does AI Refill Lite need multi-tenancy, or is this single-client (the Guatemala client)?
→ Superuser is me, developer, for app technical configs and app performance visibility. 
→ The original airefill was custom designed for ONE client, with no multi-tenant requirements. 
→ However, the end game IS to sell these apps in the Odoo market, so in the end multi-tenancy will be indispensable. Should we implement it in THIS refactor? I don't think so. As with the custom domain, let it depend on money flowing in. 

## B. Backtest — The Killer Feature

4. What data do you currently have? Specifically:
→ See for yourself. All the data we have is in dir real_data/ 

5. The backtest savings calculation: "Had you had AI Refill this month, you would've saved GTQ X." What specific savings are we calculating? The rationale mentions 4 contractual goals. For the backtest MVP, which ones should the calculation cover?

Reduced storage costs (requires: inventory levels + storage cost per unit)
Reduced unnecessary purchases (requires: purchase orders + what-if optimized orders)
Reduced lost sales from stockouts (requires: stockout events + margin data)
All of the above?
→ All the above. The client must see he is getting what *HE* explicitly asked for. 

6. Backtest UI flow — confirm my understanding:

User lands on backtest page
Sees a timeline of months with available data
For each month: model trains on all prior data, predicts that month, compares to actuals
Output per month: "GTQ savings = X because [reasoning + calculations]"
Is this automatic (runs all months on page load) or does the user click through month by month?
→ On page load, train on the first three months for which we have data and predict the four month. 
→ Give the user a notorious [Predict following month?] button. 
→ If the user clicks, train on the first four months for which we have data and predict the fifth month. 
→ And so on. 

## C. What Stays, What Goes

7. Authentication/RBAC: Does Lite keep the full RBAC system (7 roles), or is it simplified? For a sales-demo-oriented tool, do we even need role-based access?
→ RBAC is incomplete and badly designed. Simplify it. 
→ Organize pages and navigation oriented to client's FEARS: Do not use these names, LOL, but use the concepts: "Affraid of lost sales (stockouts), click here" , "Affraid of storage costs, click here" , "Affraid of frozen capital (excess slow inventory), click here" , etc. 

8. Dashboards to keep: The rationale says "relegate to secondary importance dashboards for analysts, screens for CFOs and CEOs." Does that mean:

(a) Keep all current dashboards but make backtest the landing page, OR
(b) Strip most dashboards and only keep a simplified subset?
→ Strip most dashboards. Keep only what your research says are the most asked for or begged for numbers that companies expect from an AI demand forecaster and AI inventory optimizer. 

9. Dagster pipeline: Does the ML pipeline stay as-is, or does the backtest feature need a fundamentally different pipeline (since backtesting requires training on partial historical data repeatedly)?
→ No holly cows. Most likely, we do need to re think and re design this. 

10. Odoo integration: Does Lite still ingest from Odoo directly, or will you feed it data manually/via CSV for the initial version?
→ It needs to be delivered to the client ready to ingest directly from Odoo. 
→ However, due to my failure in demonstrating the app's value, we were not granted Odoo api credentials. All we have is the data in real_data/ . We must first make it work with the data we have. Then, I can request a second chance to present the app to the decision makers. Then, if approved, Odoo direct integration becomes necessary. 

## D. Technical Decisions

11. Frontend rewrite vs. refactor: The rationale says "needs fresh frontend." Does that mean:
(a) Gut the current Next.js app and rebuild pages from scratch (same framework), OR
(b) A completely new frontend framework/approach?
→ This means sales oriented frontend instead of advanced analytics frontend. 
→ This means that the first and foremost mission of the frontend is to clearly self-demonstrate the monetary value of the app via backtesting. All other pages and views, what the real users will use in real life to make real decisions, is not the centerpiece; it's one click away, not zero clicks away. 

12. Database: Same Prisma schema with tables removed, or a fresh schema designed for Lite's reduced scope?
→ No holly cows. 
→ The plan is to launch air_lite as entry level app, and to comfortable more advanced users upsell a much more powerful air_prime .  If you find the current database design robust and complete to handle both air_lite and air_prime, keep it. If you find a BETTER structure, more robust and more technologically apt to handle both air_lite and air_prime, then rip out the old schema and build the BEST POSSIBLE ONE.

13. Infrastructure: Same AWS architecture (Aurora, ECS, AppRunner), or are you considering simplifying (e.g., single EC2, or even Vercel for frontend)?
→ Let's lighten that too: make it Vercel + Supabase

## E. Timeline & Priorities
What is the first deliverable? Is it:
(a) A working backtest demo you can show in a meeting (sales tool), OR
(b) A production-deployed system the client uses daily?
→ Production-deployed system, ready to use, turnkey. 

15. Is there a deadline or target date for the first usable version?
→ Read _THE_RULES.MD and strictly adhere to them.
→ We will take the time we need, no matter how much time that is, to launch a world-class enterprise-grade exemplary system, somethig the best data science minds of our time, the best machine learning minds of our time, and the best artificial intelligence minds of our time would actually consider exemplary. 