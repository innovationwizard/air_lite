import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { validateManualQtyOrClear } from '@/lib/compras/qty';
import { badRequest, isPositiveInt, knownBodegas } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras/reabastecimiento/pendiente
 *
 * Manual "pendiente de tomar reserva" entry (decision 2026-07-30: the value
 * is stored in NO system — Wilmer keys it inline when it exists):
 *   { productId, bodega, qty, note? }
 *
 * ⚠️ UPDATE 2026-09-03: the "no system source" premise is narrowed, not
 * reversed — no Odoo FIELD stores this number, but it IS live-derivable:
 * `stock.move` (outgoing, `location_dest_id.usage='customer'`, per bodega's
 * warehouse) in `state='confirmed'` — confirmed demand with zero reservation.
 * Validated live against Wilmer's own Odoo "Reporte de Pronóstico" screen for
 * 77205001/San José (60 units, SO-P-76811 + SO-P-77114, both invisible to him
 * as "reservado"). It is NOT a value to sync or store either way: re-querying
 * the identical SKU×warehouse ~20 min apart on production returned a
 * completely different move population (40 vs 275 active moves) — it must be
 * fetched live from Odoo at request time, never hand-typed, never snapshotted
 * by a periodic sync. This manual-entry endpoint is the interim path until
 * that live fetch replaces it.
 *
 * qty semantics:
 *   number  — pending amount; 0 means EXPLICITLY "nothing pending" (distinct
 *             from no entry at all, which the GET reports as pending: null →
 *             flags.pendingUnknown). Capped at MAX_MANUAL_QTY (incident
 *             2026-08-12: an uncapped 1e9 entry saved and poisoned exist.
 *             neta; the next larger one overflowed NUMERIC(15,4) as a 500).
 *   null    — CLEAR the manual capture: the product reverts to unknown (¿?).
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

  const { productId, bodega, note } = body;
  if (!isPositiveInt(productId)) return badRequest('productId debe ser un entero positivo');
  const qty = validateManualQtyOrClear(body.qty);
  if (!qty.ok) return badRequest(qty.error);

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
        qty: qty.qty,
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
