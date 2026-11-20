/**
 * KPI / trend / top-supplier summaries for the reabastecimiento view.
 *
 * Extracted out of VivoClient.tsx (2026-09-04) so the "proof of status"
 * snapshot route (frontend/src/app/api/compras/reabastecimiento/snapshot)
 * can compute the SAME numbers server-side, from its own server-authoritative
 * row set, instead of trusting whatever the client happens to have in memory.
 * Two implementations of "what counts as critical" is exactly the kind of
 * drift this project has already been burned by once (see rows.ts's header
 * comment on the 2026-08-20 UoM bug) — one function, two callers.
 *
 * Pure, no DOM/React dependency — usable from a Next.js route handler.
 */
import { cantidadACubicar, m3Sugerido } from '@/lib/compras/cubicaje';
import { DOH_BANDS, type DohBands } from '@/lib/compras/reabastecimientoEngine';

/** The minimal shape either the client's `ApiRow` or the server's `LiveRow` satisfies. */
export interface FilaMetrica {
  prov: string;
  doh: number;
  sug: number;
  /**
   * Cantidad digitada para cubicar. null o ausente = esa línea sigue siendo
   * el Sugerido. El total de m³ usa esta cantidad.
   */
  cantidadPedida?: number | null;
  /** m³ por unidad. null = sin medir — nunca 0 (ver lib/compras/cubicaje.ts). */
  volM3: number | null;
  flags: { tendenciaCreciente: boolean };
  tendencia: { estado: string };
}

export interface Kpis {
  total: number;
  need: number;
  totSug: number;
  crit: number;
  /**
   * m³ de la carga que está cubicando: A pedir cuando la digitó, si no el
   * Sugerido. Sin volumen medido no suma y cuenta en `sinCubicaje`.
   */
  m3Sug: number;
  /** Filas con cantidad a cubicar > 0 y sin m³ medido. */
  sinCubicaje: number;
}

/** Computed over the currently filtered/sorted view — "what he's looking at right now". */
export function computeKpis(list: readonly FilaMetrica[], bands: DohBands = DOH_BANDS): Kpis {
  const need = list.filter((r) => r.sug > 0);
  let m3Sug = 0;
  let sinCubicaje = 0;
  for (const r of list) {
    const qty = cantidadACubicar(r.sug, r.cantidadPedida);
    if (qty <= 0) continue;
    const m3 = m3Sugerido(qty, r.volM3);
    if (m3 === null) sinCubicaje += 1; else m3Sug += m3;
  }
  return {
    total: list.length,
    need: need.length,
    totSug: need.reduce((a, r) => a + r.sug, 0),
    crit: list.filter((r) => r.doh < bands.critico).length,
    m3Sug,
    sinCubicaje,
  };
}

export interface Alza {
  creciente: number;
  noEvaluable: number;
  total: number;
}

/**
 * Counted over the WHOLE bodega, not the filtered list: the point of the
 * number is to say how much is rising before any filter narrows the view.
 */
export function computeAlza(rows: readonly FilaMetrica[]): Alza {
  return {
    creciente: rows.filter((r) => r.flags.tendenciaCreciente).length,
    noEvaluable: rows.filter((r) => r.tendencia.estado === 'no-evaluable').length,
    total: rows.length,
  };
}

export interface TopProveedores {
  arr: { p: string; sug: number; crit: number }[];
  max: number;
}

/** Top 8 suppliers by Sugerido, over the whole bodega (not the filtered list). */
export function computeTopProveedores(
  rows: readonly FilaMetrica[],
  bands: DohBands = DOH_BANDS,
): TopProveedores {
  const by: Record<string, { sug: number; crit: number }> = {};
  for (const r of rows) {
    if (!r.prov) continue;
    by[r.prov] = by[r.prov] || { sug: 0, crit: 0 };
    by[r.prov].sug += r.sug;
    if (r.doh < bands.critico && r.sug > 0) by[r.prov].crit += 1;
  }
  const arr = Object.entries(by).map(([p, v]) => ({ p, ...v }))
    .sort((a, b) => b.sug - a.sug).slice(0, 8);
  return { arr, max: Math.max(1, ...arr.map((a) => a.sug)) };
}
