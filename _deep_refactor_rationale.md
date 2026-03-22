# DEEP REFACTOR RATIONALE — March 22, 2026

---

## 1. AI REFILL — THE THING THAT KEEPS ME UP AT NIGHT

### The Core Insight (Verbatim — Preserve Exactly)

> The Backtest (The Proof of Concept)
> We don't need a month to prove trust. We can 'Backtest' right now. We feed the model data from 2024 and 2025, ask it to 'predict' January 2026, and compare it to the actual Odoo report you have in your hand. If the model hits the mark on history, it will hit the mark on the future.

> I was not able to do a backtest from the user ui during the decision meeting with the decision makers. 
> It really haunts me.

> AI Refill Lite should have as first mission to demonstrate its own monetary value, month by month, for all the months for which we have data, even if we have data for very few months.

> The main backtest UI should return after each backtest cycle:
> "Had you had AI Refill this month, you would've saved GTQ (range or approximate number) due to... (very briefly explain the reasoning AND very clearly explain the calculations of the range or approximate number).
> (In latinamerican spanish, of course, as all user facing text must be.)

### The Problem

- AI Refill grew too complex. Too many features crammed in → benefits became unclear to decision makers.
- The app couldn't prove its own value in real-time during a live client meeting.
- Analytics-oriented UI ≠ what closes deals. Need **sales-oriented UI**.

### The New Direction: AI Refill Lite

- **New repo:** `air_lite` / AI Refill Lite / airefilllite
- **Dramatically reduced scope**
- **Sales-oriented UI** (not advanced analytics oriented)
- **First mission:** Self-demonstrating monetary value with superlative clarity, via backtesting

### Backtest Flow (The Killer Feature)

```
For each month with available data:
  1. Feed model all data BEFORE that month
  2. Model "predicts" that month
  3. Compare prediction vs actual Odoo report
  4. Calculate: "Had you had AI Refill → GTQ savings = X"
  5. Show reasoning + calculations transparently
```

### Contractual Goals (From Client Proposal)

1. **Reduce storage costs by 15%** (6 months)
   - Indicator: Decrease in inventory days
   - Measurement: Before/after cost comparison

2. **Increase inventory rotation by 20%** (12 months)
   - Indicator: Inventory rotation index
   - Measurement: Current vs post-implementation rotation

3. **Reduce unnecessary purchases by 20%** (9 months)
   - Indicator: Reduction in excess + improvement in inventory value
   - Measurement: Purchase order tracking + cash flow analysis

4. **Reduce lost sales from stockouts by 15%** (6 months)
   - Indicator: % of unfulfilled orders due to stockouts
   - Measurement: Before/after lost sales comparison

5. **Additional impact:** Increased fulfillment → increased client satisfaction

### Technical Capabilities (Contractual)

- Automated data ingestion from Odoo (daily, no human intervention)
- ML models trained on historical data (demand prediction, seasonal patterns, dynamic adjustments)
- Real-time intelligent alerts (critical reorder points, anomaly detection)
- Executive dashboard + BI visualization
- Continuous self-retraining

### AI Refill Lite — What It Should Be

- [ ] **Strip down to ONE clear value proposition:** "This is how much money AI saves you, month by month"
- [ ] **Backtest UI as the landing experience**
- [ ] **Sales-oriented design** — relegate to secondary importance dashboards for analysts, screens for CFOs and CEOs
- [ ] **New repo:** `air_lite`
- [ ] **Tech decisions TBD** — can reuse backend logic, needs fresh frontend to, above all, clearly self-demonstrate monetary value via backtesting

---

*Last updated: March 22, 2026*
