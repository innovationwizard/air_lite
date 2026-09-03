import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_STATUS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/status — el gap analysis que alimenta `/status`.
 *
 * Devuelve los ítems renderizables y su plan. Reservado a pm, gerencia y
 * superuser (Jorge, 2026-09-03) — ver CAN_VIEW_STATUS.
 *
 * DOS FILTROS QUE SE APLICAN ACÁ Y NO EN EL CLIENTE, porque un filtro de
 * presentación se puede desactivar desde el navegador y estos no deben poder
 * desactivarse:
 *
 *   1. `visible_ui = false` — filas cuyo contenido es una valoración de
 *      desempeño de personas. Se cargan porque informan el juicio (R03: las
 *      filas de evidencia informan, no sustituyen) y NO se envían al navegador.
 *   2. `ref` — la cita verbatim del transcript nunca sale de la base hacia la
 *      página. La auditabilidad la sostiene `src` (fecha + archivo + líneas):
 *      con eso cualquiera va al transcript. Las citas son justamente donde
 *      aparecen los juicios sobre personas.
 *
 * El denominador del porcentaje se calcula en el cliente a partir de `estado`,
 * porque depende del toggle de alcance que el lector mueve en pantalla.
 */
export async function GET() {
  const auth = await requireAuth(CAN_VIEW_STATUS);
  if (auth instanceof Response) return auth;

  const db = createServiceRoleClient();

  const { data: items, error } = await db
    .from('status_items')
    .select(
      'id, cat, orden_natural, item, tipo, flag, src, notes, estado, estado_sugerido, ' +
      'evidencia, origen, bloqueo, espera_que, temporada, esfuerzo, rodeo, ' +
      'confirmable_con, criterio_aceptacion, orden_sugerido, es_addendum, updated_at',
    )
    .eq('visible_ui', true)
    .order('orden_natural', { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: 'No se pudo leer el estado del proyecto', detail: error.message },
      { status: 500 },
    );
  }

  const { data: plan, error: planError } = await db
    .from('status_plan')
    .select('item_id, prioridad, fecha_objetivo, nota, updated_at');

  if (planError) {
    return NextResponse.json(
      { error: 'No se pudo leer el plan', detail: planError.message },
      { status: 500 },
    );
  }

  // Fecha de corte del juicio. El lector necesita saberla, por la misma razón
  // que las páginas vivas llevan banner de frescura: un reporte de estado sin
  // fecha se lee como si fuera de hoy.
  const corte = (items ?? []).reduce<string | null>(
    (max, r) => {
      const u = (r as { updated_at?: string }).updated_at;
      return u && (!max || u > max) ? u : max;
    },
    null,
  );

  return NextResponse.json({ items: items ?? [], plan: plan ?? [], corte });
}
