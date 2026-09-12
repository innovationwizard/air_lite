/**
 * KPI / trend / top-supplier summaries for the reabastecimiento-vivo view.
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
import { m3Sugerido } from '@/lib/compras/cubicaje';

/** The minimal shape either the client's `ApiRow` or the server's `LiveRow` satisfies. */
export interface FilaMetrica {
  prov: string;
  doh: number;
  sug: number;
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
   * W21 (Wilmer, 2026-08-26) — m³ of the Sugerido, summed over the rows that
   * need buying. Products WITHOUT a measured volume contribute nothing and are
   * counted in `sinCubicaje` instead, so the total can never be read as
   * complete when it is not: he books furgones against this number.
   */
  m3Sug: number;
  /** Rows with sug > 0 and no measured m³ — the holes in `m3Sug`. */
  sinCubicaje: number;
}

/** Computed over the currently filtered/sorted view — "what he's looking at right now". */
export function computeKpis(list: readonly FilaMetrica[]): Kpis {
  const need = list.filter((r) => r.sug > 0);
  let m3Sug = 0;
  let sinCubicaje = 0;
  for (const r of need) {
    const m3 = m3Sugerido(r.sug, r.volM3);
    if (m3 === null) sinCubicaje += 1; else m3Sug += m3;
  }
  return {
    total: list.length,
    need: need.length,
    totSug: need.reduce((a, r) => a + r.sug, 0),
    crit: list.filter((r) => r.doh < 3).length,
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
export function computeTopProveedores(rows: readonly FilaMetrica[]): TopProveedores {
  const by: Record<string, { sug: number; crit: number }> = {};
  for (const r of rows) {
    if (!r.prov) continue;
    by[r.prov] = by[r.prov] || { sug: 0, crit: 0 };
    by[r.prov].sug += r.sug;
    if (r.doh < 3 && r.sug > 0) by[r.prov].crit += 1;
  }
  const arr = Object.entries(by).map(([p, v]) => ({ p, ...v }))
    .sort((a, b) => b.sug - a.sug).slice(0, 8);
  return { arr, max: Math.max(1, ...arr.map((a) => a.sug)) };
}
