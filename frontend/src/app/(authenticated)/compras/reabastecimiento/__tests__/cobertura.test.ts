/**
 * Per-bodega coverage horizon for the Sugerido.
 *
 * Wilmer, 2026-08-21: *"el sugerido para estos CDs no es de 30 dias, sino de 15
 * dias por favor"* (Zacapa y Petén).
 *
 * The first test is the important one: with the field absent nothing moves, so
 * the xlsx parity page keeps its 99.85% match. Everything else here is the new
 * behaviour, pinned.
 */
import {
  COBERTURA_DEFAULT_DIAS, forecast, sugerido, doh, type ProductRow,
} from '../engine';

const base = (over: Partial<ProductRow> = {}): ProductRow => ({
  cod: '77205003', desc: 'BANDEJA No.1 TERMOFOM 5X50', prov: 'CARVAJAL',
  exist: 500, doh: 0, trans: 0, sug: 0,
  p6: 2000, p3: 2400, h: 0, adic: 0, win: 5,
  ...over,
});

describe('backwards compatibility — the parity page must not move', () => {
  it('is identical when coberturaDias is absent', () => {
    const r = base();
    expect(forecast(r)).toBe((2000 + 2400) / 2);
    expect(forecast(r)).toBe(2200);
  });

  it('is identical when coberturaDias is explicitly the default', () => {
    expect(forecast(base({ coberturaDias: COBERTURA_DEFAULT_DIAS })))
      .toBe(forecast(base()));
  });

  it('leaves the General branch (×1.1 + seasonal) untouched by default', () => {
    const g = base({ win: 10, h: 2600 });
    expect(forecast(g)).toBeCloseTo(((2000 + 2400 + 2600) / 3) * 1.1, 9);
  });
});

describe('coverage scaling', () => {
  it('halves the forecast at 15 days — Wilmer\'s ask', () => {
    expect(forecast(base({ coberturaDias: 15 }))).toBe(1100);
  });

  it('scales linearly, because the base IS one month of demand', () => {
    expect(forecast(base({ coberturaDias: 45 }))).toBe(3300);
    expect(forecast(base({ coberturaDias: 7 }))).toBeCloseTo(2200 * (7 / 30), 9);
  });

  it('applies to the General branch too, not only to locations', () => {
    const g = (dias?: number) => forecast(base({ win: 10, h: 2600, coberturaDias: dias }));
    expect(g(15)).toBeCloseTo(g(undefined) / 2, 9);
  });
});

describe('where the horizon must NOT be applied', () => {
  it('does not scale the result — stock credit stays whole', () => {
    // The wrong implementation is k·(forecast − V). With exist 500 and T = 600:
    //   right: max(0, 1100 − max(0, 500 + 0 − 600)) = 1100
    //   wrong: 0.5 · (2200 − 0) = 1100 ... so use a case where they diverge.
    const r = base({ coberturaDias: 15, exist: 1500, trans: 0 });
    const T = (r.p3 / 20) * r.win;          // 2400/20*5 = 600
    const V = Math.max(r.exist + r.trans - T, 0); // 900
    expect(sugerido(r, r.trans)).toBe(Math.max(0, 1100 - V)); // 200
    // The scale-the-result version would give 0.5 * (2200 - 900) = 650.
    expect(sugerido(r, r.trans)).not.toBe(650);
  });

  it('does not change the projection window T', () => {
    // Same exist/trans, only the horizon differs: the delta must be exactly the
    // forecast delta, proving T was untouched.
    const r30 = base({ exist: 1500 });
    const r15 = base({ exist: 1500, coberturaDias: 15 });
    expect(sugerido(r30, 0) - sugerido(r15, 0)).toBeCloseTo(forecast(r30) - forecast(r15), 9);
  });

  it('does not change DOH — it is a diagnostic, not a purchase quantity', () => {
    expect(doh(base({ coberturaDias: 15 }))).toBe(doh(base()));
  });
});

describe('the real Zacapa case', () => {
  it('asks for about half of what a 30-day horizon would', () => {
    // 77205003 at Zacapa, production 2026-08-21: p6 1,590.33 / p3 1,590.33-ish,
    // exist 566, reserved 186 → net 380, no tránsito.
    const zac = (dias?: number) => sugerido(
      base({ p6: 1590.33, p3: 1590.33, exist: 380, win: 5, coberturaDias: dias }), 0,
    );
    expect(zac(15)).toBeLessThan(zac(undefined));
    expect(zac(undefined) - zac(15)).toBeCloseTo(1590.33 / 2, 6);
  });
});
