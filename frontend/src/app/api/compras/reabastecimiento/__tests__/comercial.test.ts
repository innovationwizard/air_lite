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
  bodega?: string | null; created_at?: string;
}) => ({
  product_id: o.product_id,
  bodega: o.bodega ?? null,
  quantity: o.quantity,
  motivo: o.motivo,
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
    expect(r.get(7)).toEqual({ directo: 100, aRevision: 650 });
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

  it('sin capturas no devuelve nada, y el aditivo cae a cero', () => {
    // Con cero filas el Sugerido tiene que valer exactamente lo que valia
    // antes de que existiera el modulo.
    const r = consolidarComercial([], 'San Jose VN');
    expect(r.size).toBe(0);
    expect(r.get(1)?.directo ?? 0).toBe(0);
  });
});
