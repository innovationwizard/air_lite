/**
 * Row building for the live reabastecimiento view — SHARED, never duplicated.
 *
 * Both the page (`GET /api/compras/reabastecimiento`) and the Carvajal xlsx
 * export read their numbers from here. That is deliberate: the override merge,
 * the pending-is-unknown-not-zero rule and the seasonal policy are business
 * rules, and this project has already paid for the same number being computed
 * two ways (the 2026-08-20 UoM bug shipped a page that disagreed with itself).
 * The engine module is likewise imported, never reimplemented.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  COBERTURA_DEFAULT_DIAS,
  type ProductRow,
  sugerido,
  doh,
} from '@/app/(authenticated)/compras/reabastecimiento/engine';
import {
  evaluarTendencia, evaluarDivergencia, evaluarAlerta, tieneReferenciaAnioAnterior,
  type Tendencia, type Divergencia, type Alerta,
} from '@/lib/compras/tendencia';
import {
  type DestinoDeclarado, destinoAfectaFila, transitoSegunDestino, ultimaPorProducto,
} from '@/lib/compras/destino';
import { GENERAL_BODEGA, fetchAll } from './lib';

/**
 * SEASONAL EXCEPTIONS — per-SKU, by explicit decision, NOT a rule.
 *
 * Wilmer's forecast is `(p6 + p3 + h) / 3 × 1.1`, where `h` is the same-month
 * figure from prior years (his workbook reads it from a `Vta 2020-2024` sheet).
 * The app sources it from Odoo's `sales.history`, whose coverage is thin:
 * measured 2026-08-20 for agosto, no product has 3 years of data, 493 have 2,
 * 255 have exactly 1 and 213 have none.
 *
 * Removing the term means the two-way mean `(p6 + p3) / 2` — NOT `h = 0`,
 * which would still divide by 3 and understate the forecast further.
 *
 * ⚠️ THE REGISTRY IS DELIBERATELY EMPTY (Jorge, 2026-08-21).
 * `77205049` lived here from 2026-08-20 and was REMOVED: a per-SKU override
 * silently rewrites how a number was produced, and it does not scale to the
 * 282 products the thin seasonal source distorts. It is replaced by the
 * NOTIFICATION Wilmer actually asked for — the rising-trend flag
 * (`@/lib/compras/tendencia`), which changes no number and hands him the
 * decision: *"yo voy a revisar ya mejor mi Odoo y yo digo: ah sí, este amerita
 * que le suba la punta."*
 *
 * Consequence, stated plainly: 77205049's Sugerido returns to its engine value.
 * Measured 2026-08-20 — on the snapshot Wilmer was looking at, 3,977 with the
 * term vs 5,019 without; on that day's live data, 5,039 vs 6,081. So the number
 * he called too LOW comes back, ~1,042 below what the override was showing.
 * It now carries the ▲ trend flag instead, so the correction becomes his,
 * visible, and per-product. Its measured monthly demand (General, feb→jul 2026:
 * 2,935 · 4,194 · 6,140 · 5,084 · 5,786 · 6,459) makes the last three months a
 * strict rise, so the flag fires on it. ⚠️ Per bodega, though: the series is
 * per product × bodega, so a bodega whose own last three months do not rise
 * will correctly show no flag on the same SKU.
 *
 * The mechanism stays because the escape hatch is worth having. Any future
 * entry must carry who decided it, when, and why — an entry that outlives its
 * reason is a silent lie about how a number was produced.
 */
const SEASONAL_EXCLUDED: Record<string, { desde: string; motivo: string }> = {};

interface InputRow {
  product_id: number;
  bodega: string;
  p6: number; p3: number; h: number;
  /** Month-to-date ordered demand + the days elapsed. Display only. */
  mtd: number | null; mtd_dias: number | null;
  /** G4 invoiced lens (Raquel's filter). NULL = not yet computed by the sync. Display only. */
  f6: number | null; f3: number | null;
  /** {'YYYY-MM': qty} over the 6 complete months. NULL = sync has not written it yet. */
  demanda_mensual: Record<string, number> | null;
  existencias: number; reserved: number;
  pending_reserve: number | null;
  patio: number; transito: number;
  win: number; as_of: string;
}
interface ProductRef { id: number; sku: string | null; name: string; category: string | null }
interface SupplierLink { product_id: number; supplier_id: number }
interface SupplierRef { id: number; name: string }
/** qty === null = a CLEAR entry: the manual capture was removed (20260813000001). */
interface OverrideRow { product_id: number; qty: number | null; created_at: string }
/** W15-A — `destino` null = declaración borrada. */
interface DestinoRow { product_id: number; destino: string | null; created_at: string }
interface ComercialRow {
  product_id: number; bodega: string | null; quantity: number;
  motivo: string; created_at: string;
}


export interface LiveRow {
  productId: number;
  cod: string; desc: string; prov: string; cat: string;
  exist: number; existencias: number; reserved: number; patio: number;
  pending: number | null;
  trans: number; transOverridden: boolean;
  /** W15-A — destino final declarado a mano (null = sin declarar). */
  destino: string | null;
  /** W15-A — la declaración está cambiando lo que se ve en ESTA bodega. */
  destinoProvisional: boolean;
  adic: number; adicComercial: number; sugBodega: number | null;
  p6: number; p3: number; h: number;
  f6: number | null; f3: number | null;
  mtd: number | null; mtdDias: number | null; mtdRitmo: number | null;
  win: number; doh: number; sug: number;
  tendencia: Tendencia;
  divergencia: Divergencia;
  alerta: Alerta;
  flags: {
    pendingUnknown: boolean; seasonalLowConfidence: boolean;
    seasonalExcluded: boolean; tendenciaCreciente: boolean;
    // Sube Y se despegó de su base: la conjunción, no dos banderas sueltas.
    // Ver el bloque DIVERGENCIA en lib/compras/tendencia.ts.
    revisar: boolean;
    // Informativo: no hay mes equivalente del año pasado con qué compararse.
    sinReferenciaAnioAnterior: boolean;
  };
  seasonalMotivo: string | null;
}

/** Everything the page and the export both need for one bodega. */
export async function buildRows(
  service: SupabaseClient,
  bodega: string,
): Promise<{ rows: LiveRow[]; maxAsOf: string; monthStart: string; coberturaDias: number }> {
    const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;

    const [inputs, products, links, suppliers, transitoOv, pendingOv, comercial, sugBodegaOv, cobertura,
           destinoDecl] =
      await Promise.all([
        fetchAll<InputRow>((a, b) =>
          service.from('reabastecimiento_inputs').select('*').eq('bodega', bodega).range(a, b)),
        fetchAll<ProductRef>((a, b) =>
          service.from('products').select('id, sku, name, category').range(a, b)),
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
        // A4.17 — el pedido adicional del encargado del CD, por bodega.
        // Append-only; `qty` NULL es un borrado, igual que en tránsito.
        fetchAll<OverrideRow>((a, b) =>
          service.from('sugerido_bodega').select('product_id, qty, created_at')
            .eq('bodega', bodega).order('created_at', { ascending: false }).range(a, b)),
        // Coverage horizon for THIS bodega — append-only, newest row wins.
        // No row is a real answer: it means the engine default (30 días).
        service.from('bodega_cobertura').select('dias')
          .eq('bodega', bodega).order('created_at', { ascending: false })
          .limit(1).maybeSingle(),
        // W15-A — la declaración es GLOBAL AL PRODUCTO, no por bodega: viendo
        // San José hay que saber que el producto fue declarado a Zacapa, o el
        // tránsito no se puede mover de una vista a otra.
        fetchAll<DestinoRow>((a, b) =>
          service.from('transito_destino').select('product_id, destino, created_at')
            .order('created_at', { ascending: false }).range(a, b)),
      ]);

    const coberturaDias = (cobertura?.data as { dias: number } | null)?.dias
      ?? COBERTURA_DEFAULT_DIAS;

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
    // A4.17 — el pedido adicional del encargado del CD. Misma mecánica
    // append-only y gana-la-última que tránsito y pendiente.
    const sugBodegaByProduct = latest(sugBodegaOv);
    const pendingByProduct = latest(pendingOv);
    const destinoByProduct = ultimaPorProducto(destinoDecl);
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
      /**
       * Tránsito — tres capas, de la más específica a la más general:
       *
       *   1. `transito_overrides` — la CANTIDAD que él teclea, ya por
       *      (producto × bodega). Manda sobre todo: es la herramienta más
       *      expresiva y no se puede pisar con la menos expresiva.
       *   2. W15-A — el DESTINO declarado a mano mueve el tránsito
       *      sincronizado a una sola bodega (y lo saca de las otras).
       *   3. el tránsito sincronizado tal como llega — que hoy es global y
       *      está replicado en las tres bodegas (W15-B lo corrige de raíz).
       *
       * undefined (sin entrada) y null (borrado) caen igual a la capa de
       * abajo; sólo un número real hace override.
       */
      const destino: DestinoDeclarado = destinoByProduct.get(r.product_id) ?? null;
      const transSync = transitoSegunDestino(bodega, destino, r.transito, GENERAL_BODEGA);
      const transOverride = transitoByProduct.get(r.product_id) ?? null;
      const trans = transOverride ?? transSync;
      const adicComercial = comercialByProduct.get(r.product_id)?.qty ?? 0;
      // A4.17 — el sugerido que pidió la bodega SE SUMA al término aditivo del
      // motor. Se suma acá y no dentro del motor a propósito: `engine.ts` está
      // verificado al 99.85% de paridad contra el libro y no se toca. Con cero
      // capturas, `adic` vale exactamente lo que valía antes.
      const sugBodega = sugBodegaByProduct.get(r.product_id) ?? 0;
      const adic = adicComercial + sugBodega;
      if (r.as_of > maxAsOf) maxAsOf = r.as_of;

      const cod = ref?.sku ?? `#${r.product_id}`;
      // Substituting h with the mean of p6 and p3 makes the three-way average
      // collapse to exactly (p6 + p3) / 2 — the seasonal term removed, with the
      // engine untouched.
      const seasonalExcluded = Boolean(SEASONAL_EXCLUDED[cod]);
      const hEffective = seasonalExcluded ? (r.p6 + r.p3) / 2 : r.h;
      // Display only — the trend NEVER touches engineRow. Wilmer asked to be
      // warned, not to have the number changed for him.
      const tendencia = evaluarTendencia(r.demanda_mensual);
      // Divergencia sobre p3/p6, NO sobre `h`: medido el 2026-09-01, la base
      // interanual daba 75% de divergencia mediana y 49% de cobertura.
      const divergencia = evaluarDivergencia(r.p3, r.p6);
      const alerta = evaluarAlerta(tendencia, divergencia);

      const engineRow: ProductRow = {
        cod,
        desc: ref?.name ?? '',
        prov: supplierByProduct.get(r.product_id) ?? '',
        exist: existNet,
        doh: 0,
        trans,
        sug: 0,
        p6: r.p6,
        p3: r.p3,
        h: hEffective,
        adic,
        win: r.win === 10 ? 10 : 5,
        coberturaDias,
      };
      return {
        productId: r.product_id,
        cod: engineRow.cod,
        desc: engineRow.desc,
        prov: engineRow.prov,
        // A6.11 — agrupar por categoría. Sale de `products.category`, medido al
        // 100% de cobertura el 2026-09-01 (0 de 1,670 activos sin categoría,
        // 32 distintas). NO viaja dentro de la fila del motor: el motor calcula
        // números y la categoría es de presentación; meterla ahí obligaría a
        // tocar el tipo que la página de paridad del xlsx también usa.
        // Sin categoría cae en «Sin categoría» en vez de desaparecer — un
        // producto que no se puede agrupar igual hay que comprarlo.
        cat: (productById.get(r.product_id)?.category ?? '').trim() || 'Sin categoría',
        exist: round1(existNet),
        existencias: round1(r.existencias),
        reserved: round1(r.reserved),
        patio: round1(r.patio),
        pending,
        trans: round1(trans),
        transOverridden: transOverride !== null,
        // W15-A — `destino` es lo declarado (null = sin declarar).
        // `destinoProvisional` marca las filas donde esa declaración está
        // cambiando lo que se ve, para poder rotularlas en pantalla: un número
        // equivocado que nadie ve es un bug; uno rotulado es un instrumento.
        destino,
        destinoProvisional: destinoAfectaFila(bodega, destino, GENERAL_BODEGA),
        adic: round1(adic),
        // Las dos fuentes viajan separadas a la pantalla: un aditivo que no
        // dice de dónde salió es un número que nadie puede defender.
        adicComercial: round1(adicComercial),
        sugBodega: sugBodegaByProduct.get(r.product_id) ?? null,
        p6: round1(r.p6),
        p3: round1(r.p3),
        // G4: the invoiced lens travels beside the ordered one and never
        // touches engineRow — the Sugerido stays ordered-driven (H1).
        f6: r.f6 === null ? null : round1(r.f6),
        f3: r.f3 === null ? null : round1(r.f3),
        // `h` reports what the sync actually measured; the exception is a
        // separate, visible flag — never a quietly rewritten number.
        h: round1(r.h),
        mtd: r.mtd === null ? null : round1(r.mtd),
        mtdDias: r.mtd_dias,
        mtdRitmo: r.mtd === null || !r.mtd_dias
          ? null
          : round1((r.mtd / r.mtd_dias) * 30),
        win: engineRow.win,
        doh: round1(doh(engineRow)),
        sug: round1(sugerido(engineRow, trans)),
        tendencia,
        divergencia,
        alerta,
        flags: {
          pendingUnknown: pending === null,
          seasonalLowConfidence: engineRow.win === 10 && r.h === 0,
          seasonalExcluded,
          tendenciaCreciente: tendencia.estado === 'creciente',
          revisar: alerta.estado === 'revisar',
          sinReferenciaAnioAnterior: !tieneReferenciaAnioAnterior(r.h),
        },
        seasonalMotivo: SEASONAL_EXCLUDED[cod]?.motivo ?? null,
      };
    });

  return { rows, maxAsOf, monthStart, coberturaDias };
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
