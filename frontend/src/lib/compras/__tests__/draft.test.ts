import { MAX_MANUAL_QTY } from '../qty';
import { readDraftCantidades, readDraftKey } from '../draft';

describe('readDraftKey', () => {
  it('accepts a valid key and normalises the month to the 1st', () => {
    expect(readDraftKey({ proveedor: ' Carvajal ', semana: 4, mes: '2026-08' }))
      .toEqual({ proveedor: 'Carvajal', semana: 4, mes: '2026-08-01' });
    expect(readDraftKey({ proveedor: 'Carvajal', semana: '2', mes: '2026-08-21' }))
      .toEqual({ proveedor: 'Carvajal', semana: 2, mes: '2026-08-01' });
  });

  it('rejects a missing or blank proveedor', () => {
    expect(readDraftKey({ semana: 1, mes: '2026-08' })).toMatch(/proveedor/);
    expect(readDraftKey({ proveedor: '   ', semana: 1, mes: '2026-08' })).toMatch(/proveedor/);
  });

  it('rejects a semana outside 1..5 — the DB CHECK would reject it anyway', () => {
    for (const semana of [0, 6, 9, -1, 2.5]) {
      expect(typeof readDraftKey({ proveedor: 'C', semana, mes: '2026-08' })).toBe('string');
    }
  });

  it('rejects a malformed or impossible month', () => {
    for (const mes of ['2026', '2026-13', 'agosto', '', null]) {
      expect(typeof readDraftKey({ proveedor: 'C', semana: 1, mes })).toBe('string');
    }
  });
});

describe('readDraftCantidades', () => {
  it('keeps null as null — an empty cell is not a zero', () => {
    const out = readDraftCantidades({ 'San Jose VN': 1500, 'Petén': null, 'Zacapa': 800 });
    expect(out).toEqual({ 'San Jose VN': 1500, 'Petén': null, 'Zacapa': 800 });
  });

  it('keeps a real 0 as 0 — it means "order none", which is a decision', () => {
    expect(readDraftCantidades({ 'San Jose VN': 0 })).toEqual({
      'San Jose VN': 0, 'Petén': null, 'Zacapa': null,
    });
  });

  it('treats a missing bodega as an empty cell', () => {
    expect(readDraftCantidades({})).toEqual({
      'San Jose VN': null, 'Petén': null, 'Zacapa': null,
    });
  });

  it('ignores bodegas that are not part of the sheet', () => {
    const out = readDraftCantidades({ 'San Jose VN': 5, 'Marte': 99 }) as Record<string, unknown>;
    expect(out).not.toHaveProperty('Marte');
  });

  it('enforces the SAME ceiling as the other manual write-backs (2026-08-12 incident)', () => {
    expect(readDraftCantidades({ 'San Jose VN': MAX_MANUAL_QTY })).toEqual(
      { 'San Jose VN': MAX_MANUAL_QTY, 'Petén': null, 'Zacapa': null },
    );
    // The exact shape of the value that reached production and broke the page.
    expect(readDraftCantidades({ 'San Jose VN': 1_000_000_000 })).toMatch(/excede el máximo/);
  });

  it('rejects negatives, NaN, Infinity and non-numbers', () => {
    for (const v of [-1, Number.NaN, Infinity, '100', {}, []]) {
      expect(typeof readDraftCantidades({ 'San Jose VN': v })).toBe('string');
    }
  });

  it('rejects a non-object payload instead of coercing it', () => {
    for (const v of [null, 'x', 5, []]) {
      expect(typeof readDraftCantidades(v)).toBe('string');
    }
  });
});
