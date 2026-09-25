/**
 * Cada bloque de acá abajo fija UNO de los defectos que Wilmer reportó el
 * 26-ago. No son pruebas de cobertura: son la razón por la que el archivo se
 * reescribió, escritas de forma que no puedan volver a pasar en silencio.
 */
import { type Alerta, type Tendencia } from '@/lib/compras/tendencia';
import {
  type ContextoExport, type FilaExport,
  COLUMNAS_SUGERIDO, construirHojaOrigen, construirHojaSugerido, construirLibroSugerido,
  columnasSugerido,
  describirFiltros, describirOrden, etiquetaTendencia, m3Sugerido, nombreArchivo, sinCubicaje,
} from '../sugeridoExport';

const SIN_TENDENCIA: Tendencia = { estado: 'sin-tendencia', meses: [], alzaPct: null, motivo: null };
const SIN_ALERTA: Alerta = { estado: 'sin-alerta', motivo: null };

function fila(over: Partial<FilaExport> = {}): FilaExport {
  return {
    cod: '77205049', desc: 'BANDEJA TERMICA', prov: 'Carvajal', abc: 'A',
    exist: 100, patio: 0, doh: 2.3, trans: 0, transOverridden: false,
    pending: null, adic: 0, p6: 500, p3: 600,
    mtd: 120, mtdRitmo: 640, tendencia: SIN_TENDENCIA, alerta: SIN_ALERTA,
    sugBodega: null, sug: 1000, volM3: 0.0042,
    ...over,
  };
}

function ctx(over: Partial<ContextoExport> = {}): ContextoExport {
  return {
    bodega: 'San Jose VN', bodegaLabel: 'San José',
    bodegaDetalle: 'Existencias de 1CET/Existencias únicamente.',
    proveedorLabel: 'Carvajal',
    filtros: {}, orden: null, coberturaDias: 30,
    datosAl: '2026-09-07 06:00:00', totalSinFiltros: 1065, mtdDias: 7,
    generadoEn: new Date(2026, 8, 7, 9, 30),
    ...over,
  };
}

/** Índice de una columna por su encabezado — falla ruidosamente si no existe. */
function col(header: string): number {
  const i = COLUMNAS_SUGERIDO.findIndex((c) => c.header === header);
  if (i === -1) throw new Error(`no hay columna «${header}»`);
  return i;
}

describe('nombreArchivo — A6.16 / R2', () => {
  it('se llama «Sugerido» y lleva proveedor, bodega y fecha', () => {
    expect(nombreArchivo(ctx())).toBe('Sugerido Carvajal San José 2026-09-07.xlsx');
  });

  it('NUNCA se llama «Carvajal_Prioridades Semana N» — el nombre que él rechazó', () => {
    const n = nombreArchivo(ctx({ proveedorLabel: 'Carvajal' }));
    expect(n).not.toMatch(/Prioridades/i);
    expect(n).not.toMatch(/Semana/i);
    expect(n.startsWith('Sugerido ')).toBe(true);
  });

  it('sin filtro de proveedor no inventa uno llamado «Todos»', () => {
    expect(nombreArchivo(ctx({ proveedorLabel: '' })))
      .toBe('Sugerido San José 2026-09-07.xlsx');
  });

  it('usa la fecha LOCAL, no UTC — 21:00 en Guatemala sigue siendo ese día', () => {
    expect(nombreArchivo(ctx({ generadoEn: new Date(2026, 8, 7, 21, 0) })))
      .toContain('2026-09-07');
  });

  it('neutraliza lo que rompería un nombre de archivo', () => {
    expect(nombreArchivo(ctx({ proveedorLabel: 'A/B:C*D?' }))).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe('la hoja lleva exactamente lo que estaba en pantalla — D1/D3/R1', () => {
  it('escribe las filas en el orden recibido y no vuelve a ordenar', () => {
    const filas = [fila({ cod: 'C' }), fila({ cod: 'A' }), fila({ cod: 'B' })];
    const hoja = construirHojaSugerido(filas);
    expect(hoja.rows.map((r) => r[col('Código')])).toEqual(['C', 'A', 'B']);
  });

  it('Prioridad es la posición en ese orden, 1..N', () => {
    const hoja = construirHojaSugerido([fila(), fila(), fila()]);
    expect(hoja.rows.map((r) => r[col('Prioridad')])).toEqual([1, 2, 3]);
  });

  it('exporta TODAS las filas que recibe, sin tope propio', () => {
    const filas = Array.from({ length: 900 }, (_, i) => fila({ cod: `C${i}` }));
    expect(construirHojaSugerido(filas).rows).toHaveLength(900);
  });

  it('el Sugerido que escribe es el de la fila — no lo recalcula ni lo divide', () => {
    const hoja = construirHojaSugerido([fila({ sug: 5600 })]);
    expect(hoja.rows[0][col('Sugerido')]).toBe(5600);
  });

  it('sobrevive una tabla vacía sin romperse', () => {
    expect(construirHojaSugerido([]).rows).toEqual([]);
  });
});

describe('columnas — R4', () => {
  it('no lleva NINGUNA columna de facturación', () => {
    const headers = COLUMNAS_SUGERIDO.map((c) => c.header.toLowerCase());
    expect(headers.some((h) => h.includes('fact'))).toBe(false);
    expect(headers).not.toContain('δ');
  });

  it('lleva las columnas de trabajo que pidió', () => {
    const headers = COLUMNAS_SUGERIDO.map((c) => c.header);
    for (const h of ['Código', 'Descripción', 'Ord. 3m', 'Ord. 6m', 'Exist. neta',
      'Tránsito', 'Sugerido', 'Prioridad', 'm³ sugerido']) {
      expect(headers).toContain(h);
    }
  });

  it('separa Descripción y Proveedor, que en pantalla van en una celda', () => {
    const hoja = construirHojaSugerido([fila({ desc: 'BANDEJA', prov: 'Carvajal' })]);
    expect(hoja.rows[0][col('Descripción')]).toBe('BANDEJA');
    expect(hoja.rows[0][col('Proveedor')]).toBe('Carvajal');
  });

  it('el código va como TEXTO — como número, Excel se come los ceros de la izquierda', () => {
    expect(COLUMNAS_SUGERIDO[col('Código')].type).toBe('text');
    expect(construirHojaSugerido([fila({ cod: '0351' })]).rows[0][col('Código')]).toBe('0351');
  });

  it('DOH lleva un decimal — con #,##0 un DOH de 2.3 se vería como 2', () => {
    expect(COLUMNAS_SUGERIDO[col('DOH')].type).toBe('decimal1');
    expect(construirHojaSugerido([fila({ doh: 2.3 })]).rows[0][col('DOH')]).toBe(2.3);
  });
});

describe('vacío no es cero — regla 20260813000001', () => {
  it('Pend. reserva sin dato sale VACÍA, no 0', () => {
    const hoja = construirHojaSugerido([fila({ pending: null })]);
    expect(hoja.rows[0][col('Pend. reserva')]).toBeNull();
  });

  it('un 0 capturado de verdad sí sale como 0', () => {
    expect(construirHojaSugerido([fila({ pending: 0 })]).rows[0][col('Pend. reserva')]).toBe(0);
  });

  it('«Pide bodega» sin captura sale vacía', () => {
    expect(construirHojaSugerido([fila({ sugBodega: null })]).rows[0][col('Pide bodega')]).toBeNull();
  });
});

describe('cubicaje — huecos declarados, nunca rellenados', () => {
  it('multiplica el Sugerido por el m³ unitario', () => {
    expect(m3Sugerido(1000, 0.0042)).toBeCloseTo(4.2, 10);
  });

  it('sin medida devuelve null — un 0 diría «no ocupa espacio en el furgón»', () => {
    expect(m3Sugerido(1000, null)).toBeNull();
    expect(m3Sugerido(1000, 0)).toBeNull();
  });

  it('la celda de una fila sin cubicaje queda vacía', () => {
    const hoja = construirHojaSugerido([fila({ volM3: null })]);
    expect(hoja.rows[0][col('m³ sugerido')]).toBeNull();
  });

  it('lleva el m³ unitario para que pueda recubicar tras partir la orden', () => {
    expect(construirHojaSugerido([fila({ volM3: 0.0042 })]).rows[0][col('m³ x unidad')])
      .toBe(0.0042);
  });

  it('cuenta las filas sin medida', () => {
    expect(sinCubicaje([fila(), fila({ volM3: null }), fila({ volM3: 0 })])).toBe(2);
  });
});

describe('etiquetaTendencia — el mismo texto que el badge', () => {
  it('«Revisar» gana sobre todo lo demás', () => {
    expect(etiquetaTendencia(
      { estado: 'creciente', meses: [], alzaPct: 20, motivo: null },
      { estado: 'revisar', motivo: 'sube y se despegó' },
    )).toBe('Revisar');
  });

  it('distingue «no se puede evaluar» de «no está subiendo»', () => {
    expect(etiquetaTendencia({ ...SIN_TENDENCIA, estado: 'no-evaluable' }, SIN_ALERTA)).toBe('¿?');
    expect(etiquetaTendencia(SIN_TENDENCIA, SIN_ALERTA)).toBe('—');
  });

  it('marca el alza', () => {
    expect(etiquetaTendencia(
      { estado: 'creciente', meses: [], alzaPct: 20, motivo: null }, SIN_ALERTA,
    )).toBe('Alza');
  });
});

describe('describirOrden / describirFiltros — la respuesta a D4', () => {
  it('nombra el orden por defecto en vez de callarlo', () => {
    expect(describirOrden(null)).toMatch(/DOH/);
  });

  it('dice la columna y la dirección', () => {
    expect(describirOrden({ clave: 'p3', dir: 'desc' })).toBe('Ord. 3m de mayor a menor');
  });

  it('enumera cada filtro activo', () => {
    const d = describirFiltros({
      texto: 'bandeja', soloConSugerido: true, soloCriticos: true,
      soloEnAlza: true, soloComprables: true,
      rangos: { sug: { operador: 'gte', valor: 10 } },
    });
    expect(d).toEqual(expect.arrayContaining([
      expect.stringContaining('bandeja'),
      'Solo con sugerido (Sugerido > 0)',
      'Solo quiebre (DOH < 3)',
      'Solo en alza (dos alzas seguidas)',
      'Solo comprables (purchase_ok en Odoo)',
      'Sugerido ≥ 10',
    ]));
  });

  it('sin filtros no inventa ninguno', () => {
    expect(describirFiltros({})).toEqual([]);
  });
});

describe('ABC en la hoja Origen', () => {
  it('el filtro por clase y el orden por ABC se describen', () => {
    expect(describirFiltros({ abc: ['A', 'B'] })).toContain('Clase ABC: A, B');
    expect(describirFiltros({ abc: [] })).toEqual([]);
    expect(describirOrden({ clave: 'abc', dir: 'asc' })).toMatch(/^ABC/);
  });
});

describe('hoja Origen — de dónde salió cada número', () => {
  const texto = (hoja: { rows: (string | number | null)[][] }) =>
    hoja.rows.map((r) => r.map((c) => String(c ?? '')).join(' | ')).join('\n');

  it('declara bodega, proveedor, orden y conteo', () => {
    const t = texto(construirHojaOrigen([fila()], ctx()));
    expect(t).toContain('San José');
    expect(t).toContain('Carvajal');
    expect(t).toContain('DOH');
    expect(t).toContain('Filas exportadas | 1');
  });

  it('dice cuántas filas quedaron fuera por los filtros', () => {
    expect(texto(construirHojaOrigen([fila()], ctx({ totalSinFiltros: 1065 }))))
      .toContain('Filas en la bodega sin filtrar | 1065');
  });

  it('advierte del cubicaje incompleto con el conteo exacto', () => {
    const t = texto(construirHojaOrigen([fila(), fila({ volM3: null })], ctx()));
    expect(t).toContain('1 de 2 filas exportadas no tienen m³ medido');
    expect(t).toMatch(/INCOMPLETA/);
  });

  it('no inventa una advertencia cuando no hay huecos', () => {
    const t = texto(construirHojaOrigen([fila()], ctx()));
    expect(t).not.toMatch(/no tienen m³ medido/);
    expect(t).toContain('Todas las filas exportadas tienen m³ medido.');
  });

  it('declara la unidad sin verificar y las bolsas mal medidas', () => {
    const t = texto(construirHojaOrigen([fila()], ctx()));
    expect(t).toMatch(/unidad/i);
    expect(t).toMatch(/bolsa/i);
  });

  it('dice hasta cuándo llegan los datos, y lo dice también cuando no hay sync', () => {
    expect(texto(construirHojaOrigen([fila()], ctx()))).toContain('2026-09-07 06:00:00');
    expect(texto(construirHojaOrigen([fila()], ctx({ datosAl: null }))))
      .toContain('sin sincronización registrada');
  });

  it('sin proveedor filtrado lo dice con todas las letras', () => {
    expect(texto(construirHojaOrigen([fila()], ctx({ proveedorLabel: '' }))))
      .toContain('Todos (sin filtro de proveedor)');
  });

  it('no lleva autofiltro: es prosa, no una tabla', () => {
    expect(construirHojaOrigen([fila()], ctx()).autoFilter).toBe(false);
  });
});

describe('W18 — columnas de la bodega que abastece', () => {
  const conOrigen = fila({ origen: { exist: 50, p3: 200, doh: 6.5 } });
  const sinOrigen = fila({ cod: '0002', origen: null });

  it('sin etiqueta de origen (General, San José) las columnas NO existen', () => {
    const headers = columnasSugerido([], null).map((c) => c.header);
    expect(headers.some((h) => h.startsWith('Exist. ') && h !== 'Exist. neta')).toBe(false);
  });

  it('con origen van las tres, justo después del DOH propio y en ese orden', () => {
    const headers = columnasSugerido([], 'San José').map((c) => c.header);
    const i = headers.indexOf('DOH');
    expect(headers.slice(i, i + 4)).toEqual(['DOH', 'Exist. San José', 'Ord. 3m San José', 'DOH San José']);
  });

  it('sobreviven a las columnas por canal, que se insertan antes de Adicionales', () => {
    const headers = columnasSugerido([{ slug: 'inst', nombre: 'Institucional' }], 'Zacapa').map((c) => c.header);
    expect(headers.indexOf('DOH Zacapa')).toBeLessThan(headers.indexOf('Institucional'));
    expect(headers.indexOf('Institucional (rev.)')).toBeLessThan(headers.indexOf('Adicionales'));
    expect(headers).not.toContain('Adic.');
  });

  /**
   * CANALES plegados/desplegados (Wilmer, 2026-09-25). El botón de la pantalla
   * le pasa a este mismo constructor la lista de canales VISIBLES: plegado, la
   * lista viaja vacía. Lo que no puede pasar, en ningún modo, es que se mueva
   * un número — plegar es presentación, y «Adicionales» es lo que entra al
   * pedido.
   */
  describe('el desglose por canal se pliega sin mover ningún número', () => {
    const AREAS = [
      { slug: 'inst', nombre: 'Institucional' },
      { slug: 'may', nombre: 'Mayoreo' },
    ];
    const f = fila({
      adic: 800,
      adicPorArea: {
        inst: { directo: 500, aRevision: 70 },
        may: { directo: 300, aRevision: 0 },
      },
    });

    it('plegado no queda NINGUNA columna de canal', () => {
      const headers = columnasSugerido([], null).map((c) => c.header);
      for (const a of AREAS) {
        expect(headers).not.toContain(a.nombre);
        expect(headers).not.toContain(`${a.nombre} (rev.)`);
      }
    });

    it('«Adicionales» está en los DOS modos — es el número que entra al pedido', () => {
      expect(columnasSugerido([], null).map((c) => c.header)).toContain('Adicionales');
      expect(columnasSugerido(AREAS, null).map((c) => c.header)).toContain('Adicionales');
    });

    it('Adicionales vale lo mismo plegado que desplegado', () => {
      const plegado = construirHojaSugerido([f], [], null);
      const abierto = construirHojaSugerido([f], AREAS, null);
      const vPlegado = plegado.rows[0][plegado.columns.findIndex((c) => c.header === 'Adicionales')];
      const vAbierto = abierto.rows[0][abierto.columns.findIndex((c) => c.header === 'Adicionales')];
      expect(vPlegado).toBe(800);
      expect(vAbierto).toBe(800);
    });

    it('el Sugerido y el m³ no dependen del modo', () => {
      const plegado = construirHojaSugerido([f], [], null);
      const abierto = construirHojaSugerido([f], AREAS, null);
      for (const col of ['Sugerido', 'm³ sugerido']) {
        const iP = plegado.columns.findIndex((c) => c.header === col);
        const iA = abierto.columns.findIndex((c) => c.header === col);
        expect(iP).toBeGreaterThanOrEqual(0);
        expect(plegado.rows[0][iP]).toEqual(abierto.rows[0][iA]);
      }
    });

    it('plegar quita columnas y NADA más: el resto sigue igual, en el mismo orden', () => {
      const plegado = construirHojaSugerido([f], [], null).columns.map((c) => c.header);
      const abierto = construirHojaSugerido([f], AREAS, null).columns.map((c) => c.header);
      const porCanal = AREAS.flatMap((a) => [a.nombre, `${a.nombre} (rev.)`]);
      expect(abierto.filter((h) => !porCanal.includes(h))).toEqual(plegado);
    });

    it('desplegado cada canal lleva SU cifra — el desglose no se mezcla', () => {
      const hoja = construirHojaSugerido([f], AREAS, null);
      const h = hoja.columns.map((c) => c.header);
      expect(hoja.rows[0][h.indexOf('Institucional')]).toBe(500);
      expect(hoja.rows[0][h.indexOf('Institucional (rev.)')]).toBe(70);
      expect(hoja.rows[0][h.indexOf('Mayoreo')]).toBe(300);
      expect(hoja.rows[0][h.indexOf('Mayoreo (rev.)')]).toBe(0);
    });

    it('cada fila tiene exactamente tantos valores como columnas, en los dos modos', () => {
      for (const areas of [[], AREAS]) {
        const hoja = construirHojaSugerido([f], areas, null);
        expect(hoja.rows[0]).toHaveLength(hoja.columns.length);
      }
    });
  });

  it('lleva las cifras de la bodega de origen; sin fila allá va VACÍO, no 0', () => {
    const hoja = construirHojaSugerido([conOrigen, sinOrigen], [], 'San José');
    const h = hoja.columns.map((c) => c.header);
    expect(hoja.rows[0][h.indexOf('Exist. San José')]).toBe(50);
    expect(hoja.rows[0][h.indexOf('Ord. 3m San José')]).toBe(200);
    expect(hoja.rows[0][h.indexOf('DOH San José')]).toBe(6.5);
    expect(hoja.rows[1][h.indexOf('Exist. San José')]).toBeNull();
    expect(hoja.rows[1][h.indexOf('DOH San José')]).toBeNull();
  });

  it('el libro toma la etiqueta del contexto y la hoja Origen explica las columnas', () => {
    const libro = construirLibroSugerido([conOrigen], ctx({ bodega: 'Zacapa', bodegaLabel: 'Zacapa', bodegaOrigenLabel: 'San José' }));
    expect(libro[0].columns.map((c) => c.header)).toContain('DOH San José');
    const origen = libro[1].rows.map((r) => r.join(' ')).join('\n');
    expect(origen).toContain('Exist. / Ord. 3m / DOH San José');
    expect(origen).toContain('abastece a Zacapa');
  });
});

describe('construirLibroSugerido', () => {
  it('son dos hojas: la de trabajo primero, el origen después', () => {
    const libro = construirLibroSugerido([fila()], ctx());
    expect(libro.map((h) => h.name)).toEqual(['Sugerido', 'Origen']);
  });

  it('la hoja de trabajo conserva el autofiltro que él usa en Excel', () => {
    expect(construirLibroSugerido([fila()], ctx())[0].autoFilter).not.toBe(false);
  });
});
