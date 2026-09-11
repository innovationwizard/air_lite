import { pendientePorSku, type PendienteLive } from '../pendienteReserva';

const live: PendienteLive = {
  asOf: '2026-09-11T21:03:48Z',
  pickingTypes: { '1CET': [2, 5], '4ZAC': [27, 30], '3PET': [19, 22] },
  bodegas: {
    '1CET': { '77205001': { demanda: 4214, cantidad: 2901.976, pendiente: 1312.024 } },
    '4ZAC': { '77205001': { demanda: 10, cantidad: 0, pendiente: 10 }, '88001005': { demanda: 5, cantidad: 5, pendiente: 0 } },
    '3PET': {},
  },
};

describe('pendientePorSku', () => {
  it('a single-warehouse bodega reads that warehouse alone', () => {
    const m = pendientePorSku(live, ['4ZAC']);
    expect(m.get('77205001')).toBe(10);
    expect(m.get('88001005')).toBe(0);
  });

  it('General sums the same SKU across every in-scope warehouse', () => {
    expect(pendientePorSku(live, ['1CET', '4ZAC', '3PET']).get('77205001')).toBeCloseTo(1322.024, 3);
  });

  it('a SKU with nothing open is absent — the caller treats absence as a KNOWN 0, not unknown', () => {
    expect(pendientePorSku(live, ['3PET']).size).toBe(0);
    expect(pendientePorSku(live, ['1CET']).has('88001005')).toBe(false);
  });

  it('an unknown code contributes nothing rather than throwing', () => {
    expect(pendientePorSku(live, ['2Z11']).size).toBe(0);
  });
});
