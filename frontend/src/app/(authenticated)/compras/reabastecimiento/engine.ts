/**
 * Replenishment engine — ported VERBATIM from Wilmer's MAYO2026.xlsx formulas
 * (measured, see docs/compras/MAYO2026_XLSX_MANIFEST.md §3).
 *
 * Parity: reproduces the workbook's `Sugerido` for 1,325/1,327 products (99.85%)
 * on the General sheet. Constants (26 / window 10·5 / ×1.1) are the workbook's own,
 * pending Wilmer's confirmation (open question Q3). This module is the single
 * source of truth for the calculation so the UI and any future server job agree.
 */

export interface ProductRow {
  cod: string;
  desc: string;
  prov: string;
  exist: number;   // Existencias (net on-hand as the workbook has it)
  doh: number;     // workbook's cached Días On Hand
  trans: number;   // Tránsito (in-transit qty)
  sug: number;     // workbook's cached Sugerido (parity reference)
  p6: number;      // Promedio 6 meses
  p3: number;      // Promedio 3 meses
  h: number;       // seasonal same-month prior year (0 on location sheets)
  adic: number;    // Comercial "Adicional"
  win: 10 | 5;     // projection window: 10 (General) / 5 (locations)
}

export interface BodegaData {
  rows: ProductRow[];
  parity: { total: number; match: number; maxdiff: number } | null;
}

export type Dataset = Record<string, BodegaData>;

/** forecast = mean(6-mo, 3-mo, seasonal) × 1.1  (General)  |  mean(6-mo, 3-mo)  (locations) */
export function forecast(r: ProductRow): number {
  return r.win === 10 ? ((r.p6 + r.p3 + r.h) / 3) * 1.1 : (r.p6 + r.p3) / 2;
}

/** Sugerido = max(0, forecast − max(0, existencias + tránsito − proyección)) + adicional */
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

/** DOH severity band — thresholds are ILLUSTRATIVE, pending Wilmer's confirmation. */
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
