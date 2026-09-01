import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { GENERAL_BODEGA, badRequest, isPositiveInt, knownBodegas } from '../lib';
import { MAX_MANUAL_QTY } from '@/lib/compras/qty';

export const dynamic = 'force-dynamic';

/**
 * POST /api/compras/reabastecimiento/sugerido-bodega — A4.17
 *
 *   { productId, bodega, qty: number | null, note? }
 *
 * El pedido adicional que el encargado del centro de distribución manda para su
 * bodega, y que hoy el comprador cruza a mano con un VLOOKUP contra su tabla:
 * *«que lo sume... que lo tome en cuenta en el sugerido»* (20-ago).
 *
 * `qty = null` BORRA la captura — misma convención que tránsito y pendiente.
 * Borrar es una entrada nueva, no un DELETE: la tabla es append-only porque el
 * historial es el dato. La pregunta de la reunión no va a ser «cuánto pidió el
 * CD» sino «cuánto pidió y cuánto cambió después de revisarlo», y una escritura
 * que pisa a la anterior no puede contestar eso.
 *
 * `General` se rechaza: es el roll-up de las bodegas, no un lugar donde alguien
 * pida algo. Aceptarlo sumaría un adicional que se contaría dos veces al mirar
 * las bodegas físicas.
 *
 * RBAC en dos capas: `check_route_access` (route_permissions, migración
 * 20260901000008) + `requireAuth(CAN_VIEW_COMPRAS)` acá.
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

  if (qty !== null) {
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
      return badRequest('qty debe ser un número mayor o igual a cero, o null para borrar');
    }
    // Mismo techo que el resto de las capturas manuales. Nació del incidente
    // del 2026-08-12, cuando una prueba de límites dejó la página en −1e9.
    if (qty > MAX_MANUAL_QTY) {
      return badRequest(`qty supera el máximo de captura manual (${MAX_MANUAL_QTY})`);
    }
  }

  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    return badRequest('la nota admite hasta 500 caracteres');
  }

  const service = createServiceRoleClient();
  try {
    const bodegas = await knownBodegas(service);
    if (typeof bodega !== 'string' || !bodegas.includes(bodega)) {
      return badRequest(`bodega desconocida (válidas: ${bodegas.join(', ')})`);
    }
    if (bodega === GENERAL_BODEGA) {
      return badRequest(
        `${GENERAL_BODEGA} no es una bodega donde alguien pida: es la suma de las otras. `
        + 'Capturá el pedido en la bodega física que lo solicitó.',
      );
    }

    const { data: producto } = await service
      .from('products').select('id').eq('id', productId).maybeSingle();
    if (!producto) return badRequest('ese producto no existe');

    const { error } = await service.from('sugerido_bodega').insert({
      product_id: productId,
      bodega,
      qty: qty as number | null,
      note: (note as string | null) ?? null,
      autor: auth.email,
      created_by: auth.id,
    });
    if (error) {
      return NextResponse.json(
        { error: 'No se pudo guardar el sugerido de bodega', detail: error.message },
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
