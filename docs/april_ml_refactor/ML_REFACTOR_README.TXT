ML-UPGRADE — Derived Purchase Forecast

Three files delivered. Here's what each does and how to deploy:

forecast_purchases_derived.py → drop into ml/ alongside forecast_revenue.py
The core module. No Prophet dependency for purchases. Reads revenue_daily_for_ml, computes per-SKU median PO/Sales ratio with Tukey's fence outlier exclusion, reads the persisted sales forecast from forecast_results, multiplies. Returns the same shape as Prophet output so downstream persistence is identical.

api_endpoint_addition.py → integrate into ml/api.py
Contains the Flask route /forecast/purchases-derived and the _enumerate_forecast_months helper, both as commented code blocks ready to paste into your existing api.py. Also includes a curl command for standalone testing before wiring into route.ts.

route.ts → replaces frontend/src/app/api/acid-test/forecast/run/route.ts
Two-pass orchestration. Pass 1 runs Prophet for sales only (all SKUs). Pass 2 runs the derived endpoint for both purchase metrics (all SKUs). The persistence logic is extracted into shared helpers (persistMonthlyRows, persistStatusRow) to eliminate the duplication that was in the original. The response summary now includes method_sales: 'prophet' and method_purchases: 'derived_ratio' for audit.

Deployment sequence:

1. Ensure revenue_daily_for_ml is populated (run scripts 15 → smooth → 16 in order)
2. Add forecast_purchases_derived.py to ml/
3. Add the endpoint + import to ml/api.py
4. Deploy the ML service
5. Test the endpoint with the curl command in api_endpoint_addition.py
6. Replace route.ts
7. Deploy frontend
8. Trigger a full run: POST /api/acid-test/forecast/run with default params
9. Compare forecast_results for Feb/Mar 2026 against the insider's actuals

IMPORTANT — Pre-populate script order (must run in sequence):
  find_15_populate_revenue_daily_purchases_from_supabase.py   → revenue_daily
  smooth_oct2024_purchase_anomaly.py                          → revenue_daily_for_ml
  find_16_carvajal_tier3_fallback_purchases_for_ml.py         → revenue_daily_for_ml (append)

find_16 MUST run after smooth every time, or the 6 CARVAJAL Tier 3 SKUs
(77205003, 77205034, 77205208, 77205190, 77205035, 77205005) will have no
purchase history and return insufficient_ratio_data.

ACTUAL COMPUTED RATIOS (from production data, 2026-04-29):

Well-instrumented SKUs (15 usable months — these produce the most reliable R):
  pid=20  77201041  REYMA     R_ord=0.5808   R_rcv≈0.54
  pid=33  77201046  REYMA     R_ord=1.2340   R_rcv≈1.19
  pid=469 77201069  REYMA     R_ord=0.0310   R_rcv≈0.03
  pid=539 77201038  REYMA     R_ord=0.3014   R_rcv≈0.28
  pid=1366 77201014 REYMA     R_ord=0.5792   R_rcv≈0.54
  pid=1562 77201047 REYMA     R_ord=1.0896   R_rcv≈1.05
  pid=1606 77201053 REYMA     R_ord=1.1753   R_rcv≈1.12

Moderate-history SKUs (5 usable months — Tukey will exclude Jan 2026 spike):
  pid=37  77205207  CARVAJAL  R_ord≈1.42    (Jan 2026 spike 116,722 units excluded by Tukey)
  pid=1035 77205187 CARVAJAL  R_ord≈0.53

Single-observation SKUs (1 usable month — ratio is that one observation, no Tukey):
  pid=2   77205001  CARVAJAL  R_ord≈0.017   (not ~1.2; purchases are sparse for this SKU)
  pid=3   77205287  CARVAJAL  R_ord≈0.054
  pid=34  77201000  REYMA     R_ord≈0.095
  pid=1069 77205002 CARVAJAL  R_ord≈0.609
  pid=1096 77201023 REYMA     R_ord≈0.347
  pid=1587 77201019 REYMA     R_ord≈0.545
  pid=1590 77201055 REYMA     R_ord≈0.789
  pid=1600 77201056 REYMA     R_ord≈0.910

CARVAJAL Tier 3 SKUs — fallback via find_16 (class median R):
  pid=5   77205003  CARVAJAL  R_ord=0.4969  R_rcv=0.5687  (CARVAJAL class fallback)
  pid=29  77205034  CARVAJAL  R_ord=0.4969  R_rcv=0.5687
  pid=36  77205208  CARVAJAL  R_ord=0.4969  R_rcv=0.5687
  pid=145 77205190  CARVAJAL  R_ord=0.4969  R_rcv=0.5687
  pid=1113 77205035 CARVAJAL  R_ord=0.4969  R_rcv=0.5687
  pid=1127 77205005 CARVAJAL  R_ord=0.4969  R_rcv=0.5687

NOTE on pid=37 (77205207): Jan 2026 shows po_ordered=116,722 CAJA40 (actual bulk
pre-buy). Tukey's fence will exclude this month from the ratio computation. The
resulting R_ord≈1.42 is based on the remaining 4 usable months.
