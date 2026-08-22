import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { GENERAL_BODEGA, fetchAll, knownBodegas } from './lib';
import { buildRows, round1 } from './rows';

export const dynamic = 'force-dynamic';

/**
 * GET /api/compras/reabastecimiento?bodega=<name>
 *
 * The LIVE replenishment view: reads synced Odoo inputs
 * (`reabastecimiento_inputs`), merges the three manual override streams
 * (comercial_forecast, transito_overrides, pending_reserve_overrides — latest
 * entry per product×bodega applies), and computes Sugerido/DOH with the SAME
 * engine module the xlsx parity page uses (imported, never reimplemented).
 *
 * Availability semantics (parity with the workbook, manifest §3):
 *   engine.exist = existencias(on-hand) − reserved − pending(manual, 0 if none)
 *   patio is returned as its own column (visible, NOT in the engine math —
 *   the workbook's Existencias column excludes patio; folding it in is a
 *   Wilmer-facing decision, not a silent change).
 *   pending === null  → unknown (no manual entry, or the capture was cleared
 *   with a qty-null entry — 20260813000001) → flags.pendingUnknown.
 *
 * RBAC: defense-in-depth — middleware `check_route_access` (route_permissions,
 * migration 20260724000003) + in-handler requireAuth(CAN_VIEW_COMPRAS).
 */

/** G4 — retail perimeter, deliberately never merged into a purchasing bodega. */
interface TiendaRow { product_id: number; tienda: string; f6: number; f3: number }

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
    const [{ rows, maxAsOf, monthStart, coberturaDias }, tiendaRows, lastSync] = await Promise.all([
      buildRows(service, bodega),
      fetchAll<TiendaRow>((a, b) =>
        service.from('invoiced_tiendas').select('product_id, tienda, f6, f3').range(a, b)),
      service.from('sync_runs').select('id, status, started_at, finished_at, counts')
        .eq('kind', 'reabastecimiento').order('started_at', { ascending: false })
        .limit(1).maybeSingle(),
    ]);

    // G4 — the retail perimeter, aggregated per journal and kept apart from
    // every purchasing bodega. In July 2026 this block was 501,014 units, ~0%
    // of them traceable to a sale order: it is the whole reason Wilmer's and
    // Raquel's totals differ, so it is shown, labelled, and never folded in.
    const porTiendaMap = new Map<string, { f6: number; f3: number }>();
    for (const t of tiendaRows) {
      const acc = porTiendaMap.get(t.tienda) ?? { f6: 0, f3: 0 };
      acc.f6 += t.f6;
      acc.f3 += t.f3;
      porTiendaMap.set(t.tienda, acc);
    }
    const porTienda = [...porTiendaMap.entries()]
      .map(([tienda, v]) => ({ tienda, f6: round1(v.f6), f3: round1(v.f3) }))
      .sort((a, b) => b.f6 - a.f6);
    const tiendas = {
      porTienda,
      total: {
        f6: round1(porTienda.reduce((s, t) => s + t.f6, 0)),
        f3: round1(porTienda.reduce((s, t) => s + t.f3, 0)),
      },
      productos: porTiendaMap.size ? new Set(tiendaRows.map((t) => t.product_id)).size : 0,
    };

    return NextResponse.json({
      bodega,
      bodegas,
      rows,
      tiendas,
      meta: {
        count: rows.length,
        asOf: maxAsOf || null,
        lastSync: lastSync?.data ?? null,
        month: monthStart,
        // Days of demand the Sugerido covers for this bodega (Wilmer 2026-08-21:
        // Zacapa y Petén a 15). Reported so the page can say it out loud.
        coberturaDias,
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

