import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  type ProductRow,
  sugerido,
  doh,
} from '@/app/(authenticated)/compras/reabastecimiento/engine';
import { GENERAL_BODEGA, fetchAll, knownBodegas } from './lib';

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

interface InputRow {
  product_id: number;
  bodega: string;
  p6: number; p3: number; h: number;
  /** G4 invoiced lens (Raquel's filter). NULL = not yet computed by the sync. Display only. */
  f6: number | null; f3: number | null;
  existencias: number; reserved: number;
  pending_reserve: number | null;
  patio: number; transito: number;
  win: number; as_of: string;
}
interface ProductRef { id: number; sku: string | null; name: string }
/** G4 — retail perimeter, deliberately never merged into a purchasing bodega. */
interface TiendaRow { product_id: number; tienda: string; f6: number; f3: number }
interface SupplierLink { product_id: number; supplier_id: number }
interface SupplierRef { id: number; name: string }
/** qty === null = a CLEAR entry: the manual capture was removed (20260813000001). */
interface OverrideRow { product_id: number; qty: number | null; created_at: string }
interface ComercialRow {
  product_id: number; bodega: string | null; quantity: number;
  motivo: string; created_at: string;
}

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

    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;

    const [inputs, products, links, suppliers, transitoOv, pendingOv, comercial, tiendaRows, lastSync] =
      await Promise.all([
        fetchAll<InputRow>((a, b) =>
          service.from('reabastecimiento_inputs').select('*').eq('bodega', bodega).range(a, b)),
        fetchAll<ProductRef>((a, b) =>
          service.from('products').select('id, sku, name').range(a, b)),
        fetchAll<SupplierLink>((a, b) =>
          service.from('product_suppliers').select('product_id, supplier_id').range(a, b)),
        fetchAll<SupplierRef>((a, b) =>
          service.from('suppliers').select('id, name').range(a, b)),
        fetchAll<OverrideRow>((a, b) =>
          service.from('transito_overrides').select('product_id, qty, created_at')
            .eq('bodega', bodega).order('created_at', { ascending: false }).range(a, b)),
        fetchAll<OverrideRow>((a, b) =>
          service.from('pending_reserve_overrides').select('product_id, qty, created_at')
            .eq('bodega', bodega).order('created_at', { ascending: false }).range(a, b)),
        fetchAll<ComercialRow>((a, b) =>
          service.from('comercial_forecast')
            .select('product_id, bodega, quantity, motivo, created_at')
            .eq('month', monthStart)
            .order('created_at', { ascending: false }).range(a, b)),
        fetchAll<TiendaRow>((a, b) =>
          service.from('invoiced_tiendas').select('product_id, tienda, f6, f3').range(a, b)),
        service.from('sync_runs').select('id, status, started_at, finished_at, counts')
          .eq('kind', 'reabastecimiento').order('started_at', { ascending: false })
          .limit(1).maybeSingle(),
      ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const supplierById = new Map(suppliers.map((s) => [s.id, s.name]));
    // First link per product = primary supplier (insertion order follows
    // supplierinfo sequence in the sync).
    const supplierByProduct = new Map<number, string>();
    for (const l of links) {
      if (!supplierByProduct.has(l.product_id)) {
        supplierByProduct.set(l.product_id, supplierById.get(l.supplier_id) ?? '');
      }
    }
    // Latest-entry-wins merges (rows arrive ordered newest-first). A latest
    // entry with qty null is a CLEAR: the map stores null, and consumers
    // treat it exactly like "no override".
    const latest = (rows: OverrideRow[]) => {
      const m = new Map<number, number | null>();
      for (const r of rows) if (!m.has(r.product_id)) m.set(r.product_id, r.qty);
      return m;
    };
    const transitoByProduct = latest(transitoOv);
    const pendingByProduct = latest(pendingOv);
    // Comercial: bodega-specific entry beats the all-bodegas (null) entry.
    const comercialByProduct = new Map<number, { qty: number; motivo: string }>();
    for (const c of comercial) {
      if (c.bodega !== null && c.bodega !== bodega) continue;
      const existing = comercialByProduct.get(c.product_id);
      if (!existing) {
        comercialByProduct.set(c.product_id, { qty: c.quantity, motivo: c.motivo });
      }
    }

    let maxAsOf = '';
    const rows = inputs.map((r) => {
      const ref = productById.get(r.product_id);
      const pending = pendingByProduct.get(r.product_id) ?? null;
      const existNet = r.existencias - r.reserved - (pending ?? 0);
      // undefined (no entry) and null (cleared) both fall back to the synced
      // transit; only a real number overrides it.
      const transOverride = transitoByProduct.get(r.product_id) ?? null;
      const trans = transOverride ?? r.transito;
      const adic = comercialByProduct.get(r.product_id)?.qty ?? 0;
      if (r.as_of > maxAsOf) maxAsOf = r.as_of;

      const engineRow: ProductRow = {
        cod: ref?.sku ?? `#${r.product_id}`,
        desc: ref?.name ?? '',
        prov: supplierByProduct.get(r.product_id) ?? '',
        exist: existNet,
        doh: 0,
        trans,
        sug: 0,
        p6: r.p6,
        p3: r.p3,
        h: r.h,
        adic,
        win: r.win === 10 ? 10 : 5,
      };
      return {
        productId: r.product_id,
        cod: engineRow.cod,
        desc: engineRow.desc,
        prov: engineRow.prov,
        exist: round1(existNet),
        existencias: round1(r.existencias),
        reserved: round1(r.reserved),
        patio: round1(r.patio),
        pending,
        trans: round1(trans),
        transOverridden: transOverride !== null,
        adic: round1(adic),
        p6: round1(r.p6),
        p3: round1(r.p3),
        // G4: the invoiced lens travels beside the ordered one and never
        // touches engineRow — the Sugerido stays ordered-driven (H1).
        f6: r.f6 === null ? null : round1(r.f6),
        f3: r.f3 === null ? null : round1(r.f3),
        h: round1(r.h),
        win: engineRow.win,
        doh: round1(doh(engineRow)),
        sug: round1(sugerido(engineRow, trans)),
        flags: {
          pendingUnknown: pending === null,
          seasonalLowConfidence: engineRow.win === 10 && r.h === 0,
        },
      };
    });

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

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
