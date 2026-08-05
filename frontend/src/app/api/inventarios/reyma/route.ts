import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_INVENTARIOS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { ModeloRow, VentasRow } from '@/app/(authenticated)/inventarios/reyma/engine';
import type {
  ReymaVivoPayload,
  SyncIssue,
  TransitoDetalle,
  VivoRow,
} from '@/app/(authenticated)/inventarios/reyma-vivo/types';

export const dynamic = 'force-dynamic';

/**
 * GET /api/inventarios/reyma — the LIVE Reyma model (Alexis / Inventarios).
 *
 * Assembles the phase-1 engine's input shape from the latest successful
 * `reyma_*` sync (ml/odoo_sync_reyma.py). The engine itself runs client-side —
 * imported, never reimplemented — so this route only resolves DATA rules, all
 * measured/confirmed (docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md):
 *
 *  - psx (pendientes por surtir) counts ONLY rows with edad <= 8 días (rule 3);
 *    the unfiltered total is returned alongside for transparency.
 *  - transito excludes entregas directas (destino Z11, rule 6) — those are a
 *    separate visible column, exactly like Alexis' SALDOS distinguishes them.
 *  - proyección default = promedio móvil of the last N complete months
 *    (N=2, Alexis: "sobre dos meses... se miraban aterrizaditos"; abierto a 3).
 *    Editable client-side; persistence lands in L3.
 *  - ventas stitched per source-resolution rule: sale_order (qty_delivered)
 *    wins where it has data (>= 2024-10); sales_history (SAE) fills earlier
 *    months. Documented deviation: mean Δ 72.8 cajas on overlap.
 *
 * RBAC: middleware check_route_access (migration 20260805000002) +
 * in-handler requireAuth(CAN_VIEW_INVENTARIOS).
 */

const MESES_PROMEDIO_MOVIL = 2;
const MAX_EDAD_PENDIENTES_DIAS = 8;
const CAPACIDAD_M3 = 100;
const COD_FURGON_COMPLETO = '77201046';
const SALE_ORDER_DESDE = { anio: 2024, mes: 10 }; // probe: sale.order.line starts 2024-10

interface ProductRowDb {
  codigo: string;
  clave: string | null;
  nombre_odoo: string | null;
  descripcion: string | null;
  categoria: string;
  categoria_fuente: string;
  cubicaje: number;
  precio_factura: number | null;
  activo: boolean;
}
interface StockRowDb { codigo: string; bodega: string; cantidad: number }
interface PendRowDb { codigo: string; cantidad: number; edad_dias: number | null }
interface TransRowDb {
  codigo: string; po_name: string; fecha_planeada: string | null;
  cantidad_pendiente: number; destino: string | null;
  es_entrega_directa: boolean; es_fecha_pasada: boolean;
}
interface VentaRowDb { codigo: string; anio: number; mes: number; cajas: number; fuente: string }

async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  page = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await query(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

export async function GET() {
  const auth = await requireAuth(CAN_VIEW_INVENTARIOS);
  if (auth instanceof Response) return auth;

  const service = createServiceRoleClient();
  try {
    const { data: runs, error: runErr } = await service
      .from('sync_runs')
      .select('id, started_at, finished_at, counts')
      .eq('kind', 'reyma')
      .eq('status', 'success')
      .order('started_at', { ascending: false })
      .limit(1);
    if (runErr) throw new Error(runErr.message);
    if (!runs?.length) {
      return NextResponse.json(
        { error: 'Sin sincronización Reyma exitosa todavía — correr ml/odoo_sync_reyma.py' },
        { status: 503 },
      );
    }
    const run = runs[0];

    const [products, stock, pendientes, transito, ventas, issuesRaw] = await Promise.all([
      fetchAll<ProductRowDb>((a, b) =>
        service.from('reyma_products')
          .select('codigo, clave, nombre_odoo, descripcion, categoria, categoria_fuente, cubicaje, precio_factura, activo')
          .eq('en_alcance', true).order('codigo').range(a, b)),
      fetchAll<StockRowDb>((a, b) =>
        service.from('reyma_stock').select('codigo, bodega, cantidad')
          .eq('sync_id', run.id).range(a, b)),
      fetchAll<PendRowDb>((a, b) =>
        service.from('reyma_pendientes').select('codigo, cantidad, edad_dias')
          .eq('sync_id', run.id).range(a, b)),
      fetchAll<TransRowDb>((a, b) =>
        service.from('reyma_transito')
          .select('codigo, po_name, fecha_planeada, cantidad_pendiente, destino, es_entrega_directa, es_fecha_pasada')
          .eq('sync_id', run.id).range(a, b)),
      fetchAll<VentaRowDb>((a, b) =>
        service.from('reyma_ventas_mensuales').select('codigo, anio, mes, cajas, fuente').range(a, b)),
      fetchAll<SyncIssue & { sync_id: string }>((a, b) =>
        service.from('sync_issues').select('severity, entity, message, sync_id')
          .eq('sync_id', run.id).range(a, b)),
    ]);

    // ── ventas: stitch sources (sale_order wins from 2024-10; sales_history before)
    const soIdx = new Map<string, number>();
    const shIdx = new Map<string, number>();
    for (const v of ventas) {
      const k = `${v.codigo}|${v.anio}|${v.mes}`;
      if (v.fuente === 'sale_order') soIdx.set(k, v.cajas);
      else shIdx.set(k, v.cajas);
    }
    const mesVenta = (codigo: string, anio: number, mes: number): number => {
      const k = `${codigo}|${anio}|${mes}`;
      const soHasData = anio > SALE_ORDER_DESDE.anio ||
        (anio === SALE_ORDER_DESDE.anio && mes >= SALE_ORDER_DESDE.mes);
      if (soHasData) return soIdx.get(k) ?? 0;
      return shIdx.get(k) ?? 0;
    };
    const now = new Date();
    const anioActual = now.getUTCFullYear();
    const mesActual = now.getUTCMonth() + 1;
    const ventasRows: VentasRow[] = products.map((p) => ({
      cod: p.codigo,
      clave: p.clave ?? '',
      prodReyma: p.nombre_odoo ?? '',
      desc: p.descripcion ?? '',
      v2024: Array.from({ length: 12 }, (_, i) => mesVenta(p.codigo, 2024, i + 1)),
      v2025: Array.from({ length: 12 }, (_, i) => mesVenta(p.codigo, 2025, i + 1)),
      v2026: Array.from({ length: mesActual }, (_, i) => mesVenta(p.codigo, 2026, i + 1)),
    }));

    // proyección default: promedio móvil de los últimos N meses COMPLETOS
    const mesesCompletos: Array<[number, number]> = [];
    for (let back = 1; back <= MESES_PROMEDIO_MOVIL; back++) {
      const d = new Date(Date.UTC(anioActual, mesActual - 1 - back, 1));
      mesesCompletos.push([d.getUTCFullYear(), d.getUTCMonth() + 1]);
    }
    const proyeccionDefault = (codigo: string): number => {
      const vals = mesesCompletos.map(([a, m]) => mesVenta(codigo, a, m));
      return Math.round(vals.reduce((x, y) => x + y, 0) / vals.length);
    };

    // ── stock / pendientes / tránsito aggregation per código
    const stockIdx = new Map<string, Record<string, number>>();
    for (const s of stock) {
      const cur = stockIdx.get(s.codigo) ?? {};
      cur[s.bodega] = (cur[s.bodega] ?? 0) + s.cantidad;
      stockIdx.set(s.codigo, cur);
    }
    const psxContada = new Map<string, number>();
    const psxTotal = new Map<string, number>();
    for (const p of pendientes) {
      psxTotal.set(p.codigo, (psxTotal.get(p.codigo) ?? 0) + p.cantidad);
      if (p.edad_dias !== null && p.edad_dias <= MAX_EDAD_PENDIENTES_DIAS) {
        psxContada.set(p.codigo, (psxContada.get(p.codigo) ?? 0) + p.cantidad);
      }
    }
    const transitoNormal = new Map<string, number>();
    const transitoDirecta = new Map<string, number>();
    for (const t of transito) {
      const target = t.es_entrega_directa ? transitoDirecta : transitoNormal;
      target.set(t.codigo, (target.get(t.codigo) ?? 0) + t.cantidad_pendiente);
    }

    const rows: VivoRow[] = products.map((p) => {
      const st = stockIdx.get(p.codigo) ?? {};
      const base: ModeloRow = {
        cod: p.codigo,
        clave: p.clave ?? '',
        prodReyma: p.nombre_odoo ?? '',
        desc: p.descripcion ?? '',
        cat: p.categoria,
        cub: p.cubicaje,
        precio: p.precio_factura ?? 0,
        sj: st['SJ'] ?? 0,
        z11: st['Z11'] ?? 0,
        pet: st['PET'] ?? 0,
        zac: st['ZAC'] ?? 0,
        pat: st['PAT'] ?? 0,
        psx: psxContada.get(p.codigo) ?? 0,
        transito: transitoNormal.get(p.codigo) ?? 0,
        proyeccion: proyeccionDefault(p.codigo),
        proyOverride: false,
        ventaPend: 0,
        descAniv: null,
      };
      return {
        ...base,
        entregaDirecta: transitoDirecta.get(p.codigo) ?? 0,
        psxTotal: psxTotal.get(p.codigo) ?? 0,
        categoriaEsFallback: p.categoria_fuente === 'xlsx',
      };
    });

    const transitoDetalle: TransitoDetalle[] = transito.map((t) => ({
      codigo: t.codigo,
      poName: t.po_name,
      fechaPlaneada: t.fecha_planeada,
      cantidad: t.cantidad_pendiente,
      destino: t.destino,
      esEntregaDirecta: t.es_entrega_directa,
      esFechaPasada: t.es_fecha_pasada,
    }));

    const payload: ReymaVivoPayload = {
      sync: {
        id: run.id,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        counts: (run.counts ?? {}) as Record<string, number>,
      },
      config: {
        capacidadM3: CAPACIDAD_M3,
        codFurgonCompleto: COD_FURGON_COMPLETO,
        mesesPromedioMovil: MESES_PROMEDIO_MOVIL,
        maxEdadPendientesDias: MAX_EDAD_PENDIENTES_DIAS,
      },
      rows,
      ventas: ventasRows,
      transitoDetalle,
      issues: issuesRaw.map(({ severity, entity, message }) => ({ severity, entity, message })),
    };
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error desconocido';
    return NextResponse.json({ error: `No se pudo armar el modelo vivo: ${message}` }, { status: 500 });
  }
}
