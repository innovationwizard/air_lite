import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  badRequest,
  isFiniteNonNegative,
  isPositiveInt,
  knownBodegas,
  normalizeMonth,
} from '../lib';

export const dynamic = 'force-dynamic';

const MOTIVOS = ['adicional', 'normal_critica'] as const;
const AREAS = ['mayoreo', 'institucional', 'supermercados', 'tiendas'] as const;

/**
 * POST /api/compras/reabastecimiento/comercial
 *
 * Commercial-forecast entry (F1 — area leaders / Wilmer):
 *   { productId, month: 'YYYY-MM'|'YYYY-MM-DD', quantity, motivo,
 *     bodega?: string|null (null/omitted = all bodegas), area?, note? }
 *
 * Append-only (`comercial_forecast`); the GET merge applies the latest entry
 * per product (bodega-specific beats all-bodegas) for the requested month.
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

  const { productId, quantity, motivo, area, note } = body;
  const month = normalizeMonth(body.month);
  if (!isPositiveInt(productId)) return badRequest('productId debe ser un entero positivo');
  if (!month) return badRequest("month debe ser 'YYYY-MM' o 'YYYY-MM-DD'");
  if (!isFiniteNonNegative(quantity)) return badRequest('quantity debe ser un número ≥ 0');
  if (!MOTIVOS.includes(motivo as typeof MOTIVOS[number])) {
    return badRequest(`motivo debe ser uno de: ${MOTIVOS.join(', ')}`);
  }
  if (area !== undefined && !AREAS.includes(area as typeof AREAS[number])) {
    return badRequest(`area debe ser una de: ${AREAS.join(', ')}`);
  }

  const service = createServiceRoleClient();
  try {
    const bodega = body.bodega ?? null;
    if (bodega !== null) {
      const bodegas = await knownBodegas(service);
      if (typeof bodega !== 'string' || !bodegas.includes(bodega)) {
        return badRequest(`bodega desconocida (válidas: ${bodegas.join(', ')} o null)`);
      }
    }
    const { data, error } = await service
      .from('comercial_forecast')
      .insert({
        product_id: productId,
        bodega,
        month,
        quantity,
        motivo,
        area: area ?? null,
        note: typeof note === 'string' ? note.slice(0, 1000) : null,
        created_by: auth.id,
      })
      .select()
      .single();
    if (error) {
      // FK violation => unknown product; surface as a client error, not a 500.
      if (error.message.includes('foreign key')) {
        return badRequest(`productId ${productId} no existe`);
      }
      throw new Error(error.message);
    }
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    console.error('[reabastecimiento/comercial] POST failed:', e);
    return NextResponse.json({ error: 'Error guardando forecast comercial' }, { status: 500 });
  }
}
