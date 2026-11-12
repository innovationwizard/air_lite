-- Calculation constants that were still hardcoded, seeded with the values
-- the code already uses. ON CONFLICT DO NOTHING so a later edit of any key,
-- including the original six, is left alone.
--
--   doh.bands           crítico < 3, bajo < 7, normal ≤ 30, exceso above that
--   engine.factors      ×1.1, T divisor 20, 26 weekdays, win 10 / 5
--   abc.cutoffs         D below 10, then cumulative 50% / 80%
--   trend.thresholds    2 rises, |p3−p6|/p6 > 0.40, MTD color 1.15 / 0.85
--   cobertura.defaults  30 days, bounds 1–365
--
-- Readers fall back to these same numbers when a row is missing or the
-- shape cannot be applied, so applying this migration does not move a result.

INSERT INTO config_rules (key, value, updated_at, updated_by)
VALUES
  (
    'doh.bands',
    '{"critico":3,"bajo":7,"normal":30}'::jsonb,
    now(),
    'seed'
  ),
  (
    'engine.factors',
    '{"general_growth":1.1,"t_divisor":20,"weekdays":26,"win_general":10,"win_other":5}'::jsonb,
    now(),
    'seed'
  ),
  (
    'abc.cutoffs',
    '{"min_qty_for_class":10,"a_share":0.50,"b_share":0.80}'::jsonb,
    now(),
    'seed'
  ),
  (
    'trend.thresholds',
    '{"rises":2,"divergence":0.40,"mtd_color_high":1.15,"mtd_color_low":0.85}'::jsonb,
    now(),
    'seed'
  ),
  (
    'cobertura.defaults',
    '{"default_dias":30,"min_dias":1,"max_dias":365}'::jsonb,
    now(),
    'seed'
  )
ON CONFLICT (key) DO NOTHING;
