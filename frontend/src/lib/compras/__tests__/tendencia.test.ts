import { evaluarTendencia, TREND_RISES, TREND_WINDOW_MONTHS ,
  evaluarDivergencia, evaluarAlerta, tieneReferenciaAnioAnterior,
  DIVERGENCIA_UMBRAL, SIN_REFERENCIA_ANIO_ANTERIOR,} from '../tendencia';

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

describe('divergencia — p3 contra p6', () => {
  it('dispara cuando lo reciente se despega del promedio largo', () => {
    const d = evaluarDivergencia(150, 100);           // +50%
    expect(d.estado).toBe('divergente');
    expect(d.pct).toBeCloseTo(0.5);
  });

  it('no dispara dentro del umbral', () => {
    expect(evaluarDivergencia(130, 100).estado).toBe('sin-divergencia'); // +30%
  });

  it('el umbral es estricto, no inclusivo', () => {
    // Exactamente en el umbral NO es despegarse; es estar en el borde.
    expect(evaluarDivergencia(140, 100).estado).toBe('sin-divergencia');
    expect(evaluarDivergencia(140.1, 100).estado).toBe('divergente');
  });

  it('detecta la caida igual que la subida — el signo se conserva', () => {
    const d = evaluarDivergencia(40, 100);
    expect(d.estado).toBe('divergente');
    expect(d.pct).toBeCloseTo(-0.6);
  });

  it('sin promedio de 6 meses NO evalua, y por lo tanto no dispara', () => {
    // La regla del dia: excluida de disparar, no meramente etiquetada.
    const d = evaluarDivergencia(500, 0);
    expect(d.estado).toBe('sin-base');
    expect(d.pct).toBeNull();
  });

  it('el umbral vive en una constante, para volverse configurable', () => {
    expect(DIVERGENCIA_UMBRAL).toBe(0.40);
  });
});

describe('referencia del ano anterior', () => {
  it('h en cero es falta de referencia, no una afirmacion sobre el producto', () => {
    expect(tieneReferenciaAnioAnterior(0)).toBe(false);
    expect(tieneReferenciaAnioAnterior(12)).toBe(true);
    expect(SIN_REFERENCIA_ANIO_ANTERIOR).toBe('Sin referencia del año pasado');
  });
});

describe('alerta combinada — subir Y despegarse', () => {
  const creciente = evaluarTendencia({ '2026-06': 10, '2026-07': 20, '2026-08': 30 });
  const plana = evaluarTendencia({ '2026-06': 30, '2026-07': 20, '2026-08': 10 });

  it('pide AMBAS condiciones', () => {
    expect(evaluarAlerta(creciente, evaluarDivergencia(200, 100)).estado).toBe('revisar');
  });

  it('subir despacio y parejo no amerita revision', () => {
    expect(evaluarAlerta(creciente, evaluarDivergencia(110, 100)).estado).toBe('sin-alerta');
  });

  it('despegarse sin venir subiendo tampoco', () => {
    expect(evaluarAlerta(plana, evaluarDivergencia(200, 100)).estado).toBe('sin-alerta');
  });

  it('falta de dato no se disfraza de «no pasa nada»', () => {
    expect(evaluarAlerta(creciente, evaluarDivergencia(50, 0)).estado).toBe('no-evaluable');
    expect(evaluarAlerta(evaluarTendencia(null), evaluarDivergencia(150, 100)).estado)
      .toBe('no-evaluable');
  });

  it('el motivo dice el porcentaje y la direccion, para no obligar a abrir Odoo', () => {
    const a = evaluarAlerta(creciente, evaluarDivergencia(200, 100));
    expect(a.motivo).toContain('100%');
    expect(a.motivo).toContain('por encima de');
  });
});
