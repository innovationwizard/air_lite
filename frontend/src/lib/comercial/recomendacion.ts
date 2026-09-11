/**
 * Forecast comercial, Level 2 — the rules behind the channel leader's row.
 *
 * Every number the row shows that is not read straight from a table is
 * computed HERE, as a pure function, so the formula the spec validated can be
 * tested and cannot drift between the API and the screen.
 *
 * Spec (every constant below is a measured value, not a preference):
 *   docs/compras/FORECAST_COMERCIAL_L2_SPEC_RESEARCH_2026-09-10.md
 *     §2.3 confidence label + range · §3.3 seasonal index · §3.4 the formula
 *   docs/compras/FORECAST_COMERCIAL_L2_BUILD_PLAN_2026-09-10.md Phase 2.1
 *
 * The recommendation is `mean(avg3, avg6)` of the channel's REQUESTED qty,
 * times a category seasonal index where the area applies it. Backtested at
 * the real horizon (data through T-2) against 3/6/12 mixes, smoothing,
 * trend adjustments, Wilmer's three-term average and per-SKU seasonal
 * ratios: nothing beats it, and the index is what takes December from a -20%
 * under-forecast to -5%. Requested, never delivered: delivered is depressed
 * by exactly the stockouts the forecast exists to prevent.
 */

/** 'YYYY-MM' -> quantity in the product's stock UoM. Explicit zeros. */
export type SerieMensual = Record<string, number>;

/**
 * How evenly the SKU sold over the 6 base months (coefficient of variation).
 * Predictability differs 4x between the ends: `estable` rows land within
 * ±25% of the actual 61% of the time, `erratico` rows 19% (spec §2.3).
 */
export type Etiqueta = 'estable' | 'medio' | 'variable' | 'erratico';

export const UMBRAL_CV: { estable: number; medio: number; variable: number } = {
  estable: 0.20,
  medio: 0.35,
  variable: 0.60,
};

/**
 * Empirical P25-P75 of actual ÷ recommendation per label, from the backtest
 * (11 target months, top-80% SKUs, 6 channels). Shown as "normalmente entre
 * X y Y". It is a measured band, not a model's confidence interval.
 */
export const RANGO_POR_ETIQUETA: Record<Etiqueta, readonly [number, number]> = {
  estable: [0.83, 1.22],
  medio: [0.74, 1.23],
  variable: [0.61, 1.23],
  erratico: [0.24, 1.28],
};

export const ETIQUETA_TEXTO: Record<Etiqueta, string> = {
  estable: 'estable',
  medio: 'medio',
  variable: 'variable',
  erratico: 'errático',
};

/** Critical gap: what the warehouse did not deliver of what was requested. */
export const FALTA_CRITICA = { pctMin: 0.10, unidadesMin: 20 } as const;

/** Prior-year same month flagged when it differs this much from the recommendation. */
export const DIVERGENCIA_ANIO_ANTERIOR = 0.30;

/** Fewer complete months than this in the channel: no recommendation (null, never 0). */
export const MIN_MESES_HISTORIA = 3;

/** The ranked list shown to the leader (Jorge 2026-09-10, Q3). */
export const TOP_N = 50;

/** Seasonal index floor when deseasonalizing, so a 0.6 month cannot explode a level. */
const INDICE_MINIMO = 0.2;

export interface Recomendacion {
  /** Mean of the 3 most recent base months (deseasonalized when applied). */
  avg3: number;
  /** Mean of the 6 base months (deseasonalized when applied). */
  avg6: number;
  /** mean(avg3, avg6) — the level before the seasonal factor. */
  base: number;
  /** Index of the target month, 1 when the area does not apply it. */
  factor: number;
  /** Index of the target month regardless of application — for the sentence. */
  indiceMes: number | null;
  aplicado: boolean;
  /** Whole units. */
  valor: number;
  /** Whole units, [low, high] from the label's band. */
  rango: readonly [number, number];
  etiqueta: Etiqueta;
}

function media(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Months of a series, oldest first, by their 'YYYY-MM' label. */
export function mesesOrdenados(serie: SerieMensual): string[] {
  return Object.keys(serie).sort();
}

function mesDe(label: string): number {
  return Number(label.slice(5, 7));
}

export function etiquetaConfianza(valores: number[]): Etiqueta {
  if (valores.length === 0) return 'erratico';
  const m = media(valores);
  if (m <= 0) return 'erratico';
  const varianza = media(valores.map((x) => (x - m) ** 2));
  const cv = Math.sqrt(varianza) / m;
  if (cv < UMBRAL_CV.estable) return 'estable';
  if (cv < UMBRAL_CV.medio) return 'medio';
  if (cv < UMBRAL_CV.variable) return 'variable';
  return 'erratico';
}

/**
 * The recommendation for `mesObjetivo` ('YYYY-MM-01' or 'YYYY-MM').
 *
 * `indice` is the 12-entry monthly index for the product's category in the
 * area's SAI group (index 0 = January), or null when none exists. It is
 * applied only when `aplicaEstacional` (per area: on in mayoreo/zacapa/
 * peten/supermercados, off in institucional/tiendas — where the backtest
 * said it hurts). When applied, the base months are deseasonalized one by
 * one before averaging, and the level is re-seasonalized for the target.
 *
 * Returns null with fewer than MIN_MESES_HISTORIA months — "no history" is
 * not "zero demand", and a 0 here would be approved as a forecast.
 */
export function recomendar(args: {
  serie: SerieMensual;
  indice: readonly number[] | null;
  aplicaEstacional: boolean;
  mesObjetivo: string;
}): Recomendacion | null {
  const meses = mesesOrdenados(args.serie);
  if (meses.length < MIN_MESES_HISTORIA) return null;
  const crudos = meses.map((m) => args.serie[m]);
  const etiqueta = etiquetaConfianza(crudos);

  const indice = args.indice && args.indice.length === 12 ? args.indice : null;
  const aplicado = args.aplicaEstacional && indice !== null;
  const idx = (label: string) => Math.max(INDICE_MINIMO, indice![mesDe(label) - 1]);
  const valores = aplicado ? meses.map((m) => args.serie[m] / idx(m)) : crudos;

  const ultimos3 = valores.slice(-3);
  const ultimos6 = valores.slice(-6);
  const avg3 = media(ultimos3);
  const avg6 = media(ultimos6);
  const base = (avg3 + avg6) / 2;
  const indiceMes = indice ? indice[mesDe(args.mesObjetivo) - 1] : null;
  const factor = aplicado ? indiceMes! : 1;
  const valor = Math.max(0, Math.round(base * factor));
  const [lo, hi] = RANGO_POR_ETIQUETA[etiqueta];
  return {
    avg3, avg6, base, factor, indiceMes, aplicado, valor,
    rango: [Math.round(valor * lo), Math.round(valor * hi)],
    etiqueta,
  };
}

/** Gap of one month: requested minus delivered, never negative. */
export function falta(pedido: number, entregado: number): number {
  return Math.max(0, pedido - entregado);
}

export function faltaCritica(pedido: number, entregado: number): boolean {
  const f = falta(pedido, entregado);
  return pedido > 0
    && f >= FALTA_CRITICA.unidadesMin
    && f / pedido >= FALTA_CRITICA.pctMin;
}

/** Prior-year same month is far from the recommendation: the leader should look. */
export function divergeAnioAnterior(recomendacion: number | null, anterior: number | null): boolean {
  if (recomendacion === null || anterior === null) return false;
  if (recomendacion === 0) return anterior > 0;
  return Math.abs(anterior - recomendacion) / recomendacion > DIVERGENCIA_ANIO_ANTERIOR;
}

/**
 * The bodega that serves a channel — where "do we have it" is answered.
 * Zacapa and Petén sell from their own CD; the other four source from San
 * José (the tiendas have no warehouse space — Jorge 2026-09-03).
 */
export function bodegaQueSirve(area: string): 'Zacapa' | 'Petén' | 'San Jose VN' {
  if (area === 'zacapa') return 'Zacapa';
  if (area === 'peten') return 'Petén';
  return 'San Jose VN';
}

/**
 * What the ranking needs from a row. `doh` = days on hand in the serving
 * bodega (existencias ÷ p3 × selling days), null when unknown.
 */
export interface RiesgoInput {
  critica: boolean;
  /** Σ units short over the last 3 complete months. */
  falta3: number;
  doh: number | null;
  volumen6: number;
}

/**
 * Critical stockout risk, as decided (Q3): rows with any critical month
 * first — the channel already went unserved; then by units short (what
 * already went wrong), then by low coverage in the serving bodega (what is
 * about to), then by volume. The weights are the plan's stated assumption,
 * to be confirmed on the first real screen.
 */
export function compararRiesgo(a: RiesgoInput, b: RiesgoInput): number {
  if (a.critica !== b.critica) return a.critica ? -1 : 1;
  if (a.falta3 !== b.falta3) return b.falta3 - a.falta3;
  const da = a.doh ?? Number.POSITIVE_INFINITY;
  const db = b.doh ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;
  return b.volumen6 - a.volumen6;
}

/** Selling days per month — the engine's 26 (30 − ~4 Sundays, Wilmer 2026-07-23). */
export const DIAS_VENTA_MES = 26;

export function diasDeCobertura(existencias: number | null, p3: number | null): number | null {
  if (existencias === null || p3 === null) return null;
  if (p3 <= 0) return null;
  return existencias / (p3 / DIAS_VENTA_MES);
}
