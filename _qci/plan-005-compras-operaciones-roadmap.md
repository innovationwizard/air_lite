# Plan 005 — Closing the COMPRAS & OPERACIONES Demo Gaps
**Date:** 2026-05-08  
**Input:** `_qci/gap-analysis-compras-operaciones-vs-best-in-class.md`  
**Objective:** Close the gap between the current POC-grade COMPRAS and OPERACIONES demo pages and a world-class purchasing and inventory operations platform — using the existing real client data snapshot, making the demo compelling enough to close the sale  
**Stack:** Next.js 14 (frontend), Supabase (primary DB + REST API), Railway ML service (Prophet)  
**Constraint:** All features must use real data from the existing Supabase snapshot (PLASTICENTRO, S.A., March 3, 2026). No mock data. No placeholders. No demo modes.  
**Non-constraint:** Live Odoo sync is a post-sale implementation deliverable. It is explicitly NOT a prerequisite for any feature in this plan. The demo must win the sale on the strength of what it shows on the existing data.

---

## What Must Change for the Demo to Close the Deal

A decision maker evaluating this platform needs to leave the demo with answers to three questions:
1. "How much money is this problem costing me right now?" — **financial quantification**
2. "Can this tool show me exactly what I need to act on, right now?" — **interactivity and relevance**
3. "Does this feel like production software or a prototype?" — **professionalism of the experience**

Every item in this plan is evaluated against those three questions. Items that do not affect any of the three are not in this plan.

---

## Priority 1 — Financial Quantification on Hot List and Hold List
**Impact:** Answers question 1. A decision maker who cannot put a GTQ number on their stockout risk and frozen capital has no budget justification for the purchase.  
**Data available in Supabase:** `unit_cost` is in `products.standard_price` (synced from Odoo in the original snapshot). `current_stock`, `avg_daily_demand`, `days_of_supply`, `lead_time_days` already exist in the KPI endpoints.  
**Effort:** Small — arithmetic computed from existing columns.

### 1.1 Hot List: Add GTQ at risk + projected stockout date

**New columns on every row in `preocupaciones/desabastecimiento/page.tsx`:**
- **GTQ en riesgo:** `max(0, lead_time_days - days_of_supply) × avg_daily_demand × unit_price`  
  — This is the revenue at risk if no action is taken before a new order could arrive.
- **Se agota:** today + `days_of_supply` (formatted as "lun 11 mayo")
- **Sort default:** GTQ en riesgo DESC — a large-volume Medio item with Q80,000 at risk ranks above a tiny Crítico with Q800 at risk

**New KPI card:** Replace the 3 existing summary cards with:
1. Items Críticos: count (same)
2. **GTQ en riesgo total:** sum of GTQ en riesgo across all Crítico + Alto items — the single most important number on this page
3. Items monitoreados: count (same)

**API change required in `/api/kpis/stockout-risk`:** Add `unit_price` (from `products.standard_price` join) to the response. The computed `gtq_en_riesgo` and `fecha_agotamiento` fields can be computed client-side.

### 1.2 Hold List: Add GTQ frozen + daily carrying cost

**New columns on every row in `preocupaciones/capital-congelado/page.tsx`:**
- **GTQ inmovilizado:** `max(0, current_stock - max_stock_target) × unit_cost`  
  Where `max_stock_target = max_inventory_days × avg_daily_demand` (both already in the KPI data)
- **Costo por día:** `GTQ_inmovilizado × 0.18 / 365` (18% annual holding cost rate — matches the rate used in the backtest savings calculation)

**New KPI card:** Replace the 3 existing summary cards with:
1. Items en Hold: count
2. **GTQ inmovilizado total:** sum across all Hold items — the CFO's number
3. **Costo por día total:** sum of daily carrying cost — "this is what you're paying every day you don't act"

**API change required in `/api/kpis/abc-xyz`:** Add `unit_cost`, `current_stock`, `max_inventory_days`, `avg_daily_demand` to the response (join from `products` and `inventory_snapshot`).

**Acceptance criteria:**
- [ ] Hot List default sort is GTQ en riesgo DESC
- [ ] Hot List top KPI card shows total GTQ en riesgo across Crítico + Alto items
- [ ] Each Hot List row shows GTQ en riesgo and projected date of stockout
- [ ] Hold List top KPI card shows total GTQ inmovilizado and total Costo por día
- [ ] Each Hold List row shows GTQ inmovilizado and Costo por día

---

## Priority 2 — Interactive Filters on Hot List and Hold List
**Impact:** Answers question 2. The first follow-up a decision maker makes in a demo is "show me just Carvajal" or "filter to Bodega 2." If the filter does not exist, the demo stalls.  
**Effort:** Small — same filter pattern already implemented in Días de Inventario.

### 2.1 Hot List filters

Add above the table in `preocupaciones/desabastecimiento/page.tsx`:
- **Supplier dropdown:** derived from `supplier_name` field in the stockout risk data — "Todos los proveedores" default
- **Warehouse dropdown:** derived from `warehouse_name` — "Todas las bodegas" default  
- **Risk level filter chips:** Crítico / Alto / Medio / Bajo (same click-to-toggle pattern as Días de Inventario status cards)
- **Search:** by SKU or product name

### 2.2 Hold List filters

Add above the table in `preocupaciones/capital-congelado/page.tsx`:
- **ABC class chips:** A / B / C (toggle)
- **XYZ class chips:** X / Y / Z (toggle)
- **Supplier dropdown:** "Todos los proveedores" default
- **Search:** by SKU or product name
- **Sort selector:** by GTQ inmovilizado (default) / by ABC class / by CV de demanda

**Acceptance criteria:**
- [ ] Hot List filterable by supplier, warehouse, risk level, and search
- [ ] Hold List filterable by ABC class, XYZ class, supplier, and search; sortable by GTQ inmovilizado
- [ ] Filter state reflected in KPI card totals (totals update when filters are applied)
- [ ] "Limpiar filtros" button appears when any filter is active

---

## Priority 3 — Policy Context on Días de Inventario
**Impact:** Answers question 2. "34 días" means nothing without knowing if the policy target is 14 or 60. Decision makers will ask "is that good or bad?" — the app must answer.  
**Effort:** Small — policy parameters (`min_inventory_days`, `max_inventory_days`) need to be in the KPI data.

### 3.1 Policy compliance column

Add to `operaciones/dias-inventario/page.tsx`:
- **Column: vs. política** — badge showing:
  - "BAJO mínimo" (red) if `days_of_supply < min_policy_days`
  - "DENTRO de rango" (green) if `min_policy_days ≤ days_of_supply ≤ max_policy_days`
  - "SOBRE máximo" (blue) if `days_of_supply > max_policy_days`
- **Column: GTQ en stock** — `current_stock × unit_cost`

### 3.2 Lead-time-adjusted effective coverage

Add to each row:
- **Cobertura efectiva** = `days_of_supply - lead_time_days`  
  — If negative: "OC atrasada" (red badge). If 0-3: "Pedir ya" (amber). If >3: shows number.  
  This single column tells a buyer, without explanation, which items are already past the reorder point.

**Acceptance criteria:**
- [ ] Each row shows policy compliance badge (BAJO/DENTRO/SOBRE)
- [ ] Each row shows cobertura efectiva with color coding
- [ ] Each row shows GTQ en stock
- [ ] Status KPI cards at top show GTQ total per status bucket (not just counts)

---

## Priority 4 — Forecast Accessible to COMPRAS Role
**Impact:** Answers question 2 + question 3. The AI forecast is the core value proposition of the platform. The COMPRAS role currently cannot see it — they reach `/backtest` which is a savings demo, not a forecast. The decision maker who will approve the purchase needs to see the actual AI-generated 12-month forecast.  
**Effort:** Medium — route existing forecast view (or a buyer-appropriate subset) to the COMPRAS section.

### 4.1 Forecast view for COMPRAS

Create `/compras/forecast` accessible to `CAN_VIEW_COMPRAS`, pointing to the existing forecast page (`/gerencia/forecast`) or a variant of it.

The COMPRAS variant differs from the Gerencia variant:
- Shows all 23 SKUs and the demand + sales forecast lines prominently
- Hides the acid test / model diagnostic panel (superuser-only detail)
- Shows the Historial OC stoplight — buyers need to see which SKUs have strong vs. weak purchase history backing the forecast
- Adds a "¿Qué comprar?" overlay: for each SKU where `days_of_supply < lead_time_days`, surface a banner: "Pedí hoy para recibir antes de que se agote"

Update sidebar `FearsSidebar.tsx`:
- Change "Forecast de Demanda" in the COMPRAS section to link to `/compras/forecast` instead of `/backtest`
- Keep `/backtest` accessible as "Demostración de Valor" (rename the card) — that page has a distinct and valid purpose as a value/savings demonstration

**Acceptance criteria:**
- [ ] `/compras/forecast` exists and is accessible to CAN_VIEW_COMPRAS role
- [ ] Page shows demand + sales forecast for all 23 SKUs
- [ ] Acid test / diagnostic panel is not visible to COMPRAS role
- [ ] Sidebar "Forecast de Demanda" in COMPRAS links to `/compras/forecast`
- [ ] "/backtest" renamed to "Demostración de Valor" in the COMPRAS sidebar card

---

## Priority 5 — Hub Pages: From Card Grids to Command Centers
**Impact:** Answers question 3. The first screen a decision maker sees after clicking COMPRAS or OPERACIONES either says "this is a POC" (card grid) or "this is production software" (live KPI dashboard). Current state: card grid.  
**Effort:** Medium — requires reading from the existing KPI endpoints and combining into a summary view.

### 5.1 Inicio Compras → Purchasing Command Center

Replace `compras/page.tsx` with a live dashboard that reads from existing KPI endpoints:

**Top KPI row (4 cards, data from `/api/kpis/stockout-risk` + `/api/kpis/abc-xyz`):**
1. **Excepciones activas** — count of Crítico + Alto Hot List items
2. **GTQ en riesgo** — sum of GTQ en riesgo across Crítico + Alto items
3. **GTQ inmovilizado** — sum from Hold List
4. **Cobertura promedio** — weighted average days of supply across all SKUs

**Main panels:**
- **Top 5 excepciones** — same as Hot List top 5 by GTQ en riesgo; each row shows SKU, proveedor, GTQ en riesgo, fecha estimada de agotamiento; click through to full Hot List
- **Últimas semanas de programación** — last 3 weeks from `/api/poc/purchase-schedule`; links to full Programación page
- **Snapshot info** — "Datos al 3 de marzo 2026" — honest and clear, not apologetic

### 5.2 Inicio Operaciones → Inventory Health Dashboard

Replace `operaciones/page.tsx` with a live dashboard:

**Top KPI row (4 cards):**
1. **Items Hot** — count with GTQ en riesgo total
2. **Items Hold** — count with GTQ inmovilizado total
3. **Cobertura promedio** — weighted average days of supply
4. **Total en inventario** — GTQ value of all current stock

**Main panels:**
- **Distribución por estado** — horizontal bar: Hot | OK | Hold | Sin demanda (count + GTQ %)
- **Top 5 items críticos** — same as Hot List top 5; click through to full Hot List
- **Top 5 items con mayor capital inmovilizado** — from Hold List sorted by GTQ; click through

**Acceptance criteria:**
- [ ] Inicio Compras shows 4 live KPI cards computed from existing endpoints
- [ ] Inicio Compras shows Top 5 exceptions with GTQ context
- [ ] Inicio Operaciones shows 4 live KPI cards
- [ ] Inicio Operaciones shows Top 5 critical + Top 5 frozen capital items
- [ ] Both pages load in under 2 seconds (parallel fetches from existing endpoints)
- [ ] Hardcoded "Wilmer, empecemos acá" and "Mario, empecemos acá" removed

---

## Priority 6 — ABC/XYZ Policy Consequence
**Impact:** Answers question 2. Currently classification is a visual label. A decision maker who understands supply chain will ask "what does the app do differently for a CZ vs. an AX item?" The current answer is: nothing.  
**Effort:** Small — display only, no new computation.

### 6.1 Show policy parameters derived from ABC/XYZ cell

Add a "Política aplicada" expandable section to each Hold List row (or a policy tooltip on the class badges) showing:

| Cell | Nivel de servicio | Stock de seguridad | Frecuencia de revisión |
|---|---|---|---|
| AX | 99% | 3 días | Semanal |
| AY | 97% | 7 días | Semanal |
| AZ | 95% | 14 días | Bisemanal |
| BX | 97% | 5 días | Quincenal |
| BY | 95% | 10 días | Quincenal |
| BZ | 90% | 14 días | Mensual |
| CX | 95% | 7 días | Mensual |
| CY | 90% | 10 días | Mensual |
| CZ | 85% | 14 días | Mensual |

These parameters are defined policy values — they do not require a database query. They can be displayed as a lookup table rendered from a local constant. The point is to demonstrate that the classification is not decorative — it drives differentiated treatment of each SKU.

**Acceptance criteria:**
- [ ] Clicking an ABC/XYZ cell badge in the Hold List shows the policy parameters for that cell
- [ ] Policy parameters are consistent across all rows (same lookup table)

---

## Priority 7 — Export to CSV
**Impact:** Answers question 3. Buyers and operations directors instinctively reach for "export." Its absence signals "this does not connect to my workflow."  
**Effort:** Small — 2-3 hours per page.

Add export button to: Hot List, Hold List, Días de Inventario, Programación de Compras.

- Exports current filtered view as UTF-8 CSV with BOM (for Excel compatibility with Spanish locale)
- Filename: `{page_name}_{YYYY-MM-DD}.csv`
- All visible columns included, with Spanish headers

**Acceptance criteria:**
- [ ] Export button exists on all 4 table pages
- [ ] Export honors current filters (only exports visible rows)
- [ ] CSV opens correctly in Excel with Spanish column headers

---

## Implementation Order and Effort Estimate

| Priority | Feature | Effort | Deal-closing value |
|---|---|---|---|
| 1 | GTQ quantification on Hot List + Hold List | Small | **Highest** — transforms abstract risk into budget language |
| 2 | Filters on Hot List + Hold List | Small | **High** — demo survives follow-up questions |
| 3 | Policy context on Días de Inventario | Small | High — "34 días" becomes meaningful |
| 4 | Forecast accessible to COMPRAS role | Medium | **High** — core AI value prop reaches the right person |
| 5 | Hub pages → command centers | Medium | High — professional first impression |
| 6 | ABC/XYZ policy parameters shown | Small | Medium — differentiates from a spreadsheet |
| 7 | Export to CSV | Small | Medium — trust and professionalism signal |

**Recommended first session:** Priorities 1 + 2 + 7. All three are "Small" effort. Together they deliver GTQ context on every critical page, interactivity on the two most important lists, and export everywhere. A demo with these three done tells a decision maker: "this tool knows what your stockout costs you, lets you slice it any way you want, and works with your existing Excel workflow."

**Second session:** Priorities 3 + 4 + 5. The policy context, forecast access, and command centers complete the professional production-grade feel.

**Third session:** Priority 6. Policy parameterization adds depth for technically sophisticated buyers.

---

## What This Plan Does NOT Include

Excluded because they are post-sale implementation features, not demo-closing features:

- **Live Odoo sync** — Post-sale. The demo runs on real client data that already exists in Supabase.
- **Purchase order creation workflow** — Post-sale. Requires Odoo write-back, approval workflow, user identity management at production level.
- **Supplier management pages** — Post-sale. Requires live supplier data and ongoing performance tracking.
- **Approval workflows** — Post-sale. Enterprise requirement but not a demo differentiator.
- **Email/push notifications** — Post-sale. Threshold alerts require live data cadence.
- **Multi-echelon inventory optimization** — Post-sale. Complex math on live data; overkill for the demo.
- **Scenario planning** — Post-sale. Requires parameterized policy simulation on live inventory.
- **Agentic AI / touchless planning** — Future product direction, not demo scope.

The boundary is clear: everything in this plan runs on the existing Supabase snapshot and makes the demo more convincing. Everything excluded requires live Odoo integration and delivers value only after the sale is closed.
