import {
  buildCarvajalSheet, carvajalFilename, lineTotal, weekOfMonth, CARVAJAL_BODEGAS,
} from '../carvajal';

const line = (cod: string, desc: string, sj: number | null, pet: number | null, zac: number | null) =>
  ({ cod, desc, cantidades: { 'San Jose VN': sj, 'Petén': pet, 'Zacapa': zac } });

describe('column order — the supplier owns the format', () => {
  it('puts Prioridad BETWEEN San Jose and Petén, exactly as Carvajal sends it', () => {
    const s = buildCarvajalSheet([]);
    expect(s.columns.map((c) => c.header)).toEqual([
      'Código', 'Descripción', 'San Jose', 'Prioridad', 'Petén', 'Zacapa', 'Total',
    ]);
  });
});

describe('rows', () => {
  it('reproduces a real row from the file Wilmer sends', () => {
    // Screenshot 2026-08-21, row 4: 1,200 / prioridad 3 / 250 / 700 / 2,150
    const s = buildCarvajalSheet([
      line('77205406', 'VASO 22OZ BF IMPRESO FRUTAS BIO 20X50', 50, 5, 15),
      line('77205404', 'VASO 12OZ BF IMPRESO FRUTAS BIO 20X50', 55, 5, 15),
      line('77205034', 'PORTACOMIDA  BIO  7X7 C/D TERMO 4/50', 1200, 250, 700),
    ]);
    expect(s.rows[2]).toEqual([
      '77205034', 'PORTACOMIDA  BIO  7X7 C/D TERMO 4/50', 1200, 3, 250, 700, 2150,
    ]);
  });

  it('numbers Prioridad 1..N from the order it is given', () => {
    const s = buildCarvajalSheet([
      line('A', 'a', 1, null, null), line('B', 'b', 2, null, null), line('C', 'c', 3, null, null),
    ]);
    expect(s.rows.map((r) => r[3])).toEqual([1, 2, 3]);
  });

  it('leaves a bodega BLANK — never 0 — when it gets nothing', () => {
    // 0 would tell Carvajal "ordered none"; blank says "not on this shipment".
    const s = buildCarvajalSheet([line('77205166', 'PLATO TERMOFOM NO. 8 HONDO 20/25', 200, null, null)]);
    expect(s.rows[0]).toEqual(['77205166', 'PLATO TERMOFOM NO. 8 HONDO 20/25', 200, 1, null, null, 200]);
  });
});

describe('lineTotal', () => {
  it('sums the three bodegas', () => {
    expect(lineTotal(line('x', 'x', 580, 50, 120))).toBe(750);   // screenshot row 15
  });
  it('treats blanks as absent, not zero', () => {
    expect(lineTotal(line('x', 'x', 435, null, null))).toBe(435); // screenshot row 9
  });
  it('is blank when every bodega is blank', () => {
    expect(lineTotal(line('x', 'x', null, null, null))).toBeNull();
  });
  it('keeps a real 0 as a real 0', () => {
    expect(lineTotal(line('x', 'x', 0, null, null))).toBe(0);
  });
});

describe('weekOfMonth', () => {
  it.each([[1, 1], [7, 1], [8, 2], [14, 2], [15, 3], [21, 3], [22, 4], [28, 4], [29, 5]])(
    'day %i -> semana %i', (day, want) => {
      expect(weekOfMonth(new Date(2026, 7, day))).toBe(want);
    });
});

describe('carvajalFilename', () => {
  it('matches the name he uses today', () => {
    expect(carvajalFilename(4, new Date(2026, 7, 21)))
      .toBe('Carvajal_Prioridades Semana 4 Agosto 2026.xlsx');
  });
  it('uses the Spanish month of the given date', () => {
    expect(carvajalFilename(1, new Date(2026, 11, 2))).toContain('Diciembre 2026');
  });
  it('strips characters that break a filename', () => {
    expect(carvajalFilename(2, new Date(2026, 7, 1), 'Carvajal/Empaques:*?'))
      .toBe('CarvajalEmpaques_Prioridades Semana 2 Agosto 2026.xlsx');
  });
  it('keeps accents — they are legal in filenames', () => {
    expect(carvajalFilename(2, new Date(2026, 7, 1), 'Envaica Petén')).toContain('Envaica Petén_');
  });
});

describe('bodega set', () => {
  it('is the three split purchasing bodegas, in sheet order', () => {
    expect(CARVAJAL_BODEGAS).toEqual(['San Jose VN', 'Petén', 'Zacapa']);
  });
});
