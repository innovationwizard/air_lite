/**
 * Replenishment calculation used by the live compras grid and its API.
 *
 * Constants (26 / window 10·5 / ×1.1) come from Wilmer's workbook and were
 * confirmed deliberate on 2026-07-23: 26 = 30d − Sundays; ×1.1 = growth
 * cushion; the fixed window instead of lead time is intentional.
 */

export interface ProductRow {
  cod: string;
  desc: string;
  prov: string;
  exist: number;
  doh: number;
  trans: number;
  sug: number;
  p6: number;
  p3: number;
  h: number;
  adic: number;
  win: 10 | 5;
  /** Days of demand the Sugerido should cover. Absent means COBERTURA_DEFAULT_DIAS. */
  coberturaDias?: number;
}

/**
 * How many days of demand the Sugerido covers when nothing says otherwise.
 *
 * `p6`, `p3` and the seasonal term are monthly averages, so the suggested
 * quantity covers a month unless a bodega overrides it.
 */
export const COBERTURA_DEFAULT_DIAS = 30;

/**
 * forecast = mean(6-mo, 3-mo, seasonal) × 1.1  (General)  |  mean(6-mo, 3-mo)  (locations)
 * …then scaled to the bodega's coverage horizon.
 *
 * The scale is linear because the base is a month of demand. With
 * `coberturaDias` absent the factor is exactly 1.
 */
export function forecast(r: ProductRow): number {
  const base = r.win === 10 ? ((r.p6 + r.p3 + r.h) / 3) * 1.1 : (r.p6 + r.p3) / 2;
  const dias = r.coberturaDias ?? COBERTURA_DEFAULT_DIAS;
  return base * (dias / COBERTURA_DEFAULT_DIAS);
}

/**
 * Sugerido = max(0, forecast − max(0, existencias + tránsito − proyección)) + adicional
 *
 * The coverage horizon belongs inside `forecast`, never as a scale on the
 * result: scaling the whole result would also shrink the credit for stock
 * already on hand.
 *
 * `T` (the projection window `win`) is not scaled. It is the consumption
 * expected during the resupply cycle, separate from how much cover to hold.
 */
export function sugerido(r: ProductRow, trans: number): number {
  const T = (r.p3 / 20) * r.win;
  const U = r.exist + trans - T;
  const V = U > 0 ? U : 0;
  const X = forecast(r) - V;
  return Math.max(0, (X > 0 ? X : 0) + r.adic);
}

/** Días On Hand = existencias ÷ (promedio 3 meses ÷ 26 días hábiles) */
export function doh(r: ProductRow, existOverride?: number): number {
  const e = existOverride ?? r.exist;
  return r.p3 ? e / (r.p3 / 26) : 0;
}

/** DOH severity band: crítico < 3, bajo < 7, normal through 30, exceso above 30. */
export type Sev = 'crit' | 'low' | 'ok' | 'exc';
export function sev(d: number): Sev {
  if (d < 3) return 'crit';
  if (d < 7) return 'low';
  if (d <= 30) return 'ok';
  return 'exc';
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('es-GT');
}
