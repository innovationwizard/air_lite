import {
  type SheetColumn, type SheetSpec,
  buildWorkbook, buildXlsx, cellRef, crc32, esc, safeSheetName, sheetXml, zip,
} from '../writer';

describe('esc', () => {
  it('escapes all five XML metacharacters', () => {
    expect(esc(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });
  it('escapes ampersands before the entities it produces', () => {
    // A naive order turns "&" into "&amp;" and then into "&amp;amp;".
    expect(esc('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
  it('leaves accented text alone — the file is UTF-8', () => {
    expect(esc('Código Petén Descripción')).toBe('Código Petén Descripción');
  });
});

describe('cellRef', () => {
  it.each([
    [1, 1, 'A1'], [2, 1, 'B1'], [7, 1, 'G1'], [26, 5, 'Z5'],
    [27, 1, 'AA1'], [28, 2, 'AB2'], [52, 1, 'AZ1'], [53, 1, 'BA1'],
  ])('col %i row %i -> %s', (c, r, want) => expect(cellRef(c, r)).toBe(want));
});

describe('safeSheetName', () => {
  it('strips the characters Excel refuses', () => {
    expect(safeSheetName('a[b]c:d*e?f/g\\h')).toBe('a-b-c-d-e-f-g-h');
  });
  it('caps at 31 characters', () => {
    expect(safeSheetName('x'.repeat(50))).toHaveLength(31);
  });
  it('falls back rather than producing an unopenable empty name', () => {
    expect(safeSheetName('   ')).toBe('Hoja1');
  });
});

describe('crc32', () => {
  it('matches the known vector for "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
  it('is 0 for empty input', () => {
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe('sheetXml', () => {
  const spec = {
    name: 'Hoja1',
    columns: [
      { header: 'Código', width: 12, type: 'text' as const },
      { header: 'San Jose', width: 10, type: 'number' as const },
    ],
    rows: [['77205406', 50], ['77205166', null]],
  };

  it('writes an empty cell — not a zero — for null', () => {
    const xml = sheetXml(spec);
    // B3 is the null cell: it must carry no <v>, or Carvajal reads "ordered 0"
    // where the truth is "not on this shipment".
    expect(xml).toContain('<c r="B3" s="2"/>');
    expect(xml).not.toContain('<c r="B3" s="2"><v>0</v>');
  });

  it('writes numbers as numbers and text as inline strings', () => {
    const xml = sheetXml(spec);
    expect(xml).toContain('<c r="B2" s="2"><v>50</v></c>');
    expect(xml).toContain('t="inlineStr"');
  });

  it('spans the autofilter over the whole data range, not just the header', () => {
    expect(sheetXml(spec)).toContain('<autoFilter ref="A1:B3"/>');
  });

  it('survives a sheet with no data rows', () => {
    const xml = sheetXml({ ...spec, rows: [] });
    expect(xml).toContain('<autoFilter ref="A1:B1"/>');
    expect(xml).toContain('Código');
  });

  it('never emits a bare NaN or Infinity into a numeric cell', () => {
    const xml = sheetXml({ ...spec, rows: [['x', Number.NaN], ['y', Infinity]] });
    expect(xml).not.toMatch(/NaN|Infinity/);
  });
});

describe('zip', () => {
  const bytes = zip([{ name: 'a.txt', content: 'hello' }]);

  it('starts with the local file header signature', () => {
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it('ends with the end-of-central-directory signature', () => {
    const i = bytes.length - 22;
    expect(Array.from(bytes.slice(i, i + 4))).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it('sets the UTF-8 flag so accented filenames and content survive', () => {
    expect(bytes[6] | (bytes[7] << 8)).toBe(0x0800);
  });

  it('is deterministic — same input, byte-identical output', () => {
    expect(Array.from(zip([{ name: 'a.txt', content: 'hello' }]))).toEqual(Array.from(bytes));
  });
});

describe('buildXlsx', () => {
  const bytes = buildXlsx({
    name: 'Hoja1',
    columns: [{ header: 'Código', width: 12, type: 'text' }],
    rows: [['77205406']],
  });

  it('produces a ZIP container', () => {
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
  });

  it('contains the six OOXML parts a reader needs', () => {
    const s = new TextDecoder().decode(bytes);
    for (const part of [
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml',
    ]) expect(s).toContain(part);
  });

  it('declares a default cell style — readers warn without it', () => {
    expect(new TextDecoder().decode(bytes)).toContain('<cellStyles count="1"');
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
 * Multi-hoja y formatos decimales (2026-09-07) — lo que el export del Sugerido
 * necesita: una hoja de trabajo más una de procedencia, y números que no se
 * redondeen al escribirse.
 * ───────────────────────────────────────────────────────────────────────────── */

const HOJA = (name: string): SheetSpec => ({
  name,
  columns: [{ header: 'Código', width: 12, type: 'text' }],
  rows: [['77205049']],
});

const texto = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('buildWorkbook', () => {
  it('rechaza un libro sin hojas en vez de escribir un archivo que no abre', () => {
    expect(() => buildWorkbook([])).toThrow(/al menos una hoja/);
  });

  it('escribe una parte por hoja', () => {
    const s = texto(buildWorkbook([HOJA('Sugerido'), HOJA('Origen')]));
    expect(s).toContain('xl/worksheets/sheet1.xml');
    expect(s).toContain('xl/worksheets/sheet2.xml');
    expect(s).toContain('<Override PartName="/xl/worksheets/sheet2.xml"');
  });

  it('nombra las hojas en el orden dado', () => {
    const s = texto(buildWorkbook([HOJA('Sugerido'), HOJA('Origen')]));
    expect(s.indexOf('name="Sugerido" sheetId="1"')).toBeGreaterThan(-1);
    expect(s.indexOf('name="Origen" sheetId="2"')).toBeGreaterThan(-1);
  });

  it('mueve la relación de estilos DETRÁS de las hojas — rId2 sólo servía con una', () => {
    const s = texto(buildWorkbook([HOJA('A'), HOJA('B')]));
    expect(s).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
    expect(s).toContain('Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"');
  });

  it('desambigua nombres repetidos — Excel no abre un libro con dos hojas iguales', () => {
    const s = texto(buildWorkbook([HOJA('Origen'), HOJA('Origen'), HOJA('origen')]));
    expect(s).toContain('name="Origen" sheetId="1"');
    expect(s).toContain('name="Origen (2)" sheetId="2"');
    expect(s).toContain('name="origen (3)" sheetId="3"');
  });

  it('buildXlsx sigue produciendo exactamente un libro de una hoja', () => {
    expect(buildXlsx(HOJA('Hoja1'))).toEqual(buildWorkbook([HOJA('Hoja1')]));
  });
});

describe('formatos numéricos', () => {
  const conTipo = (type: SheetColumn['type'], v: number) => sheetXml({
    name: 'H', columns: [{ header: 'X', width: 8, type }], rows: [[v]],
  });

  it('decimal1 conserva el decimal que #,##0 escondería', () => {
    expect(conTipo('decimal1', 2.3)).toContain('<v>2.3</v>');
  });

  it('decimal4 conserva un cubicaje unitario que si no se redondea a cero', () => {
    expect(conTipo('decimal4', 0.0042)).toContain('<v>0.0042</v>');
  });

  it('cada tipo numérico usa su propio estilo', () => {
    expect(conTipo('number', 1)).toContain('s="2"');
    expect(conTipo('decimal1', 1)).toContain('s="3"');
    expect(conTipo('decimal4', 1)).toContain('s="4"');
  });

  it('los estilos que declara existen en la hoja de estilos', () => {
    const s = texto(buildXlsx(HOJA('H')));
    expect(s).toContain('<cellXfs count="5">');
    expect(s).toContain('formatCode="#,##0.0"');
    expect(s).toContain('formatCode="#,##0.0000"');
  });

  it('un decimal no finito sigue saliendo como celda vacía', () => {
    expect(conTipo('decimal1', Number.NaN)).toContain('<c r="A2" s="3"/>');
  });
});

describe('autoFilter', () => {
  it('va puesto por defecto — filtrar en Excel es para lo que existe el archivo', () => {
    expect(sheetXml(HOJA('H'))).toContain('<autoFilter');
  });

  it('se puede quitar para una hoja que es prosa', () => {
    expect(sheetXml({ ...HOJA('H'), autoFilter: false })).not.toContain('<autoFilter');
  });
});
