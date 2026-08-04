/**
 * Reyma replica engine — Alexis' `ADMINISTRACION INV REYMA JULIO 2026` workbook,
 * ported VERBATIM from the measured formulas (20260804/DEEP-MANIFEST-XLSX.md).
 *
 * Parity: the Python extraction (docs/inventarios/extract_reyma_replica.py)
 * reproduces 2,752/2,752 derived cells against Alexis' cached values; this
 * module mirrors those functions 1:1 and is tested against the same frozen
 * fixture (docs/inventarios/fixtures/parity_reyma_20260804.csv) in
 * __tests__/engine.test.ts. Single source of truth for every calculation the
 * UI shows — phase 2 (live Odoo) swaps the data source, not this module.
 *
 * Workbook-internal defects are reproduced on purpose (findings ledger in
 * data.json; "Hallazgos" panel in the UI) — e.g. the day-sheet total that
 * omits hand-added rows, and the dashboard category membership that omits
 * late-added products. Fixing them here would fake parity.
 */

/** Workbook-parity constants — measured, pending Alexis' confirmation (plan §8). */
export const WORKBOOK_CONSTANTS = {
  /** 30/7 — the workbook's weeks-per-month divisor (MODELO R, MRP J). */
  weeksPerMonth: 4.2857,
  /** MODELO safety stock: 1 week of demand (col R). */
  modeloSafetyWeeks: 1,
  /** MRP weekly order target: 2× weekly demand (col K). */
  mrpSafetyWeeks: 2,
  /** MRP criticality bands (weeks of coverage). */
  critMax: 2,
  precaucionMax: 4,
  /** Coverage sentinel when weekly demand is 0 (MRP L). */
  coverageSentinel: 999,
} as const;

// ---------------------------------------------------------------- data types

export interface ModeloRow {
  cod: string;
  clave: string;
  prodReyma: string;
  desc: string;
  cat: string;
  cub: number;
  precio: number;
  sj: number;
  z11: number;
  pet: number;
  zac: number;
  pat: number;
  psx: number;
  transito: number;
  /** Effective proyección as the workbook holds it (formula result or Alexis' override). */
  proyeccion: number;
  proyOverride: boolean;
  ventaPend: number;
  descAniv: number | null;
}

export interface VentasRow {
  cod: string;
  clave: string;
  prodReyma: string;
  desc: string;
  v2024: number[]; // Ene..Dic
  v2025: number[]; // Ene..Dic
  v2026: number[]; // Ene..(22-Jun parcial)
}

export interface Furgon {
  guia: string;
  fechaEmision: string | null;
  eta: string | null;
  estado: string | null;
  etiqueta: string | null;
}

export interface SaldosRow {
  cod: string;
  desc: string;
  cat: string;
  totalPedido: number;
  cajas: Record<string, number>; // guia -> cajas
}

export interface MrpRow {
  cod: string;
  furgon: number | null;
  inZ2Range: boolean;
  inDespacho: boolean;
}

export interface DayFila {
  cod: string;
  clave: string;
  desc: string;
  cajas: number;
  cubicaje: number;
  manual: boolean;
  enTotalCajas: boolean;
  enTotalM3: boolean;
  enConteo: boolean;
}

export interface DayBlock {
  etiqueta: string; // "F1".."F9"
  titulo: string;
  filas: DayFila[];
}

export interface DaySheet {
  hoja: string;
  titulo: string;
  nota: string;
  furgones: DayBlock[];
}

export interface NcJulRow {
  facturas: string | null;
  fechaEmision: string | null;
  fechaRecepcion: string | null;
  clave: string;
  desc: string;
  cat: string;
  cajas: number;
  tarifa: number;
  ncCached: number;
}

export interface Finding {
  id: string;
  severity: 'info' | 'warn';
  sheet: string;
  cell: string;
  message: string;
}

export interface ReymaData {
  provenance: {
    sourceFile: string;
    sourceSha256: string;
    extractedAt: string;
    script: string;
    scriptVersion: string;
  };
  findings: Finding[];
  parity: { python: Record<string, { total: number; match: number; maxdiff: number }> };
  modelo: { titulo: string; rows: ModeloRow[]; stray: Record<string, unknown> | null };
  ventas: { titulo: string; rows: VentasRow[]; meses2026: string[] };
  saldos: { titulo: string; furgones: Furgon[]; rows: SaldosRow[]; semaforo: string };
  saldosJunio: {
    titulo: string;
    furgones: Furgon[];
    rows: Array<
      SaldosRow & {
        cached: { total: number; transito: number; recibido: number; entrega: number; saldo: number };
      }
    >;
  };
  ordenCompra: {
    encabezado: Record<string, string>;
    grupos: Array<{
      categoria: string;
      filas: Array<{
        num: number;
        clave: string;
        desc: string;
        millares: number;
        cajas: number;
        precioUnit: number;
        totalUsd: number;
        totalEsFormula: boolean;
      }>;
      subtotal: {
        cajas: number;
        cajasEsFormula: boolean;
        furgonesTexto: string;
        totalUsd: number;
        totalEsFormula: boolean;
      } | null;
    }>;
    totalFurgonesTexto: string;
    notas: string[];
  };
  entregas: {
    rows: Array<{
      fecha: string | null;
      factura: string;
      guia: string;
      cliente: string;
      ciudad: string | null;
      po: string | null;
      so: string | null;
      cod: string;
      desc: string;
      cantidad: number;
    }>;
  };
  mrp: {
    titulo: string;
    leyenda: string;
    capacidadM3: number;
    codFurgonCompleto: string;
    rows: MrpRow[];
    furgonDias: Array<{ furgon: number; dia: string }>;
  };
  daySheets: DaySheet[];
  distribucion: { titulo: string; nota: string };
  alertas: {
    titulo: string;
    rows: Array<{
      cod: string;
      clave: string;
      desc: string;
      nivel: number;
      pedOpt: number;
      progr: number;
      faltante: number;
      alerta: string;
    }>;
  };
  ncJul: { titulo: string; sub: string; tarifa: number; rows: NcJulRow[]; instruccion: string };
  ncJun: {
    titulo: string;
    sub: string;
    detalle: Array<{
      furgon: string;
      estado: string;
      fecha: string | null;
      desc: string;
      cajas: number;
      pFactura: number;
      pNeto: number;
      subtotal: number;
      nc: number;
    }>;
    totales: { etiqueta: string; cajas: number; nc: number; pNeto: number; subtotal: number } | null;
    resumen: Array<{ clave: string; desc: string; cajas: number; tarifa: number; nc: number }>;
  };
  dashboard: { titulo: string; categorias: Array<{ nombre: string; codigos: string[] }>; notas: string[] };
  bd: {
    stats: Record<string, unknown>;
    reymaSlice: Array<{ cod: string; bodega: string; existencias: number }>;
    nota: string;
  };
}

/** Client-side what-if edits (page-local, never persisted — phase 2 owns persistence). */
export interface Edits {
  /** MODELO proyección override per código. */
  proyeccion: Record<string, number>;
  /** Day-sheet CAJAS per `${hoja}|${blockIdx}|${filaIdx}`. */
  cajas: Record<string, number>;
  /** NC tarifa USD/caja (Alexis: "que uno pueda editarlo y cambiarlo"). */
  tarifaNc: number | null;
}

export const EMPTY_EDITS: Edits = { proyeccion: {}, cajas: {}, tarifaNc: null };

// ---------------------------------------------------------------- excel math

/**
 * Excel ROUND: half away from zero over the 15-significant-digit decimal view
 * (mirrors extract_reyma_replica.py xround; e.g. ROUND(18.51525,4) → 18.5153
 * even when the IEEE double is 18.515249999999998).
 */
export function xround(x: number, d = 0): number {
  if (!Number.isFinite(x) || Number.isInteger(x)) return x;
  const sign = x < 0 ? -1 : 1;
  let str = Math.abs(x).toPrecision(15);
  if (str.includes('e') || str.includes('E')) {
    str = Math.abs(x).toFixed(d + 17);
  }
  const dot = str.indexOf('.');
  if (dot === -1) return x;
  const frac = str.slice(dot + 1);
  if (frac.length <= d) return sign * Number(str);
  const intPart = str.slice(0, dot);
  const kept = intPart + frac.slice(0, d);
  const next = frac.charCodeAt(d) - 48;
  // kept has ≤15 digits (toPrecision(15)) → exact as a double, no BigInt needed
  const n = Number(kept) + (next >= 5 ? 1 : 0);
  return (sign * n) / 10 ** d;
}

/** Excel FLOOR(x, significance) for positive args (the only measured case). */
export function xfloorSig(x: number, sig: number): number {
  return Math.floor(Number((x / sig).toPrecision(15))) * sig;
}

export function fmt(n: number, dp = 0): string {
  return n.toLocaleString('es-GT', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// ---------------------------------------------------------------- VENTAS

export interface VentasDerived {
  ai: number; // total 2026
  aj: number; // promedio mensual 2024
  ak: number;
  al: number;
  am: number; // total 2025
  an: number; // total 2024
  ao: number; // factor crecimiento (2026 Ene-May / 2025 Ene-May)
  ap: number; // pronóstico Jul-26
  aq: number; // pronóstico Ago-26
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function ventasDerived(row: VentasRow): VentasDerived {
  const { v2024, v2025, v2026 } = row;
  const s25 = sum(v2025.slice(0, 5));
  const ao = s25 > 0 ? sum(v2026.slice(0, 5)) / s25 : 1;
  const pron = (prev25: number, prev24: number) =>
    xround(prev25 > 0 ? prev25 * ao : prev24 > 0 ? prev24 : 0, 1);
  return {
    ai: sum(v2026),
    aj: sum(v2024) / 12,
    ak: Math.min(...v2024),
    al: Math.max(...v2024),
    am: sum(v2025),
    an: sum(v2024),
    ao,
    ap: pron(v2025[6], v2024[6]),
    aq: pron(v2025[7], v2024[7]),
  };
}

// ---------------------------------------------------------------- MODELO

export interface ModeloDerived {
  n: number; // inventario disponible
  pFormula: number; // what the (mislabeled) formula computes: avg Ene-Jun 2026
  p: number; // effective proyección (edit ?? workbook value)
  r: number; // stock seguridad (1 semana)
  s: number; // necesidad total
  t: number; // disponible (inv + tránsito)
  u: number; // pedido óptimo
  v: number; // vol furgón m³
  w: number; // factor crecimiento lookup (miss → 1)
}

export function modeloDerived(
  row: ModeloRow,
  ventasByCod: Map<string, VentasRow>,
  proyeccionEdit?: number,
): ModeloDerived {
  const { weeksPerMonth } = WORKBOOK_CONSTANTS;
  const n = row.sj + row.z11 + row.pet + row.zac + row.pat - row.psx;
  const vrow = ventasByCod.get(row.cod);
  const pFormula = vrow ? xround(sum(vrow.v2026) / 6) : 0; // IFERROR(...,0) on VLOOKUP miss
  const p = proyeccionEdit ?? row.proyeccion;
  const r = xround(p / weeksPerMonth);
  const t = n + row.transito;
  const u = Math.max(0, xround(p + r - t));
  return {
    n,
    pFormula,
    p,
    r,
    s: p + r,
    t,
    u,
    v: xround(row.cub * u, 4),
    w: vrow ? ventasDerived(vrow).ao : 1, // IFERROR(VLOOKUP...,1)
  };
}

// ---------------------------------------------------------------- SALDOS

/** SUMIF criteria semantics measured from the sheet (accent-tolerant wildcards). */
export type EstadoKind = 'transito' | 'recibido' | 'entrega';

export function estadoMatches(estado: string | null, kind: EstadoKind): boolean {
  const e = (estado ?? '').toUpperCase();
  if (kind === 'transito') return /TR.NSITO/.test(e); // "*TR?NSITO*"
  if (kind === 'recibido') return e.startsWith('RECIBIDO'); // "RECIBIDO*"
  return e.startsWith('ENTREGA DIRECTA'); // "ENTREGA DIRECTA*"
}

export interface SaldosDerived {
  ao: number; // total en furgones
  ap: number; // en tránsito
  aq: number; // recibido
  ar: number; // entrega directa
  as: number; // saldo por despachar (signed — negatives are real over-shipments)
}

export function saldosDerived(row: SaldosRow, furgones: Furgon[]): SaldosDerived {
  let ao = 0;
  const by: Record<EstadoKind, number> = { transito: 0, recibido: 0, entrega: 0 };
  for (const fg of furgones) {
    const q = row.cajas[fg.guia] ?? 0;
    ao += q;
    for (const kind of ['transito', 'recibido', 'entrega'] as EstadoKind[]) {
      if (estadoMatches(fg.estado, kind)) by[kind] += q;
    }
  }
  return { ao, ap: by.transito, aq: by.recibido, ar: by.entrega, as: row.totalPedido - ao };
}

// ---------------------------------------------------------------- MRP

export interface MrpDerived {
  cod: string;
  furgon: number | null;
  a: number;
  clave: string;
  descProv: string;
  cat: string;
  f: number; // inv disp bodega = SJ + PAT − PSX (regla medida; pendiente confirmar)
  g: number; // tránsito
  h: number; // inv neto
  i: number; // prom mensual (proyección MODELO)
  j: number; // venta proyectada semanal
  k: number; // pedido óptimo semanal
  l: number; // nivel inventario en semanas (999 = sin demanda)
  m: number; // cubicaje
  n: number; // volumen pedido m³
  o: string; // prioridad
  sj: number;
  z11: number;
  pet: number;
  zac: number;
  pat: number;
  w: number | null; // cajas a despachar (furgón-completo FLOOR para el código dedicado)
  x: number | null; // vol despacho m³
  y: number | null; // % del furgón
  aa: string | null; // etiqueta furgón
  ab: string | null; // día de despacho
}

export interface MrpResult {
  rows: MrpDerived[];
  totalFurgones: number; // X2
  furgonesDedicados: number; // Z2 (código furgón-completo)
}

export function computeMrp(
  data: ReymaData,
  modeloByCod: Map<string, ModeloRow>,
  ventasByCod: Map<string, VentasRow>,
  proyeccionEdits: Record<string, number>,
): MrpResult {
  const { weeksPerMonth, coverageSentinel, critMax, precaucionMax } = WORKBOOK_CONSTANTS;
  const cap = data.mrp.capacidadM3;
  const fullCod = data.mrp.codFurgonCompleto;
  const dias = new Map(data.mrp.furgonDias.map((d) => [d.furgon, d.dia]));

  // X per row first (Y denominators / Z2 SUMIFs need the whole column)
  const xCache = data.mrp.rows.map((row) => {
    if (!row.inDespacho) return 0;
    const m = modeloByCod.get(row.cod);
    if (!m) return 0;
    const p = proyeccionEdits[row.cod] ?? m.proyeccion;
    const j = xround(p / weeksPerMonth);
    const h = m.sj + m.pat - m.psx + m.transito;
    const k = Math.max(0, xround(j * 2 - h));
    const w = row.cod === fullCod ? xfloorSig(k, Math.floor(cap / m.cub)) : k;
    return w * m.cub;
  });
  const dedicados = xround(
    data.mrp.rows.reduce(
      (acc, row, q) => acc + (row.inZ2Range && row.cod === fullCod ? xCache[q] : 0),
      0,
    ) / cap,
  );

  const rows = data.mrp.rows.map((row, idx): MrpDerived => {
    const m = modeloByCod.get(row.cod);
    if (!m) throw new Error(`MRP: código ${row.cod} sin fila en MODELO`);
    const p = proyeccionEdits[row.cod] ?? m.proyeccion;
    const f = m.sj + m.pat - m.psx;
    const g = m.transito;
    const h = f + g;
    const j = xround(p / weeksPerMonth);
    const k = Math.max(0, xround(j * 2 - h));
    const l = j === 0 ? coverageSentinel : xround(h / j, 2);
    const o =
      l < critMax ? 'CRITICO < 2 sem' : l < precaucionMax ? 'PRECAUCION < 4 sem' : 'OK >= 4 sem';
    let w: number | null = null;
    let x: number | null = null;
    let y: number | null = null;
    if (row.inDespacho) {
      w = row.cod === fullCod ? xfloorSig(k, Math.floor(cap / m.cub)) : k;
      x = w * m.cub;
      if (row.furgon !== null) {
        const denom = data.mrp.rows.reduce(
          (acc, rr, q) => acc + (rr.inZ2Range && rr.furgon === row.furgon ? xCache[q] : 0),
          0,
        );
        y = denom ? x / denom : null;
      }
    }
    let aa: string | null = null;
    let ab: string | null = null;
    if (row.furgon !== null && row.inDespacho) {
      aa =
        row.cod === fullCod
          ? `F${row.furgon} a F${row.furgon + dedicados - 1}`
          : `F${row.furgon}`;
      ab = dias.get(row.furgon) ?? null;
    }
    return {
      cod: row.cod,
      furgon: row.furgon,
      a: idx + 1,
      clave: m.clave,
      descProv: m.prodReyma,
      cat: m.cat,
      f,
      g,
      h,
      i: p,
      j,
      k,
      l,
      m: m.cub,
      n: k * m.cub,
      o,
      sj: m.sj,
      z11: m.z11,
      pet: m.pet,
      zac: m.zac,
      pat: m.pat,
      w,
      x,
      y,
      aa,
      ab,
    };
  });
  return { rows, totalFurgones: data.mrp.furgonDias.length, furgonesDedicados: dedicados };
}

// ---------------------------------------------------------------- day sheets

export interface DayBlockDerived {
  etiqueta: string;
  titulo: string;
  hoja: string;
  dia: string | null;
  filas: Array<DayFila & { cajasEfectivas: number; m3: number; pct: number; edited: boolean }>;
  /** Total del libro: respeta los rangos medidos (incl. el rango D6:D6 del jueves — hallazgo F5). */
  totalCajas: number;
  totalM3: number;
  totalPct: number;
  espacio: number;
  espacioPct: number;
  conteoProductos: number;
  contenido: string;
}

export function computeDayBlocks(data: ReymaData, cajasEdits: Record<string, number>): DayBlockDerived[] {
  const cap = data.mrp.capacidadM3;
  const dias = new Map(data.mrp.furgonDias.map((d) => [d.furgon, d.dia]));
  const out: DayBlockDerived[] = [];
  let furgonNo = 0;
  for (const ds of data.daySheets) {
    for (let b = 0; b < ds.furgones.length; b++) {
      furgonNo += 1;
      const block = ds.furgones[b];
      const filas = block.filas.map((fl, i) => {
        const key = `${ds.hoja}|${b}|${i}`;
        const cajasEfectivas = cajasEdits[key] ?? fl.cajas;
        const m3 = cajasEfectivas * fl.cubicaje;
        return { ...fl, cajasEfectivas, m3, pct: m3 / cap, edited: cajasEdits[key] !== undefined };
      });
      const totalCajas = filas.reduce((a, fl) => a + (fl.enTotalCajas ? fl.cajasEfectivas : 0), 0);
      const totalM3 = filas.reduce((a, fl) => a + (fl.enTotalM3 ? fl.m3 : 0), 0);
      const conteo = filas.reduce((a, fl) => a + (fl.enConteo ? 1 : 0), 0);
      out.push({
        etiqueta: block.etiqueta,
        titulo: block.titulo,
        hoja: ds.hoja,
        dia: dias.get(furgonNo) ?? null,
        filas,
        totalCajas,
        totalM3,
        totalPct: totalM3 / cap,
        espacio: cap - totalM3,
        espacioPct: (cap - totalM3) / cap,
        conteoProductos: conteo,
        contenido:
          conteo === 1
            ? filas[0].desc
            : `MIXTO - ${conteo} productos (menor nivel de inventario)`,
      });
    }
  }
  return out;
}

export interface DistribucionDerived {
  furgones: DayBlockDerived[];
  total: { productos: number; cajas: number; m3: number; ocup: number; espacio: number };
}

export function computeDistribucion(blocks: DayBlockDerived[], cap: number): DistribucionDerived {
  const m3 = blocks.reduce((a, b) => a + b.totalM3, 0);
  return {
    furgones: blocks,
    total: {
      productos: blocks.reduce((a, b) => a + b.conteoProductos, 0),
      cajas: blocks.reduce((a, b) => a + b.totalCajas, 0),
      m3,
      ocup: m3 / (blocks.length * cap),
      espacio: blocks.reduce((a, b) => a + b.espacio, 0),
    },
  };
}

// ---------------------------------------------------------------- dashboard

export interface DashboardCat {
  nombre: string;
  b: number; // total pedido
  c: number; // en furgones
  d: number; // recibido
  e: number; // en tránsito
  f: number; // entrega directa
  g: number; // saldo
  h: number; // fill rate
}

export function computeDashboard(
  data: ReymaData,
  saldosDer: Map<string, SaldosDerived>,
): { categorias: DashboardCat[]; total: DashboardCat } {
  const cat = (nombre: string, codigos: string[]): DashboardCat => {
    const rows = data.saldos.rows.filter((r) => codigos.includes(r.cod));
    let b = 0,
      c = 0,
      d = 0,
      e = 0,
      f = 0,
      g = 0;
    for (const r of rows) {
      const dd = saldosDer.get(r.cod);
      if (!dd) continue;
      b += r.totalPedido;
      c += dd.ao;
      d += dd.aq;
      e += dd.ap;
      f += dd.ar;
      g += dd.as;
    }
    return { nombre, b, c, d, e, f, g, h: b > 0 ? c / b : 0 };
  };
  const categorias = data.dashboard.categorias.map((x) => cat(x.nombre, x.codigos));
  const t = categorias.reduce(
    (acc, x) => ({
      nombre: 'TOTAL GENERAL',
      b: acc.b + x.b,
      c: acc.c + x.c,
      d: acc.d + x.d,
      e: acc.e + x.e,
      f: acc.f + x.f,
      g: acc.g + x.g,
      h: 0,
    }),
    { nombre: 'TOTAL GENERAL', b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, h: 0 },
  );
  t.h = t.b > 0 ? t.c / t.b : 0;
  return { categorias, total: t };
}

// ---------------------------------------------------------------- top level

export interface ReplicaComputed {
  modeloByCod: Map<string, ModeloRow>;
  ventasByCod: Map<string, VentasRow>;
  modeloDer: Map<string, ModeloDerived>;
  modeloTotales: {
    sj: number;
    z11: number;
    pet: number;
    zac: number;
    pat: number;
    psx: number;
    n: number;
    o: number;
  };
  ventasDer: Map<string, VentasDerived>;
  saldosDer: Map<string, SaldosDerived>;
  saldosTotal: SaldosDerived & { totalPedido: number; porGuia: Record<string, number> };
  mrp: MrpResult;
  dayBlocks: DayBlockDerived[];
  distribucion: DistribucionDerived;
  dashboard: { categorias: DashboardCat[]; total: DashboardCat };
  ncJul: { rows: Array<NcJulRow & { nc: number; tarifaEfectiva: number }>; totalCajas: number; totalNc: number };
  ocTotales: { cajas: number; usd: number };
}

export function computeReplica(data: ReymaData, edits: Edits): ReplicaComputed {
  const modeloByCod = new Map(data.modelo.rows.map((r) => [r.cod, r]));
  const ventasByCod = new Map(data.ventas.rows.map((r) => [r.cod, r]));

  const modeloDer = new Map<string, ModeloDerived>();
  for (const row of data.modelo.rows) {
    modeloDer.set(row.cod, modeloDerived(row, ventasByCod, edits.proyeccion[row.cod]));
  }
  const modeloTotales = data.modelo.rows.reduce(
    (acc, r) => ({
      sj: acc.sj + r.sj,
      z11: acc.z11 + r.z11,
      pet: acc.pet + r.pet,
      zac: acc.zac + r.zac,
      pat: acc.pat + r.pat,
      psx: acc.psx + r.psx,
      n: acc.n + (modeloDer.get(r.cod) as ModeloDerived).n,
      o: acc.o + r.transito,
    }),
    { sj: 0, z11: 0, pet: 0, zac: 0, pat: 0, psx: 0, n: 0, o: 0 },
  );

  const ventasDer = new Map(data.ventas.rows.map((r) => [r.cod, ventasDerived(r)]));

  const saldosDer = new Map(
    data.saldos.rows.map((r) => [r.cod, saldosDerived(r, data.saldos.furgones)]),
  );
  const porGuia: Record<string, number> = {};
  for (const fg of data.saldos.furgones) {
    porGuia[fg.guia] = data.saldos.rows.reduce((a, r) => a + (r.cajas[fg.guia] ?? 0), 0);
  }
  const ders = [...saldosDer.values()];
  const saldosTotal = {
    totalPedido: data.saldos.rows.reduce((a, r) => a + r.totalPedido, 0),
    porGuia,
    ao: ders.reduce((a, d) => a + d.ao, 0),
    ap: ders.reduce((a, d) => a + d.ap, 0),
    aq: ders.reduce((a, d) => a + d.aq, 0),
    ar: ders.reduce((a, d) => a + d.ar, 0),
    as: ders.reduce((a, d) => a + (d.as > 0 ? d.as : 0), 0), // el libro suma solo positivos (AS53)
  };

  const mrp = computeMrp(data, modeloByCod, ventasByCod, edits.proyeccion);
  const dayBlocks = computeDayBlocks(data, edits.cajas);
  const distribucion = computeDistribucion(dayBlocks, data.mrp.capacidadM3);
  const dashboard = computeDashboard(data, saldosDer);

  const tarifa = edits.tarifaNc ?? data.ncJul.tarifa;
  const ncRows = data.ncJul.rows.map((r) => ({
    ...r,
    tarifaEfectiva: tarifa,
    nc: xround(r.cajas * tarifa, 2),
  }));
  const ncJul = {
    rows: ncRows,
    totalCajas: ncRows.reduce((a, r) => a + r.cajas, 0),
    totalNc: ncRows.reduce((a, r) => a + r.nc, 0),
  };

  const ocTotales = data.ordenCompra.grupos.reduce(
    (acc, g) => ({
      cajas: acc.cajas + (g.subtotal?.cajas ?? 0),
      usd: acc.usd + (g.subtotal?.totalUsd ?? 0),
    }),
    { cajas: 0, usd: 0 },
  );

  return {
    modeloByCod,
    ventasByCod,
    modeloDer,
    modeloTotales,
    ventasDer,
    saldosDer,
    saldosTotal,
    mrp,
    dayBlocks,
    distribucion,
    dashboard,
    ncJul,
    ocTotales,
  };
}

// ---------------------------------------------------------------- parity map

/**
 * Flat (sheet,key,field) → value map matching the frozen fixture's keying —
 * used by the Jest parity suite to compare this engine against Alexis' cached
 * values cell by cell.
 */
export function parityMap(data: ReymaData): Map<string, number | string | null> {
  const out = new Map<string, number | string | null>();
  const put = (sheet: string, key: string, field: string, v: number | string | null) =>
    out.set(`${sheet} ${key} ${field}`, v);
  const c = computeReplica(data, EMPTY_EDITS);

  for (const row of data.ventas.rows) {
    const d = c.ventasDer.get(row.cod) as VentasDerived;
    for (const f of ['ai', 'aj', 'ak', 'al', 'am', 'an', 'ao', 'ap', 'aq'] as const) {
      put('VENTAS', row.cod, f, d[f]);
    }
  }
  for (const row of data.modelo.rows) {
    const d = c.modeloDer.get(row.cod) as ModeloDerived;
    put('MODELO', row.cod, 'n', d.n);
    if (!row.proyOverride) put('MODELO', row.cod, 'p', d.pFormula);
    for (const f of ['r', 's', 't', 'u', 'v', 'w'] as const) put('MODELO', row.cod, f, d[f]);
  }
  for (const f of ['sj', 'z11', 'pet', 'zac', 'pat', 'psx', 'n', 'o'] as const) {
    put('MODELO', 'TOTALES', f, c.modeloTotales[f]);
  }
  for (const row of data.saldos.rows) {
    const d = c.saldosDer.get(row.cod) as SaldosDerived;
    for (const f of ['ao', 'ap', 'aq', 'ar', 'as'] as const) put('SALDOS', row.cod, f, d[f]);
  }
  put('SALDOS', 'TOTAL', 'd', c.saldosTotal.totalPedido);
  for (const fg of data.saldos.furgones) put('SALDOS', 'TOTAL', fg.guia, c.saldosTotal.porGuia[fg.guia]);
  for (const f of ['ao', 'ap', 'aq', 'ar', 'as'] as const) put('SALDOS', 'TOTAL', f, c.saldosTotal[f]);

  const mrpFields: Array<[string, (d: MrpDerived) => number | string | null]> = [
    ['a', (d) => d.a],
    ['c', (d) => d.clave],
    ['d', (d) => d.descProv],
    ['e', (d) => d.cat],
    ['f', (d) => d.f],
    ['g', (d) => d.g],
    ['h', (d) => d.h],
    ['i', (d) => d.i],
    ['j', (d) => d.j],
    ['k', (d) => d.k],
    ['l', (d) => d.l],
    ['m', (d) => d.m],
    ['n', (d) => d.n],
    ['o', (d) => d.o],
    ['p', (d) => d.sj],
    ['q', (d) => d.z11],
    ['rr', (d) => d.pet],
    ['ss', (d) => d.zac],
    ['t', (d) => d.pat],
    ['w', (d) => d.w],
    ['x', (d) => d.x],
    ['y', (d) => d.y],
    ['aa', (d) => d.aa],
    ['ab', (d) => d.ab],
  ];
  for (const d of c.mrp.rows) {
    for (const [f, get] of mrpFields) put('MRP', d.cod, f, get(d));
  }
  put('MRP', 'CONFIG', 'x2', c.mrp.totalFurgones);
  put('MRP', 'CONFIG', 'z2', c.mrp.furgonesDedicados);

  for (const b of c.dayBlocks) {
    for (const fl of b.filas) {
      put(b.hoja, `${b.etiqueta}:${fl.cod}`, 'm3', fl.m3);
      put(b.hoja, `${b.etiqueta}:${fl.cod}`, 'pct', fl.pct);
    }
    put(b.hoja, b.etiqueta, 'totalCajas', b.totalCajas);
    put(b.hoja, b.etiqueta, 'totalM3', b.totalM3);
    put(b.hoja, b.etiqueta, 'totalPct', b.totalPct);
    put(b.hoja, b.etiqueta, 'espacio', b.espacio);
    put(b.hoja, b.etiqueta, 'espacioPct', b.espacioPct);
  }
  c.dayBlocks.forEach((b, i) => {
    put('DISTRIBUCION', String(i + 1), 'dia', b.dia);
    put('DISTRIBUCION', String(i + 1), 'contenido', b.contenido);
    put('DISTRIBUCION', String(i + 1), 'productos', b.conteoProductos);
    put('DISTRIBUCION', String(i + 1), 'cajas', b.totalCajas);
    put('DISTRIBUCION', String(i + 1), 'm3', b.totalM3);
    put('DISTRIBUCION', String(i + 1), 'ocup', b.totalPct);
    put('DISTRIBUCION', String(i + 1), 'espacio', b.espacio);
  });
  put('DISTRIBUCION', 'TOTAL', 'productos', c.distribucion.total.productos);
  put('DISTRIBUCION', 'TOTAL', 'cajas', c.distribucion.total.cajas);
  put('DISTRIBUCION', 'TOTAL', 'm3', c.distribucion.total.m3);
  put('DISTRIBUCION', 'TOTAL', 'ocup', c.distribucion.total.ocup);
  put('DISTRIBUCION', 'TOTAL', 'espacio', c.distribucion.total.espacio);

  for (const cat of c.dashboard.categorias) {
    for (const f of ['b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) put('DASHBOARD', cat.nombre, f, cat[f]);
  }
  for (const f of ['b', 'c', 'd', 'e', 'f', 'g', 'h'] as const) {
    put('DASHBOARD', 'TOTAL', f, c.dashboard.total[f]);
  }

  for (const g of data.ordenCompra.grupos) {
    for (const fila of g.filas) {
      if (fila.totalEsFormula) put('OC', fila.clave, 'total', fila.cajas * fila.precioUnit);
    }
    if (g.subtotal?.cajasEsFormula) {
      put('OC', g.categoria, 'subCajas', g.filas.reduce((a, f) => a + f.cajas, 0));
    }
    if (g.subtotal?.totalEsFormula) {
      put('OC', g.categoria, 'subTotal', g.filas.reduce((a, f) => a + f.totalUsd, 0));
    }
  }
  put('OC', 'TOTAL', 'cajas', c.ocTotales.cajas);
  put('OC', 'TOTAL', 'usd', c.ocTotales.usd);

  put('NC-JUL', 'TOTAL', 'cajas', c.ncJul.totalCajas);
  put('NC-JUL', 'TOTAL', 'nc', data.ncJul.rows.reduce((a, r) => a + r.ncCached, 0));

  return out;
}
