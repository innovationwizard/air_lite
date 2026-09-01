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

/* ═══════════════════════════════════════════════════════════════════════════
 * DIVERGENCIA — «esto no se está comportando como venía comportándose»
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Añadido 2026-09-01. LEER ENTERO ANTES DE TOCAR EL UMBRAL O LA BASE: las dos
 * decisiones de abajo se tomaron contra mediciones de producción, y las dos
 * son contraintuitivas.
 *
 * ── QUÉ SE PIDIÓ, Y POR QUÉ NO SE CONSTRUYÓ ASÍ ────────────────────────────
 *
 * El pedido original (A1.15) decía: «alerta de divergencia TENDENCIA (3 meses)
 * vs ESTACIONAL». Es decir, comparar el promedio de 3 meses contra `h` — la
 * demanda del MISMO MES DEL AÑO PASADO.
 *
 * Se midió esa comparación sobre producción el 2026-09-01, y no se sostiene:
 *
 *   · La divergencia MEDIANA contra `h` es del 75%. No es un caso extremo: es
 *     la mitad del catálogo. Un umbral del 20-30% —el que uno elegiría por
 *     instinto— dispararía en el 82% de los productos evaluables. Eso no es una
 *     alerta, es un color de fondo.
 *   · La causa es la BASE, no el número: `h` es UN MES suelto de hace un año, y
 *     se estaba comparando contra un promedio de 3 meses. Un mes crudo es
 *     ruidosísimo; suavizado contra no-suavizado diverge para casi todo.
 *   · Además, 103 de los 653 productos con `h > 0` tienen `p3 = 0` — dejaron de
 *     venderse — y caen en exactamente 100% de divergencia. Un sexto de la
 *     alerta habrían sido productos muertos. Es información real, pero no es la
 *     que se pidió.
 *   · Y `h` sólo existe para el 49% del catálogo (678 de 1,331 lo tienen en 0).
 *
 * ── LA BASE QUE SÍ FUNCIONA: p3 CONTRA p6 ──────────────────────────────────
 *
 * Comparar el promedio RECIENTE (3 meses) contra el promedio LARGO (6 meses).
 * Misma intención —«¿está cambiando el comportamiento?»— y los dos están
 * suavizados, así que la comparación mide señal en vez de ruido de muestreo.
 *
 *   · Cobertura: 72% del catálogo (956 de 1,331) contra 49% de `h`.
 *   · Divergencia mediana: 27%, que es donde el instinto ya ponía el umbral.
 *
 * ⚠️ ESTO NO ES LA ESTACIONALIDAD. p6 es medio año, no el año pasado, así que
 * esta alerta NO detecta «este año no se parece al anterior». Detecta que lo
 * reciente se despegó de la propia base del producto. Si algún día hace falta
 * la comparación interanual de verdad, necesita los MISMOS 3 MESES del año
 * anterior —no un mes suelto— y eso hoy no se sincroniza.
 *
 * ── POR QUÉ VA COMBINADA CON LAS DOS ALZAS, Y NO SUELTA ────────────────────
 *
 * Aun con la base buena, el 41% de los evaluables supera el 40%. Un catálogo
 * chico con demanda volátil ES volátil, y no hay umbral que lo arregle sin
 * esconder cosas. Dos alertas independientes disparando cada una sobre media
 * tabla es la forma segura de que el comprador deje de leer las dos.
 *
 * Entonces la alerta que se muestra exige AMBAS cosas: que venga SUBIENDO (dos
 * alzas consecutivas) Y que se haya DESPEGADO de su base. Subir despacio y
 * parejo no amerita revisión; despegarse sin dirección tampoco. Las dos juntas
 * sí, y son un conjunto mucho más chico y mucho más accionable.
 */

/**
 * Umbral de divergencia: |p3 − p6| / p6.
 *
 * 40% ≈ percentil 60 de la distribución medida (mediana 27%), lo que deja unos
 * 393 de 956 evaluables ANTES de cruzarlo con las dos alzas.
 *
 * ⚠️ CONSTANTE POR AHORA, CON LA INTENCIÓN DECLARADA DE VOLVERLA CONFIGURABLE
 * POR EL USUARIO (Jorge, 2026-09-01). Cuando llegue ese momento: el número no
 * se guarda suelto, se guarda junto a QUIÉN lo cambió y CUÁNDO, como el resto
 * de las capturas manuales de este módulo — porque el día que la alerta deje de
 * disparar, la primera pregunta va a ser quién movió el umbral.
 *
 * Si hay que subirlo o bajarlo, hacerlo contra una medición nueva de la
 * distribución, no a ojo. La consulta está en el historial del 2026-09-01.
 */
export const DIVERGENCIA_UMBRAL = 0.40;

export type DivergenciaEstado = 'divergente' | 'sin-divergencia' | 'sin-base';

export interface Divergencia {
  estado: DivergenciaEstado;
  /** (p3 − p6) / p6. CON SIGNO: positivo se despegó hacia arriba. */
  pct: number | null;
  motivo: string | null;
}

/**
 * Evalúa la divergencia de un producto.
 *
 * `sin-base` cuando p6 es 0: no hay contra qué comparar. Esas filas quedan
 * EXCLUIDAS de disparar, no sólo etiquetadas — una fila que igual alerta con un
 * cartelito explicativo no arregla nada, sólo agrega una excusa al ruido.
 */
export function evaluarDivergencia(p3: number, p6: number): Divergencia {
  if (!Number.isFinite(p3) || !Number.isFinite(p6)) {
    return { estado: 'sin-base', pct: null, motivo: 'sin promedios sincronizados' };
  }
  if (p6 <= 0) {
    return { estado: 'sin-base', pct: null, motivo: 'sin promedio de 6 meses para comparar' };
  }
  const pct = (p3 - p6) / p6;
  return {
    estado: Math.abs(pct) > DIVERGENCIA_UMBRAL ? 'divergente' : 'sin-divergencia',
    pct,
    motivo: null,
  };
}

/**
 * Referencia del año anterior — badge INFORMATIVO, no una alerta.
 *
 * Aunque la divergencia ya no se calcula contra `h`, el dato de que más de la
 * mitad del catálogo NO TIENE con qué compararse contra el año pasado sigue
 * siendo algo que el comprador merece ver: es la razón por la que el término
 * estacional del Sugerido vale poco en esas filas. Medido el 2026-09-01: 678 de
 * 1,331 productos tienen `h = 0`.
 *
 * ⚠️ `h = 0` es AMBIGUO y por eso el texto es deliberadamente cauto: puede
 * significar que no había historia, o que ese mes del año pasado se vendió
 * cero de verdad. Con lo que se sincroniza hoy no se pueden distinguir, así que
 * se dice lo único cierto para ambos casos — que no hay referencia — en vez de
 * afirmar que «no tiene información», que sería falso para un cero real.
 */
export function tieneReferenciaAnioAnterior(h: number): boolean {
  return Number.isFinite(h) && h > 0;
}

export const SIN_REFERENCIA_ANIO_ANTERIOR = 'Sin referencia del año pasado';

export type AlertaEstado = 'revisar' | 'sin-alerta' | 'no-evaluable';

export interface Alerta {
  estado: AlertaEstado;
  /** Por qué amerita revisión, o por qué no se pudo evaluar. */
  motivo: string | null;
}

/**
 * La alerta que ve el comprador: exige SUBIR **y** DESPEGARSE.
 *
 * Ver arriba por qué la conjunción y no dos alertas sueltas. `no-evaluable`
 * cuando falta cualquiera de las dos mitades — un dato que falta y un «no pasa
 * nada» son cosas distintas, y confundirlas es exactamente cómo una alerta deja
 * de merecer confianza.
 */
export function evaluarAlerta(t: Tendencia, d: Divergencia): Alerta {
  if (t.estado === 'no-evaluable') return { estado: 'no-evaluable', motivo: t.motivo };
  if (d.estado === 'sin-base') return { estado: 'no-evaluable', motivo: d.motivo };
  if (t.estado === 'creciente' && d.estado === 'divergente') {
    const dir = (d.pct ?? 0) > 0 ? 'por encima de' : 'por debajo de';
    return {
      estado: 'revisar',
      motivo: `Sube tres meses seguidos y está ${Math.abs((d.pct ?? 0) * 100).toFixed(0)}% `
            + `${dir} su promedio de 6 meses.`,
    };
  }
  return { estado: 'sin-alerta', motivo: null };
}
