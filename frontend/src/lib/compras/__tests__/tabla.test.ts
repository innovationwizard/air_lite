import {
  compararPorDefecto, dirInicial, esTexto, filtrar, ordenar, siguienteOrden, vista,
  tablaATsv, agruparPorCategoria,
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
    expect(filtrar(filas, { soloComprables: true }).map((r) => r.cod))
      .toEqual(['77201', '77202', '77203']);
  });

  it('los filtros se combinan con Y, como el autofiltro de Excel', () => {
    expect(filtrar(filas, { proveedor: 'Reyma', umbral: { clave: 'p3', min: 100 } }).map((r) => r.cod))
      .toEqual(['77203']);
  });

  it('sin filtros devuelve todo', () => {
    expect(filtrar(filas, {})).toHaveLength(4);
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

describe('agruparPorCategoria — A6.11', () => {
  const f = (cod: string, cat: string, sug: number, crit = false) => ({ cod, cat, sug, crit });
  const agrupar = (filas: ReturnType<typeof f>[]) =>
    agruparPorCategoria(filas, (x) => x.cat, (x) => x.sug, (x) => x.crit);

  it('reparte en cajones y suma el sugerido de cada uno', () => {
    const g = agrupar([f('A', 'Vasos', 10), f('B', 'Bolsas', 5), f('C', 'Vasos', 7)]);
    expect(g.map((x) => [x.categoria, x.subtotalSug])).toEqual([['Vasos', 17], ['Bolsas', 5]]);
  });

  it('CONSERVA el orden que traian las filas dentro de cada grupo', () => {
    // Si agrupar reordenara, el orden elegido en el encabezado dejaria de
    // significar algo en cuanto se activara el agrupado.
    const g = agrupar([f('Z', 'Vasos', 1), f('A', 'Vasos', 2)]);
    expect(g[0].filas.map((x) => x.cod)).toEqual(['Z', 'A']);
  });

  it('los grupos van por subtotal descendente: donde hay mas que comprar, primero', () => {
    const g = agrupar([f('A', 'Chico', 1), f('B', 'Grande', 100)]);
    expect(g[0].categoria).toBe('Grande');
  });

  it('cuenta las criticas del grupo para no tener que abrirlo', () => {
    const g = agrupar([f('A', 'Vasos', 1, true), f('B', 'Vasos', 1, false), f('C', 'Vasos', 1, true)]);
    expect(g[0].criticas).toBe(2);
  });

  it('sin categoria cae en «Sin categoria», no desaparece', () => {
    // Un producto que no se puede agrupar sigue teniendo que comprarse.
    const g = agrupar([f('A', '', 5), f('B', '   ', 3)]);
    expect(g).toHaveLength(1);
    expect(g[0].categoria).toBe('Sin categoría');
    expect(g[0].filas).toHaveLength(2);
  });

  it('empate de subtotal se desempata alfabeticamente, para que el orden sea estable', () => {
    const g = agrupar([f('A', 'Zeta', 5), f('B', 'Alfa', 5)]);
    expect(g.map((x) => x.categoria)).toEqual(['Alfa', 'Zeta']);
  });

  it('sin filas, sin grupos', () => {
    expect(agrupar([])).toEqual([]);
  });
});
