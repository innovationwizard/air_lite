import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { GENERAL_BODEGA, buildTiendas, knownBodegas } from './lib';
import { buildRows } from './rows';

export const dynamic = 'force-dynamic';

/**
 * GET /api/compras/reabastecimiento?bodega=<name>
 *
 * The LIVE replenishment view: reads synced Odoo inputs
 * (`reabastecimiento_inputs`), merges the three manual override streams
 * (comercial_forecast, transito_overrides, sugerido_bodega — latest entry per
 * product×bodega applies), fetches pendiente de tomar reserva LIVE from Odoo,
 * and computes Sugerido/DOH with the SAME
 * engine module the xlsx parity page uses (imported, never reimplemented).
 *
 * Availability semantics (parity with the workbook, manifest §3):
 *   engine.exist = existencias(on-hand) − reserved − pending(live from Odoo)
 *   patio is returned as its own column (visible, NOT in the engine math —
 *   the workbook's Existencias column excludes patio; folding it in is a
 *   Wilmer-facing decision, not a silent change).
 *   pending === null  → Odoo did not answer THIS request → flags.pendingUnknown
 *   and meta.pendienteReserva.error says why. (Until 2026-09-11 this was a
 *   manual capture, `pending_reserve_overrides`; see rows.ts / the
 *   `lib/compras/pendienteReserva.ts` header for why it became a live fetch.)
 *
 * RBAC: defense-in-depth — middleware `check_route_access` (route_permissions,
 * migration 20260724000003) + in-handler requireAuth(CAN_VIEW_COMPRAS).
 */

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  const service = createServiceRoleClient();
  const url = new URL(request.url);
  const bodega = url.searchParams.get('bodega') ?? GENERAL_BODEGA;

  try {
    const bodegas = await knownBodegas(service);
    if (!bodegas.includes(bodega)) {
      return NextResponse.json(
        { error: `bodega desconocida: ${bodega}`, bodegas },
        { status: 400 },
      );
    }

    // Rows come from the SHARED builder the xlsx export also uses — see rows.ts.
    // tiendas comes from the SHARED lib.ts builder — the snapshot route uses it too.
    const [{ rows, maxAsOf, monthStart, coberturaDias, groups, areasComerciales, pendienteReserva, bodegaOrigen }, tiendas, lastSync] = await Promise.all([
      buildRows(service, bodega),
      buildTiendas(service),
      service.from('sync_runs').select('id, status, started_at, finished_at, counts')
        .eq('kind', 'reabastecimiento').order('started_at', { ascending: false })
        .limit(1).maybeSingle(),
    ]);

    return NextResponse.json({
      bodega,
      bodegas,
      rows,
      groups,
      // Los canales comerciales que rotulan las columnas del Adic. por canal.
      areasComerciales,
      tiendas,
      meta: {
        count: rows.length,
        asOf: maxAsOf || null,
        lastSync: lastSync?.data ?? null,
        month: monthStart,
        // Days of demand the Sugerido covers for this bodega (Wilmer 2026-08-21:
        // Zacapa y Petén a 15). Reported so the page can say it out loud.
        coberturaDias,
        // Live-fetch provenance for the pendiente column: when `error` is
        // set, every row's pending is null and the page must say so.
        pendienteReserva,
        // W18 — the bodega that supplies this one (San José → Zacapa → Petén),
        // or null. Set = every row carries `origen` and the page shows its columns.
        bodegaOrigen,
      },
    });
  } catch (e) {
    console.error('[reabastecimiento] GET failed:', e);
    return NextResponse.json(
      { error: 'Error consultando reabastecimiento' },
      { status: 500 },
    );
  }
}

