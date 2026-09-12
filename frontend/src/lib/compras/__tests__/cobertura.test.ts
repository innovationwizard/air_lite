import { esCoberturaValida, COBERTURA_MIN_DIAS, COBERTURA_MAX_DIAS } from '../cobertura';

describe('esCoberturaValida', () => {
  it('accepts any whole number of days inside the DB CHECK range (1-365, migration 20260911000006) — Wilmer types 65 for a 35-day lead time', () => {
    for (const d of [1, 7, 15, 30, 45, 65, 90, 120, 150, 365]) expect(esCoberturaValida(d)).toBe(true);
    expect(COBERTURA_MIN_DIAS).toBe(1);
    expect(COBERTURA_MAX_DIAS).toBe(365);
  });

  it('rejects outside the range and non-integers', () => {
    for (const v of [0, -15, 366, 500, 30.5]) expect(esCoberturaValida(v)).toBe(false);
  });

  it('rejects non-numbers', () => {
    for (const v of ['30', null, undefined, NaN, {}]) expect(esCoberturaValida(v)).toBe(false);
  });
});
