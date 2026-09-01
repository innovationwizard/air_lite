import {
  sumaDirecto, mesesAbiertos, mesDentroDelHorizonte, primerDiaMes, etiquetaMes,
  cicloDelMes, consolidar, MAX_CODIGOS_POR_MES, type FilaForecast,
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
  it('septiembre 2026: cierre el viernes 11, reunion el miercoles 16', () => {
    // Las unicas fechas del proyecto que nacen del calendario del cliente.
    const c = cicloDelMes('2026-09-01');
    expect(c.cierre.toISOString().slice(0, 10)).toBe('2026-09-11');
    expect(c.reunion.toISOString().slice(0, 10)).toBe('2026-09-16');
    expect(c.cierre.getUTCDay()).toBe(5);
    expect(c.reunion.getUTCDay()).toBe(3);
  });

  it('funciona en un mes que empieza en fin de semana', () => {
    const c = cicloDelMes('2026-08-01'); // sabado
    expect(c.cierre.getUTCDay()).toBe(5);
    expect(c.reunion.getUTCDay()).toBe(3);
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
