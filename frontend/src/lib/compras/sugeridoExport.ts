/**
 * «Exportar Excel» — el Sugerido tal como está en pantalla.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * POR QUÉ ESTE MÓDULO REEMPLAZA A `carvajal.ts` COMO FORMA DEL ARCHIVO
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Durante dos meses se le dijo a Wilmer «ya sirve» y ninguna vez fue cierto.
 * El 26-ago lo probó en vivo y reportó cuatro defectos que son, todos, el
 * MISMO defecto: el archivo se armaba por su cuenta en vez de exportar lo que
 * él estaba viendo.
 *
 *   D1 fuente equivocada — *"me descargo otra cosa… un reporte que alguien
 *      compartió un día, y yo creo que nada que ver"*
 *   D2 códigos cruzados — *"es el reporte con códigos de Carvajal, pero los
 *      puso con códigos de Envaica y nada que ver"*
 *   D3 bodega equivocada — *"yo estoy viendo San José y pidió Petén y Zacapa"*
 *   D4 números sin origen — *"los sugeridos y lo de las prioridades, ¿de dónde
 *      las tomó?… Esto no funciona, lo del Excel no funciona"*
 *
 * La causa raíz era arquitectónica, no cosmética: el exportador anterior
 * llamaba a `POST /export`, que releía las TRES bodegas de Carvajal desde la
 * base y proponía cantidades con una fórmula propia (`Sugerido ÷ cobertura ×
 * 7`). Nada de eso salía de la pantalla, así que nada de eso podía coincidir
 * con la pantalla.
 *
 * LA REGLA, y es estructural: **este módulo no lee nada y no calcula nada.**
 * Recibe las filas YA filtradas y ordenadas por `tabla.ts` — el mismo arreglo
 * que la tabla está pintando — y las escribe. No hay una segunda fuente que
 * pueda discrepar, no hay una bodega que elegir, y no hay una cantidad que
 * inventar. D1–D4 dejan de ser bugs posibles en vez de bugs corregidos.
 *
 * Es exactamente la regla que `tablaATsv` (el botón «Copiar») ya cumplía. El
 * export nunca la adoptó, y esa es toda la diferencia entre los dos botones.
 *
 * ── DECISIONES (Jorge, 2026-09-07) ────────────────────────────────────────
 *  · SOLO LA BODEGA ACTIVA. Una hoja, la que está en pantalla. Para Petén
 *    cambia de pestaña y exporta otra vez. Es la única forma que no puede
 *    repetir D3.
 *  · SIN MODAL. Un click y baja el archivo. El modal editable existía para
 *    corregir la propuesta ÷cobertura; sin propuesta que corregir, sobra —
 *    y él manipula en Excel, que es lo que pidió: *"poderme mover, ordenar y
 *    manipular la información… partirla"*.
 *  · CUBICAJE CON LOS HUECOS DECLARADOS. Ver el bloque m³ más abajo.
 *
 * ⚠️ Nombre del archivo: «Sugerido», NUNCA «Carvajal_Prioridades Semana N»
 * (A6.16, acordado con él: *"le vamos a poner sugerido"*). El nombre viejo
 * describía la hoja de un proveedor y aparecía aunque el proveedor fuera otro
 * — la mitad de D2 era eso.
 */
import { type SheetSpec } from '@/lib/xlsx/writer';
import { type Alerta, type Tendencia } from '@/lib/compras/tendencia';
import { type ClaveOrden, type Filtros, type Orden } from '@/lib/compras/tabla';

/**
 * Lo que una fila necesita para exportarse: EXACTAMENTE los campos que la
 * tabla pinta, ni uno más. Es un subconjunto estructural de `ApiRow`, así que
 * agregar una columna a la pantalla y olvidarla acá es visible en el tipo.
 */
export interface FilaExport {
  cod: string;
  desc: string;
  prov: string;
  abc: 'A' | 'B' | 'C' | 'D';
  exist: number;
  patio: number;
  doh: number;
  trans: number;
  transOverridden: boolean;
  /** null = «¿?», sin dato. NUNCA se escribe como 0 (regla 20260813000001). */
  pending: number | null;
  adic: number;
  /** QUIÉN pidió CUÁNTO: slug del canal → sus cantidades. */
  adicPorArea?: Record<string, { directo: number; aRevision: number }>;
  p6: number;
  p3: number;
  mtd: number | null;
  mtdRitmo: number | null;
  tendencia: Tendencia;
  alerta: Alerta;
  sugBodega: number | null;
  sug: number;
  /**
   * m³ por unidad (`products.volume_m3`, sincronizado de `product.volume` de
   * Odoo). null = sin medir — ver el bloque m³ abajo.
   */
  volM3: number | null;
}

export interface ContextoExport {
  /** Id interno de la bodega, p. ej. 'San Jose VN'. */
  bodega: string;
  /** Cómo se llama en pantalla, p. ej. 'San José'. */
  bodegaLabel: string;
  /** Qué incluye y qué excluye esa bodega (el tooltip de la pestaña). */
  bodegaDetalle?: string;
  /** La etiqueta del filtro de proveedor, ya resuelta (grupo → su nombre). */
  proveedorLabel: string;
  filtros: Filtros;
  orden: Orden | null;
  /** Días de demanda que cubre el Sugerido en esta bodega. */
  coberturaDias: number;
  /** Hasta cuándo llegan los datos de Odoo (ISO), o null si no hay sync. */
  datosAl: string | null;
  /** Filas en la bodega ANTES de los filtros — para ver cuánto se estrechó. */
  totalSinFiltros: number;
  /** Días transcurridos del mes: es igual para toda la tabla, así que no es columna. */
  mtdDias: number | null;
  generadoEn: Date;
  /** Quién lo descargó, si se conoce. Nunca inventado. */
  autor?: string | null;
}

/** Sin acentos ni caracteres que rompan un nombre de archivo en Windows o macOS. */
function seguroParaArchivo(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

/** 'YYYY-MM-DD' en hora local — la fecha que él ve, no UTC. */
export function fechaArchivo(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * `Sugerido Carvajal San José 2026-09-07.xlsx` — R2, en ese orden.
 *
 * Lleva el proveedor Y la bodega porque los dos defectos que reportó eran de
 * identidad: un archivo con los códigos de otro proveedor y otro con la bodega
 * que no estaba viendo. Si el nombre lo dice, un archivo equivocado se detecta
 * antes de abrirlo.
 */
export function nombreArchivo(ctx: {
  proveedorLabel: string; bodegaLabel: string; generadoEn: Date;
}): string {
  const partes = ['Sugerido', ctx.proveedorLabel, ctx.bodegaLabel, fechaArchivo(ctx.generadoEn)];
  return `${seguroParaArchivo(partes.filter(Boolean).join(' '))}.xlsx`;
}

/**
 * Cómo se nombra el proveedor cuando NO hay filtro puesto.
 *
 * `proveedorLabel` viene vacío en ese caso a propósito: así el nombre del
 * archivo queda «Sugerido San José 2026-09-07.xlsx» en vez de meterle un
 * «Todos» que se lee como si fuera un proveedor. En la hoja «Origen», en
 * cambio, hay que decirlo con todas las letras — un campo «Proveedor» vacío
 * se lee como un dato que se perdió.
 */
export function proveedorParaMostrar(label: string): string {
  return label.trim() || 'Todos (sin filtro de proveedor)';
}

/** El texto del badge de tendencia, palabra por palabra igual que en pantalla. */
export function etiquetaTendencia(t: Tendencia, a: Alerta): string {
  if (a.estado === 'revisar') return 'Revisar';
  if (t.estado === 'no-evaluable') return '¿?';
  if (t.estado === 'sin-tendencia') return '—';
  return 'Alza';
}

/** Nombres de columna para describir el orden activo en la hoja «Origen». */
const ETIQUETA_ORDEN: Record<ClaveOrden, string> = {
  cod: 'Código', desc: 'Descripción', prov: 'Proveedor',
  exist: 'Exist. neta', patio: 'Patio', doh: 'DOH', trans: 'Tránsito',
  pending: 'Pend. reserva', adic: 'Adic.', p6: 'Ord. 6m', p3: 'Ord. 3m',
  mtd: 'Mes en curso', sug: 'Sugerido',
};

/** Cómo está ordenada la tabla, en una frase. */
export function describirOrden(orden: Orden | null): string {
  if (!orden) {
    return 'Por defecto — activos primero, y dentro de ellos los más urgentes por DOH ascendente';
  }
  const dir = orden.dir === 'asc' ? 'de menor a mayor' : 'de mayor a menor';
  return `${ETIQUETA_ORDEN[orden.clave]} ${dir}`;
}

/**
 * Cada filtro activo, enunciado. Un filtro que estrechó la tabla y no se
 * declara es media explicación de por qué faltan códigos.
 */
export function describirFiltros(f: Filtros): string[] {
  const out: string[] = [];
  const texto = (f.texto ?? '').trim();
  if (texto) out.push(`Búsqueda: "${texto}" (en código o descripción)`);
  if (f.soloConSugerido) out.push('Solo con sugerido (Sugerido > 0)');
  if (f.soloCriticos) out.push('Solo quiebre (DOH < 3)');
  if (f.soloEnAlza) out.push('Solo en alza (dos alzas seguidas)');
  if (f.soloComprables) out.push('Solo comprables (purchase_ok en Odoo)');
  for (const [clave, r] of Object.entries(f.rangos ?? {})) {
    if (!r) continue;
    const op = r.operador === 'lte' ? '≤' : '≥';
    out.push(`${ETIQUETA_ORDEN[clave as ClaveOrden]} ${op} ${r.valor}`);
  }
  return out;
}

/**
 * m³ — CON LOS HUECOS DECLARADOS (decisión de Jorge, 2026-09-07).
 *
 * `ml/probe_cubicaje.py` lo advierte y la advertencia se respeta: *"Un
 * cubicaje incompleto o en la unidad equivocada es PEOR que no tenerlo: lo
 * usaría para reservar camiones."* Wilmer tiene un tope físico duro — *"tengo
 * un límite de 3 furgones locales, entonces yo tengo que cubicar no más de
 * eso"*.
 *
 * Medido el 2026-09-07 sobre los productos de esta página: 1,115 de 1,333
 * tienen `volume_m3 > 0` (83.6%); 218 no tienen ninguno.
 *
 * Por eso: sin medida el m³ va VACÍO, nunca 0 — un 0 dice «no ocupa espacio»
 * y es lo que haría subestimar un furgón — y la hoja «Origen» dice cuántas
 * filas quedaron sin medida, para que una suma de la columna no se pueda leer
 * como completa. Siguen abiertas la verificación de unidad y la remedición de
 * las bolsas (O7); ambas se declaran ahí también.
 */
export function m3Sugerido(sug: number, volM3: number | null): number | null {
  if (typeof volM3 !== 'number' || !Number.isFinite(volM3) || volM3 <= 0) return null;
  if (!Number.isFinite(sug)) return null;
  return sug * volM3;
}

/** Cuántas filas exportadas no tienen cubicaje medido. */
export function sinCubicaje(filas: readonly FilaExport[]): number {
  return filas.filter((f) => m3Sugerido(f.sug, f.volM3) === null).length;
}

/**
 * Las columnas del archivo — las MISMAS que están en pantalla, en el mismo
 * orden, más dos que sólo tienen sentido en una hoja de cálculo.
 *
 * `Descripción / Proveedor` es UNA celda en pantalla (dos renglones) y acá son
 * DOS columnas: pegadas en una sola no se puede filtrar por proveedor, que es
 * el primer gesto que él hace en Excel.
 *
 * `Prioridad` es la posición en el orden actual, 1..N — la columna que pidió,
 * y la que la pantalla muestra como el simple hecho de estar más arriba.
 *
 * NO HAY COLUMNAS DE FACTURACIÓN (R4). Tampoco están en pantalla desde el
 * 26-ago (Q9): *"yo trabajo con lo ordenado, no con esto"*.
 */
export const COLUMNAS_SUGERIDO: readonly {
  header: string;
  width: number;
  type: SheetSpec['columns'][number]['type'];
  valor: (f: FilaExport, i: number) => string | number | null;
}[] = [
  { header: 'Prioridad', width: 9, type: 'number', valor: (_f, i) => i + 1 },
  // Texto a propósito: un código como '0351' es un código, y Excel lo
  // convertiría en 351 si lo escribiéramos como número.
  { header: 'Código', width: 12, type: 'text', valor: (f) => f.cod },
  { header: 'ABC', width: 6, type: 'text', valor: (f) => f.abc },
  { header: 'Descripción', width: 44, type: 'text', valor: (f) => f.desc },
  { header: 'Proveedor', width: 24, type: 'text', valor: (f) => f.prov },
  { header: 'Exist. neta', width: 12, type: 'number', valor: (f) => f.exist },
  { header: 'Patio', width: 10, type: 'number', valor: (f) => f.patio },
  { header: 'DOH', width: 9, type: 'decimal1', valor: (f) => f.doh },
  { header: 'Tránsito', width: 11, type: 'number', valor: (f) => f.trans },
  {
    header: 'Tránsito capturado a mano',
    width: 12,
    type: 'text',
    // El número de tránsito cambia de significado según de dónde salga; en
    // pantalla eso se ve como el borde teal del input y acá no habría forma
    // de saberlo.
    valor: (f) => (f.transOverridden ? 'Sí' : ''),
  },
  // VACÍO = «¿?», sin dato. Escribirlo como 0 diría que sabemos que no hay
  // nada pendiente de tomar reserva, que es justo lo que no sabemos.
  { header: 'Pend. reserva', width: 13, type: 'number', valor: (f) => f.pending },
  { header: 'Adic.', width: 9, type: 'number', valor: (f) => f.adic },
  { header: 'Ord. 6m', width: 10, type: 'number', valor: (f) => f.p6 },
  { header: 'Ord. 3m', width: 10, type: 'number', valor: (f) => f.p3 },
  { header: 'Mes en curso', width: 13, type: 'number', valor: (f) => f.mtd },
  { header: 'Ritmo 30d', width: 11, type: 'number', valor: (f) => f.mtdRitmo },
  { header: 'Tendencia', width: 12, type: 'text', valor: (f) => etiquetaTendencia(f.tendencia, f.alerta) },
  { header: 'Pide bodega', width: 12, type: 'number', valor: (f) => f.sugBodega },
  { header: 'Sugerido', width: 12, type: 'number', valor: (f) => f.sug },
  // El m³ por unidad va al lado del total a propósito: en cuanto él cambie el
  // Sugerido para partir la orden, el m³ de la fila queda viejo. Con el
  // unitario al lado lo recalcula; sin él, el número que quedó miente.
  { header: 'm³ x unidad', width: 12, type: 'decimal4', valor: (f) => f.volM3 },
  { header: 'm³ sugerido', width: 12, type: 'decimal4', valor: (f) => m3Sugerido(f.sug, f.volM3) },
];

/**
 * La hoja de trabajo: encabezado + una fila por producto, en el orden recibido.
 *
 * Valores planos, sin fórmulas y sin celdas combinadas (R6) — se pega directo
 * en la grilla de Odoo, que es el destino #1 del archivo. El autofiltro queda
 * puesto para que su método de siempre funcione sin tocar nada: *"filtro los
 * de menor a mayor… todo lo que tenga más de 10 cajas sí lo compro… filtro lo
 * que [la bodega] no vende"* (R5).
 */
/**
 * Las columnas del archivo para un juego dado de canales comerciales.
 *
 * Los canales son DATOS (`comercial_areas`), no una lista fija, así que las
 * columnas se arman en tiempo de ejecución. Van justo después de `Adic.` y en
 * el mismo orden que en pantalla: el archivo tiene que poder leerse al lado de
 * la vista sin traducir nada — es la regla que arregló el export el 26-ago.
 *
 * Dos columnas por canal, y no una: lo que ENTRA al pedido y lo que queda A
 * REVISIÓN son dos conversaciones distintas, y en una hoja de cálculo se
 * filtran por separado. Fundirlas obligaría a deshacer la suma a mano, que es
 * exactamente el trabajo que este archivo vino a quitar.
 */
export function columnasSugerido(
  areas: readonly { slug: string; nombre: string }[] = [],
): typeof COLUMNAS_SUGERIDO {
  if (areas.length === 0) return COLUMNAS_SUGERIDO;
  const i = COLUMNAS_SUGERIDO.findIndex((c) => c.header === 'Adic.');
  const porCanal = areas.flatMap((a) => [
    {
      header: a.nombre, width: 12, type: 'number' as const,
      valor: (f: FilaExport) => f.adicPorArea?.[a.slug]?.directo ?? 0,
    },
    {
      header: `${a.nombre} (rev.)`, width: 14, type: 'number' as const,
      valor: (f: FilaExport) => f.adicPorArea?.[a.slug]?.aRevision ?? 0,
    },
  ]);
  return [...COLUMNAS_SUGERIDO.slice(0, i + 1), ...porCanal, ...COLUMNAS_SUGERIDO.slice(i + 1)];
}

export function construirHojaSugerido(
  filas: readonly FilaExport[],
  areas: readonly { slug: string; nombre: string }[] = [],
): SheetSpec {
  const columnas = columnasSugerido(areas);
  return {
    name: 'Sugerido',
    columns: columnas.map((c) => ({ header: c.header, width: c.width, type: c.type })),
    rows: filas.map((f, i) => columnas.map((c) => c.valor(f, i))),
  };
}

/**
 * La hoja «Origen» — la respuesta a D4, *"¿de dónde las tomó?"*.
 *
 * Va en su PROPIA hoja y no como encabezado de la tabla: un bloque de texto
 * arriba de los datos rompe el autofiltro y arruina el copiar-y-pegar hacia
 * Odoo, que son las dos cosas para las que existe el archivo.
 *
 * Dice qué bodega, qué proveedor, qué filtros, qué orden, hasta cuándo llegan
 * los datos y qué NO se puede confiar todavía. Un archivo que se explica solo
 * se puede discutir; uno que no, sólo se puede desconfiar.
 */
export function construirHojaOrigen(
  filas: readonly FilaExport[], ctx: ContextoExport,
): SheetSpec {
  const filtros = describirFiltros(ctx.filtros);
  const faltantes = sinCubicaje(filas);

  const rows: (string | number | null)[][] = [
    ['Archivo', nombreArchivo(ctx)],
    ['Generado', ctx.generadoEn.toLocaleString('es-GT')],
  ];
  if (ctx.autor) rows.push(['Descargado por', ctx.autor]);

  rows.push(
    [null, null],
    ['LO QUE ESTABA EN PANTALLA', null],
    ['Bodega', ctx.bodegaLabel],
  );
  if (ctx.bodegaDetalle) rows.push(['Qué incluye esa bodega', ctx.bodegaDetalle]);
  rows.push(
    ['Proveedor', proveedorParaMostrar(ctx.proveedorLabel)],
    ['Orden', describirOrden(ctx.orden)],
    ['Filtros activos', filtros.length ? filtros.join(' · ') : 'Ninguno'],
    ['Filas exportadas', filas.length],
    ['Filas en la bodega sin filtrar', ctx.totalSinFiltros],
    [null, null],
    ['DE DÓNDE SALEN LOS NÚMEROS', null],
    [
      'Sugerido',
      'max(0, forecast − max(0, exist. neta + tránsito − proyección)) + adicional. '
      + 'Es el MISMO número que estaba en la columna Sugerido de la pantalla: '
      + 'este archivo no recalcula nada ni propone cantidades propias.',
    ],
    ['Sugerido cubre', `${ctx.coberturaDias} días de demanda en ${ctx.bodegaLabel}`],
    [
      'Ord. 6m / Ord. 3m',
      'Promedio mensual ORDENADO (sale.order.line en estado venta y hecho; '
      + 'excluye cotización, cotización enviada y cancelado). No es facturado.',
    ],
    [
      'Prioridad',
      'La posición en el orden de arriba, 1..N. No es un cálculo: es el lugar '
      + 'que la fila ocupaba en la pantalla.',
    ],
    [
      'Exist. neta',
      'Existencias − reservado − pendiente de tomar reserva. No incluye patio ni tránsito.',
    ],
    [
      'Pend. reserva vacío',
      'Vacío significa SIN DATO, no cero. Es captura manual y no existe en ningún sistema.',
    ],
    ['Datos de Odoo al', ctx.datosAl ?? 'sin sincronización registrada'],
  );

  if (ctx.mtdDias !== null) {
    rows.push(['Mes en curso', `Ordenado en los ${ctx.mtdDias} días transcurridos del mes (parcial)`]);
  }

  rows.push(
    [null, null],
    ['LO QUE TODAVÍA NO ES CONFIABLE', null],
  );

  if (faltantes > 0) {
    rows.push([
      '⚠ Cubicaje incompleto',
      `${faltantes} de ${filas.length} filas exportadas no tienen m³ medido y salieron VACÍAS `
      + '(vacío, nunca 0). La suma de la columna «m³ sugerido» está INCOMPLETA: '
      + 'no reserves furgones con esa cifra sin revisar esas filas.',
    ]);
  } else if (filas.length > 0) {
    rows.push(['Cubicaje', 'Todas las filas exportadas tienen m³ medido.']);
  }

  rows.push(
    [
      '⚠ Unidad del cubicaje',
      'El m³ viene de product.volume de Odoo y su unidad NO está verificada contra '
      + 'la UoM de stock (sonda ml/probe_cubicaje.py, pendiente de correr).',
    ],
    [
      '⚠ Bolsas mal medidas',
      'Mario reportó que los códigos de bolsa están mal medidos en Odoo '
      + '(un pedido chico sugiere casi un furgón). La remedición sigue pendiente (O7).',
    ],
    [null, null],
    [
      'Nota',
      'Este archivo es una foto de la pantalla en la fecha de arriba. No se sube solo '
      + 'a Odoo: la importación masiva no está habilitada, así que se copia y se pega.',
    ],
  );

  return {
    name: 'Origen',
    // Sin autofiltro: es prosa, no una tabla. Un desplegable de filtro sobre
    // «Campo» no filtra nada útil y sugiere que esto se consulta como datos.
    autoFilter: false,
    columns: [
      { header: 'Campo', width: 30, type: 'text' },
      { header: 'Valor', width: 110, type: 'text' },
    ],
    rows,
  };
}

/** El libro completo: la tabla de trabajo, y de dónde salió. */
export function construirLibroSugerido(
  filas: readonly FilaExport[], ctx: ContextoExport,
  areas: readonly { slug: string; nombre: string }[] = [],
): SheetSpec[] {
  return [construirHojaSugerido(filas, areas), construirHojaOrigen(filas, ctx)];
}
