import { esCoberturaValida, COBERTURA_OPCIONES } from '../cobertura';

describe('esCoberturaValida', () => {
  it('accepts every value the dropdown offers', () => {
    for (const d of COBERTURA_OPCIONES) expect(esCoberturaValida(d)).toBe(true);
  });

  it('rejects a value inside the DB CHECK range (1-120) but outside the dropdown options', () => {
    for (const v of [1, 8, 14, 25, 60, 120]) expect(esCoberturaValida(v)).toBe(false);
  });

  it('rejects non-numbers and out-of-range numbers', () => {
    for (const v of ['30', null, undefined, NaN, -15, 0, {}]) expect(esCoberturaValida(v)).toBe(false);
  });
});
