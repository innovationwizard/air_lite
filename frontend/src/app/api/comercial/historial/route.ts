import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_FORECAST_COMERCIAL } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/paginado';
import { esModificado, mesDentroDelHorizonte, mesPorDefecto, mesesAbiertos, hoyEnGuatemala } from '@/lib/comercial/forecast';
import { TOP_N, bodegaQueSirve } from '@/lib/comercial/recomendacion';
import { cargarContexto, cargarDemanda, cargarForecastCompras, computarFilas, esPadre, type CapturaRow } from './lib';

export const dynamic = 'force-dynamic';

/** Case- and accent-insensitive, so «pajilla» finds «PAJILLA» and «bandeja» «BANDEJÁ». */
function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * GET /api/comercial/historial?area=&mes=  —  the channel leader's rows.
 *
 * Per SKU of ONE channel: six complete months of requested qty, the last
 * three with delivered and gap, the same month in prior years, who buys it,
 * and the recommendation with its confidence label and range — computed in
 * ./lib.ts from `comercial_demanda_canal` (hourly sync) and
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
export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_FORECAST_COMERCIAL);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const areaPedida = url.searchParams.get('area');
  const hoy = hoyEnGuatemala();
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
  const [ctx, demanda, capturas, cobertura, forecastCompras] = await Promise.all([
    cargarContexto(db),
    cargarDemanda(db, area),
    fetchAll<CapturaRow>(() => db.from('comercial_forecast')
      .select('id, product_id, month, quantity, motivo, area').eq('area', area), 'id'),
    db.from('bodega_cobertura').select('dias').eq('bodega', bodegaQueSirve(area))
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    // Compras' plan for the serving bodega, before the channels' forms (PM
    // request 2026-09-11): the leader compares their need against it.
    cargarForecastCompras(db, bodegaQueSirve(area)),
  ]);
  const areaCfg = ctx.areas.get(area);
  if (!areaCfg) return NextResponse.json({ error: 'Canal desconocido o inactivo' }, { status: 404 });
  if (esPadre(ctx, area)) {
    return NextResponse.json(
      { error: `${areaCfg.nombre} se pronostica por vendedor: elegí uno de sus canales.` }, { status: 400 });
  }

  const meta = {
    area: { slug: areaCfg.slug, nombre: areaCfg.nombre, aplicaEstacional: areaCfg.aplica_estacional },
    mes,
    bodega: bodegaQueSirve(area),
    coberturaDias: (cobertura?.data as { dias: number } | null)?.dias ?? null,
  };
  if (demanda.length === 0) {
    return NextResponse.json({ ...meta, historialDisponible: false, asOf: null, filas: [], total: 0 });
  }

  const todas = computarFilas(ctx, areaCfg, demanda, capturas, mes, hoy, forecastCompras);
  const asOf = demanda.reduce((m, d) => (d.as_of > m ? d.as_of : m), '');
  // `q`: search the channel's WHOLE history by code or name, not just the
  // ranked 50 — the leader may know something about a product further down.
  // A product the channel never ordered is not here at all; the add form
  // below the table covers that.
  const q = normalizar(url.searchParams.get('q') ?? '');
  // `proveedor`: `group:<id>` (one of Wilmer's supplier groups) or `sup:<id>`;
  // `categoria`: exact products.category. Both over the whole channel, like
  // `q` (Jorge 2026-09-11). The option lists come from the UNFILTERED set so
  // a filter never hides the other filter's choices.
  const proveedor = url.searchParams.get('proveedor') ?? '';
  const categoria = url.searchParams.get('categoria') ?? '';
  // `modificados=1`: only rows whose saved number is the leader's own — an
  // adjusted recommendation or a hand-added code — never one approved as-is.
  // A fact recorded at save time (motivo), not a live comparison.
  const modificados = url.searchParams.get('modificados') === '1';
  // `guardados=1`: every row with a saved capture for the month, whatever
  // the motivo and whatever else is filtered — the export uses it to reach
  // saved rows beyond the on-screen 50 (Jorge 2026-09-11). Not capped.
  const guardados = url.searchParams.get('guardados') === '1';
  if (guardados) {
    const conCaptura = todas.filter((f) => f.capturado !== null);
    return NextResponse.json({
      ...meta, historialDisponible: true, asOf, busqueda: null,
      total: conCaptura.length, totalCanal: todas.length, filas: conCaptura,
    });
  }
  const filas = todas.filter((f) =>
    (!modificados || (f.capturado !== null && esModificado(f.capturado.motivo)))
    && (!q || normalizar(f.sku).includes(q) || normalizar(f.nombre).includes(q))
    && (!proveedor || (proveedor.startsWith('group:')
      ? f.proveedor.grupoId === proveedor.slice('group:'.length)
      : String(f.proveedor.id) === proveedor.replace(/^sup:/, '')))
    && (!categoria || f.categoria === categoria));
  const grupos = new Map<string, string>();
  const proveedores = new Map<number, string>();
  const categorias = new Set<string>();
  for (const f of todas) {
    if (f.proveedor.grupoId && f.proveedor.grupoNombre) grupos.set(f.proveedor.grupoId, f.proveedor.grupoNombre);
    if (f.proveedor.id !== null && f.proveedor.nombre) proveedores.set(f.proveedor.id, f.proveedor.nombre);
    categorias.add(f.categoria);
  }
  const porNombre = (a: [unknown, string], b: [unknown, string]) => a[1].localeCompare(b[1], 'es');
  return NextResponse.json({
    ...meta, historialDisponible: true, asOf, busqueda: q || null,
    filtros: {
      proveedor: proveedor || null, categoria: categoria || null, modificados,
      proveedores: [
        ...[...grupos].sort(porNombre).map(([id, nombre]) => ({ valor: `group:${id}`, etiqueta: nombre, grupo: true })),
        ...[...proveedores].sort(porNombre).map(([id, nombre]) => ({ valor: `sup:${id}`, etiqueta: nombre, grupo: false })),
      ],
      categorias: [...categorias].sort((a, b) => a.localeCompare(b, 'es')),
    },
    total: filas.length, totalCanal: todas.length, filas: filas.slice(0, TOP_N),
  });
}
