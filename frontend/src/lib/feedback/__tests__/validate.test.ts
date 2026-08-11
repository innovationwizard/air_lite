import {
  validateBugReport,
  SHORT_FIELD_MAX,
  LONG_FIELD_MAX,
  SCREENSHOT_B64_MAX,
} from '../validate';

const meta = {
  userAgent: 'jest',
  viewport: '1280x800',
  screen: '1440x900',
  dpr: 2,
  tz: 'America/Guatemala',
  capturedAt: '2026-08-10T12:00:00.000Z',
};

const datoBase = {
  kind: 'dato_incorrecto',
  donde: 'fila 3, columna Sugerido',
  appDice: '120',
  appDeberiaDecir: '90',
  url: 'https://airefill.app/compras/reabastecimiento-vivo',
  meta,
  screenshot: null,
};

const faltaBase = {
  kind: 'falta_algo',
  queFalta: 'Falta la columna de tránsito por bodega',
  url: 'https://airefill.app/inventarios/reyma-vivo',
  meta,
  screenshot: null,
};

describe('validateBugReport — dato_incorrecto', () => {
  it('accepts a complete report', () => {
    const result = validateBugReport(datoBase);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.donde).toBe('fila 3, columna Sugerido');
      expect(result.value.queFalta).toBeNull();
    }
  });

  it.each(['donde', 'appDice', 'appDeberiaDecir'])(
    'rejects when %s is missing, empty, or whitespace',
    (field) => {
      expect(validateBugReport({ ...datoBase, [field]: undefined }).ok).toBe(false);
      expect(validateBugReport({ ...datoBase, [field]: '' }).ok).toBe(false);
      expect(validateBugReport({ ...datoBase, [field]: '   ' }).ok).toBe(false);
    },
  );

  it('rejects short fields over the length cap', () => {
    const result = validateBugReport({ ...datoBase, donde: 'x'.repeat(SHORT_FIELD_MAX + 1) });
    expect(result.ok).toBe(false);
  });

  it('trims fields', () => {
    const result = validateBugReport({ ...datoBase, appDice: '  120  ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.appDice).toBe('120');
  });
});

describe('validateBugReport — falta_algo', () => {
  it('accepts a complete report', () => {
    const result = validateBugReport(faltaBase);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.queFalta).toContain('tránsito');
      expect(result.value.donde).toBeNull();
    }
  });

  it('rejects empty or whitespace-only description', () => {
    expect(validateBugReport({ ...faltaBase, queFalta: '' }).ok).toBe(false);
    expect(validateBugReport({ ...faltaBase, queFalta: '  \n ' }).ok).toBe(false);
  });

  it('rejects description over the length cap', () => {
    const result = validateBugReport({ ...faltaBase, queFalta: 'x'.repeat(LONG_FIELD_MAX + 1) });
    expect(result.ok).toBe(false);
  });
});

describe('validateBugReport — envelope', () => {
  it('rejects non-object bodies and unknown kinds', () => {
    expect(validateBugReport(null).ok).toBe(false);
    expect(validateBugReport('hola').ok).toBe(false);
    expect(validateBugReport({ ...datoBase, kind: 'otro' }).ok).toBe(false);
  });

  it('rejects missing or empty url', () => {
    expect(validateBugReport({ ...datoBase, url: undefined }).ok).toBe(false);
    expect(validateBugReport({ ...datoBase, url: ' ' }).ok).toBe(false);
  });

  it('rejects oversized screenshots and passes valid ones through', () => {
    expect(validateBugReport({ ...datoBase, screenshot: 'x'.repeat(SCREENSHOT_B64_MAX + 1) }).ok).toBe(false);
    const result = validateBugReport({ ...datoBase, screenshot: 'aGVsbG8=' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.screenshot).toBe('aGVsbG8=');
  });

  it('normalizes malformed meta instead of rejecting the report', () => {
    const result = validateBugReport({ ...datoBase, meta: 'garbage' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.meta.dpr).toBe(1);
  });
});
