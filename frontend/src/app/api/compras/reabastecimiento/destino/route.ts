import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { GENERAL_BODEGA, badRequest, isPositiveInt, knownBodegas } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras/reabastecimiento/destino — W15-A (sonda temporal)
 *
 *   { productId, vistaBodega, destino: string | null, note? }
 *
 * `destino` es la bodega donde Wilmer declara que ese tránsito se queda de
 * verdad; `null` BORRA la declaración y devuelve el mando al tránsito
 * sincronizado. `vistaBodega` es desde qué pantalla lo tecleó — metadato de la
 * sonda, no entra en ningún cálculo.
 *
 * ⚠️ Sabidamente incompleta: un furgón que descarga en varias bodegas no se
 * puede expresar con un destino por producto. Es deliberado (Jorge, Q26,
 * 2026-08-27) — ver el comentario de la migración 20260827000001.
 *
 * Append-only: el historial de ediciones es el insumo del rediseño (Q29).
 *
 * RBAC: defense-in-depth — `check_route_access` (route_permissions, migración
 * 20260827000001) + `requireAuth(CAN_VIEW_COMPRAS)` en el handler.
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

  const { productId, vistaBodega, destino, note } = body;
  if (!isPositiveInt(productId)) return badRequest('productId debe ser un entero positivo');
  if (destino !== null && typeof destino !== 'string') {
    return badRequest('destino debe ser el nombre de una bodega, o null para borrar la declaración');
  }

  const service = createServiceRoleClient();
  try {
    const bodegas = await knownBodegas(service);
    if (typeof vistaBodega !== 'string' || !bodegas.includes(vistaBodega)) {
      return badRequest(`vistaBodega desconocida (válidas: ${bodegas.join(', ')})`);
    }
    if (destino !== null) {
      if (!bodegas.includes(destino)) {
        return badRequest(`bodega desconocida (válidas: ${bodegas.join(', ')})`);
      }
      // General es el roll-up, no un lugar físico donde algo pueda quedarse.
      // Aceptarlo escribiría una declaración que ningún cálculo puede honrar.
      if (destino === GENERAL_BODEGA) {
        return badRequest(
          `${GENERAL_BODEGA} no es un destino: es la suma de las bodegas. `
          + 'Declará la bodega física donde el producto se queda.',
        );
      }
    }

    const { data, error } = await service
      .from('transito_destino')
      .insert({
        product_id: productId,
        destino,
        vista_bodega: vistaBodega,
        note: typeof note === 'string' ? note.slice(0, 1000) : null,
        created_by: auth.id,
      })
      .select()
      .single();
    if (error) {
      if (error.message.includes('foreign key')) {
        return badRequest(`productId ${productId} no existe`);
      }
      throw new Error(error.message);
    }
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    console.error('[reabastecimiento/destino] POST failed:', e);
    return NextResponse.json({ error: 'Error guardando el destino final' }, { status: 500 });
  }
}
