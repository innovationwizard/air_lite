/**
 * Acceptance gate (plan §6): the TypeScript engine must reproduce every derived
 * cell of Alexis' frozen July workbook. The oracle is the cached-values fixture
 * written by docs/inventarios/extract_reyma_replica.py — 2,752 cells, keyed
 * (sheet, key, field). Zero unexplained mismatches ship.
 */
import { parityMap, xround, xfloorSig, estadoMatches, type ReymaData } from '../engine';
import rawData from '../data.json';
import rawFixture from './fixtures/parity_reyma_20260804.json';

interface FixtureRow {
  sheet: string;
  key: string;
  field: string;
  cached: number | string | null;
}

const fixture = rawFixture as unknown as {
  sourceSha256: string;
  cells: Array<[string, string, string, number | string | null]>;
};

const data = rawData as unknown as ReymaData;

describe('Reyma replica engine — parity vs frozen workbook fixture', () => {
  const sha = fixture.sourceSha256;
  const rows: FixtureRow[] = fixture.cells.map(([sheet, key, field, cached]) => ({
    sheet,
    key,
    field,
    cached,
  }));

  it('fixture provenance matches data.json provenance (same source workbook)', () => {
    expect(sha).toBe(data.provenance.sourceSha256);
  });

  it('fixture covers the full enumerated parity surface', () => {
    expect(rows.length).toBe(2752);
  });

  it('reproduces every derived cell within tolerance (0 unexplained mismatches)', () => {
    const computed = parityMap(data);
    const mismatches: string[] = [];
    let compared = 0;
    for (const row of rows) {
      const k = `${row.sheet} ${row.key} ${row.field}`;
      if (!computed.has(k)) {
        mismatches.push(`MISSING computed value for ${k}`);
        continue;
      }
      compared++;
      const got = computed.get(k) ?? null;
      const want = row.cached;
      if (typeof want === 'number') {
        const g = typeof got === 'number' ? got : NaN;
        const tol = Math.max(1e-9, 1e-12 * Math.abs(want));
        if (!(Math.abs(g - want) <= tol)) {
          mismatches.push(`${k}: computed=${String(got)} cached=${want}`);
        }
      } else {
        const g = got === null ? '' : String(got);
        const w = want === null ? '' : String(want);
        if (g !== w) mismatches.push(`${k}: computed=${JSON.stringify(got)} cached=${JSON.stringify(want)}`);
      }
    }
    expect(mismatches.slice(0, 25)).toEqual([]);
    expect(mismatches.length).toBe(0);
    expect(compared).toBe(rows.length);
  });
});

describe('Excel semantics helpers', () => {
  it('xround rounds half away from zero on the 15-digit decimal view', () => {
    expect(xround(18.515249999999998, 4)).toBe(18.5153); // ROUND(0.08775*211, 4)
    expect(xround(2.5)).toBe(3);
    expect(xround(-2.5)).toBe(-3);
    expect(xround(-0.47, 2)).toBe(-0.47);
    expect(xround(140.00000000000003)).toBe(140);
  });

  it('xfloorSig floors to a multiple of the significance', () => {
    expect(xfloorSig(2664, 629)).toBe(2516); // VT10 full-furgón floor
    expect(xfloorSig(628, 629)).toBe(0);
  });

  it('estadoMatches mirrors the measured SUMIF wildcards (accents + suffixes)', () => {
    expect(estadoMatches('EN TRÁNSITO', 'transito')).toBe(true);
    expect(estadoMatches('EN TRÁNSITO PETÉN', 'transito')).toBe(true);
    expect(estadoMatches('RECIBIDO ZACAPA', 'recibido')).toBe(true);
    expect(estadoMatches('ENTREGA DIRECTA', 'entrega')).toBe(true);
    expect(estadoMatches('RECIBIDO', 'transito')).toBe(false);
    expect(estadoMatches(null, 'recibido')).toBe(false);
  });
});
