import { computeSaldos, mergeFacturado } from '../saldos';
import type { FacturaLinea, FacturaPdfLinea, OrdenGlobal } from '../types';

const og: OrdenGlobal = {
  mes: '2026-08-01',
  poName: 'PO-P-3003',
  autor: 'Alexis',
  fecha: '2026-08-12T00:00:00Z',
  lineas: [
    { codigo: '77201046', cajas: 9603, recibidas: 817, precioUnit: 20.23 },
    { codigo: '77201019', cajas: 1173, recibidas: 329, precioUnit: 19.58 },
    { codigo: '77201000', cajas: 1222, recibidas: 0, precioUnit: 10.0 },
  ],
};

const pdf = (factura: string, codigo: string, cantidad: number, fecha = '2026-08-07'): FacturaPdfLinea => ({
  folioFiscal: `uuid-${factura}-${codigo}`, factura, guia: 'G-216-2026', destino: 'bodega-san-jose',
  fecha, codigo, clave: 'X', cantidad, precioUnit: 22,
});

const odoo = (factura: string, codigo: string, cantidad: number, opts: Partial<FacturaLinea> = {}): FacturaLinea => ({
  factura, fecha: '2026-08-10', referencia: null, tipo: 'factura', codigo, cantidad, precioUnit: 20, ...opts,
});

describe('mergeFacturado', () => {
  it('sums PDF facturas when Odoo has nothing (the R2 gap)', () => {
    const { porCodigo, supersededPdf } = mergeFacturado(
      [], [pdf('F171849', '77201046', 666), pdf('F171850', '77201046', 151)], '2026-08');
    expect(porCodigo.get('77201046')).toEqual({ codigo: '77201046', odoo: 0, pdf: 817, total: 817 });
    expect(supersededPdf).toEqual([]);
  });

  it('dedupes: an Odoo bill whose ref carries the factura number supersedes the PDF', () => {
    const { porCodigo, supersededPdf } = mergeFacturado(
      [odoo('BILL/2026/08/0031', '77201046', 666, { referencia: 'FACT 171849 ORDEN AGOSTO' })],
      [pdf('F171849', '77201046', 666), pdf('F171850', '77201046', 151)],
      '2026-08');
    expect(supersededPdf).toEqual(['F171849']);
    // 666 from Odoo + 151 from the non-superseded PDF; never 666 twice
    expect(porCodigo.get('77201046')?.total).toBe(817);
    expect(porCodigo.get('77201046')?.odoo).toBe(666);
    expect(porCodigo.get('77201046')?.pdf).toBe(151);
  });

  it('notas de crédito subtract; other months are excluded', () => {
    const { porCodigo } = mergeFacturado(
      [odoo('B1', '77201019', 100), odoo('NC1', '77201019', 30, { tipo: 'nota_credito' }),
       odoo('B2', '77201019', 999, { fecha: '2026-07-15' })],
      [pdf('F9', '77201019', 50, '2026-07-30')],
      '2026-08');
    expect(porCodigo.get('77201019')?.total).toBe(70);
  });
});

describe('computeSaldos', () => {
  it('computes saldo, fill, fuentePdf and totals against the PO baseline', () => {
    const res = computeSaldos(og, [odoo('B1', '77201019', 200)], [pdf('F171849', '77201046', 666)]);
    const vt10 = res.rows.find((r) => r.codigo === '77201046')!;
    expect(vt10.pedido).toBe(9603);
    expect(vt10.facturado).toBe(666);
    expect(vt10.fuentePdf).toBe(666);
    expect(vt10.saldo).toBe(8937);
    expect(vt10.recibidas).toBe(817);
    const sinFactura = res.rows.find((r) => r.codigo === '77201000')!;
    expect(sinFactura.facturado).toBe(0);
    expect(sinFactura.fill).toBe(0);
    expect(res.totales.pedido).toBe(11998);
    expect(res.totales.facturado).toBe(866);
    expect(res.totales.fill).toBeCloseTo(866 / 11998);
  });

  it('facturado outside the PO is surfaced, never dropped', () => {
    const res = computeSaldos(og, [], [pdf('F171905', '77209999', 42)]);
    expect(res.fueraDePedido).toEqual([{ codigo: '77209999', odoo: 0, pdf: 42, total: 42 }]);
  });

  it('entregas directas never discount the orden global — excluded and surfaced', () => {
    const directa = { ...pdf('F171905', '77201046', 319), destino: 'entrega-directa' };
    const res = computeSaldos(og, [], [pdf('F171849', '77201046', 666), directa]);
    const vt10 = res.rows.find((r) => r.codigo === '77201046')!;
    expect(vt10.facturado).toBe(666); // the 319 directas do NOT count
    expect(res.directasExcluidas).toEqual({ facturas: ['F171905'], cajas: 319 });
  });

  it('Odoo bills whose referencia mentions Z11 are treated as directas', () => {
    const res = computeSaldos(og,
      [odoo('B1', '77201046', 100, { referencia: 'PO-PZ11-0484 ENTREGA DIRECTA' }),
       odoo('B2', '77201046', 50)],
      []);
    expect(res.rows.find((r) => r.codigo === '77201046')!.facturado).toBe(50);
  });
});
