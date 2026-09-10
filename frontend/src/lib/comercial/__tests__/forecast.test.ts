import {
  sumaDirecto, mesesAbiertos, mesDentroDelHorizonte, primerDiaMes, etiquetaMes,
  cicloDelMes, mesPorDefecto, estadoCiclo, consolidar, MAX_CODIGOS_POR_MES,
  type FilaForecast,
} from '../forecast';

describe('motivos', () => {
  it('solo la extraordinaria suma directo al pedido', () => {
    // Es LA distinción que hace funcionar la reunión mensual: certeza con
    // destinatario entra al pedido; proyección del canal se discute.
    expect(sumaDirecto('extraordinaria')).toBe(true);
    expect(sumaDirecto('temporada')).toBe(false);
    expect(sumaDirecto('critico')).toBe(false);
  });
});

describe('horizonte de meses', () => {
  const hoy = new Date('2026-09-01T12:00:00Z');

  it('abre el mes en curso y los dos siguientes', () => {
    expect(mesesAbiertos(hoy)).toEqual(['2026-09-01', '2026-10-01', '2026-11-01']);
  });

  it('rechaza el pasado y lo que queda mas alla del horizonte', () => {
    expect(mesDentroDelHorizonte('2026-08-01', hoy)).toBe(false);
    expect(mesDentroDelHorizonte('2026-12-01', hoy)).toBe(false);
    expect(mesDentroDelHorizonte('2026-10-01', hoy)).toBe(true);
  });

  it('cruza el fin de ano sin romperse', () => {
    expect(mesesAbiertos(new Date('2026-11-20T00:00:00Z')))
      .toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
  });

  it('primerDiaMes normaliza cualquier dia al primero', () => {
    expect(primerDiaMes(new Date('2026-09-30T23:59:00Z'))).toBe('2026-09-01');
  });

  it('etiquetaMes se lee en espanol', () => {
    expect(etiquetaMes('2026-10-01')).toBe('Octubre 2026');
  });
});

describe('ciclo del cliente', () => {
  /**
   * CORREGIDO 2026-09-10. Esta prueba afirmaba que el ciclo de un mes cae en
   * ESE mes: `cicloDelMes('2026-09-01')` = cierre 11-sep, reunion 16-sep. Se
   * escribio desde la implementacion, y las dos compartian el mismo error de
   * un mes.
   *
   * La definicion de terminado dice lo contrario en cuatro lugares (§0, §1,
   * §2 y §5 de docs/compras/DEFINICION_TERMINADO_FORECAST_COMERCIAL.md), y §5
   * no deja lugar a interpretacion: «las seis areas cargaron su forecast de
   * OCTUBRE antes del viernes 11 de SEPTIEMBRE». El cierre del 11 de
   * septiembre es el de OCTUBRE, no el de septiembre.
   *
   * Lo que costaba en pantalla: al jefe de canal que elegia correctamente
   * Octubre, el banner le anunciaba «cierra el 9 de octubre, quedan 29 dias»
   * el dia antes del cierre real.
   */
  it('octubre 2026 se captura en septiembre: cierre viernes 11, reunion miercoles 16', () => {
    const c = cicloDelMes('2026-10-01');
    expect(c.cierre.toISOString().slice(0, 10)).toBe('2026-09-11');
    expect(c.reunion.toISOString().slice(0, 10)).toBe('2026-09-16');
    expect(c.cierre.getUTCDay()).toBe(5);
    expect(c.reunion.getUTCDay()).toBe(3);
  });

  it('el ciclo de enero cae en diciembre del ano anterior', () => {
    const c = cicloDelMes('2027-01-01');
    expect(c.cierre.toISOString().slice(0, 10)).toBe('2026-12-11');
    expect(c.cierre.getUTCDay()).toBe(5);
    expect(c.reunion.getUTCDay()).toBe(3);
  });

  it('funciona en un mes cuyo ciclo empieza en fin de semana', () => {
    const c = cicloDelMes('2026-09-01'); // el ciclo corre en agosto, que abre sabado
    expect(c.cierre.getUTCDay()).toBe(5);
    expect(c.reunion.getUTCDay()).toBe(3);
  });
});

describe('mes por defecto', () => {
  /**
   * El valor por defecto es la decision de producto mas cara de esta pantalla:
   * se equivoca en los seis canales a la vez y sin que nadie lo note.
   */
  it('el 10 de septiembre abre en OCTUBRE, no en el mes en curso', () => {
    // La captura de septiembre cerro el 14 de agosto; la de octubre cierra
    // manana. Abrir en septiembre mandaba a cargar un mes ya comprado.
    expect(mesPorDefecto(new Date('2026-09-10T18:00:00Z'))).toBe('2026-10-01');
  });

  it('el dia del cierre todavia cuenta como abierto', () => {
    // Cierra al TERMINAR ese viernes, no al empezarlo: quien entra el 11 a las
    // 9 de la manana sigue a tiempo.
    expect(mesPorDefecto(new Date('2026-09-11T09:00:00Z'))).toBe('2026-10-01');
    expect(mesPorDefecto(new Date('2026-09-11T23:59:00Z'))).toBe('2026-10-01');
  });

  it('pasado el cierre salta al mes siguiente', () => {
    expect(mesPorDefecto(new Date('2026-09-12T09:00:00Z'))).toBe('2026-11-01');
  });

  it('siempre devuelve un mes del horizonte', () => {
    for (const dia of ['2026-01-05', '2026-06-30', '2026-12-31']) {
      const hoy = new Date(`${dia}T12:00:00Z`);
      expect(mesesAbiertos(hoy)).toContain(mesPorDefecto(hoy));
    }
  });
});

describe('estado del ciclo', () => {
  it('el 10 de septiembre, a octubre le queda 1 dia', () => {
    const e = estadoCiclo('2026-10-01', new Date('2026-09-10T18:00:00Z'));
    expect(e.cerrada).toBe(false);
    expect(e.diasRestantes).toBe(1);
  });

  it('marca cerrada la captura del mes en curso, sin plazo negativo', () => {
    const e = estadoCiclo('2026-09-01', new Date('2026-09-10T18:00:00Z'));
    expect(e.cerrada).toBe(true);
    expect(e.diasRestantes).toBeLessThan(0);
  });

  it('el dia del cierre no esta cerrada y marca cero dias', () => {
    const e = estadoCiclo('2026-10-01', new Date('2026-09-11T09:00:00Z'));
    expect(e.cerrada).toBe(false);
    expect(e.diasRestantes).toBe(0);
  });
});

describe('consolidar', () => {
  const fila = (o: Partial<FilaForecast> & { area: string; quantity: number }): FilaForecast => ({
    product_id: 1, sku: 'A1', nombre: 'Vaso', month: '2026-10-01',
    motivo: 'temporada', note: null, ...o,
  });

  it('suma por area y separa lo directo de lo que va a revision', () => {
    const c = consolidar([
      fila({ area: 'mayoreo', quantity: 100, motivo: 'temporada' }),
      fila({ area: 'tiendas', quantity: 50, motivo: 'critico' }),
      fila({ area: 'institucional', quantity: 30, motivo: 'extraordinaria' }),
    ], new Map());
    expect(c).toHaveLength(1);
    expect(c[0].total).toBe(180);
    expect(c[0].directo).toBe(30);
    expect(c[0].aRevision).toBe(150);
    expect(c[0].porArea).toEqual({ mayoreo: 100, tiendas: 50, institucional: 30 });
  });

  it('marca revision cuando la PROYECCION supera la de la app', () => {
    const c = consolidar([fila({ area: 'mayoreo', quantity: 200, motivo: 'temporada' })],
      new Map([[1, 150]]));
    expect(c[0].superaProyeccion).toBe(true);
  });

  it('lo extraordinario NO dispara revision aunque supere la proyeccion', () => {
    // Es certeza con destinatario: entra al pedido pase lo que pase.
    const c = consolidar([fila({ area: 'mayoreo', quantity: 900, motivo: 'extraordinaria' })],
      new Map([[1, 150]]));
    expect(c[0].aRevision).toBe(0);
    expect(c[0].superaProyeccion).toBe(false);
  });

  it('sin proyeccion de la app no inventa una comparacion', () => {
    const c = consolidar([fila({ area: 'mayoreo', quantity: 999 })], new Map());
    expect(c[0].proyeccion).toBeNull();
    expect(c[0].superaProyeccion).toBe(false);
  });

  it('separa por mes el mismo producto', () => {
    const c = consolidar([
      fila({ area: 'mayoreo', quantity: 10, month: '2026-10-01' }),
      fila({ area: 'mayoreo', quantity: 20, month: '2026-11-01' }),
    ], new Map());
    expect(c).toHaveLength(2);
    expect(c.map((x) => x.month)).toEqual(['2026-10-01', '2026-11-01']);
  });

  it('ordena por mes y luego por total descendente', () => {
    const c = consolidar([
      fila({ product_id: 1, sku: 'A', area: 'mayoreo', quantity: 10 }),
      fila({ product_id: 2, sku: 'B', area: 'mayoreo', quantity: 99 }),
    ], new Map());
    expect(c.map((x) => x.sku)).toEqual(['B', 'A']);
  });

  it('el tope por area y mes es el del proceso actual', () => {
    expect(MAX_CODIGOS_POR_MES).toBe(50);
  });
});
