/**
 * The seasonal term on 77205049 — the measurements behind the trend alert.
 *
 * Wilmer reported this Sugerido as too low (2026-08-20): "es un producto que
 * esta teniendo mayor demanda y sugiere 3,977 pero para 30 dias es muy bajo".
 * Its `h` for agosto rested on a single ramp-up month (ago-2024: 2,686, with 96
 * the month before), so the seasonal term was dragging the forecast down.
 *
 * ⚠️ HISTORY: on 2026-08-20 this SKU was added to `SEASONAL_EXCLUDED` in the
 * route, which substituted `h` and lifted the Sugerido to 6,081. On 2026-08-21
 * Jorge REMOVED it: a per-SKU override rewrites how a number was produced
 * without saying so, and it does not scale to the 282 products the thin
 * seasonal source distorts. The Sugerido is back to its engine value and the
 * row now carries the ▲ rising-trend flag instead — a notification, not a
 * changed number, which is what Wilmer actually asked for.
 *
 * These assertions therefore no longer describe live behaviour for this SKU.
 * They are kept because they are the MEASUREMENT that justifies the alert: they
 * pin exactly how much a one-year seasonal figure moves a Sugerido, and they
 * prove the trap that `h = 0` is a third and WORSE answer — the formula still
 * divides by three. If anyone reaches for the per-SKU override again, this is
 * the arithmetic they need to have read first.
 */
import {
  forecast,
  sugerido,
  type ProductRow,
} from '@/app/(authenticated)/compras/reabastecimiento/engine';

// Velocity measured in production 2026-08-20, bodega General.
const P6 = 5189.05;
const P3 = 5866.4333;
const H = 2686;
const H_SIN_ESTACIONAL = (P6 + P3) / 2;

// Two real snapshots: the one on his screen, and the current one.
const SCREENSHOT = { exist: 35, trans: 3960 };      // 2026-08-19 08:02
const HOY = { exist: 492.49 - 383.7, trans: 2660 }; // 2026-08-20 21:04

function row(h: number, snap: { exist: number; trans: number }): ProductRow {
  return {
    cod: '77205049', desc: 'BANDEJA No. 2P VIVA', prov: 'ENVAICA, S.A.',
    exist: snap.exist, doh: 0, trans: snap.trans, sug: 0,
    p6: P6, p3: P3, h, adic: 0, win: 10,
  };
}
const sug = (h: number, snap: { exist: number; trans: number }) =>
  Math.round(sugerido(row(h, snap), snap.trans));

describe('forecast — the term itself', () => {
  it('with the thin seasonal figure', () => {
    expect(Math.round(forecast(row(H, HOY)))).toBe(5039);
  });

  it('substituting h with the mean of p6 and p3 IS the two-way mean', () => {
    expect(forecast(row(H_SIN_ESTACIONAL, HOY))).toBeCloseTo(((P6 + P3) / 2) * 1.1, 6);
    expect(Math.round(forecast(row(H_SIN_ESTACIONAL, HOY)))).toBe(6081);
  });

  it('h = 0 is a THIRD, worse answer — still divided by three', () => {
    expect(Math.round(forecast(row(0, HOY)))).toBe(4054);
  });
});

describe('Sugerido on the snapshot Wilmer was looking at', () => {
  it('reproduces the 3,977 he reported', () => {
    expect(sug(H, SCREENSHOT)).toBe(3977);
  });

  it('dropping the seasonal term adds 1,042', () => {
    expect(sug(H_SIN_ESTACIONAL, SCREENSHOT)).toBe(5019);
    expect(sug(H_SIN_ESTACIONAL, SCREENSHOT) - sug(H, SCREENSHOT)).toBe(1042);
  });

  it('zeroing h would have made his complaint worse, not better', () => {
    expect(sug(0, SCREENSHOT)).toBe(2992);
    expect(sug(0, SCREENSHOT)).toBeLessThan(sug(H, SCREENSHOT));
  });
});

describe('Sugerido on current data', () => {
  it('same +1,042 shift, independent of stock and tránsito', () => {
    expect(sug(H, HOY)).toBe(5039);
    expect(sug(H_SIN_ESTACIONAL, HOY)).toBe(6081);
    expect(sug(H_SIN_ESTACIONAL, HOY) - sug(H, HOY)).toBe(1042);
  });
});
