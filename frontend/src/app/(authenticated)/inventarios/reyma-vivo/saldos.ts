/**
 * C7 — Saldos de pedido / fill rate: pure computation, engine-style (no I/O).
 *
 * Baseline = the monthly global PO synced from Odoo (reyma_po_lineas).
 * Facturado merges TWO sources with provenance:
 *   - 'odoo': vendor bills posted in Odoo (reyma_facturas) — authoritative.
 *   - 'pdf':  factura PDFs from the supplier mail (reyma_facturas_pdf) — they
 *     arrive DAYS before contabilidad posts them (manifest R2), so they lead.
 * Dedupe: NO se adivina acá. Los pares factura-PDF ↔ bill-de-Odoo los produce
 * `conciliacion.ts` (escalera de reglas + asignación 1:1) y se persisten con
 * procedencia en `reyma_factura_match`. Este módulo sólo recibe la lista de
 * enlaces y excluye esas facturas PDF del total, reportándolas en
 * `supersededPdf` para que la UI lo diga en vez de contar dos veces.
 *
 * La regla vieja (buscar el número de factura dentro del `ref` de la bill) se
 * eliminó el 2026-08-20: no podía dispararse nunca porque REYMA escribe la
 * descripción de la OC en ese campo, y la misma mercadería se estaba contando
 * dos veces (N14 del manifest — fill 55.9% mostrado contra 40.5% real).
 */
import type { FacturaLinea, FacturaPdfLinea, OrdenGlobal } from './types';

/** Par enlazado que viene de la conciliación persistida. */
export interface EnlaceAplicado {
  factura: string; // 'F171849' — la factura PDF que Odoo ya tiene
  odooFactura: string; // 'BILL/2026/08/0054'
}

export interface FacturadoPorCodigo {
  codigo: string;
  odoo: number;
  pdf: number;
  total: number;
}

export interface SaldoRow {
  codigo: string;
  pedido: number;
  facturado: number;
  fuentePdf: number; // portion of facturado that comes from PDFs only
  recibidas: number;
  saldo: number;
  fill: number; // facturado / pedido (0 when pedido = 0)
}

export interface SaldosResult {
  rows: SaldoRow[];
  /** facturado for códigos that are NOT in the PO — surfaced, never dropped. */
  fueraDePedido: FacturadoPorCodigo[];
  /** PDF facturas superseded by an Odoo bill (dedupe hits). */
  supersededPdf: string[];
  /**
   * Entregas directas excluded from the global-order count: they belong to
   * their own child POs (PO-PZ11-*, Alexis' Z11 mechanic) and must NOT
   * discount the orden global. Excluded ≠ dropped — surfaced here.
   */
  directasExcluidas: { facturas: string[]; cajas: number };
  totales: { pedido: number; facturado: number; recibidas: number; fill: number };
}

/** month key 'YYYY-MM' of an ISO date string; null-safe. */
function mesDe(fecha: string | null): string | null {
  return fecha && fecha.length >= 7 ? fecha.slice(0, 7) : null;
}

export function mergeFacturado(
  odooFacturas: FacturaLinea[],
  pdfFacturas: FacturaPdfLinea[],
  mes: string, // 'YYYY-MM'
  enlaces: EnlaceAplicado[] = [],
): { porCodigo: Map<string, FacturadoPorCodigo>; supersededPdf: string[] } {
  const odooMes = odooFacturas.filter((f) => mesDe(f.fecha) === mes);
  const pdfMes = pdfFacturas.filter((f) => mesDe(f.fecha) === mes);

  // Una factura PDF queda superseded SÓLO si la conciliación la enlazó con una
  // bill de Odoo que efectivamente está sumando este mes. Si la bill no está en
  // el mes, el enlace no aplica y el PDF sigue contando (si no, desaparecería
  // de los dos lados).
  const odooDelMes = new Set(odooMes.map((f) => f.factura));
  const pdfDelMes = new Set(pdfMes.map((f) => f.factura));
  const superseded = new Set(
    enlaces
      .filter((e) => odooDelMes.has(e.odooFactura) && pdfDelMes.has(e.factura))
      .map((e) => e.factura),
  );

  const porCodigo = new Map<string, FacturadoPorCodigo>();
  const bump = (codigo: string, source: 'odoo' | 'pdf', qty: number) => {
    const e = porCodigo.get(codigo) ?? { codigo, odoo: 0, pdf: 0, total: 0 };
    e[source] += qty;
    e.total += qty;
    porCodigo.set(codigo, e);
  };
  for (const f of odooMes) {
    bump(f.codigo, 'odoo', (f.tipo === 'nota_credito' ? -1 : 1) * f.cantidad);
  }
  for (const f of pdfMes) {
    if (superseded.has(f.factura)) continue;
    bump(f.codigo, 'pdf', f.cantidad);
  }
  return { porCodigo, supersededPdf: [...superseded].sort() };
}

/**
 * PDF-implied tránsito (2026-08-13, after the CS1XN finding): the supplier
 * facturas arrive by mail DAYS before contabilidad posts them, so Odoo's
 * facturado − recibido misses furgones already on the water. Alexis' rule with
 * the merged facturado source, per código of the orden global (entregas
 * directas excluded — rule 6):
 *
 *   pdfTransito = max(0, pdfFacturado − recibidasPO − transitoOdooDeLaPO)
 *
 * The last term prevents double-counting once contabilidad posts the bills
 * (Odoo facturado then produces reyma_transito rows for the same PO).
 * Returns per-código qty + earliest ETA + contributing destinos for display.
 */
/**
 * Tránsito implícito por facturas PDF, por código.
 *
 * `eta` es la fecha EFECTIVA (manual si existe, calculada si no) — la que
 * responde «¿cuándo entra?». `etaManual` y `etaCalculada` la desarman en sus
 * dos procedencias para poder mostrarlas lado a lado.
 */
export interface PdfTransito {
  cantidad: number;
  eta: string | null;
  /** Lo que dijo Alexis. `null` = no lo dijo — y eso se muestra vacío, no se rellena. */
  etaManual: string | null;
  /** Lo que calcula la fórmula (fecha impresa + N días hábiles por bodega). */
  etaCalculada: string | null;
  destinos: string[];
}

export function computePdfTransito(
  poName: string,
  mes: string, // 'YYYY-MM'
  poLineas: Array<{ po_name: string; codigo: string; recibidas: number }>,
  odooTransito: Array<{ po_name: string; codigo: string; cantidad_pendiente: number }>,
  pdfFacturas: Array<FacturaPdfLinea & { etaManual?: string | null; etaCalculada?: string | null }>,
): Map<string, PdfTransito> {
  const pdfFact = new Map<string, {
    qty: number; etas: string[]; manuales: string[]; calculadas: string[]; destinos: Set<string>;
  }>();
  for (const f of pdfFacturas) {
    if (f.destino === 'entrega-directa' || f.fecha.slice(0, 7) !== mes) continue;
    const e = pdfFact.get(f.codigo)
      ?? { qty: 0, etas: [], manuales: [], calculadas: [], destinos: new Set<string>() };
    e.qty += f.cantidad;
    if (f.eta) e.etas.push(f.eta);
    // Las dos procedencias se agregan POR SEPARADO (decisión 2026-08-25). Una
    // sola columna esconde de dónde salió la fecha: una ETA calculada se ve
    // idéntica a una que dijo Alexis, y hoy 20 de 26 facturas están mostrando
    // fórmula sin que se note. Cada columna responde «lo más pronto que entra
    // este código, según esa fuente»; un hueco en la de Alexis es una pregunta
    // visible, no un silencio.
    if (f.etaManual) e.manuales.push(f.etaManual);
    if (f.etaCalculada) e.calculadas.push(f.etaCalculada);
    if (f.destino) e.destinos.add(f.destino);
    pdfFact.set(f.codigo, e);
  }
  const recibidas = new Map<string, number>();
  for (const l of poLineas) {
    if (l.po_name !== poName) continue;
    recibidas.set(l.codigo, (recibidas.get(l.codigo) ?? 0) + l.recibidas);
  }
  const odooOg = new Map<string, number>();
  for (const t of odooTransito) {
    if (t.po_name !== poName) continue;
    odooOg.set(t.codigo, (odooOg.get(t.codigo) ?? 0) + t.cantidad_pendiente);
  }
  const out = new Map<string, PdfTransito>();
  for (const [codigo, e] of pdfFact) {
    const extra = e.qty - (recibidas.get(codigo) ?? 0) - (odooOg.get(codigo) ?? 0);
    if (extra > 0.0001) {
      out.set(codigo, {
        cantidad: extra,
        eta: e.etas.length ? [...e.etas].sort()[0] : null,
        etaManual: e.manuales.length ? [...e.manuales].sort()[0] : null,
        etaCalculada: e.calculadas.length ? [...e.calculadas].sort()[0] : null,
        destinos: [...e.destinos].sort(),
      });
    }
  }
  return out;
}

export function computeSaldos(
  ordenGlobal: OrdenGlobal,
  odooFacturas: FacturaLinea[],
  pdfFacturas: FacturaPdfLinea[],
  enlaces: EnlaceAplicado[] = [],
): SaldosResult {
  const mes = ordenGlobal.mes.slice(0, 7);
  // Entregas directas discount their PZ11 child POs, never the orden global.
  // PDF source carries destino explicitly. Odoo bills: excluded when the
  // referencia mentions Z11 (content-based; monthly bills say e.g. 'ORDEN DE
  // JULIO 2026' — no Z11 bill observed yet, so this is a conservative filter
  // that excludes nothing until one appears).
  const esDirectaOdoo = (f: FacturaLinea) => /Z11/i.test(f.referencia ?? '');
  const directasPdf = pdfFacturas.filter((f) => f.destino === 'entrega-directa');
  const { porCodigo, supersededPdf } = mergeFacturado(
    odooFacturas.filter((f) => !esDirectaOdoo(f)),
    pdfFacturas.filter((f) => f.destino !== 'entrega-directa'),
    mes,
    enlaces,
  );
  const directasMes = directasPdf.filter((f) => f.fecha.slice(0, 7) === mes);
  const directasExcluidas = {
    facturas: [...new Set(directasMes.map((f) => f.factura))].sort(),
    cajas: directasMes.reduce((a, f) => a + f.cantidad, 0),
  };

  const rows: SaldoRow[] = ordenGlobal.lineas.map((l) => {
    const fac = porCodigo.get(l.codigo);
    const facturado = fac?.total ?? 0;
    return {
      codigo: l.codigo,
      pedido: l.cajas,
      facturado,
      fuentePdf: fac?.pdf ?? 0,
      recibidas: l.recibidas,
      saldo: l.cajas - facturado,
      fill: l.cajas > 0 ? facturado / l.cajas : 0,
    };
  });
  const enPedido = new Set(ordenGlobal.lineas.map((l) => l.codigo));
  const fueraDePedido = [...porCodigo.values()]
    .filter((f) => !enPedido.has(f.codigo) && f.total !== 0)
    .sort((a, b) => b.total - a.total);

  const pedido = rows.reduce((a, r) => a + r.pedido, 0);
  const facturado = rows.reduce((a, r) => a + r.facturado, 0);
  const recibidas = rows.reduce((a, r) => a + r.recibidas, 0);
  return {
    rows,
    fueraDePedido,
    supersededPdf,
    directasExcluidas,
    totales: { pedido, facturado, recibidas, fill: pedido > 0 ? facturado / pedido : 0 },
  };
}
