import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { validateManualQtyOrClear } from '@/lib/compras/qty';
import { badRequest, isPositiveInt, knownBodegas } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras/reabastecimiento/transito
 *
 * Manual in-transit override (Carvajal monthly fallback):
 *   { productId, bodega, qty, effectiveWeek?: 'YYYY-MM-DD', note? }
 *
 * qty: number (capped at MAX_MANUAL_QTY — incident 2026-08-12) REPLACES the
 * synced transit; null CLEARS the override so the synced value applies again.
 * Append-only (`transito_overrides`); the GET merge applies the latest entry
 * per product×bodega.
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

  const { productId, bodega, effectiveWeek, note } = body;
  if (!isPositiveInt(productId)) return badRequest('productId debe ser un entero positivo');
  const qty = validateManualQtyOrClear(body.qty);
  if (!qty.ok) return badRequest(qty.error);
  if (effectiveWeek !== undefined
      && !(typeof effectiveWeek === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(effectiveWeek))) {
    return badRequest("effectiveWeek debe ser 'YYYY-MM-DD'");
  }

  const service = createServiceRoleClient();
  try {
    const bodegas = await knownBodegas(service);
    if (typeof bodega !== 'string' || !bodegas.includes(bodega)) {
      return badRequest(`bodega desconocida (válidas: ${bodegas.join(', ')})`);
    }
    const { data, error } = await service
      .from('transito_overrides')
      .insert({
        product_id: productId,
        bodega,
        qty: qty.qty,
        effective_week: effectiveWeek ?? null,
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
    console.error('[reabastecimiento/transito] POST failed:', e);
    return NextResponse.json({ error: 'Error guardando tránsito manual' }, { status: 500 });
  }
}
