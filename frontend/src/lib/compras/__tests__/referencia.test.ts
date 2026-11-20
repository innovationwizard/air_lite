import { dohReferencia } from '../referencia';
import { ENGINE_FACTORS } from '../reabastecimientoEngine';

describe('dohReferencia', () => {
  it('returns days on hand when the warehouse has ordered sales', () => {
    // 260 on hand, 26 per month, 26 weekdays → 260 days.
    expect(dohReferencia(260, 26, ENGINE_FACTORS)).toBe(260);
  });

  it('is not computable when there are no ordered sales, even with stock', () => {
    expect(dohReferencia(100, 0)).toBeNull();
  });

  it('is not computable when ordered sales are zero and stock is zero', () => {
    expect(dohReferencia(0, 0)).toBeNull();
  });
});
