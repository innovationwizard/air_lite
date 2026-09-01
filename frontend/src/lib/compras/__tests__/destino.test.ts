import {
  destinoAfectaFila, transitoSegunDestino, ultimaPorProducto,
} from '../destino';

const GENERAL = 'General';

describe('transitoSegunDestino — W15-A', () => {
  it('sin declaración, el tránsito sincronizado pasa tal cual', () => {
    expect(transitoSegunDestino('Zacapa', null, 50, GENERAL)).toBe(50);
  });

  it('declarado a esta bodega: se queda entero', () => {
    expect(transitoSegunDestino('Zacapa', 'Zacapa', 50, GENERAL)).toBe(50);
  });

  it('declarado a otra bodega: desaparece de esta — el caso de Wilmer', () => {
    // «estos 50 en tránsito no son de la bodega de Zacapa»
    expect(transitoSegunDestino('Zacapa', 'San Jose VN', 50, GENERAL)).toBe(0);
    expect(transitoSegunDestino('Petén', 'San Jose VN', 50, GENERAL)).toBe(0);
  });

  it('General nunca se reparte: es el roll-up y su cifra global está bien', () => {
    expect(transitoSegunDestino(GENERAL, 'Zacapa', 50, GENERAL)).toBe(50);
    expect(transitoSegunDestino(GENERAL, null, 50, GENERAL)).toBe(50);
  });

  it('el reparto no inventa cantidad: la suma de las tres es el global, una sola vez', () => {
    const sync = 50;
    const total = ['San Jose VN', 'Zacapa', 'Petén']
      .reduce((a, b) => a + transitoSegunDestino(b, 'Zacapa', sync, GENERAL), 0);
    expect(total).toBe(50);
  });

  it('sin declaración sigue replicándose — el defecto que W15-B corrige de raíz', () => {
    const sync = 50;
    const total = ['San Jose VN', 'Zacapa', 'Petén']
      .reduce((a, b) => a + transitoSegunDestino(b, null, sync, GENERAL), 0);
    expect(total).toBe(150); // 3x — no es un error del test, es el estado de hoy
  });
});

describe('destinoAfectaFila', () => {
  it('marca sólo cuando la declaración cambia lo que se ve', () => {
    expect(destinoAfectaFila('Zacapa', 'San Jose VN', GENERAL)).toBe(true);
    expect(destinoAfectaFila('Zacapa', 'Zacapa', GENERAL)).toBe(true);
    expect(destinoAfectaFila('Zacapa', null, GENERAL)).toBe(false);
    expect(destinoAfectaFila(GENERAL, 'Zacapa', GENERAL)).toBe(false);
  });
});

describe('ultimaPorProducto', () => {
  it('la más nueva gana (las filas llegan nuevas primero)', () => {
    const m = ultimaPorProducto([
      { product_id: 1, destino: 'Petén' },
      { product_id: 1, destino: 'Zacapa' },
      { product_id: 2, destino: 'San Jose VN' },
    ]);
    expect(m.get(1)).toBe('Petén');
    expect(m.get(2)).toBe('San Jose VN');
  });

  it('un borrado (destino null) gana igual que cualquier entrada nueva', () => {
    const m = ultimaPorProducto([
      { product_id: 1, destino: null },
      { product_id: 1, destino: 'Zacapa' },
    ]);
    expect(m.get(1)).toBeNull();
  });

  it('un producto sin declaraciones no aparece', () => {
    expect(ultimaPorProducto([]).has(7)).toBe(false);
  });
});
