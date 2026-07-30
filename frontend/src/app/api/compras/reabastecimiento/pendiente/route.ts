import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { badRequest, isFiniteNonNegative, isPositiveInt, knownBodegas } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras/reabastecimiento/pendiente
 *
 * Manual "pendiente de tomar reserva" entry (decision 2026-07-30: the value
 * is stored in NO system — Wilmer keys it inline when it exists):
 *   { productId, bodega, qty, note? }
 *
 * qty = 0 means EXPLICITLY "nothing pending" (distinct from no entry at all,
 * which the GET reports as pending: null → flags.pendingUnknown).
 * Append-only (`pending_reserve_overrides`); latest entry per product×bodega
 * applies and is subtracted from net availability.
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

  const { productId, bodega, qty, note } = body;
  if (!isPositiveInt(productId)) return badRequest('productId debe ser un entero positivo');
  if (!isFiniteNonNegative(qty)) return badRequest('qty debe ser un número ≥ 0');

  const service = createServiceRoleClient();
  try {
    const bodegas = await knownBodegas(service);
    if (typeof bodega !== 'string' || !bodegas.includes(bodega)) {
      return badRequest(`bodega desconocida (válidas: ${bodegas.join(', ')})`);
    }
    const { data, error } = await service
      .from('pending_reserve_overrides')
      .insert({
        product_id: productId,
        bodega,
        qty,
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
    console.error('[reabastecimiento/pendiente] POST failed:', e);
    return NextResponse.json({ error: 'Error guardando pendiente de tomar reserva' }, { status: 500 });
  }
}
