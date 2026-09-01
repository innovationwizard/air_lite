import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_INVENTARIOS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { ModeloRow, VentasRow } from '@/app/(authenticated)/inventarios/reyma/engine';
import { computePdfTransito, type PdfTransito } from '@/app/(authenticated)/inventarios/reyma-vivo/saldos';
import type {
  EnlaceFactura,
  EtaConfigPayload,
  FacturaLinea,
  FacturaPdfLinea,
  NcConfig,
  OrdenGlobal,
  PedidoGuardado,
  PlanGuardado,
  ReymaVivoPayload,
  SyncIssue,
  TransitoDetalle,
  VivoRow,
} from '@/app/(authenticated)/inventarios/reyma-vivo/types';
import { DIAS_HABILES_DEFAULT, etaCalculada, resolverEta } from '@/app/(authenticated)/inventarios/reyma-vivo/eta';

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
// NC Duroport: lista medida (hoja NC del libro, 8 claves VT; Alexis 2026-08-04).
// La categoría ya no sirve de filtro: desde 2026-08-05 es x_studio_material.
const NC_CODIGOS = [
  '77201000', '77201035', '77201036', '77201039',
  '77201041', '77201046', '77201047', '77201064',
];
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
interface PendRowDb { codigo: string; cantidad: number; edad_dias: number | null; bodega_origen: string | null }
interface TransRowDb {
  codigo: string; po_name: string; fecha_planeada: string | null;
  cantidad_pendiente: number; destino: string | null;
  es_entrega_directa: boolean; es_fecha_pasada: boolean;
}
interface VentaRowDb { codigo: string; anio: number; mes: number; cajas: number; fuente: string; bodega: string }
interface OverrideRowDb { codigo: string; cajas: number | null; autor: string; created_at: string }
interface NcConfigRowDb {
  tarifa_usd: number; vigente_hasta: string | null; nota: string | null;
  autor: string; created_at: string;
}
interface NotaRowDb { po_name: string; eta: string | null; nota: string | null; autor: string; created_at: string }
interface FacturaRowDb {
  factura: string; fecha: string | null; referencia: string | null;
  tipo: 'factura' | 'nota_credito'; codigo: string; cantidad: number; precio_unit: number;
}
interface EtaConfigRowDb {
  destino: string; dias_habiles: number; autor: string; created_at: string;
}
interface PlanRowDb { semana: string; payload: unknown; autor: string; created_at: string }
interface PedidoRowDb { mes: string; payload: unknown; autor: string; created_at: string }
interface OrdenGlobalRowDb { mes: string; po_name: string; autor: string; created_at: string }
interface PoLineaRowDb {
  po_name: string; codigo: string; cajas: number; recibidas: number; precio_unit: number | null;
}
interface FacturaPdfRowDb {
  folio_fiscal: string; factura: string; guia: string | null; destino: string | null;
  fecha: string; eta: string | null; codigo: string; clave: string;
  cantidad: number; precio_unit: number;
}
/** N14: enlace persistido PDF ↔ Odoo (append-only, última fila por par manda). */
interface MatchRowDb {
  folio_fiscal: string; factura: string; odoo_factura: string;
  tier: number; regla: string; estado: string; autor: string; created_at: string;
}

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

/** Parámetros por modelo. NULL = nadie lo ha declarado; no se sustituye. */
interface ModeloProveedorDb {
  slug: string; nombre: string; provisional: boolean;
  capacidad_m3: number | null; max_furgones_dia: number | null;
  furgones_semana: number | null; dias_despacho: string[] | null;
  cod_comodin: string | null; desc_comodin: string | null;
  semanas_seguridad: number | null; lead_time_dias: number | null;
  objetivo_semanas: number | null; alzas_precio_anio: number | null;
  notas: string | null;
}

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_INVENTARIOS);
  if (auth instanceof Response) return auth;

  // A4.26 — el modelo que se está mirando. El MOTOR es el mismo para todos
  // («Es el mismo», 13-ago); lo que cambia es el alcance de códigos y los
  // parámetros. `reyma` por defecto, así que la ruta se comporta exactamente
  // como antes para quien no pide otra cosa.
  const modelo = (new URL(request.url).searchParams.get('modelo') ?? 'reyma').trim() || 'reyma';

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

    // Parámetros del modelo. Ausente = se cae a las constantes de Reyma, que es
    // lo que regía antes de que esta tabla existiera.
    const { data: modeloCfgRaw } = await service
      .from('modelo_proveedor')
      .select('slug, nombre, provisional, capacidad_m3, max_furgones_dia, furgones_semana, '
        + 'dias_despacho, cod_comodin, desc_comodin, semanas_seguridad, lead_time_dias, '
        + 'objetivo_semanas, alzas_precio_anio, notas')
      .eq('slug', modelo).maybeSingle();
    const modeloCfg = modeloCfgRaw as ModeloProveedorDb | null;

    const [products, stock, pendientes, transito, ventas, issuesRaw] = await Promise.all([
      fetchAll<ProductRowDb>((a, b) =>
        service.from('reyma_products')
          .select('codigo, clave, nombre_odoo, descripcion, categoria, categoria_fuente, cubicaje, precio_factura, activo')
          .eq('en_alcance', true).eq('modelo', modelo).order('codigo').range(a, b)),
      fetchAll<StockRowDb>((a, b) =>
        service.from('reyma_stock').select('codigo, bodega, cantidad')
          .eq('sync_id', run.id).range(a, b)),
      fetchAll<PendRowDb>((a, b) =>
        service.from('reyma_pendientes').select('codigo, cantidad, edad_dias, bodega_origen')
          .eq('sync_id', run.id).range(a, b)),
      fetchAll<TransRowDb>((a, b) =>
        service.from('reyma_transito')
          .select('codigo, po_name, fecha_planeada, cantidad_pendiente, destino, es_entrega_directa, es_fecha_pasada')
          .eq('sync_id', run.id).range(a, b)),
      fetchAll<VentaRowDb>((a, b) =>
        service.from('reyma_ventas_mensuales').select('codigo, anio, mes, cajas, fuente, bodega').range(a, b)),
      fetchAll<SyncIssue & { sync_id: string }>((a, b) =>
        service.from('sync_issues').select('severity, entity, message, sync_id')
          .eq('sync_id', run.id).range(a, b)),
    ]);

    // ── L3 write-path state (append-only history; latest row wins)
    const [overridesRaw, ncRaw, notasRaw, facturasRaw, planesRaw, pedidosRaw, ordenGlobalRaw, poLineasRaw, facturasPdfRaw, etaConfigRaw, matchRaw] = await Promise.all([
      fetchAll<OverrideRowDb>((a, b) =>
        service.from('reyma_proyeccion_overrides')
          .select('codigo, cajas, autor, created_at')
          .order('created_at', { ascending: false }).range(a, b)),
      service.from('reyma_nc_config')
        .select('tarifa_usd, vigente_hasta, nota, autor, created_at')
        .order('created_at', { ascending: false }).limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return (data ?? []) as NcConfigRowDb[];
        }),
      fetchAll<NotaRowDb>((a, b) =>
        service.from('reyma_furgon_notas')
          .select('po_name, eta, nota, autor, created_at')
          .order('created_at', { ascending: false }).range(a, b)),
      fetchAll<FacturaRowDb>((a, b) =>
        service.from('reyma_facturas')
          .select('factura, fecha, referencia, tipo, codigo, cantidad, precio_unit')
          .eq('sync_id', run.id).range(a, b)),
      service.from('reyma_plan_despacho')
        .select('semana, payload, autor, created_at')
        .order('created_at', { ascending: false }).limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return (data ?? []) as PlanRowDb[];
        }),
      service.from('reyma_pedido_mensual')
        .select('mes, payload, autor, created_at')
        .order('created_at', { ascending: false }).limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return (data ?? []) as PedidoRowDb[];
        }),
      service.from('reyma_orden_global')
        .select('mes, po_name, autor, created_at')
        .order('mes', { ascending: false }).order('created_at', { ascending: false }).limit(1)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message);
          return (data ?? []) as OrdenGlobalRowDb[];
        }),
      fetchAll<PoLineaRowDb>((a, b) =>
        service.from('reyma_po_lineas')
          .select('po_name, codigo, cajas, recibidas, precio_unit')
          .eq('sync_id', run.id).range(a, b)),
      fetchAll<FacturaPdfRowDb>((a, b) =>
        service.from('reyma_facturas_pdf')
          .select('folio_fiscal, factura, guia, destino, fecha, eta, codigo, clave, cantidad, precio_unit')
          .range(a, b)),
      fetchAll<EtaConfigRowDb>((a, b) =>
        service.from('reyma_eta_config')
          .select('destino, dias_habiles, autor, created_at')
          .order('created_at', { ascending: false }).range(a, b)),
      fetchAll<MatchRowDb>((a, b) =>
        service.from('reyma_factura_match')
          .select('folio_fiscal, factura, odoo_factura, tier, regla, estado, autor, created_at')
          .order('created_at', { ascending: false }).range(a, b)),
    ]);

    // ETA config: última fila por destino manda (append-only, mismo patrón que
    // los overrides). Default del módulo si un destino no tiene fila.
    const etaPorDestino: Record<string, number> = {};
    const etaDetalle: EtaConfigPayload['detalle'] = [];
    for (const c of etaConfigRaw) {
      if (etaPorDestino[c.destino] !== undefined) continue; // primera = más reciente
      etaPorDestino[c.destino] = c.dias_habiles;
      etaDetalle.push({
        destino: c.destino, diasHabiles: c.dias_habiles,
        autor: c.autor, fecha: c.created_at,
      });
    }
    const etaConfig: EtaConfigPayload = {
      porDestino: etaPorDestino,
      default: DIAS_HABILES_DEFAULT,
      detalle: etaDetalle.sort((x, y) => x.destino.localeCompare(y.destino)),
    };
    const overrideByCod = new Map<string, OverrideRowDb>();
    for (const o of overridesRaw) {
      if (!overrideByCod.has(o.codigo)) overrideByCod.set(o.codigo, o); // first = latest
    }
    const notaByPo = new Map<string, NotaRowDb>();
    for (const n of notasRaw) {
      if (!notaByPo.has(n.po_name)) notaByPo.set(n.po_name, n);
    }

    // ── ventas: stitch sources (sale_order wins from 2024-10; sales_history before)
    const soIdx = new Map<string, number>();
    const shIdx = new Map<string, number>();
    const soBodIdx = new Map<string, number>(); // `${codigo}|${anio}|${mes}|${bodega}` (L3.5)
    for (const v of ventas) {
      if (v.bodega && v.bodega !== 'GLOBAL') {
        if (v.fuente === 'sale_order') soBodIdx.set(`${v.codigo}|${v.anio}|${v.mes}|${v.bodega}`, v.cajas);
        continue;
      }
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
    const BODEGAS_REGIONALES = ['SJ', 'Z11', 'PET', 'ZAC'];
    const proyeccionPorBodega = (codigo: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const b of BODEGAS_REGIONALES) {
        const vals = mesesCompletos.map(([a, m]) => soBodIdx.get(`${codigo}|${a}|${m}|${b}`) ?? 0);
        out[b] = Math.round(vals.reduce((x, y) => x + y, 0) / vals.length);
      }
      return out;
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
    const psxBod = new Map<string, Record<string, number>>();
    for (const p of pendientes) {
      psxTotal.set(p.codigo, (psxTotal.get(p.codigo) ?? 0) + p.cantidad);
      if (p.edad_dias !== null && p.edad_dias <= MAX_EDAD_PENDIENTES_DIAS) {
        psxContada.set(p.codigo, (psxContada.get(p.codigo) ?? 0) + p.cantidad);
        const bod = p.bodega_origen;
        if (bod) {
          const cur = psxBod.get(p.codigo) ?? {};
          cur[bod] = (cur[bod] ?? 0) + p.cantidad;
          psxBod.set(p.codigo, cur);
        }
      }
    }
    const transitoNormal = new Map<string, number>();
    const transitoDirecta = new Map<string, number>();
    const transitoBod = new Map<string, Record<string, number>>();
    for (const t of transito) {
      const target = t.es_entrega_directa ? transitoDirecta : transitoNormal;
      target.set(t.codigo, (target.get(t.codigo) ?? 0) + t.cantidad_pendiente);
      if (!t.es_entrega_directa && t.destino) {
        const cur = transitoBod.get(t.codigo) ?? {};
        cur[t.destino] = (cur[t.destino] ?? 0) + t.cantidad_pendiente;
        transitoBod.set(t.codigo, cur);
      }
    }

    // PDF-implied tránsito (Alexis' rule with the merged facturado source —
    // the mail facturas run days ahead of Odoo's vendor bills; see saldos.ts).
    // Global column only: per-bodega MRP keeps Odoo-only tránsito until the
    // pdf destino → bodega-key mapping is confirmed with Alexis.
    const ogForTransito = ordenGlobalRaw[0];
    const pdfTransito = ogForTransito
      ? computePdfTransito(
          ogForTransito.po_name,
          ogForTransito.mes.slice(0, 7),
          poLineasRaw,
          transito.map((t) => ({ po_name: t.po_name, codigo: t.codigo, cantidad_pendiente: t.cantidad_pendiente })),
          // Tres fechas, a propósito: `eta` es la EFECTIVA (manual > calculada,
          // Lote 1) para que el tránsito muestre la fecha buena aunque nadie la
          // haya tecleado; `etaManual` y `etaCalculada` la desarman para poder
          // mostrarlas lado a lado (decisión 2026-08-25).
          facturasPdfRaw.map((f) => ({
            folioFiscal: f.folio_fiscal, factura: f.factura, guia: f.guia, destino: f.destino,
            fecha: f.fecha,
            eta: resolverEta({ fecha: f.fecha, destino: f.destino, eta: f.eta }, etaConfig).fecha,
            etaManual: f.eta,
            etaCalculada: etaCalculada({ fecha: f.fecha, destino: f.destino }, etaConfig),
            codigo: f.codigo, clave: f.clave,
            cantidad: f.cantidad, precioUnit: f.precio_unit,
          })),
        )
      : new Map<string, PdfTransito>();

    const rows: VivoRow[] = products.map((p) => {
      const st = stockIdx.get(p.codigo) ?? {};
      const ov = overrideByCod.get(p.codigo);
      const tieneOverride = ov !== undefined && ov.cajas !== null;
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
        transito: (transitoNormal.get(p.codigo) ?? 0) + (pdfTransito.get(p.codigo)?.cantidad ?? 0),
        proyeccion: tieneOverride ? (ov.cajas as number) : proyeccionDefault(p.codigo),
        proyOverride: tieneOverride,
        ventaPend: 0,
        descAniv: null,
      };
      return {
        ...base,
        entregaDirecta: transitoDirecta.get(p.codigo) ?? 0,
        psxTotal: psxTotal.get(p.codigo) ?? 0,
        categoriaEsFallback: p.categoria_fuente === 'xlsx',
        proyeccionInfo: tieneOverride ? { autor: ov.autor, fecha: ov.created_at } : null,
        psxPorBodega: psxBod.get(p.codigo) ?? {},
        transitoPorDestino: transitoBod.get(p.codigo) ?? {},
        proyeccionPorBodega: proyeccionPorBodega(p.codigo),
      };
    });

    const transitoDetalle: TransitoDetalle[] = transito.map((t) => {
      const nota = notaByPo.get(t.po_name);
      return {
        codigo: t.codigo,
        poName: t.po_name,
        fechaPlaneada: t.fecha_planeada,
        cantidad: t.cantidad_pendiente,
        destino: t.destino,
        esEntregaDirecta: t.es_entrega_directa,
        esFechaPasada: t.es_fecha_pasada,
        eta: nota?.eta ?? null,
        // Las filas de tránsito de Odoo NO salen de una factura PDF, así que no
        // hay fecha impresa de la que calcular: la columna «ETA App» queda
        // vacía en vez de inventar una.
        etaCalculada: null,
        nota: nota?.nota ?? null,
        notaAutor: nota?.autor ?? null,
      };
    });
    // Synthetic detail rows for the PDF-implied tránsito, so the Datos tab
    // shows provenance (which cajas come from mail facturas not yet in Odoo).
    for (const [codigo, t] of pdfTransito) {
      transitoDetalle.push({
        codigo,
        poName: `${ogForTransito!.po_name} · facturas PDF`,
        fechaPlaneada: null,
        cantidad: t.cantidad,
        destino: t.destinos.join(', ') || null,
        esEntregaDirecta: false,
        esFechaPasada: false,
        eta: t.etaManual,
        etaCalculada: t.etaCalculada,
        nota: 'Facturado en PDF del proveedor, aún no registrado en Odoo',
        notaAutor: null,
      });
    }

    const ncRow = ncRaw[0];
    const ncConfig: NcConfig = ncRow
      ? {
          tarifaUsd: ncRow.tarifa_usd,
          vigenteHasta: ncRow.vigente_hasta,
          nota: ncRow.nota,
          autor: ncRow.autor,
          fecha: ncRow.created_at,
        }
      : { tarifaUsd: 0.41, vigenteHasta: null, nota: null, autor: 'default', fecha: '' };

    const facturasOut: FacturaLinea[] = facturasRaw.map((f) => ({
      factura: f.factura,
      fecha: f.fecha,
      referencia: f.referencia,
      tipo: f.tipo,
      codigo: f.codigo,
      cantidad: f.cantidad,
      precioUnit: f.precio_unit,
    }));

    const planRow = planesRaw[0];
    const ultimoPlan: PlanGuardado | null = planRow
      ? { semana: planRow.semana, autor: planRow.autor, fecha: planRow.created_at, payload: planRow.payload }
      : null;
    const pedidoRow = pedidosRaw[0];
    const ultimoPedido: PedidoGuardado | null = pedidoRow
      ? { mes: pedidoRow.mes, autor: pedidoRow.autor, fecha: pedidoRow.created_at, payload: pedidoRow.payload }
      : null;

    // C7 baseline: the configured monthly global PO + its synced lines.
    const ogRow = ordenGlobalRaw[0];
    const ordenGlobal: OrdenGlobal | null = ogRow
      ? {
          mes: ogRow.mes,
          poName: ogRow.po_name,
          autor: ogRow.autor,
          fecha: ogRow.created_at,
          lineas: poLineasRaw
            .filter((l) => l.po_name === ogRow.po_name)
            .map((l) => ({
              codigo: l.codigo, cajas: l.cajas, recibidas: l.recibidas, precioUnit: l.precio_unit,
            })),
        }
      : null;
    // N14 — enlaces vigentes: la última fila por par (folio, bill) manda, y los
    // rechazos NO se publican como enlace (vetan el par, no lo crean). La cola
    // de excepciones la calcula el cliente con el mismo motor puro.
    const enlaceVisto = new Set<string>();
    const enlacesFactura: EnlaceFactura[] = [];
    for (const m of matchRaw) {
      const k = `${m.folio_fiscal}|${m.odoo_factura}`;
      if (enlaceVisto.has(k)) continue; // primera = más reciente
      enlaceVisto.add(k);
      enlacesFactura.push({
        folioFiscal: m.folio_fiscal, factura: m.factura, odooFactura: m.odoo_factura,
        tier: m.tier as EnlaceFactura['tier'], regla: m.regla,
        estado: m.estado as EnlaceFactura['estado'], autor: m.autor, fecha: m.created_at,
      });
    }

    const facturasPdf: FacturaPdfLinea[] = facturasPdfRaw.map((f) => ({
      folioFiscal: f.folio_fiscal, factura: f.factura, guia: f.guia, destino: f.destino,
      fecha: f.fecha, eta: f.eta, codigo: f.codigo, clave: f.clave,
      cantidad: f.cantidad, precioUnit: f.precio_unit,
    }));

    const payload: ReymaVivoPayload = {
      sync: {
        id: run.id,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        counts: (run.counts ?? {}) as Record<string, number>,
      },
      // A4.26 — los parámetros del modelo que se está mirando.
      //
      // Las constantes de abajo son las de Reyma y siguen siendo el piso: el
      // motor tiene que seguir dando los MISMOS números con los que se midió la
      // paridad de 2,752 celdas. Lo que llega de `modelo_proveedor` las
      // sobreescribe SÓLO cuando tiene valor; un parámetro en NULL viaja como
      // null y la pantalla lo muestra como «sin definir», que es la verdad —
      // nadie lo ha declarado todavía para ese proveedor.
      modelo: {
        slug: modeloCfg?.slug ?? 'reyma',
        nombre: modeloCfg?.nombre ?? 'Reyma',
        provisional: modeloCfg?.provisional ?? false,
        furgonesSemana: modeloCfg?.furgones_semana ?? null,
        maxFurgonesDia: modeloCfg?.max_furgones_dia ?? null,
        diasDespacho: modeloCfg?.dias_despacho ?? null,
        semanasSeguridad: modeloCfg?.semanas_seguridad ?? null,
        leadTimeDias: modeloCfg?.lead_time_dias ?? null,
        objetivoSemanas: modeloCfg?.objetivo_semanas ?? null,
        alzasPrecioAnio: modeloCfg?.alzas_precio_anio ?? null,
        descComodin: modeloCfg?.desc_comodin ?? null,
        notas: modeloCfg?.notas ?? null,
      },
      config: {
        capacidadM3: modeloCfg?.capacidad_m3 ?? CAPACIDAD_M3,
        codFurgonCompleto: modeloCfg?.cod_comodin ?? COD_FURGON_COMPLETO,
        mesesPromedioMovil: MESES_PROMEDIO_MOVIL,
        maxEdadPendientesDias: MAX_EDAD_PENDIENTES_DIAS,
        ncCodigos: NC_CODIGOS,
      },
      rows,
      ventas: ventasRows,
      transitoDetalle,
      issues: issuesRaw.map(({ severity, entity, message }) => ({ severity, entity, message })),
      facturas: facturasOut,
      ncConfig,
      ultimoPlan,
      ultimoPedido,
      ordenGlobal,
      facturasPdf,
      enlacesFactura,
      etaConfig,
    };
    return NextResponse.json(payload);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'error desconocido';
    return NextResponse.json({ error: `No se pudo armar el modelo vivo: ${message}` }, { status: 500 });
  }
}
