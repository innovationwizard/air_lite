import { computeKpis, computeAlza, computeTopProveedores, type FilaMetrica } from '../statusMetrics';

function fila(over: Partial<FilaMetrica>): FilaMetrica {
  return {
    prov: 'Carvajal', doh: 10, sug: 0,
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
    expect(computeKpis(list)).toEqual({ total: 3, need: 2, totSug: 15, crit: 2 });
  });

  it('is empty-safe', () => {
    expect(computeKpis([])).toEqual({ total: 0, need: 0, totSug: 0, crit: 0 });
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
