import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_FORECAST_COMERCIAL } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/paginado';
import {
  mesDentroDelHorizonte, mesPorDefecto, mesesAbiertos, primerDiaMes, type Motivo,
} from '@/lib/comercial/forecast';
import {
  TOP_N, bodegaQueSirve, compararRiesgo, diasDeCobertura, divergeAnioAnterior, falta,
  faltaCritica, mesesOrdenados, recomendar, type Etiqueta, type Recomendacion, type RiesgoInput,
} from '@/lib/comercial/recomendacion';

export const dynamic = 'force-dynamic';

/**
 * GET /api/comercial/historial?area=&mes=  —  the channel leader's rows.
 *
 * Per SKU of ONE channel: six complete months of requested qty, the last
 * three with delivered and gap, the same month in prior years, who buys it,
 * and the recommendation with its confidence label and range — all computed
 * here from `comercial_demanda_canal` (hourly sync) and
 * `comercial_estacionalidad` (yearly loader), ranked by critical stockout
 * risk and cut to TOP_N. The screen adds nothing to these numbers.
 *
 * Spec: docs/compras/FORECAST_COMERCIAL_L2_SPEC_RESEARCH_2026-09-10.md
 * Plan: docs/compras/FORECAST_COMERCIAL_L2_BUILD_PLAN_2026-09-10.md Phase 2.2
 *
 * RBAC as everywhere in this module: `ventas` gets its OWN area from the
 * profile and may not ask for another (403); the reading roles pick any
 * active area with `?area=`.
 */

interface AreaRow { slug: string; nombre: string; activa: boolean; aplica_estacional: boolean; grupo_sai: string | null }
interface DemandaRow {
  id: string; product_id: number;
  pedido_mensual: Record<string, number>; entregado_mensual: Record<string, number>;
  mismo_mes_anios_anteriores: Record<string, { pedido: number; entregado: number }>;
  clientes_3m: number; cliente_principal: string | null; cliente_principal_share: number | null;
  as_of: string;
}
interface ProductRow { id: number; sku: string; name: string; stock_uom: string | null }
interface IndiceRow { categoria: string; mes: number; indice: number }
interface InputRow { product_id: number; existencias: number | null; p3: number | null }
interface CapturaRow { product_id: number; month: string; quantity: number; motivo: Motivo }
interface TiendaRow { product_id: number; f3: number }

export interface FilaHistorial {
  productId: number;
  sku: string;
  nombre: string;
  uom: string | null;
  etiqueta: Etiqueta | null;
  /** Six complete months, oldest first. */
  serie: { mes: string; pedido: number }[];
  /** The last three of them, with delivered and gap. */
  meses3: { mes: string; pedido: number; entregado: number; falta: number; critica: boolean }[];
  /** Same month in prior years for the target month, newest first. */
  anteriores: { mes: string; pedido: number; entregado: number; diverge: boolean }[];
  clientes: { n: number; principal: string | null; share: number | null };
  recomendacion: Recomendacion | null;
  /** Retail sell-out, tiendas only (invoiced_tiendas f3 summed over stores). */
  ventaPublico: number | null;
  /** What this area already saved for the target month. */
  capturado: { quantity: number; motivo: Motivo } | null;
  /** The month that just closed: what was forecast vs what happened. */
  cicloAnterior: { mes: string; capturado: number | null; pedidoReal: number; entregadoReal: number } | null;
  riesgo: RiesgoInput;
}

function mesLabel(primerDia: string): string {
  return primerDia.slice(0, 7);
}

function mesAnterior(primerDia: string): string {
  const [y, m] = primerDia.split('-').map(Number);
  return primerDiaMes(new Date(Date.UTC(y, m - 2, 1)));
}

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_FORECAST_COMERCIAL);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const areaPedida = url.searchParams.get('area');
  const hoy = new Date();
  const mes = url.searchParams.get('mes') ?? mesPorDefecto(hoy);
  if (!mesDentroDelHorizonte(mes, hoy)) {
    return NextResponse.json(
      { error: `El mes debe ser uno de los abiertos: ${mesesAbiertos(hoy).join(', ')}` }, { status: 400 });
  }

  // Which area. A `ventas` user has exactly one, from the profile.
  let area: string;
  if (auth.role === 'ventas') {
    if (!auth.area) {
      return NextResponse.json({ error: 'Tu usuario no tiene un canal comercial asignado.' }, { status: 403 });
    }
    if (areaPedida && areaPedida !== auth.area) {
      return NextResponse.json({ error: 'Sólo podés ver el historial de tu propio canal.' }, { status: 403 });
    }
    area = auth.area;
  } else {
    if (!areaPedida) return NextResponse.json({ error: 'area es obligatoria' }, { status: 400 });
    area = areaPedida;
  }

  const db = createServiceRoleClient();
  const { data: areaRow } = await db.from('comercial_areas')
    .select('slug, nombre, activa, aplica_estacional, grupo_sai')
    .eq('slug', area).eq('activa', true).maybeSingle();
  if (!areaRow) return NextResponse.json({ error: 'Canal desconocido o inactivo' }, { status: 404 });
  const areaCfg = areaRow as AreaRow;
  const bodega = bodegaQueSirve(area);
  const mesPrevio = mesAnterior(primerDiaMes(hoy));

  const [demanda, indices, inputs, capturas, capturasPrevias, cobertura] = await Promise.all([
    fetchAll<DemandaRow>(() => db.from('comercial_demanda_canal')
      .select('id, product_id, pedido_mensual, entregado_mensual, mismo_mes_anios_anteriores, clientes_3m, cliente_principal, cliente_principal_share, as_of')
      .eq('area', area), 'id'),
    areaCfg.grupo_sai
      ? fetchAll<IndiceRow & { id: string }>(() => db.from('comercial_estacionalidad')
          .select('id, categoria, mes, indice').eq('grupo_sai', areaCfg.grupo_sai!), 'id')
      : Promise.resolve([] as (IndiceRow & { id: string })[]),
    fetchAll<InputRow & { id: string }>(() => db.from('reabastecimiento_inputs')
      .select('id, product_id, existencias, p3').eq('bodega', bodega), 'id'),
    fetchAll<CapturaRow & { id: string }>(() => db.from('comercial_forecast')
      .select('id, product_id, month, quantity, motivo').eq('area', area).eq('month', mes), 'id'),
    fetchAll<CapturaRow & { id: string }>(() => db.from('comercial_forecast')
      .select('id, product_id, month, quantity, motivo').eq('area', area).eq('month', mesPrevio), 'id'),
    db.from('bodega_cobertura').select('dias').eq('bodega', bodega)
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (demanda.length === 0) {
    return NextResponse.json({
      area: { slug: areaCfg.slug, nombre: areaCfg.nombre, aplicaEstacional: areaCfg.aplica_estacional },
      mes, historialDisponible: false, asOf: null, filas: [], total: 0, bodega,
    });
  }

  // Whole tables, not `.in(ids)`: a channel has ~900 products and an `in`
  // list that long is a URL the gateway may refuse. These are 1.5-3k rows.
  const [productos, tiendas, categorias] = await Promise.all([
    fetchAll<ProductRow>(() => db.from('products').select('id, sku, name, stock_uom'), 'id'),
    area === 'tiendas'
      ? fetchAll<TiendaRow & { id: string }>(() => db.from('invoiced_tiendas')
          .select('id, product_id, f3'), 'id')
      : Promise.resolve([] as (TiendaRow & { id: string })[]),
    fetchAll<{ sku: string; categoria: string }>(() => db.from('comercial_categoria_sai')
      .select('sku, categoria'), 'sku'),
  ]);
  const productoPorId = new Map(productos.map((p) => [p.id, p]));
  const categoriaPorSku = new Map(categorias.map((c) => [c.sku, c.categoria]));

  // 12-entry index per category; '*' is the group fallback.
  const indicePorCategoria = new Map<string, number[]>();
  for (const r of indices) {
    const arr = indicePorCategoria.get(r.categoria) ?? new Array<number>(12).fill(1);
    arr[r.mes - 1] = Number(r.indice);
    indicePorCategoria.set(r.categoria, arr);
  }
  const indiceDe = (sku: string) =>
    indicePorCategoria.get(categoriaPorSku.get(sku) ?? '') ?? indicePorCategoria.get('*') ?? null;

  const inputPorProducto = new Map(inputs.map((i) => [i.product_id, i]));
  const capturaPorProducto = new Map(capturas.map((c) => [c.product_id, c]));
  const capturaPreviaPorProducto = new Map(capturasPrevias.map((c) => [c.product_id, c]));
  const ventaPublicoPorProducto = new Map<number, number>();
  for (const t of tiendas) {
    ventaPublicoPorProducto.set(t.product_id, (ventaPublicoPorProducto.get(t.product_id) ?? 0) + Number(t.f3));
  }
  const coberturaDias = (cobertura?.data as { dias: number } | null)?.dias ?? null;
  const labelObjetivo = mesLabel(mes);
  const labelPrevio = mesLabel(mesPrevio);

  const filas: FilaHistorial[] = demanda.map((d) => {
    const p = productoPorId.get(d.product_id);
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
    // Prior years for the TARGET month: '2025-10', '2024-10' for '2026-10'.
    const anteriores = Object.entries(d.mismo_mes_anios_anteriores ?? {})
      .filter(([m]) => m.slice(5, 7) === labelObjetivo.slice(5, 7) && m < labelObjetivo)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([m, v]) => ({
        mes: m, pedido: Number(v.pedido), entregado: Number(v.entregado),
        diverge: divergeAnioAnterior(rec?.valor ?? null, Number(v.pedido)),
      }));
    const inp = inputPorProducto.get(d.product_id);
    const doh = diasDeCobertura(inp?.existencias ?? null, inp?.p3 ?? null);
    const cap = capturaPorProducto.get(d.product_id);
    const capPrev = capturaPreviaPorProducto.get(d.product_id);
    const enSerie = labelPrevio in d.pedido_mensual;
    return {
      productId: d.product_id, sku, nombre: p?.name ?? '', uom: p?.stock_uom ?? null,
      etiqueta: rec?.etiqueta ?? null,
      serie, meses3, anteriores,
      clientes: { n: d.clientes_3m, principal: d.cliente_principal, share: d.cliente_principal_share },
      recomendacion: rec,
      ventaPublico: area === 'tiendas' ? (ventaPublicoPorProducto.get(d.product_id) ?? 0) : null,
      capturado: cap ? { quantity: Number(cap.quantity), motivo: cap.motivo } : null,
      cicloAnterior: enSerie ? {
        mes: labelPrevio, capturado: capPrev ? Number(capPrev.quantity) : null,
        pedidoReal: Number(d.pedido_mensual[labelPrevio] ?? 0),
        entregadoReal: Number(d.entregado_mensual[labelPrevio] ?? 0),
      } : null,
      riesgo: {
        critica: meses3.some((m) => m.critica),
        falta3: meses3.reduce((a, m) => a + m.falta, 0),
        doh,
        volumen6: serie.reduce((a, m) => a + m.pedido, 0),
      },
    };
  });

  filas.sort((a, b) => compararRiesgo(a.riesgo, b.riesgo));
  const asOf = demanda.reduce((m, d) => (d.as_of > m ? d.as_of : m), '');

  return NextResponse.json({
    area: { slug: areaCfg.slug, nombre: areaCfg.nombre, aplicaEstacional: areaCfg.aplica_estacional },
    mes,
    historialDisponible: true,
    asOf,
    bodega,
    coberturaDias,
    total: filas.length,
    filas: filas.slice(0, TOP_N),
  });
}
