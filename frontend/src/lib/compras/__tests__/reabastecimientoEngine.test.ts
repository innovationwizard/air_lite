/**
 * Per-bodega coverage horizon for the Sugerido.
 *
 * With coberturaDias absent, forecast stays the 30-day default. A shorter
 * horizon scales the forecast term only.
 */
import {
  COBERTURA_DEFAULT_DIAS, forecast, sugerido, doh, type ProductRow,
} from '../reabastecimientoEngine';

const base = (over: Partial<ProductRow> = {}): ProductRow => ({
  cod: '77205003', desc: 'BANDEJA No.1 TERMOFOM 5X50', prov: 'CARVAJAL',
  exist: 500, doh: 0, trans: 0, sug: 0,
  p6: 2000, p3: 2400, h: 0, adic: 0, win: 5,
  ...over,
});

describe('default horizon', () => {
  it('is the unscaled monthly mean when coberturaDias is absent', () => {
    const r = base();
    expect(forecast(r)).toBe((2000 + 2400) / 2);
    expect(forecast(r)).toBe(2200);
  });

  it('is identical when coberturaDias is explicitly the default', () => {
    expect(forecast(base({ coberturaDias: COBERTURA_DEFAULT_DIAS })))
      .toBe(forecast(base()));
  });

  it('leaves the General branch (×1.1 + seasonal) unscaled by default', () => {
    const g = base({ win: 10, h: 2600 });
    expect(forecast(g)).toBeCloseTo(((2000 + 2400 + 2600) / 3) * 1.1, 9);
  });
});

describe('coverage scaling', () => {
  it('halves the forecast at 15 days', () => {
    expect(forecast(base({ coberturaDias: 15 }))).toBe(1100);
  });

  it('scales linearly, because the base is one month of demand', () => {
    expect(forecast(base({ coberturaDias: 45 }))).toBe(3300);
    expect(forecast(base({ coberturaDias: 7 }))).toBeCloseTo(2200 * (7 / 30), 9);
  });

  it('applies to the General branch too, not only to locations', () => {
    const g = (dias?: number) => forecast(base({ win: 10, h: 2600, coberturaDias: dias }));
    expect(g(15)).toBeCloseTo(g(undefined) / 2, 9);
  });
});

describe('where the horizon must not be applied', () => {
  it('does not scale the result — stock credit stays whole', () => {
    const r = base({ coberturaDias: 15, exist: 1500, trans: 0 });
    const T = (r.p3 / 20) * r.win;
    const V = Math.max(r.exist + r.trans - T, 0);
    expect(sugerido(r, r.trans)).toBe(Math.max(0, 1100 - V));
    expect(sugerido(r, r.trans)).not.toBe(650);
  });

  it('does not change the projection window T', () => {
    const r30 = base({ exist: 1500 });
    const r15 = base({ exist: 1500, coberturaDias: 15 });
    expect(sugerido(r30, 0) - sugerido(r15, 0)).toBeCloseTo(forecast(r30) - forecast(r15), 9);
  });

  it('does not change DOH', () => {
    expect(doh(base({ coberturaDias: 15 }))).toBe(doh(base()));
  });
});

describe('a 15-day horizon asks for less than 30 days', () => {
  it('the difference is half the monthly mean', () => {
    const zac = (dias?: number) => sugerido(
      base({ p6: 1590.33, p3: 1590.33, exist: 380, win: 5, coberturaDias: dias }), 0,
    );
    expect(zac(15)).toBeLessThan(zac(undefined));
    expect(zac(undefined) - zac(15)).toBeCloseTo(1590.33 / 2, 6);
  });
});
