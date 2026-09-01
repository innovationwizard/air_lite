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
export type Motivo = 'extraordinaria' | 'temporada' | 'critico';

export const MOTIVOS: { valor: Motivo; etiqueta: string; ayuda: string }[] = [
  {
    valor: 'extraordinaria',
    etiqueta: 'Compra extraordinaria',
    ayuda: 'Ya tengo a quién entregárselo. Se suma directo al pedido.',
  },
  {
    valor: 'temporada',
    etiqueta: 'Compra por temporada',
    ayuda: 'Lo espero por la temporada. Se revisa en la reunión si el total pasa la proyección.',
  },
  {
    valor: 'critico',
    etiqueta: 'Faltante o crítico',
    ayuda: 'Me está faltando. Se revisa en la reunión si el total pasa la proyección.',
  },
];

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

/**
 * Las dos fechas del ciclo del cliente, para el mes que se esté mirando:
 * cierre de captura el 2º viernes, reunión el 3er miércoles.
 *
 * Son las únicas fechas de todo el proyecto que nacen del calendario del
 * cliente y no de una negociación, así que la pantalla las muestra en vez de
 * inventar un plazo propio.
 */
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

export function cicloDelMes(mes: string): { cierre: Date; reunion: Date } {
  const [a, m] = mes.split('-').map(Number);
  return {
    cierre: nEsimoDiaSemana(a, m, 5, 2),   // 2º viernes
    reunion: nEsimoDiaSemana(a, m, 3, 3),  // 3er miércoles
  };
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
        porArea: {}, total: 0, directo: 0, aRevision: 0,
        proyeccion, superaProyeccion: false,
      };
      porClave.set(clave, c);
    }
    c.porArea[f.area] = (c.porArea[f.area] ?? 0) + f.quantity;
    c.total += f.quantity;
    if (sumaDirecto(f.motivo)) c.directo += f.quantity;
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
