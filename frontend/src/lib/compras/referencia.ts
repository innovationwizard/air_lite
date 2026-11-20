/**
 * Days on hand for a warehouse shown as columns on another tab.
 *
 * The engine's `doh` returns 0 when there is no ordered sale. On a transfer
 * decision that 0 reads as "no stock to spare". Wilmer (2026-11-19): if the
 * warehouse has no ordered sales, days on hand is not computable.
 */
import {
  doh,
  ENGINE_FACTORS,
  type EngineFactors,
  type ProductRow,
} from '@/lib/compras/reabastecimientoEngine';

export function dohReferencia(
  exist: number,
  p3: number,
  factors: EngineFactors = ENGINE_FACTORS,
): number | null {
  if (!Number.isFinite(p3) || p3 === 0) return null;
  const row: ProductRow = {
    cod: '', desc: '', prov: '', exist, doh: 0, trans: 0, sug: 0,
    p6: 0, p3, h: 0, adic: 0, win: factors.win_other,
  };
  const dias = doh(row, undefined, factors);
  if (!Number.isFinite(dias)) return null;
  return Math.round(dias * 10) / 10;
}
