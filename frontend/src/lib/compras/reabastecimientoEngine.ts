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
  /** General uses win_general (10); every other bodega uses win_other (5). */
  win: number;
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
 * Workbook factors. Fallback for config_rules `engine.factors`.
 * general_growth is the ×1.1 on the General forecast; t_divisor is the 20
 * in T = (p3 / 20) × win; weekdays is the 26 in DOH.
 */
export interface EngineFactors {
  general_growth: number;
  t_divisor: number;
  weekdays: number;
  win_general: number;
  win_other: number;
}

export const ENGINE_FACTORS: EngineFactors = {
  general_growth: 1.1,
  t_divisor: 20,
  weekdays: 26,
  win_general: 10,
  win_other: 5,
};

/** DOH bands. Fallback for config_rules `doh.bands`. crítico < 3, bajo < 7, normal ≤ 30. */
export interface DohBands {
  critico: number;
  bajo: number;
  normal: number;
}

export const DOH_BANDS: DohBands = { critico: 3, bajo: 7, normal: 30 };

/**
 * forecast = mean(6-mo, 3-mo, seasonal) × 1.1  (General)  |  mean(6-mo, 3-mo)  (locations)
 * …then scaled to the bodega's coverage horizon.
 *
 * The scale is linear because the base is a month of demand. With
 * `coberturaDias` absent the factor is exactly 1.
 */
export function forecast(
  r: ProductRow,
  factors: EngineFactors = ENGINE_FACTORS,
  coberturaDefault = COBERTURA_DEFAULT_DIAS,
): number {
  const base = r.win === factors.win_general
    ? ((r.p6 + r.p3 + r.h) / 3) * factors.general_growth
    : (r.p6 + r.p3) / 2;
  const dias = r.coberturaDias ?? coberturaDefault;
  return base * (dias / coberturaDefault);
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
export function sugerido(
  r: ProductRow,
  trans: number,
  factors: EngineFactors = ENGINE_FACTORS,
  coberturaDefault = COBERTURA_DEFAULT_DIAS,
): number {
  const T = (r.p3 / factors.t_divisor) * r.win;
  const U = r.exist + trans - T;
  const V = U > 0 ? U : 0;
  const X = forecast(r, factors, coberturaDefault) - V;
  return Math.max(0, (X > 0 ? X : 0) + r.adic);
}

/** Días On Hand = existencias ÷ (promedio 3 meses ÷ 26 días hábiles) */
export function doh(
  r: ProductRow,
  existOverride?: number,
  factors: EngineFactors = ENGINE_FACTORS,
): number {
  const e = existOverride ?? r.exist;
  return r.p3 ? e / (r.p3 / factors.weekdays) : 0;
}

/** DOH severity band: crítico < 3, bajo < 7, normal through 30, exceso above 30. */
export type Sev = 'crit' | 'low' | 'ok' | 'exc';
export function sev(d: number, bands: DohBands = DOH_BANDS): Sev {
  if (d < bands.critico) return 'crit';
  if (d < bands.bajo) return 'low';
  if (d <= bands.normal) return 'ok';
  return 'exc';
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('es-GT');
}
