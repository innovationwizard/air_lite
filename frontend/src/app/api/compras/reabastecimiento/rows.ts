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
import { esBase, mesPorDefecto, sumaDirecto, type Motivo } from '@/lib/comercial/forecast';
import {
  evaluarTendencia, evaluarDivergencia, evaluarAlerta, tieneReferenciaAnioAnterior,
  type Tendencia, type Divergencia, type Alerta,
} from '@/lib/compras/tendencia';
import { fetchAll } from '@/lib/supabase/paginado';
import { round1 } from './lib';

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
interface ProductRef {
  id: number; sku: string | null; name: string; category: string | null;
  purchase_ok: boolean;
  /**
   * m³ por unidad, de `product.volume` de Odoo. NULL = nunca se midió — y se
   * propaga como null hasta el archivo, jamás como 0: un 0 diría que el
   * producto no ocupa espacio en el furgón. Medido el 2026-09-07: 1,115 de
   * 1,333 productos de esta página lo tienen (83.6%).
   */
  volume_m3: number | string | null;
}
interface SupplierLink { product_id: number; supplier_id: number }
interface SupplierRef { id: number; name: string }
interface SupplierGroupRef { id: string; display_name: string }
interface SupplierGroupMemberRef { supplier_id: number; group_id: string }
/** qty === null = a CLEAR entry: the manual capture was removed (20260813000001). */
interface OverrideRow { product_id: number; qty: number | null; created_at: string }
/** A6.15 — una entrada futura de tránsito: cuánto y cuándo. */
interface DetalleRow {
  product_id: number; fecha: string | null; qty: number; orden: string | null;
}
interface ComercialRow {
  product_id: number; bodega: string | null; quantity: number;
  motivo: string; area: string; created_at: string;
}


export interface LiveRow {
  productId: number;
  cod: string; desc: string; prov: string; cat: string;
  /** Grupo de proveedores (2026-09-04) — null si el proveedor no está agrupado. */
  provGroupId: string | null;
  /** Odoo product.template "Can be Purchased" — drives the solo-comprables filter. */
  purchaseOk: boolean;
  exist: number; existencias: number; reserved: number; patio: number;
  pending: number | null;
  trans: number; transOverridden: boolean;
  adic: number; adicComercial: number; sugBodega: number | null;
  /**
   * Forecast comercial que NO entra al pedido: `temporada` + `critico`, que
   * son proyección del canal y se discuten en la reunión. Viaja para poder
   * mostrarse, nunca para sumarse.
   */
  adicRevision: number;
  /**
   * QUIÉN pidió CUÁNTO, por canal comercial (slug → cantidades).
   *
   * Un total sin autor no se puede discutir: ante «Adic. 800», el comprador no
   * puede preguntarle a nadie por qué, ni el canal defender su número en la
   * reunión. Es la misma regla que ya separa `adicComercial` de `sugBodega`,
   * aplicada un nivel más adentro.
   */
  adicPorArea: Record<string, { directo: number; aRevision: number; base: number }>;
  transitoDetalle: { fecha: string | null; qty: number; orden: string | null }[];
  p6: number; p3: number; h: number;
  f6: number | null; f3: number | null;
  mtd: number | null; mtdDias: number | null; mtdRitmo: number | null;
  win: number; doh: number; sug: number;
  tendencia: Tendencia;
  divergencia: Divergencia;
  alerta: Alerta;
  /** ABC (Wilmer, 2026-09-03) — ver classifyAbc más abajo. */
  abc: 'A' | 'B' | 'C' | 'D';
  /** m³ por unidad. null = sin medir; nunca 0 por omisión. Ver ProductRef. */
  volM3: number | null;
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

/**
 * `products.volume_m3` es NUMERIC y PostgREST lo entrega como string. Sólo un
 * número finito y POSITIVO cuenta como medida: 0, vacío, null y cualquier cosa
 * no numérica son «sin medir», y viajan como null hasta la columna m³ del
 * archivo, que queda vacía en vez de mentir con un cero.
 */
export function volumenM3(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Forecast comercial de un mes, por producto: SUMA de las seis áreas, separando
 * lo que es compromiso de lo que es proyección.
 *
 * Dos reglas, y ninguna es nueva — ya estaban escritas en
 * `lib/comercial/forecast.ts` y en la migración 20260901000006. Lo que había
 * acá era de cuando `comercial_forecast` era append-only y la escribía un solo
 * comprador; con seis canales capturando dejó de servir:
 *
 *   1. SUMAR, no quedarse con la última. Hay una fila por (área, mes,
 *      producto), así que seis canales dejan seis filas del mismo código. El
 *      merge anterior se quedaba con la más reciente y descartaba en silencio
 *      las otras cinco: Mayoreo 500 + Tiendas 300 + Institucional 200 llegaba
 *      como 200, mientras el consolidado de /comercial/forecast mostraba
 *      1,000. El mismo dato, dos pantallas, dos números y ningún error.
 *   2. Sólo `extraordinaria` suma al pedido — es certeza con destinatario.
 *      `temporada` y `critico` son PROYECCIÓN del canal: se revisan en la
 *      reunión si superan la proyección de la app, y no entran solas al
 *      Sugerido. Sumarlas movía la compra sin que nadie la revisara, que es de
 *      donde salieron los 18 furgones de exceso — y el jefe de canal lo hacía
 *      leyendo en pantalla, literalmente, «se revisa en la reunión».
 *
 * Lo que queda a revisión se devuelve aparte: tiene que poder VERSE sin mover
 * el número.
 *
 * `bodega` null en la fila = todas las bodegas, que es como lo escribe la
 * pantalla de captura (el canal proyecta lo que va a vender, no dónde se
 * guarda).
 *
 * Función pura y exportada para poder probarla: es la regla que decide cuánto
 * se compra de más.
 */
export interface AporteComercial {
  directo: number;
  aRevision: number;
  /**
   * Recomendaciones aprobadas (`base`, nivel 2). Se ven y se comparan; no
   * entran a `adic` ni a la revisión: el cableado del forecast de canal al
   * Sugerido está en pausa (plan L2 §1 Q5), y sumarlas duplicaría la demanda
   * que p3/p6 ya traen.
   */
  base: number;
  /** slug del canal → lo que ese canal pidió. */
  porArea: Record<string, { directo: number; aRevision: number; base: number }>;
}

export function consolidarComercial(
  filas: ComercialRow[],
  bodega: string,
): Map<number, AporteComercial> {
  const porProducto = new Map<number, AporteComercial>();
  for (const c of filas) {
    if (c.bodega !== null && c.bodega !== bodega) continue;
    const acc = porProducto.get(c.product_id)
      ?? { directo: 0, aRevision: 0, base: 0, porArea: {} as AporteComercial['porArea'] };
    const canal = acc.porArea[c.area] ?? { directo: 0, aRevision: 0, base: 0 };
    if (sumaDirecto(c.motivo as Motivo)) {
      acc.directo += c.quantity;
      canal.directo += c.quantity;
    } else if (esBase(c.motivo as Motivo)) {
      acc.base += c.quantity;
      canal.base += c.quantity;
    } else {
      acc.aRevision += c.quantity;
      canal.aRevision += c.quantity;
    }
    acc.porArea[c.area] = canal;
    porProducto.set(c.product_id, acc);
  }
  return porProducto;
}

/** Everything the page and the export both need for one bodega. */
export async function buildRows(
  service: SupabaseClient,
  bodega: string,
): Promise<{
  rows: LiveRow[]; maxAsOf: string; monthStart: string; coberturaDias: number;
  groups: { id: string; displayName: string }[];
  /**
   * Los canales comerciales, para rotular y ORDENAR sus columnas.
   *
   * Vienen de la tabla y no de una lista en el código a propósito: la
   * migración 20260901000006 dejó dicho que un canal nuevo no debe necesitar
   * ni migración ni despliegue, y ya se agregaron dos (Zacapa y Petén) tres
   * días después de sembrar los primeros cuatro.
   */
  areasComerciales: { slug: string; nombre: string }[];
}> {
    // El mes cuyo forecast se está capturando, NO el mes del calendario.
    // `${new Date().toISOString().slice(0, 7)}-01` leía el mes en curso, así
    // que todo lo que los seis canales cargaran para octubre —el mes que este
    // ciclo existe para cubrir— era invisible acá hasta el 1 de octubre: dos
    // semanas después de la reunión que tenía que usarlo y con el pedido ya
    // puesto. Misma regla que abre la pantalla de captura, importada de un
    // solo lugar para que ambas no puedan discrepar.
    const monthStart = mesPorDefecto(new Date());

    const [inputs, products, links, suppliers, transitoOv, pendingOv, comercial, sugBodegaOv, detalleTr, cobertura,
           supplierGroups, supplierGroupMembers, areasCom] =
      await Promise.all([
        // El desempate por columna única de cada consulta NO ES OPCIONAL —
        // ver el comentario de `fetchAll` en ./lib.ts: sin él el paginado
        // repite una fila y pierde otra, en silencio.
        fetchAll<InputRow>(() =>
          service.from('reabastecimiento_inputs').select('*').eq('bodega', bodega), 'id'),
        fetchAll<ProductRef>(() =>
          service.from('products').select('id, sku, name, category, purchase_ok, volume_m3'), 'id'),
        // `id` es SERIAL, así que ordenar por él es el orden de inserción —
        // que es justo lo que asume «el primer link es el proveedor
        // principal» unas líneas más abajo. Antes lo daba por sentado sin
        // pedirlo; ahora lo pide.
        fetchAll<SupplierLink>(() =>
          service.from('product_suppliers').select('product_id, supplier_id'), 'id'),
        fetchAll<SupplierRef>(() =>
          service.from('suppliers').select('id, name'), 'id'),
        fetchAll<OverrideRow>(() =>
          service.from('transito_overrides').select('product_id, qty, created_at')
            .eq('bodega', bodega).order('created_at', { ascending: false }),
          { columna: 'id', ascending: false }),
        fetchAll<OverrideRow>(() =>
          service.from('pending_reserve_overrides').select('product_id, qty, created_at')
            .eq('bodega', bodega).order('created_at', { ascending: false }),
          { columna: 'id', ascending: false }),
        fetchAll<ComercialRow>(() =>
          service.from('comercial_forecast')
            .select('product_id, bodega, quantity, motivo, area, created_at')
            .eq('month', monthStart)
            .order('created_at', { ascending: false }),
          { columna: 'id', ascending: false }),
        // A4.17 — el pedido adicional del encargado del CD, por bodega.
        // Append-only; `qty` NULL es un borrado, igual que en tránsito.
        fetchAll<OverrideRow>(() =>
          service.from('sugerido_bodega').select('product_id, qty, created_at')
            .eq('bodega', bodega).order('created_at', { ascending: false }),
          { columna: 'id', ascending: false }),
        // A6.15 — el desglose por fecha del tránsito de ESTA bodega. Tabla
        // derivada: la reemplaza entera cada sincronización.
        fetchAll<DetalleRow>(() =>
          service.from('transito_detalle').select('product_id, fecha, qty, orden')
            .eq('bodega', bodega).order('fecha', { ascending: true }), 'id'),
        // Coverage horizon for THIS bodega — append-only, newest row wins.
        // No row is a real answer: it means the engine default (30 días).
        service.from('bodega_cobertura').select('dias')
          .eq('bodega', bodega).order('created_at', { ascending: false })
          .limit(1).maybeSingle(),
        // Grupos de proveedores (2026-09-04) — ver rows.ts §provGroupId abajo.
        fetchAll<SupplierGroupRef>(() =>
          service.from('supplier_groups').select('id, display_name'), 'id'),
        // `supplier_id` ES la primary key acá (un proveedor, a lo sumo un
        // grupo), así que es el desempate único de esta tabla.
        fetchAll<SupplierGroupMemberRef>(() =>
          service.from('supplier_group_members').select('supplier_id, group_id'), 'supplier_id'),
        // Catálogo de canales comerciales — seis filas hoy; el orden por
        // nombre es el orden de las columnas, para que no bailen entre cargas.
        service.from('comercial_areas').select('slug, nombre').eq('activa', true).order('nombre'),
      ]);
    const areasComerciales =
      (areasCom?.data as { slug: string; nombre: string }[] | null) ?? [];

    const coberturaDias = (cobertura?.data as { dias: number } | null)?.dias
      ?? COBERTURA_DEFAULT_DIAS;

    const productById = new Map(products.map((p) => [p.id, p]));
    const supplierById = new Map(suppliers.map((s) => [s.id, s.name]));
    // Grupos de proveedores (2026-09-04) — un proveedor pertenece a lo sumo a
    // un grupo (supplier_id es PK de supplier_group_members).
    const groupIdBySupplierId = new Map(supplierGroupMembers.map((m) => [m.supplier_id, m.group_id]));
    // First link per product = primary supplier (insertion order follows
    // supplierinfo sequence in the sync).
    const supplierByProduct = new Map<number, { name: string; groupId: string | null }>();
    for (const l of links) {
      if (!supplierByProduct.has(l.product_id)) {
        supplierByProduct.set(l.product_id, {
          name: supplierById.get(l.supplier_id) ?? '',
          groupId: groupIdBySupplierId.get(l.supplier_id) ?? null,
        });
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
    // A6.15 — agrupado por producto, ya ordenado por fecha desde la consulta.
    // Las entradas SIN fecha van al final: no se pueden usar para decidir
    // cuándo, y ponerlas primero fingiría una inminencia que no existe.
    const detallePorProducto = new Map<number, DetalleRow[]>();
    for (const d of detalleTr) {
      const l = detallePorProducto.get(d.product_id);
      if (l) l.push(d); else detallePorProducto.set(d.product_id, [d]);
    }
    for (const l of detallePorProducto.values()) {
      l.sort((a, b) => (a.fecha ?? '9999').localeCompare(b.fecha ?? '9999'));
    }
    const pendingByProduct = latest(pendingOv);
    // Suma de los seis canales, y sólo lo que es compromiso — ver
    // `consolidarComercial` arriba.
    const comercialByProduct = consolidarComercial(comercial, bodega);

    let maxAsOf = '';
    const rows = inputs.map((r) => {
      const ref = productById.get(r.product_id);
      const pending = pendingByProduct.get(r.product_id) ?? null;
      const existNet = r.existencias - r.reserved - (pending ?? 0);
      /**
       * Tránsito — dos capas, de la más específica a la más general:
       *
       *   1. `transito_overrides` — la CANTIDAD que él teclea, ya por
       *      (producto × bodega). Manda sobre todo: es la herramienta más
       *      expresiva y no se puede pisar con la menos expresiva.
       *   2. el tránsito sincronizado, ya POR BODEGA: `sync_transit()` lo
       *      atribuye por la sucursal de la orden de compra (c67ba1f,
       *      2026-09-08), así que cada vista ve sólo el suyo.
       *
       * Hubo una capa intermedia —«Destino final» declarado a mano, W15-A—
       * que movía el tránsito replicado a una sola bodega. Se retiró el
       * 2026-09-10 a pedido de Wilmer: con el tránsito ya atribuido por
       * sucursal, verlo bodega por bodega con el filtro de arriba la
       * reemplaza. La tabla `transito_destino` queda como historial; nadie
       * la lee.
       *
       * undefined (sin entrada) y null (borrado) caen igual a la capa de
       * abajo; sólo un número real hace override.
       */
      const transOverride = transitoByProduct.get(r.product_id) ?? null;
      const trans = transOverride ?? r.transito;
      const comercialFila = comercialByProduct.get(r.product_id);
      const adicComercial = comercialFila?.directo ?? 0;
      const adicRevision = comercialFila?.aRevision ?? 0;
      const adicPorArea = comercialFila?.porArea ?? {};
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
        prov: supplierByProduct.get(r.product_id)?.name ?? '',
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
        provGroupId: supplierByProduct.get(r.product_id)?.groupId ?? null,
        // A6.11 — agrupar por categoría. Sale de `products.category`, medido al
        // 100% de cobertura el 2026-09-01 (0 de 1,670 activos sin categoría,
        // 32 distintas). NO viaja dentro de la fila del motor: el motor calcula
        // números y la categoría es de presentación; meterla ahí obligaría a
        // tocar el tipo que la página de paridad del xlsx también usa.
        // Sin categoría cae en «Sin categoría» en vez de desaparecer — un
        // producto que no se puede agrupar igual hay que comprarlo.
        cat: (productById.get(r.product_id)?.category ?? '').trim() || 'Sin categoría',
        purchaseOk: productById.get(r.product_id)?.purchase_ok ?? true,
        // NUMERIC llega como string desde PostgREST; un Number('') sería 0 y
        // eso es justo lo que no puede pasar acá.
        volM3: volumenM3(productById.get(r.product_id)?.volume_m3),
        exist: round1(existNet),
        existencias: round1(r.existencias),
        reserved: round1(r.reserved),
        patio: round1(r.patio),
        pending,
        trans: round1(trans),
        transOverridden: transOverride !== null,
        adic: round1(adic),
        // Las dos fuentes viajan separadas a la pantalla: un aditivo que no
        // dice de dónde salió es un número que nadie puede defender.
        adicComercial: round1(adicComercial),
        adicRevision: round1(adicRevision),
        adicPorArea,
        sugBodega: sugBodegaByProduct.get(r.product_id) ?? null,
        transitoDetalle: (detallePorProducto.get(r.product_id) ?? [])
          .map((d) => ({ fecha: d.fecha, qty: round1(d.qty), orden: d.orden })),
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
        // Overwritten below by classifyAbc(); placeholder to satisfy LiveRow.
        abc: 'D' as const,
      };
    });

    classifyAbc(rows);

  return {
    rows, maxAsOf, monthStart, coberturaDias, areasComerciales,
    groups: supplierGroups.map((g) => ({ id: g.id, displayName: g.display_name })),
  };
}

/**
 * ABC (Wilmer, 2026-09-03) — clasificación por bodega sobre `p3` (Ord. 3m),
 * la cantidad ordenada en los últimos 3 meses en la unidad de stock de Odoo
 * de cada SKU (no siempre "caja" literal, pero es el proxy que ya existe en
 * esta tabla). D es un piso ABSOLUTO, no un porcentaje: por debajo de 10 es D
 * sin importar el ranking. Entre el resto, A/B/C son porcentaje ACUMULADO de
 * p3 ordenando de mayor a menor — 50/30/15. Como 50+30+15 = 95 y no 100, la
 * cola que sobra después de 95% NO se vuelve su propia categoría: se queda
 * en C (documentado así porque no es obvio de dónde sale ese último tramo).
 */
function classifyAbc(rows: LiveRow[]): void {
  const resto = rows.filter((r) => r.p3 >= 10);
  resto.sort((a, b) => b.p3 - a.p3);
  const total = resto.reduce((sum, r) => sum + r.p3, 0);
  let acumulado = 0;
  for (const r of resto) {
    acumulado += r.p3;
    const pct = total === 0 ? 0 : acumulado / total;
    r.abc = pct <= 0.5 ? 'A' : pct <= 0.8 ? 'B' : 'C';
  }
  for (const r of rows) {
    if (r.p3 < 10) r.abc = 'D';
  }
}
