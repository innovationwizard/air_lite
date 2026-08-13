import { MAX_MANUAL_QTY, validateManualQty, validateManualQtyOrClear } from '../qty';

describe('validateManualQty', () => {
  it('accepts zero (explicitly none)', () => {
    expect(validateManualQty(0)).toEqual({ ok: true, qty: 0 });
  });

  it('accepts realistic quantities, including decimals', () => {
    expect(validateManualQty(27372)).toEqual({ ok: true, qty: 27372 });
    expect(validateManualQty(4086.5)).toEqual({ ok: true, qty: 4086.5 });
  });

  it('accepts exactly MAX_MANUAL_QTY', () => {
    expect(validateManualQty(MAX_MANUAL_QTY)).toEqual({ ok: true, qty: MAX_MANUAL_QTY });
  });

  it('rejects values above the cap with an explanatory message', () => {
    const res = validateManualQty(MAX_MANUAL_QTY + 1);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('máximo de captura manual');
  });

  it('rejects the 2026-08-12 incident value (1e9) instead of saving it', () => {
    expect(validateManualQty(1_000_000_000).ok).toBe(false);
  });

  it('rejects values that would overflow NUMERIC(15,4) (the opaque-500 case)', () => {
    expect(validateManualQty(1e12).ok).toBe(false);
  });

  it('rejects negatives, non-finites, and non-numbers', () => {
    for (const bad of [-1, NaN, Infinity, -Infinity, '100', undefined, {}, [], true]) {
      expect(validateManualQty(bad).ok).toBe(false);
    }
  });

  it('rejects null (clearing is not valid where a quantity is required)', () => {
    expect(validateManualQty(null).ok).toBe(false);
  });
});

describe('validateManualQtyOrClear', () => {
  it('accepts null as an explicit clear', () => {
    expect(validateManualQtyOrClear(null)).toEqual({ ok: true, qty: null });
  });

  it('otherwise applies the same rules as validateManualQty', () => {
    expect(validateManualQtyOrClear(0)).toEqual({ ok: true, qty: 0 });
    expect(validateManualQtyOrClear(MAX_MANUAL_QTY + 1).ok).toBe(false);
    expect(validateManualQtyOrClear(undefined).ok).toBe(false);
    expect(validateManualQtyOrClear('0').ok).toBe(false);
  });
});
