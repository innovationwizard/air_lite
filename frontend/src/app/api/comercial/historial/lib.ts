import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchAll } from '@/lib/supabase/paginado';
import { primerDiaMes, type Motivo } from '@/lib/comercial/forecast';
import { buildRows } from '@/app/api/compras/reabastecimiento/rows';
import {
  bodegaQueSirve, compararRiesgo, diasDeCobertura, divergeAnioAnterior, falta, faltaCritica,
  mesesOrdenados, recomendar, type Etiqueta, type Recomendacion, type RiesgoInput,
} from '@/lib/comercial/recomendacion';

/**
 * The channel leader's rows, computed once and used by two routes:
 * /api/comercial/historial (one area, ranked, top 50) and the readers' branch
 * of /api/comercial/forecast (every area, for the consolidated view).
 *
 * Split in two on purpose: `cargarContexto` reads what is shared by every
 * area (catalogue, categories, seasonal indices, stock in the three serving
 * bodegas, area configs) so the consolidated view pays for it once, and
 * `computarFilas` is pure over an area's demand rows so the same numbers
 * come out whichever route asked.
 */

export interface AreaCfg { slug: string; nombre: string; activa: boolean; aplica_estacional: boolean; grupo_sai: string | null }
export interface DemandaRow {
  id: string; product_id: number;
  pedido_mensual: Record<string, number>; entregado_mensual: Record<string, number>;
  mismo_mes_anios_anteriores: Record<string, { pedido: number; entregado: number }>;
  clientes_3m: number; cliente_principal: string | null; cliente_principal_share: number | null;
  as_of: string;
}
interface ProductRow { id: number; sku: string; name: string; stock_uom: string | null }
interface IndiceRow { id: string; grupo_sai: string; categoria: string; mes: number; indice: number }
interface InputRow { id: string; product_id: number; bodega: string; existencias: number | null; p3: number | null }
export interface CapturaRow { id: string; product_id: number; month: string; quantity: number; motivo: Motivo; area: string }
interface TiendaRow { id: string; product_id: number; f3: number }

export interface FilaHistorial {
  productId: number;
  sku: string;
  nombre: string;
  uom: string | null;
  etiqueta: Etiqueta | null;
  serie: { mes: string; pedido: number }[];
  meses3: { mes: string; pedido: number; entregado: number; falta: number; critica: boolean }[];
  anteriores: { mes: string; pedido: number; entregado: number; diverge: boolean }[];
  clientes: { n: number; principal: string | null; share: number | null };
  recomendacion: Recomendacion | null;
  ventaPublico: number | null;
  capturado: { quantity: number; motivo: Motivo } | null;
  /**
   * Compras' numbers for the bodega that serves this channel, BEFORE the
   * channels' forms: what Wilmer's engine plans to buy (Sugerido without
   * the comercial additive) and the demand it projects for the coverage
   * window. Per bodega, i.e. for every channel that bodega serves — exact
   * for Zacapa/Petén, a shared total for the four San José channels.
   */
  compras: { compra: number; proyeccion: number; bodega: string; coberturaDias: number } | null;
  cicloAnterior: { mes: string; capturado: number | null; pedidoReal: number; entregadoReal: number } | null;
  riesgo: RiesgoInput;
}

export interface Contexto {
  areas: Map<string, AreaCfg>;
  productoPorId: Map<number, ProductRow>;
  categoriaPorSku: Map<string, string>;
  /** grupo_sai -> categoria ('*' = fallback) -> 12 indices, January first. */
  indices: Map<string, Map<string, number[]>>;
  /** bodega -> product_id -> stock and velocity. */
  inputs: Map<string, Map<number, { existencias: number | null; p3: number | null }>>;
  /** product_id -> retail sell-out (invoiced_tiendas f3 summed over stores). */
  ventaPublico: Map<number, number>;
}

export async function cargarContexto(db: SupabaseClient): Promise<Contexto> {
  // Whole tables, not `.in(ids)`: an `in` list of ~900 ids is a URL the
  // gateway may refuse. These are 1.5-3k rows each.
  const [areas, productos, categorias, indices, inputs, tiendas] = await Promise.all([
    fetchAll<AreaCfg & { id?: string }>(() => db.from('comercial_areas')
      .select('slug, nombre, activa, aplica_estacional, grupo_sai').eq('activa', true), 'slug'),
    fetchAll<ProductRow>(() => db.from('products').select('id, sku, name, stock_uom'), 'id'),
    fetchAll<{ sku: string; categoria: string }>(() => db.from('comercial_categoria_sai')
      .select('sku, categoria'), 'sku'),
    fetchAll<IndiceRow>(() => db.from('comercial_estacionalidad')
      .select('id, grupo_sai, categoria, mes, indice'), 'id'),
    fetchAll<InputRow>(() => db.from('reabastecimiento_inputs')
      .select('id, product_id, bodega, existencias, p3')
      .in('bodega', ['San Jose VN', 'Zacapa', 'Petén']), 'id'),
    fetchAll<TiendaRow>(() => db.from('invoiced_tiendas').select('id, product_id, f3'), 'id'),
  ]);

  const idx = new Map<string, Map<string, number[]>>();
  for (const r of indices) {
    const porCat = idx.get(r.grupo_sai) ?? new Map<string, number[]>();
    const arr = porCat.get(r.categoria) ?? new Array<number>(12).fill(1);
    arr[r.mes - 1] = Number(r.indice);
    porCat.set(r.categoria, arr);
    idx.set(r.grupo_sai, porCat);
  }
  const inp = new Map<string, Map<number, { existencias: number | null; p3: number | null }>>();
  for (const r of inputs) {
    const m = inp.get(r.bodega) ?? new Map();
    m.set(r.product_id, { existencias: r.existencias, p3: r.p3 });
    inp.set(r.bodega, m);
  }
  const vp = new Map<number, number>();
  for (const t of tiendas) vp.set(t.product_id, (vp.get(t.product_id) ?? 0) + Number(t.f3));

  return {
    areas: new Map(areas.map((a) => [a.slug, a])),
    productoPorId: new Map(productos.map((p) => [p.id, p])),
    categoriaPorSku: new Map(categorias.map((c) => [c.sku, c.categoria])),
    indices: idx,
    inputs: inp,
    ventaPublico: vp,
  };
}

export type ForecastCompras = Map<number, { compra: number; proyeccion: number }> & { coberturaDias: number };

/**
 * Wilmer's live numbers for one bodega, through the same `buildRows` his
 * page uses (overrides, seasonal exclusions, coverage horizon included), so
 * the leader sees exactly what Compras sees. `compra` is the Sugerido with
 * the channels' additive removed: what he would buy had no form arrived.
 */
export async function cargarForecastCompras(db: SupabaseClient, bodega: string): Promise<ForecastCompras> {
  const { rows, coberturaDias } = await buildRows(db, bodega);
  const m = new Map<number, { compra: number; proyeccion: number }>() as ForecastCompras;
  for (const r of rows) {
    m.set(r.productId, {
      compra: Math.max(0, Math.round(r.sug - r.adicComercial)),
      proyeccion: Math.round(r.proyeccion),
    });
  }
  m.coberturaDias = coberturaDias;
  return m;
}

export function cargarDemanda(db: SupabaseClient, area: string): Promise<DemandaRow[]> {
  return fetchAll<DemandaRow>(() => db.from('comercial_demanda_canal')
    .select('id, product_id, pedido_mensual, entregado_mensual, mismo_mes_anios_anteriores, clientes_3m, cliente_principal, cliente_principal_share, as_of')
    .eq('area', area), 'id');
}

/** First day of the month before `primerDia` ('YYYY-MM-01'). */
export function mesAnterior(primerDia: string): string {
  const [y, m] = primerDia.split('-').map(Number);
  return primerDiaMes(new Date(Date.UTC(y, m - 2, 1)));
}

const mesLabel = (primerDia: string) => primerDia.slice(0, 7);

/**
 * Every row of one area for one target month, ranked by stockout risk.
 * Pure over its inputs; `capturas` may hold any months — only `mes` and the
 * previous month are read.
 */
export function computarFilas(
  ctx: Contexto,
  areaCfg: AreaCfg,
  demanda: DemandaRow[],
  capturas: CapturaRow[],
  mes: string,
  hoy: Date,
  forecastCompras: ForecastCompras | null = null,
): FilaHistorial[] {
  const area = areaCfg.slug;
  const bodega = bodegaQueSirve(area);
  const mesPrevio = mesAnterior(primerDiaMes(hoy));
  const labelObjetivo = mesLabel(mes);
  const labelPrevio = mesLabel(mesPrevio);
  const porGrupo = areaCfg.grupo_sai ? ctx.indices.get(areaCfg.grupo_sai) : undefined;
  const indiceDe = (sku: string) =>
    porGrupo?.get(ctx.categoriaPorSku.get(sku) ?? '') ?? porGrupo?.get('*') ?? null;
  const inputsBodega = ctx.inputs.get(bodega);
  const capturaPorProducto = new Map(capturas.filter((c) => c.month === mes).map((c) => [c.product_id, c]));
  const capturaPreviaPorProducto = new Map(capturas.filter((c) => c.month === mesPrevio).map((c) => [c.product_id, c]));

  const filas = demanda.map((d): FilaHistorial => {
    const p = ctx.productoPorId.get(d.product_id);
    const sku = p?.sku ?? `#${d.product_id}`;
    const meses = mesesOrdenados(d.pedido_mensual);
    const serie = meses.map((m) => ({ mes: m, pedido: Number(d.pedido_mensual[m] ?? 0) }));
    const meses3 = meses.slice(-3).map((m) => {
      const pedido = Number(d.pedido_mensual[m] ?? 0);
      const entregado = Number(d.entregado_mensual[m] ?? 0);
      return { mes: m, pedido, entregado, falta: falta(pedido, entregado), critica: faltaCritica(pedido, entregado) };
    });
    const rec = recomendar({
      serie: d.pedido_mensual, indice: indiceDe(sku),
      aplicaEstacional: areaCfg.aplica_estacional, mesObjetivo: mes,
    });
    const anteriores = Object.entries(d.mismo_mes_anios_anteriores ?? {})
      .filter(([m]) => m.slice(5, 7) === labelObjetivo.slice(5, 7) && m < labelObjetivo)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([m, v]) => ({
        mes: m, pedido: Number(v.pedido), entregado: Number(v.entregado),
        diverge: divergeAnioAnterior(rec?.valor ?? null, Number(v.pedido)),
      }));
    const inp = inputsBodega?.get(d.product_id);
    const cap = capturaPorProducto.get(d.product_id);
    const capPrev = capturaPreviaPorProducto.get(d.product_id);
    const enSerie = labelPrevio in d.pedido_mensual;
    return {
      productId: d.product_id, sku, nombre: p?.name ?? '', uom: p?.stock_uom ?? null,
      etiqueta: rec?.etiqueta ?? null,
      serie, meses3, anteriores,
      clientes: { n: d.clientes_3m, principal: d.cliente_principal, share: d.cliente_principal_share },
      recomendacion: rec,
      ventaPublico: area === 'tiendas' ? (ctx.ventaPublico.get(d.product_id) ?? 0) : null,
      capturado: cap ? { quantity: Number(cap.quantity), motivo: cap.motivo } : null,
      compras: (() => {
        const fc = forecastCompras?.get(d.product_id);
        return fc && forecastCompras
          ? { ...fc, bodega, coberturaDias: forecastCompras.coberturaDias } : null;
      })(),
      cicloAnterior: enSerie ? {
        mes: labelPrevio, capturado: capPrev ? Number(capPrev.quantity) : null,
        pedidoReal: Number(d.pedido_mensual[labelPrevio] ?? 0),
        entregadoReal: Number(d.entregado_mensual[labelPrevio] ?? 0),
      } : null,
      riesgo: {
        critica: meses3.some((m) => m.critica),
        falta3: meses3.reduce((a, m) => a + m.falta, 0),
        doh: diasDeCobertura(inp?.existencias ?? null, inp?.p3 ?? null),
        volumen6: serie.reduce((a, m) => a + m.pedido, 0),
      },
    };
  });
  filas.sort((a, b) => compararRiesgo(a.riesgo, b.riesgo));
  return filas;
}
