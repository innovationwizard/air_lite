import { computeKpis, computeAlza, computeTopProveedores, type FilaMetrica } from '../statusMetrics';

function fila(over: Partial<FilaMetrica>): FilaMetrica {
  return {
    prov: 'Carvajal', doh: 10, sug: 0, volM3: 0.5,
    flags: { tendenciaCreciente: false }, tendencia: { estado: 'sin-tendencia' },
    ...over,
  };
}

describe('computeKpis', () => {
  it('counts total, needing-sugerido and críticos over the given list', () => {
    const list = [
      fila({ sug: 10, doh: 1 }),   // needs, crítico
      fila({ sug: 0, doh: 1 }),    // doesn't need, crítico
      fila({ sug: 5, doh: 10 }),   // needs, not crítico
    ];
    expect(computeKpis(list)).toEqual({
      total: 3, need: 2, totSug: 15, crit: 2, m3Sug: 7.5, sinCubicaje: 0,
    });
  });

  it('is empty-safe', () => {
    expect(computeKpis([])).toEqual({
      total: 0, need: 0, totSug: 0, crit: 0, m3Sug: 0, sinCubicaje: 0,
    });
  });

  // W21 — a product without a measured volume must never add 0 to the
  // total as if it took no space: it is counted as a hole instead.
  it('sums m³ only over measured rows that need buying, and counts the holes', () => {
    const list = [
      fila({ sug: 1000, volM3: 0.0042 }), // 4.2 m³
      fila({ sug: 10, volM3: null }),     // needs buying, unmeasured → hole
      fila({ sug: 10, volM3: 0 }),        // 0 is "unmeasured", not "no space" → hole
      fila({ sug: 0, volM3: null }),      // nothing to buy → not a hole
      fila({ sug: 0, volM3: 0.5 }),       // nothing to buy → adds nothing
    ];
    const k = computeKpis(list);
    expect(k.m3Sug).toBeCloseTo(4.2, 10);
    expect(k.sinCubicaje).toBe(2);
    expect(k.need).toBe(3);
  });
});

describe('computeAlza', () => {
  it('counts rising-trend and non-evaluable rows independently', () => {
    const rows = [
      fila({ flags: { tendenciaCreciente: true }, tendencia: { estado: 'creciente' } }),
      fila({ flags: { tendenciaCreciente: false }, tendencia: { estado: 'no-evaluable' } }),
      fila({ flags: { tendenciaCreciente: false }, tendencia: { estado: 'sin-tendencia' } }),
    ];
    expect(computeAlza(rows)).toEqual({ creciente: 1, noEvaluable: 1, total: 3 });
  });
});

describe('computeTopProveedores', () => {
  it('sums sug per proveedor, sorts descending, and caps at 8', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      fila({ prov: `Prov${i}`, sug: 10 - i, doh: 1 }));
    const { arr, max } = computeTopProveedores(rows);
    expect(arr).toHaveLength(8);
    expect(arr[0]).toEqual({ p: 'Prov0', sug: 10, crit: 1 });
    expect(max).toBe(10);
  });

  it('skips rows with no proveedor and only counts crit when sug > 0', () => {
    const rows = [
      fila({ prov: '', sug: 99, doh: 1 }),
      fila({ prov: 'Carvajal', sug: 0, doh: 1 }), // doh<3 but sug=0 → not crit
      fila({ prov: 'Carvajal', sug: 5, doh: 10 }), // sug>0 but doh>=3 → not crit
    ];
    const { arr } = computeTopProveedores(rows);
    expect(arr).toEqual([{ p: 'Carvajal', sug: 5, crit: 0 }]);
  });

  it('returns max=1 (never 0) when there are no suppliers, to avoid a divide-by-zero downstream', () => {
    expect(computeTopProveedores([]).max).toBe(1);
  });
});
