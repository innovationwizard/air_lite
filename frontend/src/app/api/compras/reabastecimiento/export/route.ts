/**
 * POST /api/compras/reabastecimiento/export
 *
 * Cross-bodega figures for the supplier sheet (W1 format (a)).
 *
 * The live page shows ONE bodega at a time, but Carvajal's file wants San Jose,
 * Petén and Zacapa side by side for the same product — so this reads all three
 * through the SAME shared builder the page uses (`rows.ts`). Nothing is
 * recomputed here: if the page and the file ever disagreed on a number, the
 * file is what reaches the supplier.
 *
 * Takes the ORDERED list of product ids the user is looking at and answers in
 * that order — the sheet's `Prioridad` column is literally that position, and
 * the page's default sort is DOH ascending, i.e. Wilmer's own *"de acuerdo a
 * los días de inventario que tengo"*.
 *
 * RBAC: middleware `check_route_access` (route_permissions row added in
 * migration 20260821000003) + in-handler requireAuth(CAN_VIEW_COMPRAS).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { CARVAJAL_BODEGAS } from '@/lib/compras/carvajal';
import { badRequest, isPositiveInt } from '../lib';
import { buildRows } from '../rows';

export const dynamic = 'force-dynamic';

/** Enough for the whole catalogue with headroom; a bigger list is a bug or abuse. */
const MAX_PRODUCTS = 3000;

export async function POST(request: Request) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('cuerpo inválido: se esperaba JSON');
  }

  const ids = (body as { productIds?: unknown })?.productIds;
  if (!Array.isArray(ids) || ids.length === 0) {
    return badRequest('productIds debe ser un arreglo con al menos un producto');
  }
  if (ids.length > MAX_PRODUCTS) {
    return badRequest(`demasiados productos (${ids.length}); el máximo es ${MAX_PRODUCTS}`);
  }
  if (!ids.every(isPositiveInt)) {
    return badRequest('productIds debe contener sólo ids enteros positivos');
  }

  try {
    const service = createServiceRoleClient();
    const perBodega = await Promise.all(
      CARVAJAL_BODEGAS.map(async (b) => ({ bodega: b, built: await buildRows(service, b) })),
    );

    const byBodega = new Map(
      perBodega.map(({ bodega, built }) => [
        bodega,
        new Map(built.rows.map((r) => [r.productId, r])),
      ]),
    );

    // Answer in the order asked. A product with no row in ANY bodega is
    // reported back rather than dropped: the caller listed it on purpose, and
    // a silently missing line is a line Carvajal never ships.
    const desconocidos: number[] = [];
    const lines = (ids as number[]).map((productId) => {
      const found = CARVAJAL_BODEGAS.map((b) => byBodega.get(b)?.get(productId)).filter(Boolean);
      if (found.length === 0) {
        desconocidos.push(productId);
        return null;
      }
      const ref = found[0]!;
      const porBodega: Record<string, { sug: number; doh: number; exist: number; trans: number } | null> = {};
      for (const b of CARVAJAL_BODEGAS) {
        const r = byBodega.get(b)?.get(productId);
        porBodega[b] = r ? { sug: r.sug, doh: r.doh, exist: r.exist, trans: r.trans } : null;
      }
      return { productId, cod: ref.cod, desc: ref.desc, prov: ref.prov, porBodega };
    }).filter((l): l is NonNullable<typeof l> => l !== null);

    const cobertura: Record<string, number> = {};
    for (const { bodega, built } of perBodega) cobertura[bodega] = built.coberturaDias;

    return NextResponse.json({
      lines,
      bodegas: CARVAJAL_BODEGAS,
      // Each bodega's coverage horizon, so the weekly proposal is derived from
      // what its Sugerido actually covers instead of a fixed divisor.
      cobertura,
      desconocidos,
      asOf: perBodega.map((p) => p.built.maxAsOf).filter(Boolean).sort().pop() ?? null,
    });
  } catch (e) {
    console.error('[reabastecimiento/export] POST failed:', e);
    return NextResponse.json({ error: 'Error preparando la exportación' }, { status: 500 });
  }
}
