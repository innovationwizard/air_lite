/**
 * Reglas del forecast comercial (nivel 1).
 *
 * Están acá y no en el handler porque son las reglas del NEGOCIO, no de HTTP:
 * el tope de códigos, el horizonte y —sobre todo— qué motivo suma directo al
 * pedido y cuál sólo se revisa. Esa última distinción es la que hace funcionar
 * la reunión mensual, y una regla así no puede vivir enterrada en una ruta.
 */

/**
 * Los tres motivos, con la semántica acordada.
 *
 *   extraordinaria — certeza con destinatario: alguien ya lo pidió. SUMA
 *                    DIRECTO al pedido, sin pasar por revisión.
 *   temporada      — proyección del canal para la temporada.
 *   critico        — faltante o producto crítico.
 *
 * Los dos últimos son PROYECCIÓN, no compromiso, y por eso se revisan juntos y
 * sólo cuando su suma supera la proyección de compras. Fundirlos con el primero
 * borraría la única distinción que la reunión mensual necesita.
 */
export type Motivo = 'extraordinaria' | 'temporada' | 'critico' | 'base' | 'ajustado';

/**
 * `base` (Level 2, 2026-09-10) is the APPROVED RECOMMENDATION: the leader
 * accepted the app's number for a code. It is none of the three reasons
 * above — not a commitment, not a projection to review — and it NEVER sums
 * into the Sugerido: the wiring of channel forecasts into purchasing is on
 * hold (plan §1 Q5). It is written by the recommendation table, not chosen
 * by hand, so it is not offered in the capture form's radio (`manual: false`).
 */
export const MOTIVOS: { valor: Motivo; etiqueta: string; ayuda: string; manual: boolean }[] = [
  {
    valor: 'extraordinaria',
    etiqueta: 'Compra extraordinaria',
    ayuda: 'Ya tengo a quién entregárselo. Se suma directo al pedido.',
    manual: true,
  },
  {
    valor: 'temporada',
    etiqueta: 'Compra por temporada',
    ayuda: 'Lo espero por la temporada. Se revisa en la reunión si el total pasa la proyección.',
    manual: true,
  },
  {
    valor: 'critico',
    etiqueta: 'Faltante o crítico',
    ayuda: 'Me está faltando. Se revisa en la reunión si el total pasa la proyección.',
    manual: true,
  },
  {
    valor: 'base',
    etiqueta: 'Recomendación aprobada',
    ayuda: 'No entra sola al pedido; se compara en la reunión.',
    manual: false,
  },
  {
    // 2026-09-11: recorded at save time when the quantity differs from the
    // recommendation, so «Modificados» is a fact, not a live comparison.
    valor: 'ajustado',
    etiqueta: 'Recomendación ajustada',
    ayuda: 'El canal cambió el número de la app. No entra sola al pedido; se compara en la reunión.',
    manual: false,
  },
];

export const MOTIVOS_VALIDOS: Motivo[] = MOTIVOS.map((m) => m.valor);

/**
 * An approved (`base`) or adjusted (`ajustado`) recommendation: the leader's
 * number over the app's baseline. Shown beside the others, summed into nothing.
 */
export function esBase(m: Motivo): boolean {
  return m === 'base' || m === 'ajustado';
}

/** The leader's number is their own, not the app's as-is: everything but `base`. */
export function esModificado(m: Motivo): boolean {
  return m !== 'base';
}

/** Suma directo al pedido, sin pasar por la reunión. */
export function sumaDirecto(m: Motivo): boolean {
  return m === 'extraordinaria';
}

/** Tope por área y por mes — el parámetro del proceso actual, sin cambiarlo. */
export const MAX_CODIGOS_POR_MES = 50;

/** Horizonte: el mes en curso y los dos siguientes. */
export const MESES_HORIZONTE = 3;

/** Primer día del mes, en UTC, como 'YYYY-MM-DD'. */
export function primerDiaMes(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * Los meses que se pueden cargar hoy. `hoy` se inyecta para que las pruebas no
 * dependan del reloj de la máquina.
 */
export function mesesAbiertos(hoy: Date): string[] {
  return Array.from({ length: MESES_HORIZONTE }, (_, i) =>
    primerDiaMes(new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + i, 1))));
}

export function mesDentroDelHorizonte(mes: string, hoy: Date): boolean {
  return mesesAbiertos(hoy).includes(mes);
}

/** 'Septiembre 2026' a partir de '2026-09-01'. */
const NOMBRE_MES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function etiquetaMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return `${NOMBRE_MES[m - 1]} ${a}`;
}

/** El n-ésimo `diaSemana` (0=domingo) de un mes, en UTC. */
export function nEsimoDiaSemana(anio: number, mes1a12: number, diaSemana: number, n: number): Date {
  const d = new Date(Date.UTC(anio, mes1a12 - 1, 1));
  let cuenta = 0;
  while (true) {
    if (d.getUTCDay() === diaSemana) {
      cuenta += 1;
      if (cuenta === n) return new Date(d);
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
}

/**
 * Las dos fechas del ciclo del cliente para el mes que se esté mirando:
 * cierre de captura el 2º viernes, reunión el 3er miércoles.
 *
 * Son las únicas fechas de todo el proyecto que nacen del calendario del
 * cliente y no de una negociación, así que la pantalla las muestra en vez de
 * inventar un plazo propio.
 */
export function cicloDelMes(mes: string): { cierre: Date; reunion: Date } {
  const [a, m] = mes.split('-').map(Number);
  // EL MES ANTERIOR, no el propio. Un pronóstico se levanta ANTES de que
  // empiece el mes que describe, y la definición de terminado lo fija en una
  // línea: «las seis áreas cargaron su forecast de OCTUBRE antes del viernes 11
  // de SEPTIEMBRE» (docs/compras/DEFINICION_TERMINADO_FORECAST_COMERCIAL.md §5,
  // y lo mismo en §0, §1 y §2). Calcularlo sobre el mes propio cerraba la
  // captura de octubre el 9 de octubre: nueve días DESPUÉS de que el mes
  // empezó y con el pedido ya puesto.
  const anioCiclo = m === 1 ? a - 1 : a;
  const mesCiclo = m === 1 ? 12 : m - 1;
  return {
    cierre: nEsimoDiaSemana(anioCiclo, mesCiclo, 5, 2),   // 2º viernes
    reunion: nEsimoDiaSemana(anioCiclo, mesCiclo, 3, 3),  // 3er miércoles
  };
}

/** Medianoche UTC del día de `d` — para comparar días, no instantes. */
function diaUTC(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * El mes que la pantalla debe abrir: el SIGUIENTE al mes en curso, siempre.
 *
 * No es un detalle de presentación. `mesesAbiertos` encabeza con el mes EN
 * CURSO, cuya compra ya se decidió, así que abrir ahí es empujar al jefe de
 * canal a cargar un mes que ya se compró — y un valor por defecto equivocado
 * se equivoca a escala, en los seis canales a la vez.
 *
 * Hasta el 2026-09-11 el valor por defecto SALTABA al mes siguiente en cuanto
 * pasaba el cierre del 2º viernes. Eso mandó a los seis canales a noviembre
 * la misma tarde en que todavía discutían octubre (Jorge: «The teams are
 * still discussing forecasts for October. The app must not default to
 * November!»). El cierre es una fecha del banner, no una compuerta: lo único
 * que congela un mes es «Bloquear cambios». El mes que se discute durante
 * septiembre es octubre, con cierre pasado o no; noviembre se discute en
 * octubre.
 *
 * Si el horizonte fuera de un solo mes (no lo es), abre el único que hay.
 */
export function mesPorDefecto(hoy: Date): string {
  const abiertos = mesesAbiertos(hoy);
  return abiertos[1] ?? abiertos[0];
}

/**
 * «Hoy» según el calendario de Guatemala, como medianoche UTC de ese día —
 * la forma que `mesesAbiertos`, `mesPorDefecto` y `estadoCiclo` esperan.
 *
 * Todo el módulo compara días con getUTC*. Pasarle `new Date()` a secas hace
 * que a las 6 de la tarde en Guatemala (UTC−6) ya sea «mañana»: el 11 de
 * septiembre por la tarde el banner daba la captura por cerrada y la
 * pantalla abría en noviembre. El servidor (Vercel, UTC) tiene el mismo
 * problema todo el día, no sólo por la tarde.
 */
export function hoyEnGuatemala(ahora: Date = new Date()): Date {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Guatemala', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora); // en-CA → 'YYYY-MM-DD'
  return new Date(`${partes}T00:00:00Z`);
}

/**
 * Estado del ciclo de un mes respecto de hoy, para que la pantalla no tenga
 * que recalcularlo ni redactar un plazo en negativo.
 */
export function estadoCiclo(mes: string, hoy: Date): {
  cierre: Date; reunion: Date; cerrada: boolean; diasRestantes: number;
} {
  const { cierre, reunion } = cicloDelMes(mes);
  const dias = Math.round((cierre.getTime() - diaUTC(hoy)) / 86_400_000);
  return { cierre, reunion, cerrada: dias < 0, diasRestantes: dias };
}

export interface FilaForecast {
  id?: string;
  product_id: number;
  sku: string;
  nombre: string;
  month: string;
  quantity: number;
  motivo: Motivo;
  area: string;
  note: string | null;
}

/**
 * Consolidado por producto y mes: cuánto pide cada área, cuánto suma directo y
 * cuánto queda a revisión.
 *
 * La separación es el punto entero de la vista: compras necesita saber cuánto
 * de ese total es compromiso (extraordinaria) y cuánto es proyección que se
 * discute, porque son dos conversaciones distintas.
 */
export interface Consolidado {
  product_id: number;
  sku: string;
  nombre: string;
  month: string;
  porArea: Record<string, number>;
  total: number;
  directo: number;
  aRevision: number;
  /** Approved recommendations (`base`): visible, compared, never added. */
  base: number;
  /** Proyección de la app para ese producto. null cuando no hay dato. */
  proyeccion: number | null;
  /** La proyección comercial supera a la de la app: se revisa en la reunión. */
  superaProyeccion: boolean;
}

export function consolidar(
  filas: FilaForecast[],
  proyeccionPorProducto: Map<number, number>,
): Consolidado[] {
  const porClave = new Map<string, Consolidado>();
  for (const f of filas) {
    const clave = `${f.product_id}|${f.month}`;
    let c = porClave.get(clave);
    if (!c) {
      const proyeccion = proyeccionPorProducto.get(f.product_id) ?? null;
      c = {
        product_id: f.product_id, sku: f.sku, nombre: f.nombre, month: f.month,
        porArea: {}, total: 0, directo: 0, aRevision: 0, base: 0,
        proyeccion, superaProyeccion: false,
      };
      porClave.set(clave, c);
    }
    c.porArea[f.area] = (c.porArea[f.area] ?? 0) + f.quantity;
    c.total += f.quantity;
    if (sumaDirecto(f.motivo)) c.directo += f.quantity;
    else if (esBase(f.motivo)) c.base += f.quantity;
    else c.aRevision += f.quantity;
  }
  for (const c of porClave.values()) {
    // Sólo lo que es proyección se compara contra la proyección. Lo
    // extraordinario es certeza y entra al pedido pase lo que pase.
    c.superaProyeccion = c.proyeccion !== null && c.aRevision > c.proyeccion;
  }
  return [...porClave.values()].sort(
    (a, b) => a.month.localeCompare(b.month) || b.total - a.total || a.sku.localeCompare(b.sku));
}
