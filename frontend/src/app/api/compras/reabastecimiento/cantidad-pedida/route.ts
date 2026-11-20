import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_EDIT_REABASTECIMIENTO } from '@/lib/auth/roles';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import { badRequest, isPositiveInt, knownBodegas } from '../lib';
import { MAX_MANUAL_QTY } from '@/lib/compras/qty';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras/reabastecimiento/cantidad-pedida
 *
 *   { productId, bodega, qty: number | null }
 *
 * La cantidad que Wilmer digita para cubicar la carga (2026-11-19). Cada
 * pestaña guarda la suya, General incluida: no se suma al mirar otra bodega.
 *
 * No entra al Sugerido. La fórmula sigue en su columna. `qty = null` quita
 * la captura y esa línea vuelve a cubicar con el Sugerido. Borrar es una
 * entrada nueva: la tabla es append-only.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(CAN_EDIT_REABASTECIMIENTO);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('cuerpo JSON inválido');
  }

  const { productId, bodega, qty } = body;

  if (!isPositiveInt(productId)) return badRequest('productId debe ser un entero positivo');

  if (qty !== null) {
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
      return badRequest('qty debe ser un número mayor o igual a cero, o null para borrar');
    }
    if (qty > MAX_MANUAL_QTY) {
      return badRequest(`qty supera el máximo de captura manual (${MAX_MANUAL_QTY})`);
    }
  }

  const reads = await createServerSupabaseClient();
  const service = createServiceRoleClient();
  try {
    const bodegas = await knownBodegas(reads);
    if (typeof bodega !== 'string' || !bodegas.includes(bodega)) {
      return badRequest(`bodega desconocida (válidas: ${bodegas.join(', ')})`);
    }

    const { data: producto } = await reads
      .from('products').select('id').eq('id', productId).maybeSingle();
    if (!producto) return badRequest('ese producto no existe');

    const { error } = await service.from('cantidad_pedida').insert({
      product_id: productId,
      bodega,
      qty: qty as number | null,
      autor: auth.email,
      created_by: auth.id,
    });
    if (error) {
      return NextResponse.json(
        { error: 'No se pudo guardar la cantidad a pedir', detail: error.message },
        { status: 500 },
      );
    }
    return NextResponse.json({ guardado: true, productId, bodega, qty });
  } catch (e) {
    return NextResponse.json(
      { error: 'No se pudo guardar', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
