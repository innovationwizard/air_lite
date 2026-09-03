import { readSnapshotFiltros, readSnapshotOrden } from '../statusSnapshot';

describe('readSnapshotFiltros', () => {
  it('accepts an empty/missing filtros as "no filters"', () => {
    expect(readSnapshotFiltros(undefined)).toEqual({});
    expect(readSnapshotFiltros(null)).toEqual({});
    expect(readSnapshotFiltros({})).toEqual({ rangos: {} });
  });

  it('round-trips a full, valid filtros object', () => {
    const raw = {
      texto: 'duroport', proveedor: 'Carvajal',
      soloConSugerido: true, soloCriticos: true, soloEnAlza: false, soloComprables: true,
      rangos: { doh: { operador: 'lte', valor: 5 }, sug: { operador: 'gte', valor: 100 } },
    };
    expect(readSnapshotFiltros(raw)).toEqual(raw);
  });

  it('rejects a non-object payload', () => {
    for (const v of ['x', 5, [], true]) {
      expect(typeof readSnapshotFiltros(v)).toBe('string');
    }
  });

  it('rejects wrong-typed fields instead of coercing them', () => {
    expect(typeof readSnapshotFiltros({ texto: 5 })).toBe('string');
    expect(typeof readSnapshotFiltros({ soloCriticos: 'yes' })).toBe('string');
  });

  it('rejects a rango on an unknown or non-numeric (text) column', () => {
    expect(readSnapshotFiltros({ rangos: { cod: { operador: 'lte', valor: 1 } } }))
      .toMatch(/clave desconocida/);
    expect(readSnapshotFiltros({ rangos: { inventado: { operador: 'lte', valor: 1 } } }))
      .toMatch(/clave desconocida/);
  });

  it('rejects a rango with a bad operador or a non-numeric valor', () => {
    expect(readSnapshotFiltros({ rangos: { doh: { operador: 'eq', valor: 1 } } })).toMatch(/operador/);
    expect(readSnapshotFiltros({ rangos: { doh: { operador: 'lte', valor: 'x' } } })).toMatch(/valor/);
  });

  it('rejects an oversized texto/proveedor rather than truncating it silently', () => {
    expect(readSnapshotFiltros({ texto: 'x'.repeat(500) })).toMatch(/excede/);
    expect(readSnapshotFiltros({ proveedor: 'x'.repeat(500) })).toMatch(/excede/);
  });
});

describe('readSnapshotOrden', () => {
  it('accepts null/undefined as "the default order"', () => {
    expect(readSnapshotOrden(null)).toBeNull();
    expect(readSnapshotOrden(undefined)).toBeNull();
  });

  it('accepts a valid clave/dir pair', () => {
    expect(readSnapshotOrden({ clave: 'doh', dir: 'asc' })).toEqual({ clave: 'doh', dir: 'asc' });
  });

  it('rejects an unknown clave', () => {
    expect(readSnapshotOrden({ clave: 'inventada', dir: 'asc' })).toMatch(/clave/);
  });

  it('rejects a dir that is not asc/desc', () => {
    expect(readSnapshotOrden({ clave: 'doh', dir: 'up' })).toMatch(/dir/);
  });

  it('rejects a non-object payload', () => {
    for (const v of ['x', 5, []]) {
      expect(typeof readSnapshotOrden(v)).toBe('string');
    }
  });
});
