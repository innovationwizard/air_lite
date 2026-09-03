/**
 * GET /api/compras/reabastecimiento/snapshot/[id]
 *
 * Full payload of one frozen "proof of status" snapshot — used to re-render
 * the PDF client-side (D-5: no PDF bytes are stored, only the frozen JSON;
 * "re-download" means "regenerate the identical PDF from this row").
 *
 * Access: the snapshot's own generating user, or superuser (D-7) — 403, not
 * 404, on a mismatch: the id isn't guessable, so there's no existence-leak
 * concern, and a 404 here would be indistinguishable from a typo'd id.
 *
 * RBAC: middleware `check_route_access` + in-handler requireAuth(CAN_VIEW_COMPRAS).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  const { id } = await params;
  const service = createServiceRoleClient();

  try {
    const { data, error } = await service
      .from('reabastecimiento_status_snapshots')
      .select('id, user_id, autor, bodega, filtros, meta, kpis, alza, top_proveedores, tiendas, filas, total_filas, created_at')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ error: 'Snapshot no encontrado' }, { status: 404 });
    if (data.user_id !== auth.id && auth.role !== 'superuser') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }

    const { orden, ...filtros } = data.filtros as Record<string, unknown>;
    return NextResponse.json({
      id: data.id,
      createdAt: data.created_at,
      autor: data.autor,
      bodega: data.bodega,
      filtros,
      orden: orden ?? null,
      meta: data.meta,
      kpis: data.kpis,
      alza: data.alza,
      topProveedores: data.top_proveedores,
      tiendas: data.tiendas,
      filas: data.filas,
      totalFilas: data.total_filas,
    });
  } catch (e) {
    console.error('[reabastecimiento/snapshot/[id]] GET failed:', e);
    return NextResponse.json({ error: 'Error leyendo el snapshot' }, { status: 500 });
  }
}
