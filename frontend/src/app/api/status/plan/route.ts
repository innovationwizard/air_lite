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
/** Tope defensivo: el plan entero son ~70 pendientes, no miles. */
const MAX_ORDEN = 500;

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

/**
 * PUT /api/status/plan — reordenamiento en bloque, o vuelta al orden calculado.
 *
 *   { orden: string[] }   asigna prioridad = posición (1..N) en ese orden
 *   { reset: true }       borra TODA prioridad manual y devuelve el plan al
 *                         orden que calcula scripts/sync_status.py
 *
 * POR QUÉ EN BLOQUE Y NO N PATCH. Arrastrar una fila cambia la posición de
 * todas las que quedan entre el origen y el destino. Mandarlo fila por fila
 * sería lento y, sobre todo, no atómico: una tanda a medio aplicar deja el
 * plan en un orden que nadie eligió y que no se parece ni al viejo ni al nuevo.
 *
 * EL CLIENTE MANDA EL ORDEN CANÓNICO COMPLETO, no sólo lo que se ve en
 * pantalla. La tabla se puede estar filtrando por alcance, y numerar 1..N
 * sobre un subconjunto visible produciría posiciones que no significan nada
 * cuando el filtro cambia. Se numera sobre la lista entera de pendientes.
 *
 * `fecha_objetivo` y `nota` NO se tocan: el upsert sólo nombra `prioridad`, así
 * que en las filas que ya existen el resto de columnas queda intacto.
 */
export async function PUT(request: Request) {
  const auth = await requireAuth(CAN_EDIT_STATUS_PLAN);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('cuerpo JSON inválido');
  }

  const db = createServiceRoleClient();
  const ahora = new Date().toISOString();

  if (body.reset === true) {
    const { error } = await db
      .from('status_plan')
      .update({ prioridad: null, autor: auth.email, updated_at: ahora })
      .not('prioridad', 'is', null);
    if (error) {
      return NextResponse.json(
        { error: 'No se pudo restaurar el orden', detail: error.message }, { status: 500 },
      );
    }
    return NextResponse.json({ reset: true });
  }

  const { orden } = body;
  if (!Array.isArray(orden) || orden.length === 0) {
    return badRequest('orden debe ser un arreglo de ids, o enviar { reset: true }');
  }
  if (orden.length > MAX_ORDEN) {
    return badRequest(`orden admite hasta ${MAX_ORDEN} ítems`);
  }
  if (!orden.every((x): x is string => typeof x === 'string' && x.trim().length > 0)) {
    return badRequest('orden debe contener sólo ids no vacíos');
  }
  if (new Set(orden).size !== orden.length) {
    return badRequest('orden tiene ids repetidos');
  }

  // Todos los ids tienen que existir. La llave foránea también lo impediría,
  // pero un 400 que nombra el id sobrante es más útil que un error de
  // integridad — y evita aplicar la mitad del reordenamiento.
  const { data: existentes, error: errLectura } = await db
    .from('status_items').select('id').in('id', orden);
  if (errLectura) {
    return NextResponse.json(
      { error: 'No se pudo validar el orden', detail: errLectura.message }, { status: 500 },
    );
  }
  const conocidos = new Set((existentes ?? []).map((r) => r.id));
  const desconocidos = orden.filter((id) => !conocidos.has(id));
  if (desconocidos.length > 0) {
    return badRequest(`estos ítems no existen: ${desconocidos.slice(0, 5).join(', ')}`);
  }

  const filas = orden.map((itemId, i) => ({
    item_id: itemId, prioridad: i + 1, autor: auth.email, updated_at: ahora,
  }));

  const { error } = await db.from('status_plan').upsert(filas, { onConflict: 'item_id' });
  if (error) {
    return NextResponse.json(
      { error: 'No se pudo guardar el orden', detail: error.message }, { status: 500 },
    );
  }

  return NextResponse.json({ ordenadas: filas.length });
}
