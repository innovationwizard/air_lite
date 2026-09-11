import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_FORECAST_COMERCIAL } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/comercial/exportado — record one «Exportar a Excel» download.
 *
 *   { area, month, archivo, filtros, totalFilas, hash }
 *
 * The file is built and downloaded in the browser from what is on screen;
 * this row is the audit trail ("this is the file that went out"). A `ventas`
 * user may only record exports of its own area. The client never blocks the
 * download on this call.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(CAN_VIEW_FORECAST_COMERCIAL);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'cuerpo JSON inválido' }, { status: 400 }); }
  const { area, month, archivo, filtros, totalFilas, hash } = body;
  if (typeof area !== 'string' || !area) return NextResponse.json({ error: 'area es obligatoria' }, { status: 400 });
  if (auth.role === 'ventas' && area !== auth.area) {
    return NextResponse.json({ error: 'Sólo podés exportar tu propio canal.' }, { status: 403 });
  }
  if (typeof month !== 'string' || !/^\d{4}-\d{2}-01$/.test(month)) return NextResponse.json({ error: 'month inválido' }, { status: 400 });
  if (typeof archivo !== 'string' || !archivo || archivo.length > 200) return NextResponse.json({ error: 'archivo inválido' }, { status: 400 });
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) return NextResponse.json({ error: 'hash inválido' }, { status: 400 });
  if (!Number.isInteger(totalFilas) || (totalFilas as number) < 0) return NextResponse.json({ error: 'totalFilas inválido' }, { status: 400 });
  if (filtros !== null && (typeof filtros !== 'object' || Array.isArray(filtros))) return NextResponse.json({ error: 'filtros inválido' }, { status: 400 });

  const db = createServiceRoleClient();
  const autor = `${auth.displayName ?? ''} <${auth.email}>`.trim();
  const { data, error } = await db.from('comercial_forecast_exportado')
    .insert({ area, month, user_id: auth.id, autor, archivo, filtros: filtros ?? {}, total_filas: totalFilas, hash })
    .select('id, created_at').single();
  if (error) return NextResponse.json({ error: 'No se pudo registrar la exportación', detail: error.message }, { status: 500 });
  return NextResponse.json({ registro: data });
}
