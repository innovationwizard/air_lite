import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { esCoberturaValida, COBERTURA_MIN_DIAS, COBERTURA_MAX_DIAS } from '@/lib/compras/cobertura';
import { badRequest, knownBodegas } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras/reabastecimiento/cobertura — { bodega, dias }
 *
 * Sets the coverage horizon (how many days of demand the Sugerido covers)
 * for one bodega. Was a single hardcoded default (30, or 15 for Zacapa/Petén
 * per Wilmer's 2026-08-21 request — see migration 20260821000006); a
 * dropdown filter from 2026-09-04; a TYPED number from 2026-09-11 (Wilmer:
 * a 35-day lead time means «sugerido 65», which no menu offered).
 *
 * `bodega_cobertura` already existed for exactly this, append-only ("the
 * latest row per bodega wins", per its own migration) — this route is its
 * missing write path. `dias` is validated against the table's own CHECK
 * range (1-365 since 20260911000006, `lib/compras/cobertura.ts`) so the input, the route and the
 * database agree on what a valid horizon is.
 *
 * `General` IS allowed here, unlike sugerido-bodega's rejection of it: that
 * route is about a physical CD's own request, which General genuinely isn't;
 * this is a calculation parameter (how many days the aggregate Sugerido
 * should cover), which applies to General exactly as it does anywhere else.
 *
 * No free-text reason from the caller — this is routine, self-service
 * filter, not a rare policy call; `motivo` is filled in automatically so the
 * append-only table still reads as a log of what changed and by whom.
 *
 * RBAC in two layers: `check_route_access` (route_permissions, migration
 * 20260904000003) + `requireAuth(CAN_VIEW_COMPRAS)` here.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('cuerpo JSON inválido');
  }

  const { bodega, dias } = body;
  if (!esCoberturaValida(dias)) {
    return badRequest(`dias debe ser un entero entre ${COBERTURA_MIN_DIAS} y ${COBERTURA_MAX_DIAS}`);
  }

  const service = createServiceRoleClient();
  try {
    const bodegas = await knownBodegas(service);
    if (typeof bodega !== 'string' || !bodegas.includes(bodega)) {
      return badRequest(`bodega desconocida (válidas: ${bodegas.join(', ')})`);
    }

    const { error } = await service.from('bodega_cobertura').insert({
      bodega,
      dias,
      motivo: `Cambiado desde el filtro "Sugerido a N días" en Reabastecimiento en Vivo.`,
      autor: auth.displayName ? `${auth.displayName} (${auth.email})` : auth.email,
    });
    if (error) {
      return NextResponse.json(
        { error: 'No se pudo guardar la cobertura', detail: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ guardado: true, bodega, dias });
  } catch (e) {
    return NextResponse.json(
      { error: 'No se pudo guardar', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
