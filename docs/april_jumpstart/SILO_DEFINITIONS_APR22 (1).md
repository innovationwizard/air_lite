# SILO DEFINITIONS — Wilmer & Mario

**Date:** April 22, 2026  
**Source:** Raw transcript (Suplicentro1.txt) + Suplicentro_Reports_Summary.txt + Especificaciones.pdf + Respuestas.pdf + all handover docs  
**Purpose:** Define and scope exactly what each person needs to see when they log in.

---

## INSIGHTS FROM RAW TRANSCRIPT MISSED IN PREVIOUS DOCS

The summary docs (Suplicentro_Reports_Summary.txt, Especificaciones.pdf) captured the report structure but missed the emotional and operational reality. Here's what the raw transcript reveals:

### 1. Furgones as overflow storage (CRITICAL for Mario)
They park furgones OUTSIDE the warehouse as buffer storage for the top 7 codes. They literally unload from parked containers as customer orders come in. They have NEVER had safety stock for their top products. The warehouse isn't just "always full" — it has physically overflowed into the parking lot.

### 2. Archived codes destroy history (CRITICAL for Wilmer)
When they change a UOM on a product, Odoo forces them to archive the old code and create a new one. All sales history dies with the archived code. Wilmer manually merges the two lines in Excel by matching the product code. This has caused purchasing errors — they once stopped ordering top codes from Reyma because the new codes showed zero history. They ran out of stock.

### 3. Homólogos exist ONLY in people's heads
Product substitutes (e.g., "vaso de cartón 811" has 8 substitute codes from different suppliers) aren't documented anywhere in the system. The rule "don't buy this AND that simultaneously" lives in one person's mind. When that person isn't available, wrong purchases happen.

### 4. "Never be out" codes have no system flag
Institutional/supermarket clients (Walmart-type) require permanent stock. Running out means losing the client permanently — they switch to a competitor. These codes need higher safety stock, but Odoo has no way to mark them. Wilmer carries this classification mentally.

### 5. Reserved inventory is invisible to purchasing
Vendedores reserve large quantities (600 cases for a single dispatch on a future date). That reservation eats into available inventory, but the purchasing team can't easily see what's reserved vs. truly available. Mario says this directly causes space conflicts.

### 6. Roberto asks "how many days of inventory?" multiple times PER DAY
Roberto (Gerencia Comercial) needs this constantly to manage suppliers (telling El Salvador/Mexico to hold or accelerate shipments). He wants it on his phone. Today: he calls Mario, who doesn't have the answer either. They wait for month-end close, which takes 15 DAYS.

### 7. Import containers carry 1.5-2 months of inventory, mixed
7-8 Colombian/Chinese containers arrive with mixed SKUs. Some codes sell out in 2 weeks, others sit for 2 months. They can't control the mix within a container. The next shipment might bring more of what's overstocked.

### 8. Sales frequency ≠ replenishment frequency (Mario's space insight)
A customer buys 125/month, but all on the 30th. Product arrives on the 2nd. For 28 days, 125 units occupy space doing nothing. Mario says: "If we could match real sales frequency with replenishment frequency, we could solve the space problem." He estimates this affects ~10% of products but those 10% represent massive volume.

### 9. BOM/packaging materials are a mess
They supply ALL packaging to maquiladores (contract manufacturers). UOM conversions are broken in Odoo. They have Q100,000+ in obsolete bags from 2021-2022 that are degrading. They can't track packaging consumption, leading to chronic over-ordering.

### 10. "It's cultural, not technical"
Mario explicitly says vendedores don't know how to check inventory in Odoo. They call to ask. If the tool isn't dead-simple and visual, it won't get adopted. "If it's like Excel where you press something and see — that would be great."

### 11. Purchases are PER distribution center
Each bodega/CD generates independent purchase orders. Wilmer forecasts globally then distributes per CD. But salesperson-to-bodega mapping is messy — a salesperson in Zacapa might sell from San José.

### 12. Forecast meetings have improved but are still manual
Used to review 150 codes per supplier meeting. Now down to 20-25. The process works, but requires 3-4 separate Excel downloads, manual merging, and hours of prep. Some suppliers (e.g., "Baica") are already well-controlled.

---

## WILMER'S SILO: "Compras"

### Who is Wilmer?
Comprador (Buyer). Handles local purchases. Works alongside Alexis (imports). Reports to Mario. Lives in Excel. Sophisticated analytical mind trapped in manual tooling.

### His daily pain (verbatim from transcript)
- "No podemos proyectar más allá de tres meses"
- Downloads sales data from Odoo → 10 different reports give 10 different numbers
- Manually merges archived codes by matching product code across two lines
- Carries homólogo/substitute relationships in his head
- Carries "never be out" classification in his head
- Prepares forecast for reconciliation meeting with Ventas (Roberto)
- Can't give solid 3-month forecasts to import suppliers who ask in July

### What the demo should show Wilmer

**Screen 1: Forecast de Demanda (the Excel-killer)**

This is Report 1 from the meeting. It IS what Wilmer builds manually every month.

| What to show | Maps to existing feature | Build status |
|---|---|---|
| Demand forecast per SKU, 12-month horizon | Backtest predicted_demand per product | EXISTS in backtest_results — reframe as forward forecast |
| Historical sales last 6 months per SKU | demand_daily aggregated | EXISTS in Supabase |
| Seasonality index per SKU | Prophet model captures this | EXISTS inside the model, not surfaced in UI |
| Trend (growth/decline) per SKU | Prophet model captures this | EXISTS inside the model, not surfaced in UI |
| Local vs Importado tag | product_suppliers + res.partner.country_id | EXISTS in data, NOT surfaced in UI |
| Lead time per SKU | product_suppliers.delay | EXISTS in data, NOT surfaced in UI |
| Per-bodega breakdown | sale_orders.warehouse_id | EXISTS in data, NOT surfaced in UI |
| Export to Excel | — | NOT built |

**Screen 2: Purchase Scheduling (what to buy, when)**

This already exists as the POC at `/poc/programacion`.

| What to show | Status |
|---|---|
| Weekly purchase plan, Carvajal + Reyma | EXISTS — 61 weeks pre-computed |
| SKU-level quantities per week | EXISTS |
| Respect 1-week max / 3-day min buffer | EXISTS (POC uses 2-week ceiling, spec says 1-week) |

**NOT in scope for the demo (but Wilmer will want later):**

- Forecast comparison: system vs Ventas forecast (needs upload interface)
- Archived code → replacement code mapping table (needs manual input or Odoo query)
- Homólogo/substitute relationships (needs manual input — nobody has this digitized)
- "Never be out" / criticality classification (needs manual flagging by Wilmer)
- BOM/packaging materials explosion (complex, depends on Odoo mrp.bom access which is currently denied)
- ABC/XYZ classification display (the data exists in the backtest, needs a dedicated view)

### Wilmer silo: minimum viable demo surface

1. **Backtest page reframed as "Forecast"** — Show him predicted vs actual per product. Say: "This is your Excel, automated. 12 months, not 3."
2. **Purchase Scheduling POC** — Show the weekly plan for Carvajal/Reyma. Say: "This is what to buy and when."
3. **One card showing unnecessary purchase savings** — "If you'd had this, you'd have saved GTQ X in purchases you didn't need."

Time to get this ready for demo: **0 minutes. It already exists.** Just needs the right narrative framing.

---

## MARIO'S SILO: "Operaciones"

### Who is Mario?
Gerente de Operaciones. Owns the warehouses, the receiving docks, the operational chaos. Reports to Gerencia. Manages Ángel (bodega leader), Jorge (dimensioning). Daily firefighter.

### His daily pain (verbatim from transcript)
- "Hay dos furgones afuera... es mucho volumen" (furgones parked outside as overflow)
- Never knows if inbound containers will fit in the warehouse
- Doesn't know what space is available at any bodega
- Gets asked by Roberto "¿Cuántos días de inventario tengo?" multiple times/day and can't answer
- Reserved inventory is invisible — vendedores block stock, Mario doesn't see it
- 15-day lag on month-end close data means he can't react mid-month
- Top 7 codes have NEVER had safety stock due to space + timing
- Timing mismatch between replenishment arrival and actual customer demand

### What the demo should show Mario

**Screen 1: Inventory Status Dashboard (the daily question killer)**

This answers Roberto's daily question and Mario's capacity anxiety.

| What to show | Data source | Build status |
|---|---|---|
| Days of inventory per SKU | inventory_daily.quantity_on_hand ÷ avg_daily_demand | CALCULABLE from existing data |
| Days of inventory per bodega (aggregate) | Same, grouped by warehouse | CALCULABLE |
| In-transit: what's coming, when, how much | purchase_order_lines where state='purchase', not received | EXISTS in data, NOT surfaced |
| Occupied m³ per bodega | inventory qty × product.volume | CALCULABLE (74.6% of products have volume) |
| Available m³ per bodega | Total capacity − occupied (needs one-time capacity config) | NEEDS manual capacity input |

**Screen 2: Hot List / Hold List (the Carvajal/Reyma communicator)**

From Especificaciones.pdf. This is what Mario sends to suppliers every morning.

| What to show | Calculation | Build status |
|---|---|---|
| Hot List: SKUs < 3 days of stock | inventory_neto ÷ avg_daily_demand < 3 | CALCULABLE |
| Hold List: SKUs > 7 days of stock (over-buffer) | inventory_neto ÷ avg_daily_demand > 7 | CALCULABLE |
| Exportable as PDF for WhatsApp/email to Carvajal/Reyma | — | NOT built |

**Screen 3: Fear pages (already exist)**

| What to show | Status |
|---|---|
| Desabastecimiento (stockout risk) → Mario's Hot List | EXISTS at /preocupaciones/desabastecimiento |
| Capital Congelado (frozen capital) → Mario's Hold List | EXISTS at /preocupaciones/capital-congelado |

**NOT in scope for the demo (but Mario will want later):**

- Rack-level or slot-level warehouse map (nobody tracks what's where at slot level — NOT feasible)
- Receiving dock scheduling / rampa saturation calculation (needs unloading time data, 0% populated)
- Supplier compliance % in time AND quantity per delivery, not just per PO (needs matching PO lines to stock.picking receipts)
- Reserved inventory deduction from available (needs sale_order_lines.reserved_qty visibility)
- Furgón/container volume vs bodega capacity fit/no-fit alert (needs capacity config + inbound volume)
- Mobile-optimized dashboard (responsive design, not a separate build)
- Automated morning report before 8 AM (needs cron + notification service)

### Mario silo: minimum viable demo surface

1. **Fear page: Desabastecimiento** — "These are your products about to stock out. This is your Hot List for Carvajal." Already exists.
2. **Fear page: Capital Congelado** — "These are eating your warehouse space. This is your Hold List." Already exists.
3. **Purchase Scheduling POC** — Reframed: "Here's what's coming to your warehouse, when, and how much. No more surprises."

Time to get this ready for demo: **0 minutes for existing fear pages.** The inventory days / m³ dashboard is NOT built and CANNOT be built in 1 hour.

---

## DEMO STRATEGY: THE HONEST PLAY

You have ~40 showable minutes. Here's the sequence:

### Phase 1 — Wilmer (15 min)
1. Open `/backtest` → show the 14-cycle timeline → click a month → show per-product predicted vs actual
2. Frame: "Esto es tu Excel automatizado. 12 meses de horizonte, no 3."
3. Open `/poc/programacion` → show weekly purchase plan for Carvajal
4. Frame: "Cuando Carvajal te pida el forecast de julio-agosto-septiembre, esto ya lo tiene."
5. Show the unnecessary purchases savings card
6. Frame: "Si hubieras tenido esto, GTQ X en compras innecesarias se habrían evitado."

### Phase 2 — Mario (15 min)
1. Open `/preocupaciones/desabastecimiento` → show stockout risk products
2. Frame: "Esta es tu Hot List. Estos son los que necesitás asegurar que entren primero."
3. Open `/preocupaciones/capital-congelado` → show frozen capital products
4. Frame: "Y estos son los que están comiendo espacio. Tu Hold List para decirle a Carvajal 'no me mandés más de esto.'"
5. Open `/poc/programacion` → same screen, different frame
6. Frame: "Aquí ves qué viene, cuánto, y cuándo. Sin sorpresas."
7. Promise: "El siguiente paso es conectar el volumen de cada producto para decirte exactamente cuántos m³ de tus bodegas están ocupados y cuánto espacio queda. Los datos ya existen en Odoo."

### Phase 3 — Both (10 min)
1. Show the backtest savings headline: "Si hubieran tenido AI Refill, habrían ahorrado GTQ X."
2. Acknowledge: data is from March snapshot. With live Odoo connection, this refreshes daily.
3. Ask: "¿Qué quieren ver primero en la próxima versión?"
4. Listen. Write it down. That's your sprint 1 scope.

---

## POST-DEMO ROADMAP (updated with transcript insights)

### Sprint 1: Wilmer's Forecast Screen (highest ROI, clearest pain)
- Build `/compras/forecast` — demand forecast table per SKU × bodega × month
- Surface Prophet's seasonality + trend as visible columns (not hidden inside the model)
- Add local/importado tag + lead time column from product_suppliers
- Export to Excel button (Wilmer's bridge to his current workflow)
- Duration: 5-7 days

### Sprint 2: Mario's Inventory Dashboard
- Build `/operaciones/inventario` — days of inventory per SKU, per bodega
- Add in-transit column (POs confirmed, not received)
- Add occupied m³ vs capacity per bodega (needs one-time capacity config from client)
- Hot/Hold list as exportable PDF
- Make responsive for mobile (Roberto's phone)
- Duration: 7-10 days

### Sprint 3: Fix Savings + Data Refresh
- Fix the 3 broken savings calculations
- Re-ingest with credit notes
- Fresh Odoo snapshot
- Re-run pre-computation
- Duration: 3-5 days

### Sprint 4: Odoo Live Sync
- Automated daily ingestion via XML-RPC (already proven with odoo_explorer.py)
- Kill the stale data problem permanently
- Duration: 5-7 days

### Sprint 5: The features they'll ask for after the demo
- Archived code mapping table (manual input by Wilmer, or query Odoo for products with same default_code but different IDs)
- Homólogo/substitute parent-child mapping (manual input — this is tribal knowledge digitization)
- "Never be out" criticality flags per SKU (manual classification by Wilmer/Mario)
- Forecast comparison: system vs Ventas upload
- Supplier compliance: % on time + % quantity per delivery
- BOM/packaging materials explosion (blocked by mrp.bom access denial in Odoo)

---

*Based on: raw transcript, meeting summary, Especificaciones.pdf, Respuestas.pdf, SUPERREADME.md, all handover docs, Odoo exploration results, warehouse floor plan, and Q&A session of April 22 2026.*
