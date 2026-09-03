import {
  compararPorDefecto, dirInicial, esTexto, filtrar, ordenar, siguienteOrden, vista,
  tablaATsv,
  type FilaOrdenable,
} from '../tabla';

function fila(over: Partial<FilaOrdenable> & { cod: string }): FilaOrdenable {
  return {
    desc: '', prov: '', exist: 0, patio: 0, doh: 0, trans: 0, pending: null,
    adic: 0, p6: 0, p3: 0, mtd: null, sug: 0,
    flags: { tendenciaCreciente: false },
    purchaseOk: true,
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
    fila({ cod: '77204', desc: 'Tapa cristal', prov: 'Carvajal', p3: 5, sug: 0, doh: 15, purchaseOk: false }),
  ];

  it('busca por código y por descripción, sin distinguir mayúsculas', () => {
    expect(filtrar(filas, { texto: 'BANDEJA' }).map((r) => r.cod)).toEqual(['77202']);
    expect(filtrar(filas, { texto: '77203' }).map((r) => r.cod)).toEqual(['77203']);
  });

  it('conserva los filtros que ya existían', () => {
    expect(filtrar(filas, { proveedor: 'Reyma' })).toHaveLength(2);
    expect(filtrar(filas, { soloConSugerido: true }).map((r) => r.cod)).toEqual(['77201', '77203']);
    expect(filtrar(filas, { soloCriticos: true }).map((r) => r.cod)).toEqual(['77201', '77203']);
    expect(filtrar(filas, { soloEnAlza: true }).map((r) => r.cod)).toEqual(['77203']);
    expect(filtrar(filas, { soloComprables: true }).map((r) => r.cod))
      .toEqual(['77201', '77202', '77203']);
  });

  it('los filtros se combinan con Y, como el autofiltro de Excel', () => {
    expect(filtrar(filas, { proveedor: 'Reyma', soloConSugerido: true }).map((r) => r.cod))
      .toEqual(['77201', '77203']);
  });

  it('sin filtros devuelve todo', () => {
    expect(filtrar(filas, {})).toHaveLength(4);
  });
});

describe('filtrar — rangos ≤/≥ por columna', () => {
  const filas = [
    fila({ cod: 'A', doh: 1, p3: 10, pending: null }),
    fila({ cod: 'B', doh: 5, p3: 40, pending: 0 }),
    fila({ cod: 'C', doh: 20, p3: 400, pending: 900 }),
  ];

  it('≤ deja solo lo menor o igual al valor', () => {
    expect(filtrar(filas, { rangos: { doh: { operador: 'lte', valor: 5 } } }).map((r) => r.cod))
      .toEqual(['A', 'B']);
  });

  it('≥ deja solo lo mayor o igual al valor', () => {
    expect(filtrar(filas, { rangos: { doh: { operador: 'gte', valor: 5 } } }).map((r) => r.cod))
      .toEqual(['B', 'C']);
  });

  it('varias columnas se combinan con Y', () => {
    expect(filtrar(filas, {
      rangos: {
        doh: { operador: 'gte', valor: 2 },
        p3: { operador: 'lte', valor: 100 },
      },
    }).map((r) => r.cod)).toEqual(['B']);
  });

  it('«sin dato» nunca cumple un rango, en ninguna dirección — no es cero', () => {
    expect(filtrar(filas, { rangos: { pending: { operador: 'gte', valor: 0 } } }).map((r) => r.cod))
      .toEqual(['B', 'C']);
    expect(filtrar(filas, { rangos: { pending: { operador: 'lte', valor: 900 } } }).map((r) => r.cod))
      .toEqual(['B', 'C']);
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
    const out = vista(filas, { proveedor: 'X' }, { clave: 'p3', dir: 'desc' });
    expect(out.map((r) => r.cod)).toEqual(['B', 'D', 'A']);
  });
});

describe('tablaATsv — copiar lo visible', () => {
  const cols = [
    { encabezado: 'Código', valor: (r: Record<string, unknown>) => r.cod as string },
    { encabezado: 'Sugerido', valor: (r: Record<string, unknown>) => r.sug as number },
  ];

  it('encabezado y filas separados por tabulaciones', () => {
    const tsv = tablaATsv([{ cod: 'A1', sug: 10 }, { cod: 'B2', sug: 20 }], cols);
    expect(tsv).toBe('Código\tSugerido\nA1\t10\nB2\t20');
  });

  it('respeta el orden recibido: no reordena nada', () => {
    // El defecto del 26-ago fue exactamente que el archivo decidia por su cuenta.
    const tsv = tablaATsv([{ cod: 'Z9', sug: 1 }, { cod: 'A1', sug: 2 }], cols);
    expect(tsv.split('\n')[1]).toBe('Z9\t1');
  });

  it('neutraliza tabuladores y saltos dentro de una celda', () => {
    // Sin esto, una descripcion con un tabulador corre todas las columnas
    // siguientes y el resultado se ve plausible — que es lo peor posible.
    const tsv = tablaATsv([{ cod: 'A\t1', sug: 5 }], cols);
    expect(tsv.split('\n')[1]).toBe('A 1\t5');
    expect(tablaATsv([{ cod: 'x\ny', sug: 1 }], cols).split('\n')).toHaveLength(2);
  });

  it('vacio y nulo se copian como celda vacia, no como «null»', () => {
    expect(tablaATsv([{ cod: null, sug: undefined }], cols).split('\n')[1]).toBe('\t');
  });

  it('sin filas copia solo el encabezado', () => {
    expect(tablaATsv([], cols)).toBe('Código\tSugerido');
  });
});
