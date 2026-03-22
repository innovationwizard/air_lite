# Odoo Marketplace Research: Inventory Optimization & Demand Forecasting
## User Pain Points, Gaps, and Opportunities — March 22, 2026

---

## 1. Most Common Complaints About Existing Odoo Inventory/Demand Forecasting Apps

### Native Odoo Forecasting is Deterministic, Not Predictive
The single most repeated complaint across forums, blogs, and reviews is that **Odoo uses deterministic projection, not statistical or ML-based forecasting**. The "Forecasted Inventory" report simply calculates: `On Hand + Incoming (confirmed POs) - Outgoing (confirmed SOs)`. It cannot detect seasonal trends, demand patterns, or growth trajectories. Users who need real forecasting end up exporting to Excel.

### Reorder Rules Are Static and Manual
Odoo's reorder rules require manually-set min/max values that **do not auto-adjust** based on historical demand. Users on the Odoo forum explicitly ask: "How to calc max value product based on history?" One user noted: "At this moment, maybe we set Max as 30, but next month, maybe Max is 50" — the system has no mechanism to adapt. There is no native EOQ (Economic Order Quantity) calculation.

### Third-Party Apps Are Immature or Buggy
- **TechFinna Inventory Forecasting** ($1,462.90): A detailed December 2025 review reported deployment bugs, license activation delays, inability to identify companies, and that "forecast calculation is wrong" because an override field defaults to 1, producing identical forecasts across all variants. The reviewer concluded: **"Not ready for production use."**
- **Most AI forecasting apps have zero reviews** on the Odoo Apps Store. The `pv_ai_demand_sense` and `im_ai_inventory_forecast` apps show no user reviews or ratings despite being listed.
- Apps that do work often use basic statistical methods (AutoReg, ARMA) rather than modern ML approaches.

### No Unified View
Users consistently report there is **no single view** showing stock levels, incoming supply, and expected demand together. Weekly trend analysis is not available on monthly reports. Seasonality is "known but never formally accounted for."

---

## 2. Most Frequently Requested Features

### Automated, Intelligent Reorder Points
- Auto-calculate min/max based on historical sales velocity, lead times, and seasonality
- Dynamic safety stock that adjusts to demand variability
- EOQ optimization at the supplier level (group orders)
- DDMRP (Demand Driven MRP) — explicitly referenced by community members as the desired direction

### True Demand Forecasting
- ML-based prediction using historical sales data (not just open orders)
- Seasonality detection (weekly, monthly, yearly patterns)
- Handling of zero-stock periods (adjusting forecasts when stockouts suppressed sales)
- New product launch spike detection and adjustment
- Promotion/event-aware forecasting

### ABC/XYZ Analysis and Dead Stock Detection
- Native ABC classification by revenue/margin contribution
- FSN (Fast/Slow/Non-moving) analysis
- Dead stock and obsolescence alerts
- These are **not built into Odoo** and require third-party apps

### Multi-Warehouse Intelligence
- Location-specific forecasting and reorder optimization
- Cross-warehouse stock balancing recommendations
- Unified visibility across all warehouses

### Supplier Scorecards and Lead Time Tracking
- Automated vendor performance scoring (on-time delivery, quality)
- Lead time variability tracking to feed into safety stock calculations
- Odoo lacks this natively; it requires customization

---

## 3. Top-Rated / Notable Apps and Their Reviews

| App | Price | Odoo Version | Key Features | User Feedback |
|-----|-------|-------------|--------------|---------------|
| **TechFinna Inventory Forecasting** | $1,462.90 | 15-19 | Sales history analysis, RFQ creation, 500+ SKU support | **Negative**: "Not ready for production" — bugs, wrong calculations |
| **AI-Powered Inventory Forecasting** (Farid Slimani) | $285.75 | 18-19 | Prophet/ARIMA/Ensemble, smart alerts, auto reorder optimization | **No reviews** — claims 85-95% accuracy, 40-60% stockout reduction |
| **PV AI Demand Sense** | Unlisted | 18 | Moving average, exponential smoothing, seasonality factors, what-if simulation, anomaly detection | **No reviews** |
| **AI Inventory Forecast** (NeuralProphet) | Varies | 18-19 | Time series forecasting via NeuralProphet | **No reviews** |
| **Stock Demand Trends and Forecast** | Varies | 12-17 | AutoReg, ARDR, ARMA statistical methods | Developer guarantees bug fixes within 60 days |
| **FrePPLe** | Varies | 15 | Safety stock, reorder quantities, service level optimization | Established tool but older Odoo version support |

**Key pattern**: The most feature-rich apps have **zero user reviews**, meaning buyers face significant risk. The one app with a detailed review was rated negatively.

---

## 4. SMB Pain Points That Current Solutions Don't Address

### The Spreadsheet Trap
A 2025 Gartner survey found **43% of SMEs still rely on spreadsheets** for inventory planning. Odoo's native tools aren't sophisticated enough to replace them, but dedicated supply chain tools (Streamline, Kinaxis, etc.) are too expensive and complex for SMBs. There is a clear **gap in the mid-market** for an affordable, Odoo-integrated AI forecaster.

### Data Quality and Migration Issues
Companies experience demand forecasts being **34% off** due to duplicate SKUs from Odoo migrations, products with `cost > unit_price`, and unfiltered order states (drafts/cancelled mixed with confirmed). No current marketplace app addresses data cleanliness as a prerequisite.

### Manual Purchase Planning
Purchase planning still happens manually in most Odoo SMBs. The scheduler runs once daily by default and often **doesn't trigger correctly** — the forums are full of "reordering rule not working" threads covering BOM issues, sub-component failures, location-specific failures, and snooze bugs.

### No Financial Impact Visibility
SMBs want to know the **cost of their inventory decisions** — how much capital is tied up in excess stock, how much revenue is lost to stockouts, what the carrying cost is. Odoo provides inventory valuation but not decision-cost analysis.

### Perishable/Shelf-Life Complexity
While Odoo has basic expiration date tracking, there is **no FEFO (First Expiry First Out) optimization** that connects to demand forecasting. Companies with perishable goods cannot get forecasts that account for shelf life constraints.

### Multi-Channel / Multi-Marketplace
Companies selling across multiple channels need unified demand signals. Current apps treat each warehouse independently without cross-channel demand aggregation.

---

## 5. KPIs and Numbers Companies Most Want From an AI Demand Forecaster

### Tier 1: Must-Have (every user asks for these)

| KPI | Description |
|-----|-------------|
| **Forecast Accuracy (MAPE/WMAPE)** | How close predictions are to actual demand; WMAPE preferred because it weights high-volume SKUs |
| **Stockout Rate** | % of SKUs out of stock when orders arrive |
| **Inventory Turnover** | How many times stock sells and replaces per period |
| **Days of Supply (DOS)** | How many days current inventory lasts at forecasted demand rate |
| **Fill Rate / Service Level** | % of customer orders fulfilled immediately from stock |
| **Safety Stock Levels** | Optimal buffer quantities per SKU |

### Tier 2: High Value (differentiators)

| KPI | Description |
|-----|-------------|
| **Lost Sales Estimate** | Revenue missed due to stockouts — the number that gets executive attention |
| **Excess Inventory Value** | Capital tied up in overstock with holding cost projections |
| **Optimal Reorder Point & EOQ** | When and how much to order, per SKU, per supplier |
| **Lead Time Variability** | Supplier reliability metric feeding into safety stock |
| **On-Time In-Full (OTIF)** | % of orders delivered complete and on time |
| **Forecast Bias** | Systematic over/under-forecasting tendency |
| **Dead/Slow-Moving Stock Value** | Capital trapped in items unlikely to sell |

### Tier 3: Advanced / Executive (competitive moat)

| KPI | Description |
|-----|-------------|
| **Forecast Value Added (FVA)** | Whether each forecasting step actually improves accuracy vs. a naive baseline |
| **Demand Sensing** | Real-time short-term (4-8 week) forecast adjustments |
| **What-If Scenario Modeling** | Impact of price changes, promotions, supplier disruptions on inventory needs |
| **Obsolete Inventory %** | Portion of stock no longer sellable |
| **ABC/XYZ Classification** | Revenue contribution vs. demand variability matrix |
| **Cash-to-Cash Cycle Time** | Days between paying suppliers and receiving customer payment |
| **Contribution Margin by SKU** | Profitability after variable costs, for inventory prioritization |

### The Headline Number
Research consistently shows: **a 10% improvement in demand prediction accuracy can cut inventory costs by up to 30%**. This is the ROI metric that sells the product.

---

## 6. Strategic Takeaway for AI Refill Lite

The Odoo marketplace for AI inventory optimization is **wide open**. The current landscape is characterized by:

1. **No credible, well-reviewed AI forecasting app exists** — the most expensive one was called "not ready for production"
2. **Native Odoo forecasting is purely deterministic** with no ML, no seasonality, no auto-adjusting reorder points
3. **Users are explicitly asking** for historical-data-driven automated min/max, EOQ, seasonality handling, and stockout-period adjustment
4. **SMBs are stuck between** spreadsheets (free but manual) and enterprise tools (powerful but $50K+/year)
5. **Data quality is the silent killer** — no competitor addresses it, but our audit work already demonstrates expertise here
6. **The KPIs users want** align well with what our BI dashboards already compute (margin analysis, inventory valuation, sales trends)

**The biggest gap to exploit:** An app that combines **data quality auditing + ML forecasting + automated reorder optimization + financial impact visibility**, delivered at an SMB price point and natively integrated with Odoo.

---

## Data Inventory (real_data/)

### Available Data: ~548MB, ~3M rows, Oct 2024 — Mar 2026 (17+ months)

| File | Rows | Description |
|------|------|-------------|
| product.category | 43 | Product categories (Aluminio, Biodegradables, Bolsas, etc.) |
| product.product | 1,654 | Full product catalog with costs and prices |
| product.supplierinfo | 2,018 | Supplier-product relationships with lead times |
| res.partner | 22,757 | Customers + suppliers (Guatemala, multi-department) |
| stock.warehouse | 25 | Warehouses and stores |
| stock.location | 210 | Warehouse internal locations |
| uom.uom | 204 | Units of measure (CAJA, ROLLO, FARDO, etc.) |
| sale.order | 85,986 | Sales orders (Oct 2024 — Mar 2026) |
| sale.order.line | 480,525 | Sales order line items |
| purchase.order | 3,254 | Purchase orders with supplier + currency info |
| purchase.order.line | 20,686 | Purchase order line items |
| stock.move (6 files) | ~967,671 | Inventory movements (all quarters) |
| stock.picking | 240,164 | Picking/shipment operations |
| stock.quant1 | 9,301 | Current inventory snapshot (point-in-time) |
| account.move | varies | Invoices/accounting documents |
| account.move.line (4 files) | varies | Journal entry details with debit/credit |
| res.currency | 1,103 | Exchange rates (GTQ/USD) |

### Key Strengths for Backtest
- Complete 17-month time series across all business functions
- Line-item granularity for precise cost accounting
- Multi-warehouse distribution data
- GTQ and USD transactions with exchange rates
- Document tracing: sales → pickings → invoices → accounting

### Key Limitation
- `stock.quant1` is a **point-in-time snapshot** (as of 2026-03-03), not a continuous historical series. Historical inventory levels must be **reconstructed** from `stock.move` data.

---

*Sources: Odoo Forums, Odoo Apps Store, TechFinna/Medium, Odoo Skillz, Business.org, Silent Infotech, GMDH/Streamline, Intuendi, Prediko, Impact Analytics, G2, Capterra, Braincuber, Much Consulting*
