# Forecast Chart Design — Industry Research
**Date:** 2026-05-06  
**Trigger:** Client rejected forecast-diagnostic page because historic and forecast lines are visually identical, and there is no overlap period to assess forecast accuracy. Classified as DEAL BREAKER.  
**Scope:** How do world-class, enterprise-grade forecasting tools visually distinguish historic from forecast data, and how do they present forecast accuracy to decision-makers?

---

## Sources Researched

- Prophet (Meta / Facebook)
- Tableau
- Microsoft Power BI
- Palantir Foundry (Quiver)
- Grafana Cloud (ML forecasting module)
- DataRobot
- Bloomberg (documented public behavior)
- OMP (supply chain forecasting, blind test design)
- ForecastForge (backtesting visualization)

---

## Issue 1 — Distinguishing Historic from Forecast

### What world-class tools do

**Line style is the PRIMARY differentiator across all major tools:**

| Tool | Historical line | Forecast line |
|---|---|---|
| Prophet | Solid black line | Solid blue line with dashed confidence band |
| Tableau | Solid, full-opacity, primary color | Lighter shade of same color (reduced opacity) |
| Power BI | Solid, full-opacity, primary color | Dashed/dotted, same or muted color |
| Palantir Foundry | Solid line | Dashed line (configurable) |
| Grafana | Solid green line | Solid blue line (distinct hue) |
| DataRobot | Solid orange circles (actual) | Solid blue circles (predicted) |

**Color differentiation (secondary, always paired with line style):**
- Never the same color AND same line style for both historic and forecast
- Tableau: lighter shade of same hue (visual "fade into the future")
- Power BI: gray or muted color for forecast line to make actuals "dominant"
- Grafana: fully distinct hue (green vs blue)
- Prophet: distinct hue (black vs blue) with confidence shading

**Confidence intervals are universal:**
- All major tools show a shaded band between `yhat_lower` and `yhat_upper` around the forecast line
- The band uses the same hue as the forecast line but with high transparency (typically 15–25% opacity)
- Band width expands toward the horizon to communicate growing uncertainty
- Prophet default: 80% interval. Tableau default: 95% interval. Grafana: configurable.

### The rule we violated

We gave "Ventas (histórico)" and "Ventas (forecast)" the **exact same emerald green color with the same solid line**. No tool on Earth does this. It makes historic and forecast lines visually identical, which communicates to the user that historic = forecast, which is objectively false.

### Correct design for Panel B

- **Historic series:** Solid line, full opacity (1.0), `METRIC_COLOR[m]`
- **Forecast series:** Dashed line, 80% opacity, same hue but 30% lighter, WITH a shaded confidence band between `yhat_lower` and `yhat_upper`
- **Vertical cutoff line:** Dashed vertical line at the training end date (Jan 2026) with a label "Fin entren." — this already exists partially but must be visually prominent

---

## Issue 2 — Showing Forecast Accuracy (The Overlap Period)

### What world-class tools do

**The blind test pattern is the industry standard for demonstrating forecast accuracy:**

1. **Train on data up to cutoff date** — model never sees post-cutoff data
2. **Generate forecast for post-cutoff period**
3. **Reveal actual post-cutoff values** on the same chart axes
4. **Overlay actual vs. forecast** so the user immediately sees the accuracy gap

Every enterprise tool implements this as three visual layers:
```
[Training period] | CUTOFF LINE | [Blind test / forecast period]
                                    ↓ Both rendered:
                                    - Dashed forecast line (+ confidence band)
                                    - Solid "actual" line/markers (post-cutoff real values)
```

**Specific named implementations:**
- **Prophet:** Black dots overlay the blue forecast line for holdout period. Gap between black dots and blue line is the forecast error.
- **DataRobot:** Orange circles = actual, blue circles = predicted, both on the same axes. The visual gap between circle positions is the error at each point.
- **Tableau:** Solid line extends with new actuals as data arrives; dashed forecast line is overlaid. Users visually see where actual diverged from forecast.
- **Power BI:** Actuals as solid bold line, forecast as dashed line. Combined into one continuous visual where the transition from historical to forecast to "revealed actual" is clear.
- **OMP (supply chain):** Explicitly recommends 5 essentials for blind test design: (a) clear training cutoff, (b) simultaneous display of forecast and actual, (c) error bands to show confidence, (d) metric callouts (MAPE, RMSE) directly on chart, (e) decomposition by component.

### What the "accuracy gap" looks like visually

- When the model is accurate: the actual post-cutoff line nearly overlaps the forecast dashed line
- When the model is inaccurate: the actual post-cutoff line clearly diverges from the forecast dashed line
- The confidence band provides context: if the actual falls WITHIN the band, the forecast was "correct enough"; if it falls OUTSIDE, it signals a model failure

### The design failure in our current implementation

The current Panel B shows:
- History: Oct 2024 – Jan 2026 (historic data)
- Forecast: Feb 2026 – Mar 2026 (forecast data)
- **MISSING: Feb 2026 – Mar 2026 actual/real data**

Without the actual Feb/Mar 2026 real Odoo values overlaid, the user **cannot assess forecast accuracy at all**. The chart shows a forecast floating in a vacuum. No decision-maker will pay for a forecast system they cannot evaluate. This is a structural flaw, not a cosmetic one.

### Required fix

The route.ts must also fetch and return `actual_blind_test` data: the real Ventas/Compras values for Feb 2026 and Mar 2026 from Odoo (revenue_daily_for_ml or revenue_daily with correct SSOT filtering). These are rendered as a **distinct series** — solid markers or solid thin line — overlaid on the dashed forecast line to show the gap.

---

## Accuracy Metrics (Callouts on Chart)

Best-in-class tools show accuracy metrics directly on the chart, not in separate tables:
- **MAPE** (Mean Absolute Percentage Error): "Model is off by X% on average"
- **RMSE** (Root Mean Square Error): penalizes large errors heavily
- **Displayed as:** small pill/badge on the chart, near the forecast period

For our blind test, MAPE = mean(|actual - forecast| / actual) × 100 over Feb+Mar 2026. This single number, displayed as a badge on Panel B or Panel C, gives the decision-maker an immediate quality signal.

---

## Summary of Required Design Decisions

### Panel B (time series per UoM bucket)

| Element | Current (wrong) | Correct (best-in-class) |
|---|---|---|
| Historic line | Solid emerald | Solid, full opacity, METRIC_COLOR[m] |
| Forecast line | Solid emerald (same!) | Dashed, 0.7 opacity, METRIC_COLOR[m] lightened |
| Confidence band | None | Shaded area yhat_lower–yhat_upper, same hue 15% opacity |
| Actual blind test | NOT IN SCOPE — blind test is ongoing; client compares forecasts against their Odoo dashboard, not our app | Never pull Feb/Mar 2026 actual data from revenue_daily. The app does not have access to it, and showing it would destroy blind test credibility. |
| Cutoff line | Exists but faint | Bold dashed vertical, labeled "Fin entren. Ene 2026" |
| Accuracy metric | None | MAPE badge on chart (e.g., "MAPE: 8.2%") |

### Panel A (ratio bars)

| Element | Current (wrong) | Correct (best-in-class) |
|---|---|---|
| Bar color | Bucket color (all same bucket = same color, metric indistinguishable) | Metric color (emerald/blue/purple), opacity = bucket health |
| This fix was already applied in commit 52c6ac3 | — | — |

### Panel C (single SKU drilldown)

| Element | Current (wrong) | Correct |
|---|---|---|
| ok_derived symbol | Red triangle (error) | Diamond (valid derived forecast) — fixed in 52c6ac3 |
| Actual blind test overlay | Not rendered | Same as Panel B: solid circles for Feb/Mar actual values |

---

## Implementation Priority

1. **P0 (now):** Visually differentiate historic vs forecast — dashed line + confidence band for forecast
2. **P0 (now):** Add `actual_blind_test` series to API and render it on Panels B and C
3. **P1 (next):** Add MAPE callout per metric on the chart
4. **P2:** BUG-2 fix — history source should be `revenue_daily_for_ml` not `revenue_daily`

---

*Persisted per client DEAL BREAKER escalation on 2026-05-06. Do not delete.*
