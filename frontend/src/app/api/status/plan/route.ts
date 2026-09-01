import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_EDIT_STATUS_PLAN } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/status/plan — el PLAN de un ítem del gap analysis.
 *
 *   { itemId, prioridad?: number | null, fechaObjetivo?: string | null, nota?: string | null }
 *
 * ESTA RUTA ES LA FRONTERA DE AUTORIDAD del reporte de estado, y conviene
 * decir qué separa:
 *
 *   * el ESTADO de cada ítem (¿está hecho?) lo juzga quien construyó, y viaja
 *     por `docs/gap-analysis-corpus-aug31/juicio.tsv` + `scripts/sync_status.py`.
 *     NO hay ninguna ruta que permita cambiarlo desde acá.
 *   * el PLAN (¿cuándo?) lo escribe el rol `project_manager`, y sólo eso.
 *
 * Por eso el plan vive en su propia tabla: si fuera columnas de `status_items`,
 * la próxima corrida del sync lo borraría en silencio. La separación es
 * estructural, no disciplinaria.
 *
 * `prioridad = null` devuelve la fila al orden calculado (`orden_sugerido`).
 * La app NUNCA propone una fecha: el corpus registra etapas acordadas cuyo
 * contenido nunca se definió, y llenarlas desde el documento sería inventar.
 *
 * RBAC en dos capas: `check_route_access` (route_permissions, migración
 * 20260901000002) + `requireAuth(CAN_EDIT_STATUS_PLAN)` acá.
 */

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/** `YYYY-MM-DD` y que sea una fecha real — '2026-02-31' no pasa. */
function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const MAX_NOTA = 2000;

export async function PATCH(request: Request) {
  const auth = await requireAuth(CAN_EDIT_STATUS_PLAN);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('cuerpo JSON inválido');
  }

  const { itemId, prioridad, fechaObjetivo, nota } = body;

  if (typeof itemId !== 'string' || !itemId.trim()) {
    return badRequest('itemId es obligatorio');
  }

  const patch: Record<string, unknown> = { item_id: itemId, autor: auth.email };

  if (prioridad !== undefined) {
    if (prioridad !== null && (!Number.isInteger(prioridad) || (prioridad as number) < 1)) {
      return badRequest('prioridad debe ser un entero >= 1, o null para volver al orden calculado');
    }
    patch.prioridad = prioridad;
  }

  if (fechaObjetivo !== undefined) {
    if (fechaObjetivo !== null && !isIsoDate(fechaObjetivo)) {
      return badRequest('fechaObjetivo debe ser YYYY-MM-DD, o null');
    }
    patch.fecha_objetivo = fechaObjetivo;
  }

  if (nota !== undefined) {
    if (nota !== null && (typeof nota !== 'string' || nota.length > MAX_NOTA)) {
      return badRequest(`nota debe ser texto de hasta ${MAX_NOTA} caracteres, o null`);
    }
    patch.nota = nota;
  }

  if (Object.keys(patch).length === 2) {
    return badRequest('nada que actualizar: enviar prioridad, fechaObjetivo o nota');
  }

  const db = createServiceRoleClient();

  // El ítem tiene que existir. La FK lo garantizaría, pero un 400 explícito es
  // más útil que un error de integridad — un id mal tecleado es lo más probable.
  const { data: existe } = await db
    .from('status_items').select('id').eq('id', itemId).maybeSingle();
  if (!existe) return badRequest(`el ítem ${itemId} no existe`);

  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from('status_plan')
    .upsert(patch, { onConflict: 'item_id' })
    .select('item_id, prioridad, fecha_objetivo, nota, updated_at')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'No se pudo guardar el plan', detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ plan: data });
}
