/**
 * GET / POST /api/compras/reabastecimiento/snapshot
 *
 * "Proof of status" for Wilmer's live replenishment view — an immutable,
 * server-authoritative record of what the page showed at a point in time, for
 * posterior audits. Plan: docs/compras/PROOF_OF_STATUS_IMPLEMENTATION_PLAN_2026-09-03.md
 *
 * POST freezes a snapshot. The request carries only VIEWING PARAMETERS
 * (bodega, filtros, orden) — never row data. The server re-derives the exact
 * rows itself via buildRows() + vista(), the SAME functions the live page and
 * GET /api/compras/reabastecimiento use, so what gets stored can never be a
 * stale or fabricated client payload (D-3 in the plan: freeze the data,
 * render the paper — the server IS the "freeze" step). The response returns
 * the full frozen payload; the client renders the PDF from THAT, never from
 * its own local state, so the stored record and the printed document are
 * guaranteed to match.
 *
 * GET lists snapshot history — a user's own by default; `?scope=all` only
 * honored for `superuser` (D-7). Silently downgrades to `own` for anyone
 * else rather than 403ing, so the parameter's existence isn't itself a
 * signal.
 *
 * No PDF bytes are stored (D-5) and no hash/signature is computed (D-6) —
 * see the migration's header comment for why that's a deliberate choice, not
 * an oversight.
 *
 * RBAC: middleware `check_route_access` + in-handler requireAuth(CAN_VIEW_COMPRAS).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { vista } from '@/lib/compras/tabla';
import { computeKpis, computeAlza, computeTopProveedores } from '@/lib/compras/statusMetrics';
import { readSnapshotFiltros, readSnapshotOrden } from '@/lib/compras/statusSnapshot';
import { GENERAL_BODEGA, badRequest, buildTiendas, knownBodegas } from '../lib';
import { buildRows } from '../rows';

export const dynamic = 'force-dynamic';

/** Sanity ceiling, not a real-world limit — the live catalog is ~1,500 products. */
const MAX_SNAPSHOT_FILAS = 5000;
const MAX_HISTORY = 50;

export async function POST(request: Request) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('cuerpo inválido: se esperaba JSON');
  }

  const bodega = typeof body.bodega === 'string' && body.bodega ? body.bodega : GENERAL_BODEGA;
  const filtros = readSnapshotFiltros(body.filtros);
  if (typeof filtros === 'string') return badRequest(filtros);
  const orden = readSnapshotOrden(body.orden);
  if (typeof orden === 'string') return badRequest(orden);

  const service = createServiceRoleClient();

  try {
    const bodegas = await knownBodegas(service);
    if (!bodegas.includes(bodega)) return badRequest(`bodega desconocida: ${bodega}`);

    const [{ rows, maxAsOf, monthStart, coberturaDias }, tiendas, lastSyncRes] = await Promise.all([
      buildRows(service, bodega),
      buildTiendas(service),
      service.from('sync_runs').select('id, status, started_at, finished_at, counts')
        .eq('kind', 'reabastecimiento').order('started_at', { ascending: false })
        .limit(1).maybeSingle(),
    ]);

    // Filter + sort with the SAME pure function the on-screen table uses
    // (lib/compras/tabla.ts) — the frozen row order matches exactly what
    // Wilmer was looking at.
    const filas = vista(rows, filtros, orden);
    if (filas.length > MAX_SNAPSHOT_FILAS) {
      return badRequest(`demasiadas filas (${filas.length}); el máximo es ${MAX_SNAPSHOT_FILAS}`);
    }

    const kpis = computeKpis(filas);
    const alza = computeAlza(rows);
    const topProveedores = computeTopProveedores(rows).arr;
    const meta = {
      asOf: maxAsOf || null,
      month: monthStart,
      coberturaDias,
      lastSync: lastSyncRes?.data ?? null,
    };
    const autor = auth.displayName ? `${auth.displayName} (${auth.email})` : auth.email;
    const filtrosGuardados = { ...filtros, orden };

    const { data, error } = await service
      .from('reabastecimiento_status_snapshots')
      .insert({
        user_id: auth.id,
        autor,
        bodega,
        filtros: filtrosGuardados,
        meta,
        kpis,
        alza,
        top_proveedores: topProveedores,
        tiendas,
        filas,
        total_filas: filas.length,
      })
      .select('id, created_at')
      .single();
    if (error) throw new Error(error.message);

    // The client renders the PDF from THIS response, not from its own local
    // state — what's stored and what's printed are the same object.
    return NextResponse.json({
      id: data?.id,
      createdAt: data?.created_at,
      autor,
      bodega,
      filtros,
      orden,
      meta,
      kpis,
      alza,
      topProveedores,
      tiendas,
      filas,
      totalFilas: filas.length,
    });
  } catch (e) {
    console.error('[reabastecimiento/snapshot] POST failed:', e);
    return NextResponse.json({ error: 'Error generando el snapshot' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const scope = url.searchParams.get('scope') === 'all' && auth.role === 'superuser' ? 'all' : 'own';

  const service = createServiceRoleClient();
  try {
    let query = service
      .from('reabastecimiento_status_snapshots')
      .select('id, bodega, filtros, total_filas, created_at, autor, user_id')
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY);
    if (scope === 'own') query = query.eq('user_id', auth.id);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ snapshots: data ?? [], scope });
  } catch (e) {
    console.error('[reabastecimiento/snapshot] GET failed:', e);
    return NextResponse.json({ error: 'Error leyendo los snapshots' }, { status: 500 });
  }
}
