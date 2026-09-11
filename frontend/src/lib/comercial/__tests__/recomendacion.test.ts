import {
  DIAS_VENTA_MES, RANGO_POR_ETIQUETA, TOP_N, bodegaQueSirve, compararRiesgo, diasDeCobertura,
  divergeAnioAnterior, etiquetaConfianza, falta, faltaCritica, recomendar, type RiesgoInput,
} from '../recomendacion';

/**
 * The rules behind the channel leader's row. Every threshold here is a
 * measured value from docs/compras/FORECAST_COMERCIAL_L2_SPEC_RESEARCH_2026-09-10.md;
 * these tests pin the arithmetic, not the choice of thresholds.
 */

const SERIE6 = {
  '2026-03': 100, '2026-04': 110, '2026-05': 90, '2026-06': 120, '2026-07': 100, '2026-08': 140,
};

describe('etiquetaConfianza', () => {
  it('a flat series is estable', () => {
    expect(etiquetaConfianza([100, 100, 100, 100, 100, 100])).toBe('estable');
  });
  it('thresholds at 0.20 / 0.35 / 0.60 of CV', () => {
    // mean 100, population sd 25 -> cv 0.25
    expect(etiquetaConfianza([75, 125, 75, 125, 75, 125])).toBe('medio');
    // sd 50 -> cv 0.5
    expect(etiquetaConfianza([50, 150, 50, 150, 50, 150])).toBe('variable');
    // one spike: mean 100, values 0,0,0,0,0,600 -> sd ~223 -> cv 2.2
    expect(etiquetaConfianza([0, 0, 0, 0, 0, 600])).toBe('erratico');
  });
  it('no demand at all is erratico, not a division by zero', () => {
    expect(etiquetaConfianza([0, 0, 0])).toBe('erratico');
    expect(etiquetaConfianza([])).toBe('erratico');
  });
});

describe('recomendar', () => {
  it('is the mean of the 3- and 6-month averages, whole units', () => {
    const r = recomendar({ serie: SERIE6, indice: null, aplicaEstacional: false, mesObjetivo: '2026-10-01' })!;
    expect(r.avg3).toBeCloseTo(120);        // 120, 100, 140
    expect(r.avg6).toBeCloseTo(110);
    expect(r.base).toBeCloseTo(115);
    expect(r.factor).toBe(1);
    expect(r.aplicado).toBe(false);
    expect(r.valor).toBe(115);
    expect(r.indiceMes).toBeNull();
  });

  it('returns null, never 0, with fewer than three months of history', () => {
    expect(recomendar({ serie: { '2026-07': 5, '2026-08': 9 }, indice: null,
                        aplicaEstacional: false, mesObjetivo: '2026-10-01' })).toBeNull();
    expect(recomendar({ serie: {}, indice: null, aplicaEstacional: false, mesObjetivo: '2026-10-01' })).toBeNull();
  });

  it('a series of explicit zeros is a real 0, not null', () => {
    const r = recomendar({ serie: { '2026-06': 0, '2026-07': 0, '2026-08': 0 }, indice: null,
                          aplicaEstacional: false, mesObjetivo: '2026-10-01' });
    expect(r?.valor).toBe(0);
    expect(r?.rango).toEqual([0, 0]);
  });

  it('deseasonalizes the base months and re-seasonalizes the target when applied', () => {
    // Index: every month 1.0 except Aug 2.0 and Oct 1.5. A flat 100 series
    // whose August reads 200 is really flat 100 -> October = 150.
    const indice = [1, 1, 1, 1, 1, 1, 1, 2, 1, 1.5, 1, 1];
    const serie = { '2026-03': 100, '2026-04': 100, '2026-05': 100, '2026-06': 100, '2026-07': 100, '2026-08': 200 };
    const r = recomendar({ serie, indice, aplicaEstacional: true, mesObjetivo: '2026-10-01' })!;
    expect(r.avg3).toBeCloseTo(100);
    expect(r.avg6).toBeCloseTo(100);
    expect(r.factor).toBe(1.5);
    expect(r.indiceMes).toBe(1.5);
    expect(r.aplicado).toBe(true);
    expect(r.valor).toBe(150);
  });

  it('shows the index but does not apply it when the area says no', () => {
    const indice = [1, 1, 1, 1, 1, 1, 1, 2, 1, 1.5, 1, 1];
    const serie = { '2026-03': 100, '2026-04': 100, '2026-05': 100, '2026-06': 100, '2026-07': 100, '2026-08': 200 };
    const r = recomendar({ serie, indice, aplicaEstacional: false, mesObjetivo: '2026-10-01' })!;
    expect(r.aplicado).toBe(false);
    expect(r.factor).toBe(1);
    expect(r.indiceMes).toBe(1.5);       // for the sentence on screen
    // raw: avg3 = 133.3, avg6 = 116.7 -> 125
    expect(r.valor).toBe(125);
  });

  it('a malformed index (not 12 entries) is ignored, not crashed on', () => {
    const r = recomendar({ serie: SERIE6, indice: [1, 2, 3], aplicaEstacional: true, mesObjetivo: '2026-10-01' })!;
    expect(r.aplicado).toBe(false);
    expect(r.valor).toBe(115);
  });

  it('the range is the label band times the value, rounded', () => {
    const r = recomendar({ serie: { '2026-06': 100, '2026-07': 100, '2026-08': 100 }, indice: null,
                          aplicaEstacional: false, mesObjetivo: '2026-10-01' })!;
    expect(r.etiqueta).toBe('estable');
    const [lo, hi] = RANGO_POR_ETIQUETA.estable;
    expect(r.rango).toEqual([Math.round(100 * lo), Math.round(100 * hi)]);
    expect(r.rango).toEqual([83, 122]);
  });

  it('accepts the target month as YYYY-MM or YYYY-MM-01', () => {
    const indice = new Array(12).fill(1); indice[9] = 1.2;
    const a = recomendar({ serie: SERIE6, indice, aplicaEstacional: true, mesObjetivo: '2026-10' })!;
    const b = recomendar({ serie: SERIE6, indice, aplicaEstacional: true, mesObjetivo: '2026-10-01' })!;
    expect(a.valor).toBe(b.valor);
    expect(a.factor).toBe(1.2);
  });
});

describe('falta y faltaCritica', () => {
  it('gap is requested minus delivered, never negative', () => {
    expect(falta(100, 90)).toBe(10);
    expect(falta(100, 120)).toBe(0);
  });
  it('critical needs BOTH 10% and 20 units', () => {
    expect(faltaCritica(100, 80)).toBe(true);     // 20 units, 20%
    expect(faltaCritica(100, 85)).toBe(false);    // 15 units
  });
  it('1000 requested, 950 delivered is 5%: not critical', () => {
    expect(faltaCritica(1000, 950)).toBe(false);
  });
  it('nothing requested is never critical', () => {
    expect(faltaCritica(0, 0)).toBe(false);
  });
});

describe('divergeAnioAnterior', () => {
  it('flags beyond ±30%', () => {
    expect(divergeAnioAnterior(100, 131)).toBe(true);
    expect(divergeAnioAnterior(100, 129)).toBe(false);
    expect(divergeAnioAnterior(100, 69)).toBe(true);
  });
  it('null on either side is no flag; a zero recommendation flags any prior demand', () => {
    expect(divergeAnioAnterior(null, 50)).toBe(false);
    expect(divergeAnioAnterior(100, null)).toBe(false);
    expect(divergeAnioAnterior(0, 5)).toBe(true);
    expect(divergeAnioAnterior(0, 0)).toBe(false);
  });
});

describe('ranking por riesgo de desabasto', () => {
  const fila = (o: Partial<RiesgoInput>): RiesgoInput =>
    ({ critica: false, falta3: 0, doh: null, volumen6: 0, ...o });

  it('any critical month outranks everything else', () => {
    const a = fila({ critica: true, falta3: 20, volumen6: 10 });
    const b = fila({ critica: false, falta3: 500, volumen6: 9000, doh: 1 });
    expect([b, a].sort(compararRiesgo)[0]).toBe(a);
  });
  it('then units short, descending', () => {
    const a = fila({ falta3: 30 }); const b = fila({ falta3: 300 });
    expect([a, b].sort(compararRiesgo)[0]).toBe(b);
  });
  it('then coverage ascending, unknown coverage last', () => {
    const a = fila({ doh: 40 }); const b = fila({ doh: 3 }); const c = fila({ doh: null });
    expect([a, c, b].sort(compararRiesgo)).toEqual([b, a, c]);
  });
  it('then volume descending', () => {
    const a = fila({ volumen6: 10 }); const b = fila({ volumen6: 1000 });
    expect([a, b].sort(compararRiesgo)[0]).toBe(b);
  });
  it('the list is fifty', () => {
    expect(TOP_N).toBe(50);
  });
});

describe('bodega que sirve y cobertura', () => {
  it('Zacapa and Petén sell from their CD; everyone else from San José', () => {
    expect(bodegaQueSirve('zacapa')).toBe('Zacapa');
    expect(bodegaQueSirve('peten')).toBe('Petén');
    expect(bodegaQueSirve('mayoreo')).toBe('San Jose VN');
    expect(bodegaQueSirve('tiendas')).toBe('San Jose VN');
  });
  it('days on hand uses the engine\'s 26 selling days', () => {
    expect(DIAS_VENTA_MES).toBe(26);
    expect(diasDeCobertura(260, 260)).toBeCloseTo(26);
    expect(diasDeCobertura(130, 260)).toBeCloseTo(13);
  });
  it('unknown stock or no velocity is null, not infinity or zero', () => {
    expect(diasDeCobertura(null, 10)).toBeNull();
    expect(diasDeCobertura(100, 0)).toBeNull();
    expect(diasDeCobertura(100, null)).toBeNull();
  });
});
