import { type CellValue, type SheetSpec } from '@/lib/xlsx/writer';
import { ETIQUETA_TEXTO, type Etiqueta, type Recomendacion } from '@/lib/comercial/recomendacion';
import { MOTIVOS, etiquetaMes, type Motivo } from '@/lib/comercial/forecast';

/**
 * «Exportar a Excel» for the channel leader's table (Jorge, 2026-09-11).
 *
 * Same rule as Wilmer's export (`lib/compras/sugeridoExport.ts`): THIS MODULE
 * READS NOTHING AND CALCULATES NOTHING. It receives the rows the table is
 * painting — plus, when the month has saved rows beyond the on-screen 50,
 * those rows as the API returns them — and writes them. There is no second
 * source that can disagree with the screen.
 *
 * Decisions (Jorge, 2026-09-11): the three months always go out expanded
 * (pedido / entregado / falta each) whatever the on-screen collapse state;
 * every saved row of the month goes out even if not on screen; every
 * download is recorded (comercial_forecast_exportado) with the sha256 of
 * the bytes.
 */

/** The row as the table has it — a structural subset of FilaHistorial. */
export interface FilaForecastExport {
  productId: number;
  sku: string;
  nombre: string;
  uom: string | null;
  etiqueta: Etiqueta | null;
  proveedor: { nombre: string; grupoNombre: string | null };
  categoria: string;
  serie: { mes: string; pedido: number }[];
  meses3: { mes: string; pedido: number; entregado: number; falta: number; critica: boolean }[];
  anteriores: { mes: string; pedido: number; entregado: number; diverge: boolean }[];
  clientes: { n: number; principal: string | null; share: number | null };
  recomendacion: Recomendacion | null;
  ventaPublico: number | null;
  compras: { compra: number; proyeccion: number; bodega: string; coberturaDias: number } | null;
  capturado: { quantity: number; motivo: Motivo } | null;
  cicloAnterior: { mes: string; capturado: number | null; pedidoReal: number; entregadoReal: number } | null;
  /** The leader's number in «Voy a pedir» (edited > saved > captured); null when the box is empty. */
  miForecast: number | null;
  /** The motivo the saved row carries, if saved (this session or before). */
  motivoGuardado: Motivo | null;
  /** True when the row is in the file only because it was saved, not because it is on screen. */
  fueraDePantalla: boolean;
}

export interface ContextoForecastExport {
  areaSlug: string;
  areaNombre: string;
  /** 'YYYY-MM-01' */
  mes: string;
  bodega: string;
  generadoEn: Date;
  autor: string | null;
  asOf: string | null;
  bloqueo: { version: number; autor: string; at: string; aprobadoAt?: string | null; aprobadoAutor?: string | null } | null;
  filtros: {
    busqueda: string | null; proveedor: string | null; categoria: string | null;
    etiqueta: Etiqueta | null; modificados: boolean;
  };
  enPantalla: number;
  guardadasFueraDePantalla: number;
}

const MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const mesCorto = (label: string) => `${MES_CORTO[Number(label.slice(5, 7)) - 1]} ${label.slice(0, 4)}`;

export function fechaArchivo(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

export function nombreArchivo(ctx: Pick<ContextoForecastExport, 'areaSlug' | 'mes' | 'generadoEn'>): string {
  return `Forecast_${ctx.areaSlug}_${ctx.mes.slice(0, 7)}_${fechaArchivo(ctx.generadoEn)}.xlsx`;
}

/** What the row is, in the leader's words (Jorge 2026-09-11: «Voy a pedir», never "requested"). */
export function estadoFila(f: Pick<FilaForecastExport, 'motivoGuardado' | 'miForecast'>): string {
  if (f.motivoGuardado === null) return 'sugerido, no elegido';
  if (f.motivoGuardado === 'base') return 'voy a pedir lo sugerido';
  if (f.motivoGuardado === 'ajustado') return 'voy a pedir otra cantidad';
  return MOTIVOS.find((m) => m.valor === f.motivoGuardado)?.etiqueta ?? f.motivoGuardado;
}

/**
 * Columns are built from the FIRST row's month labels so the headers say
 * «Jun 2026», not «mes 1». Prior-year columns: up to two, newest first.
 */
export function columnasForecast(filas: readonly FilaForecastExport[], mes: string) {
  const serieLabels = filas[0]?.serie.map((s) => s.mes) ?? [];
  const meses3 = filas[0]?.meses3.map((m) => m.mes) ?? [];
  const nAnteriores = Math.max(0, ...filas.map((f) => f.anteriores.length));
  const anterioresLabels = Array.from({ length: nAnteriores }, (_, i) =>
    `${MES_CORTO[Number(mes.slice(5, 7)) - 1]} ${Number(mes.slice(0, 4)) - i - 1}`);
  const cols: { header: string; width: number; type: 'text' | 'number' | 'decimal1' | 'decimal4';
                valor: (f: FilaForecastExport) => CellValue }[] = [
    { header: 'Código', width: 12, type: 'text', valor: (f) => f.sku },
    { header: 'Nombre', width: 40, type: 'text', valor: (f) => f.nombre },
    { header: 'Unidad', width: 10, type: 'text', valor: (f) => f.uom },
    { header: 'Proveedor', width: 28, type: 'text', valor: (f) => f.proveedor.nombre || null },
    { header: 'Grupo de proveedores', width: 20, type: 'text', valor: (f) => f.proveedor.grupoNombre },
    { header: 'Categoría', width: 18, type: 'text', valor: (f) => f.categoria },
    { header: 'Variabilidad', width: 12, type: 'text', valor: (f) => (f.etiqueta ? ETIQUETA_TEXTO[f.etiqueta] : null) },
    ...serieLabels.map((l, i) => ({
      header: `Pedido ${mesCorto(l)}`, width: 12, type: 'number' as const,
      valor: (f: FilaForecastExport) => f.serie[i]?.pedido ?? null,
    })),
    ...meses3.flatMap((l, i) => [
      { header: `${mesCorto(l)} pedido`, width: 12, type: 'number' as const, valor: (f: FilaForecastExport) => f.meses3[i]?.pedido ?? null },
      { header: `${mesCorto(l)} entregado`, width: 12, type: 'number' as const, valor: (f: FilaForecastExport) => f.meses3[i]?.entregado ?? null },
      { header: `${mesCorto(l)} falta`, width: 12, type: 'number' as const, valor: (f: FilaForecastExport) => f.meses3[i]?.falta ?? null },
    ]),
    { header: 'Faltó entregar 3 m', width: 14, type: 'number', valor: (f) => f.meses3.reduce((a, m) => a + m.falta, 0) },
    { header: 'Faltante crítico', width: 12, type: 'text', valor: (f) => (f.meses3.some((m) => m.critica) ? 'Sí' : 'No') },
    ...anterioresLabels.map((l, i) => ({
      header: `Pedido ${l}`, width: 12, type: 'number' as const,
      valor: (f: FilaForecastExport) => f.anteriores[i]?.pedido ?? null,
    })),
    { header: 'Clientes 3 m', width: 10, type: 'number', valor: (f) => f.clientes.n },
    { header: 'Cliente principal', width: 32, type: 'text', valor: (f) => f.clientes.principal },
    { header: '% cliente principal', width: 10, type: 'number', valor: (f) => (f.clientes.share === null ? null : Math.round(f.clientes.share * 100)) },
    { header: 'Venta al público 3 m', width: 12, type: 'number', valor: (f) => f.ventaPublico },
    { header: 'Compra planificada (Compras)', width: 16, type: 'number', valor: (f) => f.compras?.compra ?? null },
    { header: 'Proyección Compras', width: 14, type: 'number', valor: (f) => f.compras?.proyeccion ?? null },
    { header: 'Recomendación', width: 14, type: 'number', valor: (f) => f.recomendacion?.valor ?? null },
    { header: 'Rango desde', width: 12, type: 'number', valor: (f) => f.recomendacion?.rango[0] ?? null },
    { header: 'Rango hasta', width: 12, type: 'number', valor: (f) => f.recomendacion?.rango[1] ?? null },
    { header: 'Factor del mes', width: 10, type: 'decimal4', valor: (f) => f.recomendacion?.indiceMes ?? null },
    { header: 'Factor aplicado', width: 10, type: 'text', valor: (f) => (f.recomendacion ? (f.recomendacion.aplicado ? 'Sí' : 'No') : null) },
    { header: 'Voy a pedir', width: 12, type: 'number', valor: (f) => f.miForecast },
    { header: 'Estado', width: 20, type: 'text', valor: (f) => estadoFila(f) || null },
    { header: 'Fuera de pantalla', width: 12, type: 'text', valor: (f) => (f.fueraDePantalla ? 'Sí' : 'No') },
    { header: 'Forecast mes anterior', width: 14, type: 'number', valor: (f) => f.cicloAnterior?.capturado ?? null },
    { header: 'Real mes anterior (pedido)', width: 14, type: 'number', valor: (f) => f.cicloAnterior?.pedidoReal ?? null },
  ];
  return cols;
}

export function construirHojaForecast(filas: readonly FilaForecastExport[], ctx: ContextoForecastExport): SheetSpec {
  const cols = columnasForecast(filas, ctx.mes);
  return {
    name: 'Forecast',
    columns: cols.map(({ header, width, type }) => ({ header, width, type })),
    rows: filas.map((f) => cols.map((c) => c.valor(f))),
  };
}

export function describirFiltros(f: ContextoForecastExport['filtros']): string[] {
  const out: string[] = [];
  if (f.busqueda) out.push(`Búsqueda: «${f.busqueda}»`);
  if (f.proveedor) out.push(`Proveedor: ${f.proveedor}`);
  if (f.categoria) out.push(`Categoría: ${f.categoria}`);
  if (f.etiqueta) out.push(`Variabilidad: ${ETIQUETA_TEXTO[f.etiqueta]}`);
  if (f.modificados) out.push('Sólo modificados');
  return out.length ? out : ['Sin filtros: los 50 códigos con más riesgo de faltante'];
}

/** A sheet that explains the file — never above the table (it would break the autofilter). */
export function construirHojaOrigen(ctx: ContextoForecastExport): SheetSpec {
  const rows: CellValue[][] = [
    ['Archivo', nombreArchivo(ctx)],
    ['Canal', ctx.areaNombre],
    ['Mes del forecast', etiquetaMes(ctx.mes)],
    ['Bodega que surte', ctx.bodega],
    ['Generado', ctx.generadoEn.toLocaleString('es-GT')],
  ];
  if (ctx.autor) rows.push(['Descargado por', ctx.autor]);
  if (ctx.asOf) rows.push(['Historial de Odoo al', new Date(ctx.asOf).toLocaleString('es-GT')]);
  rows.push(['Pedido', ctx.bloqueo
    ? (ctx.bloqueo.aprobadoAt
      ? `Aprobado el ${new Date(ctx.bloqueo.aprobadoAt).toLocaleString('es-GT')} por ${ctx.bloqueo.aprobadoAutor} (bloqueado el ${new Date(ctx.bloqueo.at).toLocaleString('es-GT')}, versión ${ctx.bloqueo.version}); lo ve Compras`
      : `Bloqueado el ${new Date(ctx.bloqueo.at).toLocaleString('es-GT')} por ${ctx.bloqueo.autor} (versión ${ctx.bloqueo.version}); sin aprobar, Compras no lo ve`)
    : 'Borrador: se puede cambiar; Compras no lo ve']);
  for (const [i, t] of describirFiltros(ctx.filtros).entries()) rows.push([i === 0 ? 'Filtros' : '', t]);
  rows.push(['Filas en pantalla', ctx.enPantalla]);
  rows.push(['Filas guardadas fuera de pantalla', ctx.guardadasFueraDePantalla]);
  rows.push(['Nota', 'Los tres meses van desplegados (pedido / entregado / falta) aunque en pantalla estén colapsados. '
    + '«Voy a pedir» es el número del canal al exportar (vacío = todavía no elegido; la sugerencia va en «Recomendación»). Estado lo explica.']);
  return {
    name: 'Origen',
    columns: [{ header: 'Dato', width: 34, type: 'text' }, { header: 'Valor', width: 100, type: 'text' }],
    rows,
    autoFilter: false,
  };
}

export function construirLibroForecast(filas: readonly FilaForecastExport[], ctx: ContextoForecastExport): SheetSpec[] {
  return [construirHojaForecast(filas, ctx), construirHojaOrigen(ctx)];
}

/** sha256 of the bytes, in the browser. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
