/**
 * TENDENCIA CRECIENTE — the rising-trend alert Wilmer asked for (2026-08-20).
 *
 * His words: *"que me lo cambie de color o que me tire un signo de advertencia
 * y que diga que está subiendo, la tendencia es incrementar los últimos tres
 * meses. Entonces yo voy a revisar ya mejor mi Odoo y yo digo: ah sí, este
 * amerita que le suba la punta."*
 *
 * WHAT THIS IS: a NOTIFICATION. It does not change the Sugerido — it tells him
 * which rows deserve his own judgement. He explicitly did NOT ask for the
 * seasonal term to be dropped automatically (*"no quitarles el estacional"*),
 * so nothing here feeds the engine.
 *
 * THE RULE — TWO CONSECUTIVE RISES (Jorge, 2026-08-21).
 *
 * Counted in RISES, not months, because that is how the decision was reasoned.
 * Two rises = three consecutive complete months, strictly increasing:
 * `m-3 < m-2 < m-1`.
 *
 * WHY TWO — the intent, in Jorge's words: *"detect the trend and flag the
 * trend as soon as possible, with as little information as possible."*
 * There is a detection ladder already operating in the business, and each rung
 * is one rise slower than the last because of who talks to whom:
 *
 *   1st rise — the SALESPEOPLE already know. They talk to buyers in person, so
 *              they feel the change before it is a number anywhere.
 *   2nd rise — the COMMERCIAL people know, because they talk to salespeople.
 *   3rd rise — too late to be worth telling anyone: by then it is obvious, and
 *              a flag that only confirms what the room already knows is noise.
 *
 * The app has no in-person signal, so it cannot beat rung 1 and should not try.
 * It must not be SLOWER than rung 2 — that is the whole point of the alert. So
 * two rises is the target, not a compromise.
 *
 * And two is the FLOOR, not a tuning parameter: *"a single rise has ZERO
 * statistical significance"* (Jorge). One rise is a coin flip; flagging on it
 * would fire on roughly half the catalogue and destroy the signal.
 *
 * ⚠️ READ THIS BEFORE RAISING IT. The instinct on seeing false positives is to
 * require more rises. That directly defeats the intent — every rise added
 * costs a month of warning and pushes the app past the point where anyone
 * still needs telling. Earliest-useful-detection is the goal; noise is the
 * accepted price, and the badge shows the actual monthly figures so the reader
 * can judge magnitude themselves. If noise genuinely has to be cut, cut it on
 * MAGNITUDE (a minimum volume), never on more rises.
 *
 * The CURRENT month is never used: it is partial, so it would read as a fall
 * on almost every product for most of the month.
 *
 * ⚠️ This does NOT resolve the seasonal `h` coverage defect (finding
 * 2026-08-20 d). It fires on a rising trend; that defect is one of data
 * coverage — a product with one thin year of history and flat demand is still
 * miscomputed and will never trigger this. The two sets overlap, they are not
 * the same set.
 */

/**
 * Consecutive month-over-month rises required to flag. TWO — see the ladder
 * above. This is the knob; the month count follows from it.
 */
export const TREND_RISES = 2;

/** Months needed to observe TREND_RISES rises. Derived — never set directly. */
export const TREND_WINDOW_MONTHS = TREND_RISES + 1;

export type TendenciaEstado = 'creciente' | 'sin-tendencia' | 'no-evaluable';

export interface MesDemanda {
  /** 'YYYY-MM' */
  month: string;
  qty: number;
}

export interface Tendencia {
  estado: TendenciaEstado;
  /** The months actually evaluated, oldest → newest. Empty when no-evaluable. */
  meses: MesDemanda[];
  /**
   * Rise from the first to the last evaluated month, in percent.
   * null when not evaluable, or when the base month is 0 — a rise from zero
   * has no percentage, and inventing one (∞, or 100%) would be a lie about
   * magnitude on exactly the rows where magnitude is least meaningful.
   */
  alzaPct: number | null;
  /** Why it could not be evaluated. null when it could. */
  motivo: string | null;
}

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Months since year 0 — lets us test calendar adjacency without Date math. */
function monthIndex(key: string): number {
  const m = MONTH_KEY.exec(key);
  if (!m) return Number.NaN;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

function noEvaluable(motivo: string): Tendencia {
  return { estado: 'no-evaluable', meses: [], alzaPct: null, motivo };
}

/**
 * Evaluate the monthly demand series written by the sync
 * (`reabastecimiento_inputs.demanda_mensual`, keys 'YYYY-MM' → qty in the
 * product's stock UoM, one entry per COMPLETE month, explicit zeros included).
 *
 * Returns `no-evaluable` — never a silent `sin-tendencia` — when the series is
 * absent, too short, or not calendar-consecutive. A missing answer and a
 * negative answer are different things and the UI says so out loud: before the
 * sync has run once with this column, every row is `no-evaluable`, and that
 * must not read as "nothing is rising".
 */
export function evaluarTendencia(
  serie: Record<string, unknown> | null | undefined,
): Tendencia {
  if (serie === null || serie === undefined || typeof serie !== 'object') {
    return noEvaluable('sin serie mensual sincronizada');
  }

  const meses: MesDemanda[] = Object.entries(serie)
    .filter(([k, v]) => MONTH_KEY.test(k) && typeof v === 'number' && Number.isFinite(v))
    .map(([month, qty]) => ({ month, qty: qty as number }))
    // 'YYYY-MM' sorts chronologically as a plain string.
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

  if (meses.length < TREND_WINDOW_MONTHS) {
    return noEvaluable(
      `sólo ${meses.length} ${meses.length === 1 ? 'mes completo' : 'meses completos'} `
      + `en la serie (se necesitan ${TREND_WINDOW_MONTHS})`,
    );
  }

  const ventana = meses.slice(-TREND_WINDOW_MONTHS);

  // Adjacency is checked, not assumed: a series with a gap (jul, may, feb)
  // would otherwise be read as a three-month run and reported as a trend.
  for (let i = 1; i < ventana.length; i += 1) {
    if (monthIndex(ventana[i].month) !== monthIndex(ventana[i - 1].month) + 1) {
      return noEvaluable(
        `los ${TREND_WINDOW_MONTHS} meses más recientes de la serie no son consecutivos `
        + `(${ventana.map((m) => m.month).join(', ')})`,
      );
    }
  }

  let creciente = true;
  for (let i = 1; i < ventana.length; i += 1) {
    if (!(ventana[i - 1].qty < ventana[i].qty)) { creciente = false; break; }
  }

  const base = ventana[0].qty;
  const fin = ventana[ventana.length - 1].qty;
  const alzaPct = base > 0 ? ((fin - base) / base) * 100 : null;

  return {
    estado: creciente ? 'creciente' : 'sin-tendencia',
    meses: ventana,
    alzaPct: creciente ? alzaPct : null,
    motivo: null,
  };
}
