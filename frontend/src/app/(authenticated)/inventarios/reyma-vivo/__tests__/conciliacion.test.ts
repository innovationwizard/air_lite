import { conciliar, facturasSuperseded } from '../conciliacion';
import type { DecisionPersistida } from '../conciliacion';
import type { FacturaLinea, FacturaPdfLinea } from '../types';

/** Línea de factura PDF. `precioUnit` × `cantidad` arma el total del documento. */
const pdf = (
  factura: string, codigo: string, cantidad: number, precioUnit: number,
  fecha = '2026-08-07',
): FacturaPdfLinea => ({
  folioFiscal: `uuid-${factura}`, factura, guia: null, destino: 'bodega-san-jose',
  fecha, eta: null, codigo, clave: 'X', cantidad, precioUnit,
});

const odoo = (
  factura: string, codigo: string, cantidad: number, precioUnit: number,
  fecha = '2026-08-07', referencia: string | null = 'PEDIDO AGOSTO 2026',
): FacturaLinea => ({ factura, fecha, referencia, tipo: 'factura', codigo, cantidad, precioUnit });

describe('conciliar — tier 2 (monto + líneas + fecha)', () => {
  it('enlaza el caso de producción: la bill de Odoo es la misma factura del PDF', () => {
    // G-216/F171849: una sola línea VT10XN 666 @ $22.00 = $14,652.00
    const res = conciliar(
      [odoo('BILL/2026/08/0056', '77201046', 666, 22)],
      [pdf('F171849', '77201046', 666, 22)],
      '2026-08',
    );
    expect(res.enlaces).toHaveLength(1);
    expect(res.enlaces[0]).toMatchObject({
      factura: 'F171849', odooFactura: 'BILL/2026/08/0056', tier: 2, estado: 'auto', humano: false,
    });
    expect(res.enlaces[0].evidencia).toMatchObject({
      totalPdf: 14652, totalOdoo: 14652, mismoTotal: true, mismaFecha: true, mismasLineas: true,
    });
    expect(res.excepciones).toEqual([]);
    expect(facturasSuperseded(res)).toEqual(['F171849']);
  });

  it('NO enlaza cuando sólo calza el monto (líneas distintas) — va a la cola', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201019', 666, 22)],
      [pdf('F1', '77201046', 666, 22)],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
    expect(res.excepciones).toHaveLength(1);
    expect(res.excepciones[0].motivo).toBe('LINEAS_DISCREPAN');
  });

  it('NO enlaza cuando las líneas calzan pero el monto no (posible NC/R3)', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 666, 20.23)], // precio de OC, no de factura
      [pdf('F1', '77201046', 666, 22)],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
    expect(res.excepciones[0].motivo).toBe('MONTO_DISCREPA');
  });

  it('NO enlaza cuando monto y líneas calzan pero la fecha no', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 666, 22, '2026-08-19')],
      [pdf('F1', '77201046', 666, 22, '2026-08-07')],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
    expect(res.excepciones[0].motivo).toBe('FECHA_DISCREPA');
  });
});

describe('conciliar — las gemelas VT10 (por qué la fecha es obligatoria)', () => {
  // G-216 y G-224 son idénticas salvo la fecha: 1 línea VT10XN 666 @ $22.00.
  // Es la forma de factura MÁS común de REYMA (furgón dedicado, N7).
  const gemelas = [
    ...[pdf('F171849', '77201046', 666, 22, '2026-08-07')],
    ...[pdf('F172109', '77201046', 666, 22, '2026-08-12')],
  ];
  const bills = [
    odoo('BILL/2026/08/0056', '77201046', 666, 22, '2026-08-07'),
    odoo('BILL/2026/08/0058', '77201046', 666, 22, '2026-08-12'),
  ];

  it('con la fecha, cada gemela se enlaza con SU bill y ninguna se cruza', () => {
    const res = conciliar(bills, gemelas, '2026-08');
    expect(res.enlaces).toHaveLength(2);
    expect(res.enlaces.map((e) => [e.factura, e.odooFactura])).toEqual([
      ['F171849', 'BILL/2026/08/0056'],
      ['F172109', 'BILL/2026/08/0058'],
    ]);
    expect(res.excepciones).toEqual([]);
  });

  it('cuando dos facturas pelean la MISMA bill, ninguna se asigna: van a la cola', () => {
    // Misma fecha en las dos: el desempate desaparece.
    const res = conciliar(
      [odoo('BILL/UNICA', '77201046', 666, 22, '2026-08-07')],
      [pdf('F171849', '77201046', 666, 22, '2026-08-07'),
        pdf('F172109', '77201046', 666, 22, '2026-08-07')],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]); // ⬅ el punto: 1:1, no "la primera que pase"
    expect(res.excepciones).toHaveLength(2);
    expect(res.excepciones.every((e) => e.motivo === 'AMBIGUO')).toBe(true);
  });

  it('una factura con dos bills candidatas al mismo tier queda AMBIGUA', () => {
    const res = conciliar(
      [odoo('BILL/A', '77201046', 666, 22, '2026-08-07'),
        odoo('BILL/B', '77201046', 666, 22, '2026-08-07')],
      [pdf('F1', '77201046', 666, 22, '2026-08-07')],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
    expect(res.excepciones[0].motivo).toBe('AMBIGUO');
    expect(res.excepciones[0].candidatos).toHaveLength(2);
  });
});

describe('conciliar — tier 1 (el folio en la referencia)', () => {
  it('gana sobre tier 2 y funciona aunque el monto no calce', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 600, 22, '2026-08-09',
        'PEDIDO BODEGA PETEN ------ AGOSTO 2026 F171849')],
      [pdf('F171849', '77201046', 666, 22)],
      '2026-08',
    );
    expect(res.enlaces).toHaveLength(1);
    expect(res.enlaces[0].tier).toBe(1);
    expect(res.enlaces[0].evidencia.mismoTotal).toBe(false); // enlazada igual: el folio manda
  });

  it('se resuelve antes que tier 2, liberando la ambigüedad', () => {
    // F1 tiene el folio en BILL/B; sin tier 1, F1 y F2 pelearían las dos bills.
    const res = conciliar(
      [odoo('BILL/A', '77201046', 666, 22, '2026-08-07'),
        odoo('BILL/B', '77201046', 666, 22, '2026-08-07', 'ORDEN F171849')],
      [pdf('F171849', '77201046', 666, 22, '2026-08-07'),
        pdf('F171850', '77201046', 666, 22, '2026-08-07')],
      '2026-08',
    );
    const t1 = res.enlaces.find((e) => e.tier === 1);
    expect(t1).toMatchObject({ factura: 'F171849', odooFactura: 'BILL/B' });
    // F171850 queda con una sola bill libre y se asigna por tier 2.
    expect(res.enlaces.find((e) => e.tier === 2)).toMatchObject({
      factura: 'F171850', odooFactura: 'BILL/A',
    });
  });

  it('no matchea por un número corto (evita falsos positivos por casualidad)', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 1, 1, '2026-08-07', 'FURGON 123')],
      [pdf('F123', '77201046', 999, 5)],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
  });
});

describe('conciliar — decisiones humanas persistidas', () => {
  const decision = (estado: 'confirmado' | 'rechazado', odooFactura: string): DecisionPersistida => ({
    folioFiscal: 'uuid-F1', odooFactura, estado, tier: 0, regla: 'enlace manual',
    autor: 'Alexis', fecha: '2026-08-20T10:00:00Z',
  });

  it('un rechazo veta el par aunque el motor lo proponga', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 666, 22)],
      [pdf('F1', '77201046', 666, 22)],
      '2026-08',
      [decision('rechazado', 'BILL/1')],
    );
    expect(res.enlaces).toEqual([]);
    expect(res.excepciones).toEqual([]); // vetado explícitamente: no vuelve a preguntar
    expect(res.pdfSinOdoo).toEqual(['F1']);
  });

  it('un confirmado se aplica aunque el motor NO lo proponga', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201019', 10, 5)], // nada en común con el PDF
      [pdf('F1', '77201046', 666, 22)],
      '2026-08',
      [decision('confirmado', 'BILL/1')],
    );
    expect(res.enlaces).toHaveLength(1);
    expect(res.enlaces[0]).toMatchObject({ estado: 'confirmado', humano: true, tier: 0 });
  });

  it('la decisión más reciente manda (tabla append-only)', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 666, 22)],
      [pdf('F1', '77201046', 666, 22)],
      '2026-08',
      // llega ordenada por created_at DESC: la primera es la última decisión
      [{ ...decision('confirmado', 'BILL/1'), fecha: '2026-08-20T12:00:00Z' },
        { ...decision('rechazado', 'BILL/1'), fecha: '2026-08-20T09:00:00Z' }],
    );
    expect(res.enlaces).toHaveLength(1);
    expect(res.enlaces[0].estado).toBe('confirmado');
  });
});

describe('conciliar — alcance y casos normales', () => {
  it('una factura PDF sin contraparte NO es excepción: es el estado normal', () => {
    const res = conciliar([], [pdf('F1', '77201046', 666, 22)], '2026-08');
    expect(res.enlaces).toEqual([]);
    expect(res.excepciones).toEqual([]);
    expect(res.pdfSinOdoo).toEqual(['F1']);
  });

  it('reporta bills de Odoo sin PDF (posible hueco en el canal de Alexis)', () => {
    const res = conciliar([odoo('BILL/9', '77201046', 5, 1)], [], '2026-08');
    expect(res.odooSinPdf).toEqual(['BILL/9']);
  });

  it('ignora otros meses de los dos lados', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 666, 22, '2026-07-07')],
      [pdf('F1', '77201046', 666, 22, '2026-07-07')],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
    expect(res.pdfSinOdoo).toEqual([]);
    expect(res.odooSinPdf).toEqual([]);
  });

  it('las notas de crédito no participan del match (son otro CFDI)', () => {
    const res = conciliar(
      [{ ...odoo('NC/1', '77201046', 666, 22), tipo: 'nota_credito' }],
      [pdf('F1', '77201046', 666, 22)],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
    expect(res.odooSinPdf).toEqual([]);
  });

  it('agrupa líneas múltiples y compara el documento completo', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 151, 22), odoo('BILL/1', '77201019', 329, 22.3)],
      [pdf('F1', '77201046', 151, 22), pdf('F1', '77201019', 329, 22.3)],
      '2026-08',
    );
    expect(res.enlaces).toHaveLength(1);
    expect(res.enlaces[0].evidencia).toMatchObject({ lineasPdf: 2, lineasOdoo: 2, codigosEnComun: 2 });
  });

  it('un subconjunto de líneas NO se enlaza (bill parcial → cola)', () => {
    const res = conciliar(
      [odoo('BILL/1', '77201046', 151, 22)],
      [pdf('F1', '77201046', 151, 22), pdf('F1', '77201019', 329, 22.3)],
      '2026-08',
    );
    expect(res.enlaces).toEqual([]);
    expect(res.excepciones).toHaveLength(1);
  });
});
