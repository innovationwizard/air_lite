import { ordenarBodegas, ordenarAreas, BODEGA_LABEL } from '../bodega';

describe('ordenarBodegas', () => {
  it('reorders to the canonical General → San José → Zacapa → Petén sequence', () => {
    expect(ordenarBodegas(['San Jose VN', 'Petén', 'Zacapa', 'General']))
      .toEqual(['General', 'San Jose VN', 'Zacapa', 'Petén']);
  });

  it('leaves an already-canonical list unchanged', () => {
    const canon = ['General', 'San Jose VN', 'Zacapa', 'Petén'];
    expect(ordenarBodegas(canon)).toEqual(canon);
  });

  it('appends an unknown bodega at the end rather than dropping or erroring on it', () => {
    expect(ordenarBodegas(['Zacapa', 'Marte', 'General'])).toEqual(['General', 'Zacapa', 'Marte']);
  });

  it('does not mutate the input array', () => {
    const input = ['Petén', 'General'];
    const copy = [...input];
    ordenarBodegas(input);
    expect(input).toEqual(copy);
  });
});

describe('BODEGA_LABEL', () => {
  it('maps San Jose VN to the accented, VN-less display label', () => {
    expect(BODEGA_LABEL['San Jose VN']).toBe('San José');
  });

  it('has no entry for bodegas whose identifier is already the display label', () => {
    expect(BODEGA_LABEL.General).toBeUndefined();
    expect(BODEGA_LABEL.Zacapa).toBeUndefined();
    expect(BODEGA_LABEL['Petén']).toBeUndefined();
  });
});

describe('ordenarAreas', () => {
  const a = (slug: string, nombre: string) => ({ slug, nombre });

  it('puts client types first (by name) and the sedes after, Zacapa before Petén', () => {
    // The alphabetical order the DB returns — sedes mixed in with client types.
    const alfabetico = [
      a('institucional', 'Institucional'), a('mayoreo', 'Mayoreo'), a('peten', 'Petén'),
      a('supermercados', 'Supermercados'), a('tiendas', 'Tiendas'), a('zacapa', 'Zacapa'),
    ];
    expect(ordenarAreas(alfabetico).map((x) => x.slug))
      .toEqual(['institucional', 'mayoreo', 'supermercados', 'tiendas', 'zacapa', 'peten']);
  });

  it('treats an unknown slug as a client type, not a sede', () => {
    expect(ordenarAreas([a('zacapa', 'Zacapa'), a('exportacion', 'Exportación')]).map((x) => x.slug))
      .toEqual(['exportacion', 'zacapa']);
  });

  it('does not mutate the input array', () => {
    const input = [a('zacapa', 'Zacapa'), a('mayoreo', 'Mayoreo')];
    const copy = [...input];
    ordenarAreas(input);
    expect(input).toEqual(copy);
  });
});
