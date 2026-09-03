/**
 * Ordenamiento y filtrado de la tabla del Sugerido — W16 y W17.
 *
 * POR QUÉ EXISTE ESTE MÓDULO Y NO VIVE DENTRO DEL COMPONENTE: es el método de
 * trabajo de Wilmer, no un detalle de presentación. Verbatim (2026-08-26):
 *
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
  /** Grupo de proveedores (2026-09-04) — null si el proveedor no está agrupado. */
  provGroupId: string | null;
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
  purchaseOk: boolean;
}

/**
 * Columnas ordenables. Los nombres son los de los datos, no los del encabezado:
 * el encabezado cambia de texto sin que cambie el orden.
 */
export type ClaveOrden =
  | 'cod' | 'desc' | 'prov'
  | 'exist' | 'patio' | 'doh' | 'trans' | 'pending' | 'adic'
  | 'p6' | 'p3' | 'mtd' | 'sug';

/** Las columnas numéricas de `ClaveOrden` — las únicas que aceptan un filtro de rango. */
export type ClaveOrdenNumerica = Exclude<ClaveOrden, 'cod' | 'desc' | 'prov'>;

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
export function valorNumerico(f: FilaOrdenable, clave: ClaveOrden): number | null {
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

export type OperadorRango = 'lte' | 'gte';

export interface FiltroRango {
  operador: OperadorRango;
  valor: number;
}

/**
 * Grupos de proveedores (2026-09-04) — el valor seleccionado en el filtro es
 * SIEMPRE un string (`proveedor` no cambia de tipo), pero uno que refiere a un
 * grupo lleva este prefijo para distinguirse de un nombre crudo de proveedor.
 * Vive acá, no en el componente, para que el prefijo se use una sola vez.
 */
export const grupoFiltroValor = (groupId: string): string => `group:${groupId}`;

export interface Filtros {
  /** Código o descripción, sin distinguir mayúsculas. */
  texto?: string;
  /** Nombre crudo de proveedor, o `grupoFiltroValor(id)` para filtrar por grupo. */
  proveedor?: string;
  soloConSugerido?: boolean;
  soloCriticos?: boolean;
  soloEnAlza?: boolean;
  /** Odoo purchase_ok — deja fuera los productos marcados como no comprables. */
  soloComprables?: boolean;
  /**
   * Filtro ≤ / ≥ por columna numérica — el «autofiltro por número» que pidió
   * Wilmer, uno por columna, combinados con Y con todo lo demás.
   */
  rangos?: Partial<Record<ClaveOrdenNumerica, FiltroRango>>;
}

/**
 * Aplica los filtros. Se combinan con Y — cada uno estrecha al anterior, que es
 * como funciona el autofiltro de Excel del que viene el pedido.
 */
export function filtrar<T extends FilaOrdenable>(filas: readonly T[], f: Filtros): T[] {
  const texto = (f.texto ?? '').trim().toLowerCase();
  const rangos = Object.entries(f.rangos ?? {}) as [ClaveOrdenNumerica, FiltroRango][];
  return filas.filter((r) => {
    if (f.proveedor) {
      if (f.proveedor.startsWith('group:')) {
        if (r.provGroupId !== f.proveedor.slice('group:'.length)) return false;
      } else if (r.prov !== f.proveedor) return false;
    }
    if (texto
        && !r.cod.toLowerCase().includes(texto)
        && !r.desc.toLowerCase().includes(texto)) return false;
    if (f.soloConSugerido && r.sug <= 0) return false;
    if (f.soloCriticos && r.doh >= 3) return false;
    if (f.soloEnAlza && !r.flags.tendenciaCreciente) return false;
    if (f.soloComprables && !r.purchaseOk) return false;
    for (const [clave, rango] of rangos) {
      const v = valorNumerico(r, clave);
      // «Sin dato» no es cero: no puede cumplir ni ≤ ni ≥ nada, así que
      // un rango activo lo deja fuera (misma regla que ordenar, línea 85).
      if (v === null) return false;
      if (rango.operador === 'lte' ? v > rango.valor : v < rango.valor) return false;
    }
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

/* ═══════════════════════════════════════════════════════════════════════════
 * COPIAR AL PORTAPAPELES — la tabla visible como TSV
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * POR QUÉ ESTO EXISTE, y por qué NO es un archivo.
 *
 * Wilmer digita a mano los códigos de cada orden de compra en Odoo, y lo dijo
 * con todas sus letras: *«yo no digito, me prefiero copiar y pegar porque se me
 * equivocó un código»*. El pedido nunca fue un importador — fue dejar de
 * retipear.
 *
 * Durante meses esto se tradujo como «un archivo importable a Odoo» (A4, línea
 * del contrato del 16-jun). Dos hechos, confirmados el 2026-09-01, cierran esa
 * lectura:
 *   1. La importación masiva NO está habilitada en Odoo, y así estaba
 *      registrado desde el 06-ago.
 *   2. La decisión vigente del cliente es copiar y pegar; la importación no
 *      está aprobada por quienes tendrían que aprobarla.
 *
 * Un archivo obliga a descargar, abrir, y —el riesgo real— abrirlo en Excel,
 * que corrompe fechas y códigos con ceros a la izquierda antes de que nadie lo
 * note. El portapapeles se pega directo en la grilla de Odoo o en Excel sin
 * pasar por el disco. Es menos trabajo Y menos superficie de error.
 *
 * TSV Y NO CSV, deliberado: la grilla de Odoo y Excel pegan tabulaciones en
 * columnas separadas sin preguntar nada. Un CSV pegado abre un diálogo de
 * importación, o peor, cae todo en una sola columna.
 */

/** Una columna tal como se ve en pantalla: el encabezado y cómo sacar su valor. */
export interface ColumnaCopiable<T> {
  encabezado: string;
  valor: (fila: T) => string | number | null | undefined;
}

/**
 * Neutraliza lo que rompería el pegado.
 *
 * Un tabulador o un salto de línea dentro de una celda desplazaría TODAS las
 * columnas siguientes de esa fila, y el resultado se ve plausible — que es lo
 * peor que puede pasar cuando el destino es una orden de compra. Se reemplazan
 * por espacios en vez de entrecomillar: entrecomillar es lo correcto en CSV,
 * pero la grilla de Odoo no siempre lo interpreta al pegar.
 */
function celda(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[\t\r\n]+/g, ' ').trim();
}

/**
 * La tabla visible como TSV, en el MISMO orden y con las MISMAS filas que se
 * están viendo.
 *
 * `filas` debe venir ya ordenada y filtrada — este módulo no vuelve a decidir
 * qué se ve. Ese fue exactamente el defecto del 26-ago: el archivo se armaba
 * por su cuenta y devolvía otra bodega y códigos de otro proveedor que los que
 * había en pantalla.
 */
export function tablaATsv<T>(filas: readonly T[], columnas: readonly ColumnaCopiable<T>[]): string {
  const cabecera = columnas.map((c) => celda(c.encabezado)).join('\t');
  const cuerpo = filas.map((f) => columnas.map((c) => celda(c.valor(f))).join('\t'));
  return [cabecera, ...cuerpo].join('\n');
}
