/**
 * Minimal XLSX writer — no dependencies.
 *
 * WHY HAND-ROLLED instead of a library (decision 2026-08-21):
 *   * SheetJS on npm (`xlsx`) is the stale fork — the maintained builds moved
 *     off npm, and the published 0.18.5 carries known prototype-pollution and
 *     ReDoS advisories. Not something to put in a live client app.
 *   * `exceljs` is ~1 MB for one seven-column sheet.
 *   * Carvajal's robot format is still IN DEVELOPMENT (Jorge, 2026-08-21), so
 *     the output shape will keep changing. Owning the writer means a template
 *     change is an edit here, not a fight with someone's abstraction.
 *
 * WHAT IT SUPPORTS — deliberately only what the Carvajal sheet needs: one
 * worksheet, a styled header row, inline strings, numbers with a thousands
 * separator, per-column widths and an autofilter. No formulas, no shared
 * strings, no merged cells. If a future template needs more, add it here with
 * a test rather than reaching for a dependency.
 *
 * ZIP uses STORE (no compression). It is a valid ZIP that Excel, LibreOffice
 * and openpyxl all open; DEFLATE would only shrink a file that is already a
 * few KB, at the cost of shipping an compressor.
 *
 * VERIFIED, not assumed: on 2026-08-21 the output was generated and read back
 * with openpyxl (a real OOXML reader, not this code's own idea of the format) —
 * values, accents, XML-hostile characters, bold header, the #,##0 format,
 * numbers typed as numbers, blank-vs-zero and column widths all round-trip, and
 * the reader loads it with zero warnings. The unit tests here cover the pieces;
 * only an independent reader can prove the container is really a valid xlsx.
 */

export type CellValue = string | number | null;

export interface SheetColumn {
  /** Header text, written verbatim into row 1. */
  header: string;
  /** Column width in Excel character units. */
  width: number;
  /** 'number' renders with a #,##0 thousands separator; 'text' is a string. */
  type: 'text' | 'number';
}

export interface SheetSpec {
  /** Worksheet name (Excel caps this at 31 chars and forbids []:*?/\ ). */
  name: string;
  columns: SheetColumn[];
  /** One array per row, aligned to `columns`. null renders an EMPTY cell. */
  rows: CellValue[][];
}

// ── XML helpers ──────────────────────────────────────────────────────────────

/** Escapes the five XML metacharacters. Applied to every string that reaches a document. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** A1, B2, AA10 … 1-indexed column and row. */
export function cellRef(col: number, row: number): string {
  let c = '';
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    c = String.fromCharCode(65 + rem) + c;
    n = Math.floor((n - 1) / 26);
  }
  return `${c}${row}`;
}

/**
 * Excel forbids [ ] : * ? / \ in sheet names and caps them at 31 characters.
 * Sanitised rather than rejected: a caller should never be able to produce a
 * file that Excel silently refuses to open.
 */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[[\]:*?/\\]/g, '-').trim();
  return (cleaned || 'Hoja1').slice(0, 31);
}

const STYLE_DEFAULT = 0;
const STYLE_HEADER = 1;
const STYLE_NUMBER = 2;

function cellXml(col: number, row: number, value: CellValue, style: number, type: 'text' | 'number'): string {
  const ref = cellRef(col, row);
  const s = style === STYLE_DEFAULT ? '' : ` s="${style}"`;
  // null is an EMPTY cell, not a zero. The Carvajal sheet leaves a bodega blank
  // when it gets nothing, and a 0 there would read as "ordered zero" instead of
  // "not on this shipment".
  if (value === null || value === '') return `<c r="${ref}"${s}/>`;
  if (type === 'number' && typeof value === 'number') {
    if (!Number.isFinite(value)) return `<c r="${ref}"${s}/>`;
    return `<c r="${ref}"${s}><v>${value}</v></c>`;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(String(value))}</t></is></c>`;
}

export function sheetXml(spec: SheetSpec): string {
  const nCols = spec.columns.length;
  const nRows = spec.rows.length;
  const lastRow = nRows + 1;
  const dim = `A1:${cellRef(Math.max(nCols, 1), Math.max(lastRow, 1))}`;

  const cols = spec.columns
    .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`)
    .join('');

  const header = `<row r="1">${spec.columns
    .map((c, i) => cellXml(i + 1, 1, c.header, STYLE_HEADER, 'text'))
    .join('')}</row>`;

  const body = spec.rows
    .map((r, ri) => {
      const cells = spec.columns
        .map((c, ci) => {
          const style = c.type === 'number' ? STYLE_NUMBER : STYLE_DEFAULT;
          return cellXml(ci + 1, ri + 2, r[ci] ?? null, style, c.type);
        })
        .join('');
      return `<row r="${ri + 2}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<dimension ref="${dim}"/>`
    + `<sheetFormatPr defaultRowHeight="15"/>`
    + `<cols>${cols}</cols>`
    + `<sheetData>${header}${body}</sheetData>`
    + `<autoFilter ref="${dim}"/>`
    + `</worksheet>`;
}

/** Bold header on a light fill + a #,##0 number format. Matches the sheet Wilmer sends today. */
function stylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts>`
    + `<fonts count="2">`
    + `<font><sz val="11"/><name val="Aptos Narrow"/></font>`
    + `<font><b/><sz val="11"/><name val="Aptos Narrow"/></font>`
    + `</fonts>`
    + `<fills count="3">`
    + `<fill><patternFill patternType="none"/></fill>`
    + `<fill><patternFill patternType="gray125"/></fill>`
    + `<fill><patternFill patternType="solid"><fgColor rgb="FFE2EFDA"/><bgColor indexed="64"/></patternFill></fill>`
    + `</fills>`
    + `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>`
    + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`
    + `<cellXfs count="3">`
    + `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`
    + `<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`
    + `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`
    + `</cellXfs>`
    // Without this, readers report "workbook contains no default style" — the
    // file still opens, but a file that makes a reader complain is not done.
    + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`
    + `</styleSheet>`;
}

// ── ZIP (STORE only) ─────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

interface ZipEntry { name: string; data: Uint8Array; crc: number }

/**
 * Fixed DOS timestamp (1980-01-01) so the same input always produces byte-identical
 * output — it makes the writer testable. Excel shows the filesystem date anyway.
 */
const DOS_TIME = 0;
const DOS_DATE = 33; // (1980-1980)<<9 | 1<<5 | 1

function u16(v: number): number[] { return [v & 0xff, (v >>> 8) & 0xff]; }
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

export function zip(files: { name: string; content: string }[]): Uint8Array {
  const entries: ZipEntry[] = files.map((f) => {
    const data = utf8(f.content);
    return { name: f.name, data, crc: crc32(data) };
  });

  const local: number[] = [];
  const central: number[] = [];
  const offsets: number[] = [];

  for (const e of entries) {
    offsets.push(local.length);
    const name = utf8(e.name);
    local.push(
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(e.crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(name.length), ...u16(0),
      ...name, ...e.data,
    );
  }

  entries.forEach((e, i) => {
    const name = utf8(e.name);
    central.push(
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(DOS_TIME), ...u16(DOS_DATE),
      ...u32(e.crc), ...u32(e.data.length), ...u32(e.data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(offsets[i]),
      ...name,
    );
  });

  const end = [
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(central.length), ...u32(local.length), ...u16(0),
  ];

  return new Uint8Array([...local, ...central, ...end]);
}

// ── Public entry point ───────────────────────────────────────────────────────

export function buildXlsx(spec: SheetSpec): Uint8Array {
  const name = safeSheetName(spec.name);
  return zip([
    {
      name: '[Content_Types].xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
        + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
        + `<Default Extension="xml" ContentType="application/xml"/>`
        + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
        + `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
        + `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
        + `</Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
        + `</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" `
        + `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
        + `<sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets>`
        + `</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
        + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
        + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>`
        + `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + `</Relationships>`,
    },
    { name: 'xl/styles.xml', content: stylesXml() },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml({ ...spec, name }) },
  ]);
}
