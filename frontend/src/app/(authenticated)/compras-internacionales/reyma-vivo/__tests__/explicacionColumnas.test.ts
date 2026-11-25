import { EXPLICACIONES, explicacionColumna } from '../explicacionColumnas';

describe('explicacionColumnas', () => {
  const todas = Object.entries(EXPLICACIONES);

  it('cada columna es un cálculo itemizado o una procedencia, nunca las dos', () => {
    for (const [id, exp] of todas) {
      const esCalculo = exp.formula !== null;
      if (esCalculo) {
        expect({ id, terminos: exp.terminos.length, origen: exp.origen }).toEqual({
          id,
          terminos: expect.any(Number),
          origen: null,
        });
        expect(exp.terminos.length).toBeGreaterThan(0);
        expect(exp.formula!.length).toBeGreaterThan(0);
      } else {
        expect(exp.terminos).toEqual([]);
        expect(exp.origen && exp.origen.length > 0).toBe(true);
      }
    }
  });

  it('el inventario disponible del Modelo suma las cuatro bodegas y los patios, y resta PxS', () => {
    const exp = explicacionColumna('modelo.invDisp');
    expect(exp.formula).toBe('San José + Zona 11 + Petén + Zacapa + Patios − PxS (≤8 días).');
  });

  it('el inventario de bodega del MRP semanal es San José más patios menos PxS', () => {
    expect(explicacionColumna('mrp.invDispBodega').formula).toBe('San José + Patios − PxS (≤8 días).');
  });

  it('el pedido semanal cubre dos semanas de venta y le resta el inventario neto', () => {
    expect(explicacionColumna('mrp.pedido').formula).toContain('2 × Venta semanal − Inventario neto');
  });

  it('el pedido regional usa las semanas objetivo, no las dos semanas fijas del MRP semanal', () => {
    expect(explicacionColumna('regional.pedido').formula).toContain('semanas objetivo × Venta semanal − Neto');
  });

  it('el fill es facturado entre pedido', () => {
    expect(explicacionColumna('cumpl.fill').formula).toBe('Facturado ÷ Pedido.');
  });

  it('el factor de ventas compara enero a mayo, y los pronósticos del libro son julio y agosto', () => {
    expect(explicacionColumna('ventas.factor').formula).toContain('enero a mayo');
    expect(explicacionColumna('ventas.pronAct').formula).toContain('julio');
    expect(explicacionColumna('ventas.pronSig').formula).toContain('agosto');
  });
});
