/**
 * Ordenamiento y filtrado de la tabla del Sugerido — W16 y W17.
 *
 * POR QUÉ EXISTE ESTE MÓDULO Y NO VIVE DENTRO DEL COMPONENTE: es el método de
 * trabajo de Wilmer, no un detalle de presentación. Verbatim (2026-08-26):
 *
 *   «lo que yo hago en mi Excel es que filtro los de menor a mayor y luego me
 *    voy al promedio de ventas y todo lo que tenga más de 10 cajas sí lo
 *    compro… filtro todo lo menor a 10 cajas, lo excluyo»
 *   «quiero ordenar de lo que más vendemos… pero no la puedo ordenar»
 *
 * Es la secuencia ordenar → filtrar → decidir que hoy lo obliga a bajar a
 * Excel. Aislada aquí es testeable sin renderizar la página, igual que
 * `tendencia.ts` y `qty.ts`.
 *
 * ⚠️ ESTE MÓDULO NO CALCULA NADA. No toca el motor, no deriva cantidades y no
 * reordena por «relevancia». Ordena y filtra lo que ya viene calculado — si
 * algún día necesita una cifra nueva, esa cifra se calcula en el motor y llega
 * como campo, no se inventa aquí.
 */

/** Lo mínimo que una fila necesita para ordenarse y filtrarse. */
export interface FilaOrdenable {
  cod: string;
  desc: string;
  prov: string;
  exist: number;
  patio: number;
  doh: number;
  trans: number;
  pending: number | null;
  adic: number;
  p6: number;
  p3: number;
  mtd: number | null;
  sug: number;
  flags: { tendenciaCreciente: boolean };
}

/**
 * Columnas ordenables. Los nombres son los de los datos, no los del encabezado:
 * el encabezado cambia de texto sin que cambie el orden.
 */
export type ClaveOrden =
  | 'cod' | 'desc' | 'prov'
  | 'exist' | 'patio' | 'doh' | 'trans' | 'pending' | 'adic'
  | 'p6' | 'p3' | 'mtd' | 'sug';

export type Direccion = 'asc' | 'desc';

export interface Orden {
  clave: ClaveOrden;
  dir: Direccion;
}

const TEXTO: ReadonlySet<ClaveOrden> = new Set<ClaveOrden>(['cod', 'desc', 'prov']);

/** ¿La columna se ordena como texto? Las demás son numéricas. */
export function esTexto(clave: ClaveOrden): boolean {
  return TEXTO.has(clave);
}

/**
 * Primer click en una columna: numéricas arrancan DESCENDENTES, texto
 * ASCENDENTE.
 *
 * No es un capricho de UX. Lo que él pide de una columna numérica es siempre
 * «lo que más vendemos» primero — *"de mayor a lo que no vendemos"*. Arrancar
 * ascendente lo obligaría a un segundo click cada vez.
 */
export function dirInicial(clave: ClaveOrden): Direccion {
  return esTexto(clave) ? 'asc' : 'desc';
}

/**
 * Click sobre un encabezado: si ya es la columna activa invierte la dirección;
 * si no, cambia de columna con su dirección inicial.
 */
export function siguienteOrden(actual: Orden | null, clave: ClaveOrden): Orden {
  if (actual && actual.clave === clave) {
    return { clave, dir: actual.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { clave, dir: dirInicial(clave) };
}

/**
 * `pending === null` es «sin dato», NO cero (regla del proyecto, 20260813000001).
 * Al ordenar se va SIEMPRE al final, suba o baje la columna: mezclarlo con los
 * ceros diría que sabemos algo que no sabemos.
 */
function valorNumerico(f: FilaOrdenable, clave: ClaveOrden): number | null {
  switch (clave) {
    case 'exist': return f.exist;
    case 'patio': return f.patio;
    case 'doh': return f.doh;
    case 'trans': return f.trans;
    case 'pending': return f.pending;
    case 'adic': return f.adic;
    case 'p6': return f.p6;
    case 'p3': return f.p3;
    case 'mtd': return f.mtd;
    case 'sug': return f.sug;
    default: return null;
  }
}

function valorTexto(f: FilaOrdenable, clave: ClaveOrden): string {
  switch (clave) {
    case 'cod': return f.cod;
    case 'desc': return f.desc;
    case 'prov': return f.prov;
    default: return '';
  }
}

/**
 * Orden por defecto — el que la página traía antes de W16 y que se conserva
 * como estado inicial: activos primero (algo de demanda, existencia o
 * sugerido), y dentro de ellos los más urgentes por DOH ascendente. Las filas
 * muertas se hunden en vez de ocupar la primera pantalla.
 *
 * Deja de ser «el único orden» y pasa a ser «con el que abre».
 */
export function compararPorDefecto(a: FilaOrdenable, b: FilaOrdenable): number {
  const activo = (f: FilaOrdenable) => (f.p3 > 0 || f.exist > 0 || f.sug > 0 ? 1 : 0);
  const d = activo(b) - activo(a);
  if (d !== 0) return d;
  return a.doh - b.doh;
}

/**
 * Ordena una copia. `orden === null` = el orden por defecto.
 *
 * Desempate SIEMPRE por código: sin él, dos filas con el mismo valor pueden
 * intercambiarse entre renders y la tabla «tiembla» mientras él la lee.
 */
export function ordenar<T extends FilaOrdenable>(filas: readonly T[], orden: Orden | null): T[] {
  const out = [...filas];
  if (!orden) return out.sort((a, b) => compararPorDefecto(a, b) || a.cod.localeCompare(b.cod));

  const signo = orden.dir === 'asc' ? 1 : -1;
  if (esTexto(orden.clave)) {
    return out.sort((a, b) =>
      signo * valorTexto(a, orden.clave).localeCompare(valorTexto(b, orden.clave), 'es')
      || a.cod.localeCompare(b.cod));
  }
  return out.sort((a, b) => {
    const va = valorNumerico(a, orden.clave);
    const vb = valorNumerico(b, orden.clave);
    // «Sin dato» al final en ambas direcciones.
    if (va === null && vb === null) return a.cod.localeCompare(b.cod);
    if (va === null) return 1;
    if (vb === null) return -1;
    return signo * (va - vb) || a.cod.localeCompare(b.cod);
  });
}

/** Columnas sobre las que se puede poner un mínimo. */
export type ClaveUmbral = 'p6' | 'p3' | 'sug' | 'exist';

export interface Filtros {
  /** Código o descripción, sin distinguir mayúsculas. */
  texto?: string;
  proveedor?: string;
  soloConSugerido?: boolean;
  soloCriticos?: boolean;
  soloEnAlza?: boolean;
  /**
   * Umbral mínimo INCLUSIVO sobre una columna numérica — W17.
   *
   * ⚠️ La unidad es la de la columna en pantalla, que es la UoM de stock del
   * producto. Wilmer habla de «10 cajas»; que su caja sea esa unidad NO está
   * confirmado (Q28), y el bug de UoM del 2026-08-20 es el precedente de por
   * qué no se asume. Por eso el filtro se define sobre el valor que él ve, que
   * es lo único que hoy podemos afirmar sin inventar una conversión.
   */
  umbral?: { clave: ClaveUmbral; min: number };
}

function valorUmbral(f: FilaOrdenable, clave: ClaveUmbral): number {
  switch (clave) {
    case 'p6': return f.p6;
    case 'p3': return f.p3;
    case 'sug': return f.sug;
    case 'exist': return f.exist;
  }
}

/**
 * Aplica los filtros. Se combinan con Y — cada uno estrecha al anterior, que es
 * como funciona el autofiltro de Excel del que viene el pedido.
 */
export function filtrar<T extends FilaOrdenable>(filas: readonly T[], f: Filtros): T[] {
  const texto = (f.texto ?? '').trim().toLowerCase();
  return filas.filter((r) => {
    if (f.proveedor && r.prov !== f.proveedor) return false;
    if (texto
        && !r.cod.toLowerCase().includes(texto)
        && !r.desc.toLowerCase().includes(texto)) return false;
    if (f.soloConSugerido && r.sug <= 0) return false;
    if (f.soloCriticos && r.doh >= 3) return false;
    if (f.soloEnAlza && !r.flags.tendenciaCreciente) return false;
    if (f.umbral && valorUmbral(r, f.umbral.clave) < f.umbral.min) return false;
    return true;
  });
}

/** Filtrar y luego ordenar — el orden en que él trabaja, y el que el export debe respetar. */
export function vista<T extends FilaOrdenable>(
  filas: readonly T[],
  filtros: Filtros,
  orden: Orden | null,
): T[] {
  return ordenar(filtrar(filas, filtros), orden);
}
