import {
  compararPorDefecto, dirInicial, esTexto, filtrar, ordenar, siguienteOrden, vista,
  tablaATsv, grupoFiltroValor,
  claveCanal, esClaveCanal, slugDeClaveCanal, valorNumerico,
  type FilaOrdenable,
} from '../tabla';

function fila(over: Partial<FilaOrdenable> & { cod: string }): FilaOrdenable {
  return {
    desc: '', prov: '', provGroupId: null, exist: 0, patio: 0, doh: 0, trans: 0, pending: null,
    adic: 0, p6: 0, p3: 0, mtd: null, sug: 0, origen: null, abc: 'A',
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

describe('filtrar — grupos de proveedores (2026-09-04)', () => {
  const filas = [
    fila({ cod: 'A', prov: 'Carvajal CA', provGroupId: 'g1' }),
    fila({ cod: 'B', prov: 'Carvajal MX', provGroupId: 'g1' }),
    fila({ cod: 'C', prov: 'Reyma', provGroupId: null }),
    fila({ cod: 'D', prov: 'Darnel', provGroupId: 'g2' }),
  ];

  it('un filtro de grupo trae TODAS las filas de sus miembros, sin importar el nombre crudo', () => {
    expect(filtrar(filas, { proveedor: grupoFiltroValor('g1') }).map((r) => r.cod))
      .toEqual(['A', 'B']);
  });

  it('un filtro de nombre crudo sigue funcionando exactamente igual que antes', () => {
    expect(filtrar(filas, { proveedor: 'Reyma' }).map((r) => r.cod)).toEqual(['C']);
  });

  it('una fila sin grupo nunca matchea un filtro de grupo, aunque su nombre "parezca" un prefijo de grupo', () => {
    const conNombreRaro = [...filas, fila({ cod: 'E', prov: 'group:g1', provGroupId: null })];
    expect(filtrar(conNombreRaro, { proveedor: grupoFiltroValor('g1') }).map((r) => r.cod))
      .toEqual(['A', 'B']);
  });

  it('grupoFiltroValor antepone el prefijo que filtrar() despues quita', () => {
    expect(grupoFiltroValor('abc-123')).toBe('group:abc-123');
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

describe('W18 — columnas de la bodega que abastece', () => {
  const filas = [
    fila({ cod: 'A', origen: { exist: 50, doh: 6.5 } }),
    fila({ cod: 'B', origen: null }),               // no existe en la de origen
    fila({ cod: 'C', origen: { exist: 5000, doh: 45 } }),
  ];

  it('ordena por DOH de origen — «¿cuáles me cubre un traslado?» primero', () => {
    expect(ordenar(filas, { clave: 'origenDoh', dir: 'desc' }).map((f) => f.cod)).toEqual(['C', 'A', 'B']);
  });

  it('sin origen va al final en ambas direcciones — «no está allá» no es cero', () => {
    expect(ordenar(filas, { clave: 'origenExist', dir: 'asc' }).map((f) => f.cod)).toEqual(['A', 'C', 'B']);
    expect(ordenar(filas, { clave: 'origenExist', dir: 'desc' }).map((f) => f.cod)).toEqual(['C', 'A', 'B']);
  });

  it('un rango sobre la columna de origen deja fuera las filas sin origen', () => {
    const out = filtrar(filas, { rangos: { origenDoh: { operador: 'gte', valor: 30 } } });
    expect(out.map((f) => f.cod)).toEqual(['C']);
  });

  it('las claves nuevas son numéricas y arrancan descendentes', () => {
    expect(esTexto('origenExist')).toBe(false);
    expect(dirInicial('origenDoh')).toBe('desc');
  });
});

describe('ABC — «no puedo ordenar o filtrar ABC» (2026-09-11)', () => {
  const filas = [
    fila({ cod: 'X', abc: 'C' }),
    fila({ cod: 'Y', abc: 'A' }),
    fila({ cod: 'Z', abc: 'D' }),
    fila({ cod: 'W', abc: 'B' }),
  ];

  it('es una clave de texto: arranca A→D y el segundo clic invierte a D→A', () => {
    expect(esTexto('abc')).toBe(true);
    expect(dirInicial('abc')).toBe('asc');
    expect(ordenar(filas, { clave: 'abc', dir: 'asc' }).map((f) => f.cod)).toEqual(['Y', 'W', 'X', 'Z']);
    expect(ordenar(filas, { clave: 'abc', dir: 'desc' }).map((f) => f.cod)).toEqual(['Z', 'X', 'W', 'Y']);
  });

  it('las fichas dejan sólo las clases encendidas', () => {
    expect(filtrar(filas, { abc: ['A', 'B'] }).map((f) => f.cod).sort()).toEqual(['W', 'Y']);
  });

  it('ninguna ficha encendida = todas, no ninguna', () => {
    expect(filtrar(filas, { abc: [] })).toHaveLength(4);
    expect(filtrar(filas, {})).toHaveLength(4);
  });

  it('se combina con Y con los demás filtros', () => {
    const conSug = [fila({ cod: 'P', abc: 'A', sug: 5 }), fila({ cod: 'Q', abc: 'A', sug: 0 })];
    expect(filtrar(conSug, { abc: ['A'], soloConSugerido: true }).map((f) => f.cod)).toEqual(['P']);
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

/**
 * Ordenar por canal comercial (Wilmer, 2026-09-25): «que cada columna de canal
 * y la de canales colapsada se puedan ordenar con un clic».
 *
 * Los canales son DATOS (`comercial_areas`, se agregan sin despliegue), así que
 * su clave de orden no puede ser un literal de `ClaveOrden` como las demás: se
 * nombra `canal:<slug>`. Lo que se ordena es lo que ENTRA al pedido
 * (`directo`); lo que va «a revisión» se ve en gris y no ordena, porque todavía
 * no es una compra.
 */
describe('ordenar por canal comercial', () => {
  const porArea = (inst: number, may: number, instRev = 0) => ({
    inst: { directo: inst, aRevision: instRev },
    may: { directo: may, aRevision: 0 },
  });
  const filas = [
    fila({ cod: 'A', adic: 300, adicPorArea: porArea(100, 200) }),
    fila({ cod: 'B', adic: 700, adicPorArea: porArea(500, 200) }),
    fila({ cod: 'C', adic: 350, adicPorArea: porArea(50, 300) }),
  ];

  describe('la clave', () => {
    it('lleva el slug y se reconoce', () => {
      expect(claveCanal('inst')).toBe('canal:inst');
      expect(esClaveCanal('canal:inst')).toBe(true);
      expect(slugDeClaveCanal('canal:inst')).toBe('inst');
    });

    it('NO se confunde con las columnas fijas — ninguna lleva dos puntos', () => {
      for (const k of ['adic', 'sug', 'p3', 'cod', 'origenDoh'] as const) {
        expect(esClaveCanal(k)).toBe(false);
        expect(slugDeClaveCanal(k)).toBeNull();
      }
    });

    it('un slug con guiones sobrevive entero', () => {
      expect(slugDeClaveCanal(claveCanal('zacapa-tienda'))).toBe('zacapa-tienda');
    });
  });

  describe('el orden', () => {
    it('un canal arranca DESCENDENTE, como toda columna numérica', () => {
      expect(dirInicial(claveCanal('inst'))).toBe('desc');
      expect(esTexto(claveCanal('inst'))).toBe(false);
    });

    it('ordena por lo que pidió ESE canal, no por el total', () => {
      // Por Institucional: B 500 · A 100 · C 50 — distinto del orden por `adic`.
      expect(ordenar(filas, { clave: claveCanal('inst'), dir: 'desc' }).map((r) => r.cod))
        .toEqual(['B', 'A', 'C']);
    });

    it('cada canal da SU orden — dos canales, dos respuestas', () => {
      // Por Mayoreo: C 300 · A 200 = B 200, y el empate lo rompe el código.
      expect(ordenar(filas, { clave: claveCanal('may'), dir: 'desc' }).map((r) => r.cod))
        .toEqual(['C', 'A', 'B']);
    });

    it('ascendente invierte', () => {
      expect(ordenar(filas, { clave: claveCanal('inst'), dir: 'asc' }).map((r) => r.cod))
        .toEqual(['C', 'A', 'B']);
    });

    it('reclicar el mismo canal invierte; cambiar de canal usa su inicial', () => {
      const uno = siguienteOrden(null, claveCanal('inst'));
      expect(uno).toEqual({ clave: 'canal:inst', dir: 'desc' });
      expect(siguienteOrden(uno, claveCanal('inst')).dir).toBe('asc');
      expect(siguienteOrden(uno, claveCanal('may'))).toEqual({ clave: 'canal:may', dir: 'desc' });
    });

    it('ordena por lo DIRECTO, nunca por lo que va a revisión', () => {
      // A pide 100 directo + 900 a revisión; B pide 500 directo. Manda B.
      const conRev = [
        fila({ cod: 'A', adicPorArea: porArea(100, 0, 900) }),
        fila({ cod: 'B', adicPorArea: porArea(500, 0) }),
      ];
      expect(ordenar(conRev, { clave: claveCanal('inst'), dir: 'desc' }).map((r) => r.cod))
        .toEqual(['B', 'A']);
    });
  });

  describe('sin desglose', () => {
    it('un canal que no pidió nada vale 0 — es un dato, no «sin dato»', () => {
      expect(valorNumerico(filas[0], claveCanal('nadie'))).toBe(0);
      expect(valorNumerico(fila({ cod: 'X' }), claveCanal('inst'))).toBe(0);
    });

    it('las filas sin desglose se hunden en descendente, no se pierden', () => {
      const mixto = [
        fila({ cod: 'A' }),
        fila({ cod: 'B', adicPorArea: porArea(500, 0) }),
      ];
      const out = ordenar(mixto, { clave: claveCanal('inst'), dir: 'desc' });
      expect(out.map((r) => r.cod)).toEqual(['B', 'A']);
      expect(out).toHaveLength(2);
    });
  });

  describe('la columna colapsada «Adicionales» sigue ordenando por el total', () => {
    it('ordena por `adic`, que es la suma de los canales', () => {
      expect(ordenar(filas, { clave: 'adic', dir: 'desc' }).map((r) => r.cod))
        .toEqual(['B', 'C', 'A']);
    });

    it('el total NO es el orden de ningún canal por separado', () => {
      const porTotal = ordenar(filas, { clave: 'adic', dir: 'desc' }).map((r) => r.cod);
      const porInst = ordenar(filas, { clave: claveCanal('inst'), dir: 'desc' }).map((r) => r.cod);
      expect(porTotal).not.toEqual(porInst);
    });
  });
});
