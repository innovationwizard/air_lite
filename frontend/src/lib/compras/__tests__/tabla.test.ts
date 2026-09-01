import {
  compararPorDefecto, dirInicial, esTexto, filtrar, ordenar, siguienteOrden, vista,
  type FilaOrdenable,
} from '../tabla';

function fila(over: Partial<FilaOrdenable> & { cod: string }): FilaOrdenable {
  return {
    desc: '', prov: '', exist: 0, patio: 0, doh: 0, trans: 0, pending: null,
    adic: 0, p6: 0, p3: 0, mtd: null, sug: 0,
    flags: { tendenciaCreciente: false },
    ...over,
  };
}

describe('dirección inicial', () => {
  it('las numéricas arrancan descendentes — él pide "de mayor a lo que no vendemos"', () => {
    expect(dirInicial('p3')).toBe('desc');
    expect(dirInicial('sug')).toBe('desc');
  });

  it('las de texto arrancan ascendentes', () => {
    expect(dirInicial('cod')).toBe('asc');
    expect(esTexto('prov')).toBe(true);
    expect(esTexto('doh')).toBe(false);
  });

  it('reclicar la misma columna invierte; cambiar de columna usa su inicial', () => {
    const a = siguienteOrden(null, 'p3');
    expect(a).toEqual({ clave: 'p3', dir: 'desc' });
    expect(siguienteOrden(a, 'p3')).toEqual({ clave: 'p3', dir: 'asc' });
    expect(siguienteOrden(a, 'cod')).toEqual({ clave: 'cod', dir: 'asc' });
  });
});

describe('ordenar', () => {
  const filas = [
    fila({ cod: 'A', p3: 10, sug: 5, exist: 1, doh: 20 }),
    fila({ cod: 'B', p3: 50, sug: 0, exist: 0, doh: 2 }),
    fila({ cod: 'C', p3: 30, sug: 99, exist: 4, doh: 9 }),
  ];

  it('ordena numérico descendente', () => {
    expect(ordenar(filas, { clave: 'p3', dir: 'desc' }).map((r) => r.cod)).toEqual(['B', 'C', 'A']);
  });

  it('ordena numérico ascendente', () => {
    expect(ordenar(filas, { clave: 'p3', dir: 'asc' }).map((r) => r.cod)).toEqual(['A', 'C', 'B']);
  });

  it('no muta el arreglo original', () => {
    const orig = [...filas];
    ordenar(filas, { clave: 'sug', dir: 'desc' });
    expect(filas).toEqual(orig);
  });

  it('desempata por código, para que la tabla no tiemble entre renders', () => {
    const empatadas = [fila({ cod: 'Z', p3: 7 }), fila({ cod: 'M', p3: 7 }), fila({ cod: 'Q', p3: 7 })];
    expect(ordenar(empatadas, { clave: 'p3', dir: 'desc' }).map((r) => r.cod)).toEqual(['M', 'Q', 'Z']);
    expect(ordenar(empatadas, { clave: 'p3', dir: 'asc' }).map((r) => r.cod)).toEqual(['M', 'Q', 'Z']);
  });

  it('«sin dato» (pending null) va al final en AMBAS direcciones — no es cero', () => {
    const f = [
      fila({ cod: 'A', pending: null }),
      fila({ cod: 'B', pending: 0 }),
      fila({ cod: 'C', pending: 900 }),
    ];
    expect(ordenar(f, { clave: 'pending', dir: 'desc' }).map((r) => r.cod)).toEqual(['C', 'B', 'A']);
    expect(ordenar(f, { clave: 'pending', dir: 'asc' }).map((r) => r.cod)).toEqual(['B', 'C', 'A']);
  });

  it('ordena texto con reglas del español', () => {
    const f = [fila({ cod: '1', prov: 'Zeta' }), fila({ cod: '2', prov: 'ábaco' }), fila({ cod: '3', prov: 'Beta' })];
    expect(ordenar(f, { clave: 'prov', dir: 'asc' }).map((r) => r.prov)).toEqual(['ábaco', 'Beta', 'Zeta']);
  });

  it('orden null = el de por defecto: activos primero, urgencia por DOH', () => {
    const f = [
      fila({ cod: 'muerto', p3: 0, exist: 0, sug: 0, doh: 0 }),
      fila({ cod: 'holgado', p3: 5, exist: 100, sug: 1, doh: 40 }),
      fila({ cod: 'critico', p3: 5, exist: 1, sug: 9, doh: 1 }),
    ];
    expect(ordenar(f, null).map((r) => r.cod)).toEqual(['critico', 'holgado', 'muerto']);
  });

  it('el comparador por defecto sigue siendo el que la página ya usaba', () => {
    const activo = fila({ cod: 'a', p3: 1, doh: 10 });
    const muerto = fila({ cod: 'b', p3: 0, exist: 0, sug: 0, doh: 0 });
    expect(compararPorDefecto(activo, muerto)).toBeLessThan(0);
  });
});

describe('filtrar', () => {
  const filas = [
    fila({ cod: '77201', desc: 'Vaso duroport', prov: 'Reyma', p3: 4, sug: 10, doh: 1 }),
    fila({ cod: '77202', desc: 'Bandeja negra', prov: 'Carvajal', p3: 40, sug: 0, doh: 20 }),
    fila({ cod: '77203', desc: 'Bolsa clara', prov: 'Reyma', p3: 400, sug: 7, doh: 2, flags: { tendenciaCreciente: true } }),
  ];

  it('umbral mínimo inclusivo sobre el promedio — su regla de las 10 cajas', () => {
    expect(filtrar(filas, { umbral: { clave: 'p3', min: 10 } }).map((r) => r.cod))
      .toEqual(['77202', '77203']);
  });

  it('el umbral es inclusivo en el borde exacto', () => {
    const borde = [fila({ cod: 'justo', p3: 10 }), fila({ cod: 'abajo', p3: 9.9 })];
    expect(filtrar(borde, { umbral: { clave: 'p3', min: 10 } }).map((r) => r.cod)).toEqual(['justo']);
  });

  it('busca por código y por descripción, sin distinguir mayúsculas', () => {
    expect(filtrar(filas, { texto: 'BANDEJA' }).map((r) => r.cod)).toEqual(['77202']);
    expect(filtrar(filas, { texto: '77203' }).map((r) => r.cod)).toEqual(['77203']);
  });

  it('conserva los filtros que ya existían', () => {
    expect(filtrar(filas, { proveedor: 'Reyma' })).toHaveLength(2);
    expect(filtrar(filas, { soloConSugerido: true }).map((r) => r.cod)).toEqual(['77201', '77203']);
    expect(filtrar(filas, { soloCriticos: true }).map((r) => r.cod)).toEqual(['77201', '77203']);
    expect(filtrar(filas, { soloEnAlza: true }).map((r) => r.cod)).toEqual(['77203']);
  });

  it('los filtros se combinan con Y, como el autofiltro de Excel', () => {
    expect(filtrar(filas, { proveedor: 'Reyma', umbral: { clave: 'p3', min: 100 } }).map((r) => r.cod))
      .toEqual(['77203']);
  });

  it('sin filtros devuelve todo', () => {
    expect(filtrar(filas, {})).toHaveLength(3);
  });
});

describe('vista', () => {
  it('filtra y DESPUÉS ordena — es lo que el export debe reproducir', () => {
    const filas = [
      fila({ cod: 'A', p3: 5, prov: 'X' }),
      fila({ cod: 'B', p3: 80, prov: 'X' }),
      fila({ cod: 'C', p3: 40, prov: 'Y' }),
      fila({ cod: 'D', p3: 60, prov: 'X' }),
    ];
    const out = vista(filas, { proveedor: 'X', umbral: { clave: 'p3', min: 10 } },
                      { clave: 'p3', dir: 'desc' });
    expect(out.map((r) => r.cod)).toEqual(['B', 'D']);
  });
});
