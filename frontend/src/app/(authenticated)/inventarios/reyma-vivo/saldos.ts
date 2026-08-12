/**
 * C7 — Saldos de pedido / fill rate: pure computation, engine-style (no I/O).
 *
 * Baseline = the monthly global PO synced from Odoo (reyma_po_lineas).
 * Facturado merges TWO sources with provenance:
 *   - 'odoo': vendor bills posted in Odoo (reyma_facturas) — authoritative.
 *   - 'pdf':  factura PDFs from the supplier mail (reyma_facturas_pdf) — they
 *     arrive DAYS before contabilidad posts them (manifest R2), so they lead.
 * Dedupe rule: if an Odoo bill's ref/name contains a PDF factura number
 * (e.g. '171849'), that PDF factura is superseded — Odoo wins, the PDF rows
 * are excluded from totals and reported in `supersededPdf` so the UI can say
 * so instead of double-counting.
 */
import type { FacturaLinea, FacturaPdfLinea, OrdenGlobal } from './types';

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
): { porCodigo: Map<string, FacturadoPorCodigo>; supersededPdf: string[] } {
  const odooMes = odooFacturas.filter((f) => mesDe(f.fecha) === mes);
  const pdfMes = pdfFacturas.filter((f) => mesDe(f.fecha) === mes);

  // Odoo refs/names that mention a PDF factura number supersede that factura.
  const odooText = odooMes
    .map((f) => `${f.factura} ${f.referencia ?? ''}`)
    .join(' ');
  const pdfNumbers = [...new Set(pdfMes.map((f) => f.factura))];
  const superseded = new Set(
    pdfNumbers.filter((num) => odooText.includes(num.replace(/^F/, ''))),
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

export function computeSaldos(
  ordenGlobal: OrdenGlobal,
  odooFacturas: FacturaLinea[],
  pdfFacturas: FacturaPdfLinea[],
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
