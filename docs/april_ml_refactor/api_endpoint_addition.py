"""
Flask endpoint for derived purchase forecasts.

Add this route to ml/api.py alongside the existing /forecast/revenue-daily
endpoint.  The import and Supabase client setup should match the existing
pattern in api.py.

Integration:
    from forecast_purchases_derived import forecast_purchases_derived

    # Then register this route on the Flask app.
"""

# ── Paste into ml/api.py ─────────────────────────────────────────────────────
#
# @app.route('/forecast/purchases-derived', methods=['POST'])
# def forecast_purchases_derived_endpoint():
#     """Derive purchase forecast from persisted sales forecast × ratio.
#
#     Expects JSON body with the same fields as /forecast/revenue-daily:
#         product_id, ssot_label, metric, training_start, training_end, prediction_end
#
#     Requires that sales forecast for the same product_id and training_end
#     already exists in forecast_results (run Prophet for sales first).
#     """
#     data = request.get_json(force=True)
#
#     product_id     = int(data['product_id'])
#     metric         = data['metric']
#     ssot_label     = data['ssot_label']
#     training_start = date.fromisoformat(data['training_start'])
#     training_end   = date.fromisoformat(data['training_end'])
#     prediction_end = date.fromisoformat(data['prediction_end'])
#
#     # Compute forecast months: each full month between training_end and prediction_end
#     forecast_months = _enumerate_forecast_months(training_end, prediction_end)
#
#     result = forecast_purchases_derived(
#         supabase=supabase,   # module-level Supabase client from api.py
#         product_id=product_id,
#         metric=metric,
#         ssot_label=ssot_label,
#         training_start=training_start,
#         training_end=training_end,
#         forecast_months=forecast_months,
#     )
#
#     return jsonify(result)
#
#
# def _enumerate_forecast_months(training_end: date, prediction_end: date) -> list[str]:
#     """Return ['2026-02', '2026-03', ...] for every full month after training_end
#     up to and including the month containing prediction_end."""
#     months = []
#     year = training_end.year
#     month = training_end.month + 1
#     if month > 12:
#         month = 1
#         year += 1
#     while date(year, month, 1) <= prediction_end:
#         months.append(f'{year:04d}-{month:02d}')
#         month += 1
#         if month > 12:
#             month = 1
#             year += 1
#     return months


# ── Standalone integration test ──────────────────────────────────────────────
#
# If you want to verify the endpoint works before wiring it into route.ts:
#
#   curl -X POST http://localhost:5000/forecast/purchases-derived \
#     -H 'Content-Type: application/json' \
#     -H 'X-API-Key: YOUR_KEY' \
#     -d '{
#       "product_id": 2,
#       "ssot_label": "pol_confirmed_date_planned_product_qty_c40",
#       "metric": "purchases_ordered",
#       "training_start": "2024-10-01",
#       "training_end": "2026-01-31",
#       "prediction_end": "2026-03-31"
#     }'
#
# Expected response shape:
#   {
#     "status": "ok_derived",
#     "monthly": [
#       {"month": "2026-02", "yhat_sum": 42000.0, ...},
#       {"month": "2026-03", "yhat_sum": 43500.0, ...}
#     ],
#     "ratio_detail": {
#       "R": 1.21,
#       "months_used": 14,
#       "months_excluded": 2,
#       "ratios_used": [["2024-11", 1.54], ...],
#       "ratios_excluded": [["2024-10", 0.88], ["2026-01", 1.54]]
#     }
#   }
