-- ============================================================================
-- forecast_results — per-product per-month predictions for Acid Test 2
-- ============================================================================
-- Stores forecasts produced by ml/forecast_revenue.py (Prophet trained on
-- revenue_daily under a winning SSOT formula).
--
-- Rows are write-once per (product_id, ssot_label, metric, forecast_month,
-- training_end_date). Re-running with the same training_end_date updates in
-- place; running with a different training_end_date (e.g. re-forecast after
-- receiving new data) creates a new snapshot so we can audit the whole
-- prediction trajectory over time.
--
-- Reference:
--   docs/reconciliation/PLAN_ACID_TEST_SSOT_DISCOVERY.md §Step 8
--   docs/reconciliation/SSOT_WINNING_FORMULAS.md
--   ml/forecast_revenue.py
-- ============================================================================

CREATE TABLE IF NOT EXISTS forecast_results (
  id BIGSERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  ssot_label VARCHAR(100) NOT NULL,
  metric VARCHAR(30) NOT NULL,         -- 'sales' | 'purchases_ordered' | 'purchases_received'
  forecast_month DATE NOT NULL,         -- first day of predicted month, e.g. 2026-02-01
  training_start_date DATE NOT NULL,
  training_end_date DATE NOT NULL,
  yhat_sum NUMERIC(15,4) NOT NULL,      -- monthly aggregate of Prophet yhat
  yhat_lower_sum NUMERIC(15,4),         -- monthly aggregate of yhat_lower (80% interval)
  yhat_upper_sum NUMERIC(15,4),         -- monthly aggregate of yhat_upper
  training_points INT,                  -- rows used to train (audit)
  nonzero_points INT,                   -- non-zero training rows (sparsity check)
  model_status VARCHAR(30) NOT NULL,    -- 'ok' | 'insufficient_history' | 'training_failed'
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, ssot_label, metric, forecast_month, training_end_date)
);

CREATE INDEX IF NOT EXISTS idx_fr_product_metric ON forecast_results(product_id, metric);
CREATE INDEX IF NOT EXISTS idx_fr_month ON forecast_results(forecast_month);
CREATE INDEX IF NOT EXISTS idx_fr_training_end ON forecast_results(training_end_date);

COMMENT ON TABLE forecast_results IS
  'Prophet forecasts on revenue_daily for Acid Test 2. One row per (SKU, ssot, metric, forecast_month, training_end_date). Multiple training_end_date snapshots allowed for prediction-trajectory audit.';

COMMENT ON COLUMN forecast_results.forecast_month IS
  'First day of the predicted month. For Feb 2026 → 2026-02-01.';

COMMENT ON COLUMN forecast_results.training_end_date IS
  'Last day included in training. The day after is the first day of the prediction window.';

-- Phase 2 RLS baseline
ALTER TABLE forecast_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forecast_results_read ON forecast_results;
CREATE POLICY forecast_results_read ON forecast_results
  FOR SELECT USING (auth_role() IS NOT NULL);

DROP POLICY IF EXISTS forecast_results_service_write ON forecast_results;
CREATE POLICY forecast_results_service_write ON forecast_results
  FOR ALL USING (auth.role() = 'service_role');
