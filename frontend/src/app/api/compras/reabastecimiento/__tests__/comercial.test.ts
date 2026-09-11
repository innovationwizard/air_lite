import { consolidarComercial } from '../rows';

/**
 * El merge del forecast comercial hacia el Sugerido de Wilmer.
 *
 * Estas pruebas existen porque el merge anterior fallaba en las dos mitades a
 * la vez y ninguna fallaba ruidosamente: descartaba cinco de los seis canales,
 * y sumaba al pedido cantidades que la pantalla de captura le promete al jefe
 * de canal que van a la reunion. Las dos reglas viven en
 * lib/comercial/forecast.ts; esto verifica que el merge las respeta.
 */

const fila = (o: {
  product_id: number; quantity: number; motivo: string;
  area?: string; bodega?: string | null; created_at?: string;
}) => ({
  product_id: o.product_id,
  bodega: o.bodega ?? null,
  quantity: o.quantity,
  motivo: o.motivo,
  area: o.area ?? 'mayoreo',
  created_at: o.created_at ?? '2026-09-10T12:00:00Z',
});

describe('consolidarComercial', () => {
  it('SUMA los seis canales en vez de quedarse con el ultimo', () => {
    // El defecto exacto: con orden created_at DESC, el merge anterior devolvia
    // 200 (la fila mas reciente) mientras /comercial/forecast mostraba 1,000.
    const r = consolidarComercial([
      fila({ product_id: 1, quantity: 200, motivo: 'extraordinaria', created_at: '2026-09-10T15:00:00Z' }),
      fila({ product_id: 1, quantity: 300, motivo: 'extraordinaria', created_at: '2026-09-10T14:00:00Z' }),
      fila({ product_id: 1, quantity: 500, motivo: 'extraordinaria', created_at: '2026-09-10T13:00:00Z' }),
    ], 'San Jose VN');
    expect(r.get(1)?.directo).toBe(1000);
  });

  it('solo la extraordinaria entra al pedido; temporada y critico quedan aparte', () => {
    const r = consolidarComercial([
      fila({ product_id: 7, quantity: 100, motivo: 'extraordinaria' }),
      fila({ product_id: 7, quantity: 400, motivo: 'temporada' }),
      fila({ product_id: 7, quantity: 250, motivo: 'critico' }),
    ], 'San Jose VN');
    expect(r.get(7)?.directo).toBe(100);
    expect(r.get(7)?.aRevision).toBe(650);
  });

  it('dice QUIEN pidio CUANTO, no solo el total', () => {
    // El total sin autor no se puede discutir: ante «Adic. 1,000» ni el
    // comprador puede preguntar por que, ni el canal defender su numero.
    const r = consolidarComercial([
      fila({ product_id: 5, quantity: 500, motivo: 'extraordinaria', area: 'mayoreo' }),
      fila({ product_id: 5, quantity: 300, motivo: 'extraordinaria', area: 'tiendas' }),
      fila({ product_id: 5, quantity: 200, motivo: 'temporada', area: 'peten' }),
    ], 'San Jose VN');
    expect(r.get(5)?.porArea).toEqual({
      mayoreo: { directo: 500, aRevision: 0, base: 0 },
      tiendas: { directo: 300, aRevision: 0, base: 0 },
      peten: { directo: 0, aRevision: 200, base: 0 },
    });
    // Y el desglose reconcilia con los totales, o son dos numeros distintos.
    const pa = r.get(5)!.porArea;
    const sumaDir = Object.values(pa).reduce((n, a) => n + a.directo, 0);
    const sumaRev = Object.values(pa).reduce((n, a) => n + a.aRevision, 0);
    expect(sumaDir).toBe(r.get(5)!.directo);
    expect(sumaRev).toBe(r.get(5)!.aRevision);
  });

  it('un mismo canal que carga dos motivos queda separado dentro de su columna', () => {
    const r = consolidarComercial([
      fila({ product_id: 6, quantity: 400, motivo: 'extraordinaria', area: 'zacapa' }),
      fila({ product_id: 6, quantity: 150, motivo: 'critico', area: 'zacapa' }),
    ], 'San Jose VN');
    expect(r.get(6)?.porArea.zacapa).toEqual({ directo: 400, aRevision: 150, base: 0 });
  });

  it('un producto solo de proyeccion no mueve el Sugerido ni un punto', () => {
    // La regla que costo 18 furgones: el canal lee «se revisa en la reunion»
    // y la cantidad NO puede entrar sola al pedido.
    const r = consolidarComercial([
      fila({ product_id: 9, quantity: 5000, motivo: 'temporada' }),
    ], 'San Jose VN');
    expect(r.get(9)?.directo).toBe(0);
    expect(r.get(9)?.aRevision).toBe(5000);
  });

  it('una fila de otra bodega no entra; null es todas las bodegas', () => {
    const r = consolidarComercial([
      fila({ product_id: 3, quantity: 10, motivo: 'extraordinaria', bodega: 'Zacapa' }),
      fila({ product_id: 3, quantity: 20, motivo: 'extraordinaria', bodega: 'San Jose VN' }),
      fila({ product_id: 3, quantity: 40, motivo: 'extraordinaria', bodega: null }),
    ], 'San Jose VN');
    expect(r.get(3)?.directo).toBe(60);
  });

  it('una recomendacion aprobada (base) se ve y no entra a ningun lado', () => {
    // Nivel 2 (2026-09-10): el jefe de canal aprueba ~50 codigos con la
    // recomendacion de la app. Ese numero sale de los mismos p3/p6 que el
    // motor ya promedia; sumarlo a `adic` compraria la misma demanda dos
    // veces, y mandarlo a revision lo mezclaria con la proyeccion del canal.
    // Va a su propio balde. El cableado al Sugerido esta en pausa (Q5).
    const r = consolidarComercial([
      fila({ product_id: 11, quantity: 1245, motivo: 'base' }),
      fila({ product_id: 11, quantity: 100, motivo: 'extraordinaria' }),
      fila({ product_id: 11, quantity: 40, motivo: 'critico', area: 'tiendas' }),
    ], 'San Jose VN');
    expect(r.get(11)?.directo).toBe(100);
    expect(r.get(11)?.aRevision).toBe(40);
    expect(r.get(11)?.base).toBe(1245);
    expect(r.get(11)?.porArea).toEqual({
      mayoreo: { directo: 100, aRevision: 0, base: 1245 },
      tiendas: { directo: 0, aRevision: 40, base: 0 },
    });
  });

  it('con solo filas base el aditivo vale exactamente cero', () => {
    const r = consolidarComercial([
      fila({ product_id: 12, quantity: 800, motivo: 'base' }),
      fila({ product_id: 12, quantity: 300, motivo: 'base', area: 'zacapa' }),
    ], 'San Jose VN');
    expect(r.get(12)?.directo).toBe(0);
    expect(r.get(12)?.aRevision).toBe(0);
    expect(r.get(12)?.base).toBe(1100);
  });

  it('los vendedores de Institucional se suman en UNA columna Institucional', () => {
    // 2026-09-11: institucional se pronostica por vendedor (cinco areas hijas).
    // Wilmer no discute con cinco vendedores: ve el canal.
    const padreDe = new Map([['institucional_ortiz', 'institucional'], ['institucional_cerezo', 'institucional']]);
    const r = consolidarComercial([
      fila({ product_id: 20, quantity: 100, motivo: 'extraordinaria', area: 'institucional_ortiz' }),
      fila({ product_id: 20, quantity: 50, motivo: 'extraordinaria', area: 'institucional_cerezo' }),
      fila({ product_id: 20, quantity: 30, motivo: 'critico', area: 'institucional_cerezo' }),
      fila({ product_id: 20, quantity: 7, motivo: 'extraordinaria', area: 'mayoreo' }),
    ], 'San Jose VN', padreDe);
    expect(r.get(20)?.directo).toBe(157);
    expect(r.get(20)?.porArea).toEqual({
      institucional: { directo: 150, aRevision: 30, base: 0 },
      mayoreo: { directo: 7, aRevision: 0, base: 0 },
    });
  });

  it('solo los canales que APROBARON su pedido llegan a la pantalla de Wilmer', () => {
    // «Aprobar pedido» (2026-09-11): bloquear guarda, aprobar envia. Un canal
    // en borrador o bloqueado sin aprobar es invisible aca, aunque tenga filas.
    const filas = [
      fila({ product_id: 30, quantity: 100, motivo: 'extraordinaria', area: 'mayoreo' }),
      fila({ product_id: 30, quantity: 50, motivo: 'extraordinaria', area: 'tiendas' }),
    ];
    const conGate = consolidarComercial(filas, 'San Jose VN', new Map(), new Set(['mayoreo']));
    expect(conGate.get(30)?.directo).toBe(100);
    expect(conGate.get(30)?.porArea).toEqual({ mayoreo: { directo: 100, aRevision: 0, base: 0 } });
    // the gate applies to the CHILD area, before the roll-up into its parent
    const hijos = consolidarComercial(
      [fila({ product_id: 31, quantity: 10, motivo: 'extraordinaria', area: 'institucional_ortiz' }),
       fila({ product_id: 31, quantity: 20, motivo: 'extraordinaria', area: 'institucional_cerezo' })],
      'San Jose VN', new Map([['institucional_ortiz', 'institucional'], ['institucional_cerezo', 'institucional']]),
      new Set(['institucional_ortiz']));
    expect(hijos.get(31)?.porArea).toEqual({ institucional: { directo: 10, aRevision: 0, base: 0 } });
    // no gate (null) = the old behaviour, so the merge tests above stay meaningful
    expect(consolidarComercial(filas, 'San Jose VN').get(30)?.directo).toBe(150);
  });

  it('sin capturas no devuelve nada, y el aditivo cae a cero', () => {
    // Con cero filas el Sugerido tiene que valer exactamente lo que valia
    // antes de que existiera el modulo.
    const r = consolidarComercial([], 'San Jose VN');
    expect(r.size).toBe(0);
    expect(r.get(1)?.directo ?? 0).toBe(0);
  });
});
