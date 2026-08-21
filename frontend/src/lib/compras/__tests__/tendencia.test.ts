import { evaluarTendencia, TREND_RISES, TREND_WINDOW_MONTHS } from '../tendencia';

describe('evaluarTendencia', () => {
  it('fires on three strictly increasing complete months', () => {
    const t = evaluarTendencia({ '2026-05': 5084, '2026-06': 5786, '2026-07': 6459 });
    expect(t.estado).toBe('creciente');
    expect(t.meses.map((m) => m.month)).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(t.alzaPct).toBeCloseTo(27.04, 1);
  });

  it('uses the THREE most recent months and ignores older ones', () => {
    // 77205049, the SKU that triggered this build. Its full measured series is
    // feb→jul 2026; apr→may is a FALL, so only the last three months qualify.
    const t = evaluarTendencia({
      '2026-02': 2935, '2026-03': 4194, '2026-04': 6140,
      '2026-05': 5084, '2026-06': 5786, '2026-07': 6459,
    });
    expect(t.estado).toBe('creciente');
    expect(t.meses.map((m) => m.qty)).toEqual([5084, 5786, 6459]);
  });

  it('does not fire when the most recent month falls', () => {
    expect(evaluarTendencia({ '2026-05': 100, '2026-06': 200, '2026-07': 150 }).estado)
      .toBe('sin-tendencia');
  });

  it('does not fire when the middle month falls', () => {
    expect(evaluarTendencia({ '2026-05': 200, '2026-06': 100, '2026-07': 300 }).estado)
      .toBe('sin-tendencia');
  });

  it('requires STRICT growth — a flat month is not a rise', () => {
    expect(evaluarTendencia({ '2026-05': 100, '2026-06': 100, '2026-07': 200 }).estado)
      .toBe('sin-tendencia');
    expect(evaluarTendencia({ '2026-05': 100, '2026-06': 200, '2026-07': 200 }).estado)
      .toBe('sin-tendencia');
  });

  it('reports no-evaluable — never sin-tendencia — when the series is missing', () => {
    for (const bad of [null, undefined]) {
      const t = evaluarTendencia(bad);
      expect(t.estado).toBe('no-evaluable');
      expect(t.motivo).toMatch(/sin serie mensual/);
    }
  });

  it('reports no-evaluable when there are fewer than three months', () => {
    const t = evaluarTendencia({ '2026-06': 100, '2026-07': 200 });
    expect(t.estado).toBe('no-evaluable');
    expect(t.motivo).toMatch(/se necesitan 3/);
  });

  it('reports no-evaluable when the three most recent months are NOT consecutive', () => {
    // A gap must never be read as a run: feb, may, jul rises are not a trend.
    const t = evaluarTendencia({ '2026-02': 10, '2026-05': 20, '2026-07': 30 });
    expect(t.estado).toBe('no-evaluable');
    expect(t.motivo).toMatch(/no son consecutivos/);
  });

  it('crosses a year boundary correctly', () => {
    expect(evaluarTendencia({ '2025-11': 10, '2025-12': 20, '2026-01': 30 }).estado)
      .toBe('creciente');
    // dec → feb is a gap, not a run.
    expect(evaluarTendencia({ '2025-11': 10, '2025-12': 20, '2026-02': 30 }).estado)
      .toBe('no-evaluable');
  });

  it('ignores malformed keys and non-numeric values instead of throwing', () => {
    const t = evaluarTendencia({
      '2026-05': 100, '2026-06': 200, '2026-07': 300,
      'total': 600, '2026-13': 5, '2026-04': 'x' as unknown as number,
    });
    expect(t.estado).toBe('creciente');
    expect(t.meses).toHaveLength(3);
  });

  it('gives no alzaPct when the base month is zero — a rise from 0 has no percentage', () => {
    const t = evaluarTendencia({ '2026-05': 0, '2026-06': 1, '2026-07': 2 });
    expect(t.estado).toBe('creciente');
    expect(t.alzaPct).toBeNull();
  });

  it('treats an all-zero series as no trend, not as growth', () => {
    expect(evaluarTendencia({ '2026-05': 0, '2026-06': 0, '2026-07': 0 }).estado)
      .toBe('sin-tendencia');
  });

  it('flags on TWO consecutive rises — the floor, per the detection ladder', () => {
    // Salespeople know at the 1st rise, commercial at the 2nd; the app must not
    // be slower than commercial. One rise has no statistical significance.
    expect(TREND_RISES).toBe(2);
    expect(TREND_WINDOW_MONTHS).toBe(TREND_RISES + 1);
  });

  it('does NOT flag on a single rise', () => {
    // Two months of data is one rise: not enough to be evaluable at all.
    const t = evaluarTendencia({ '2026-06': 100, '2026-07': 200 });
    expect(t.estado).toBe('no-evaluable');
    // And within a full series, one rise preceded by a fall is not a trend.
    expect(evaluarTendencia({ '2026-05': 300, '2026-06': 100, '2026-07': 200 }).estado)
      .toBe('sin-tendencia');
  });

  it('flags as early as two rises allow — it does not wait for a third', () => {
    // A third rise would cost a month of warning; the alert fires at two.
    expect(evaluarTendencia({ '2026-05': 10, '2026-06': 20, '2026-07': 30 }).estado)
      .toBe('creciente');
  });
});
