import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_FORECAST_COMERCIAL } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/paginado';
import { mesDentroDelHorizonte, mesPorDefecto, mesesAbiertos } from '@/lib/comercial/forecast';
import { TOP_N, bodegaQueSirve } from '@/lib/comercial/recomendacion';
import { cargarContexto, cargarDemanda, computarFilas, type CapturaRow } from './lib';

export const dynamic = 'force-dynamic';

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
  const [ctx, demanda, capturas, cobertura] = await Promise.all([
    cargarContexto(db),
    cargarDemanda(db, area),
    fetchAll<CapturaRow>(() => db.from('comercial_forecast')
      .select('id, product_id, month, quantity, motivo, area').eq('area', area), 'id'),
    db.from('bodega_cobertura').select('dias').eq('bodega', bodegaQueSirve(area))
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const areaCfg = ctx.areas.get(area);
  if (!areaCfg) return NextResponse.json({ error: 'Canal desconocido o inactivo' }, { status: 404 });

  const meta = {
    area: { slug: areaCfg.slug, nombre: areaCfg.nombre, aplicaEstacional: areaCfg.aplica_estacional },
    mes,
    bodega: bodegaQueSirve(area),
    coberturaDias: (cobertura?.data as { dias: number } | null)?.dias ?? null,
  };
  if (demanda.length === 0) {
    return NextResponse.json({ ...meta, historialDisponible: false, asOf: null, filas: [], total: 0 });
  }

  const filas = computarFilas(ctx, areaCfg, demanda, capturas, mes, hoy);
  const asOf = demanda.reduce((m, d) => (d.as_of > m ? d.as_of : m), '');
  return NextResponse.json({
    ...meta, historialDisponible: true, asOf, total: filas.length, filas: filas.slice(0, TOP_N),
  });
}
