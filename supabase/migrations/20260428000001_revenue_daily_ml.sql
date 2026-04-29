-- ============================================================================
-- revenue_daily_for_ml — ML-only clone of revenue_daily with anomaly smoothing
-- ============================================================================
-- Context: October 2024 shows 5–12 confirmed POs per SKU simultaneously across
-- the 23 demo SKUs, likely a data-loading artifact from system onboarding.
-- Feeding this raw signal to Prophet causes it to fit a spurious seasonal
-- component to an artifact rather than to real purchase behavior.
--
-- revenue_daily is NEVER modified — it holds the verified acid-test data.
-- Acid Test 1 has a perfect score (4/4 on SKU 77201046) and must remain intact.
--
-- revenue_daily_for_ml is populated by:
--   docs/reconciliation/smooth_oct2024_purchase_anomaly.py
--
-- That script:
--   1. Copies all rows from revenue_daily into this table.
--   2. For each (product_id, metric, ssot_label) in purchases_ordered/received:
--      - Deletes October 2024 rows.
--      - Inserts one synthetic row on 2024-10-15 with quantity = median of the
--        other 15 months in the training window.
--   3. Sales rows are copied unchanged.
--
-- The ML training pipeline reads from revenue_daily_for_ml, NOT from revenue_daily.
-- All UI pages, acid tests, and reconciliation scripts continue to read
-- revenue_daily only.
--
-- Reference:
--   ML_PURCHASE_HYPOTHESIS_REVALIDATION_2026-04-28.md (anomaly description)
--   ML_TRAINING_DATA_FINDINGS_2026-04-28.md (root cause analysis)
--   docs/reconciliation/SSOT_WINNING_FORMULAS.md (SSOT labels)
-- ============================================================================

CREATE TABLE IF NOT EXISTS revenue_daily_for_ml (
  id BIGSERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  ssot_label VARCHAR(100) NOT NULL,
  metric VARCHAR(30) NOT NULL,
  observation_date DATE NOT NULL,
  quantity NUMERIC(15,4) NOT NULL,
  revenue_gtq NUMERIC(15,4),
  source_doc_count INT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(product_id, ssot_label, metric, observation_date)
);

CREATE INDEX IF NOT EXISTS idx_rdml_product_metric_date
  ON revenue_daily_for_ml(product_id, metric, observation_date);

CREATE INDEX IF NOT EXISTS idx_rdml_ssot_label
  ON revenue_daily_for_ml(ssot_label);

CREATE INDEX IF NOT EXISTS idx_rdml_date
  ON revenue_daily_for_ml(observation_date);

COMMENT ON TABLE revenue_daily_for_ml IS
  'ML-training clone of revenue_daily. October 2024 purchase rows replaced with median-smoothed synthetic rows to remove the system-onboarding artifact. NEVER read by UI pages or acid tests. Populated by docs/reconciliation/smooth_oct2024_purchase_anomaly.py. Added 2026-04-28.';

COMMENT ON COLUMN revenue_daily_for_ml.ssot_label IS
  'Same as revenue_daily.ssot_label — formula identifier from SSOT_WINNING_FORMULAS.md.';

COMMENT ON COLUMN revenue_daily_for_ml.metric IS
  'One of: sales | purchases_ordered | purchases_received.';

COMMENT ON COLUMN revenue_daily_for_ml.quantity IS
  'Aggregate quantity normalized to stock UoM (CAJA40). For October 2024 purchase rows: median of the other 15 training-window months (synthetic). All other rows: direct copy from revenue_daily.';

COMMENT ON COLUMN revenue_daily_for_ml.source_doc_count IS
  'For synthetic October 2024 rows: 1. For all other rows: copied from revenue_daily.';
