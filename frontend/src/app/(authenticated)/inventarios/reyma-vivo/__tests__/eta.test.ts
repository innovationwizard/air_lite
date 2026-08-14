import {
  DIAS_HABILES_DEFAULT,
  diasHabilesDe,
  etaCalculada,
  resolverEta,
  sumarDiasHabiles,
  type EtaConfig,
} from '../eta';

const CONFIG: EtaConfig = {
  porDestino: { 'bodega-san-jose': 4, 'bodega-zacapa': 4, 'bodega-peten': 4 },
  default: DIAS_HABILES_DEFAULT,
};

describe('sumarDiasHabiles', () => {
  it('salta el fin de semana (el caso que contó Alexis: factura miércoles)', () => {
    // miércoles 12-ago-2026 → jue 13 (1), vie 14 (2), lun 17 (3), mar 18 (4)
    expect(sumarDiasHabiles('2026-08-12', 1)).toBe('2026-08-13');
    expect(sumarDiasHabiles('2026-08-12', 2)).toBe('2026-08-14');
    expect(sumarDiasHabiles('2026-08-12', 3)).toBe('2026-08-17'); // se salta sáb+dom
    expect(sumarDiasHabiles('2026-08-12', 4)).toBe('2026-08-18');
  });

  it('desde un viernes cae en lunes, no en sábado', () => {
    expect(sumarDiasHabiles('2026-08-14', 1)).toBe('2026-08-17');
  });

  it('desde un sábado, el primer hábil es el lunes', () => {
    expect(sumarDiasHabiles('2026-08-15', 1)).toBe('2026-08-17');
  });

  it('0 días devuelve la misma fecha', () => {
    expect(sumarDiasHabiles('2026-08-12', 0)).toBe('2026-08-12');
  });

  it('acepta timestamps ISO completos (la columna puede traer hora)', () => {
    expect(sumarDiasHabiles('2026-08-12T16:52:16Z', 1)).toBe('2026-08-13');
  });

  it('nunca inventa una fecha: entrada inválida o nula → null', () => {
    expect(sumarDiasHabiles(null, 4)).toBeNull();
    expect(sumarDiasHabiles('no es fecha', 4)).toBeNull();
    expect(sumarDiasHabiles('2026-08-12', -1)).toBeNull();
  });
});

describe('diasHabilesDe', () => {
  it('usa la config del destino y cae al default cuando no hay fila', () => {
    expect(diasHabilesDe('bodega-peten', CONFIG)).toBe(4);
    expect(diasHabilesDe('bodega-nueva', CONFIG)).toBe(DIAS_HABILES_DEFAULT);
    expect(diasHabilesDe(null, CONFIG)).toBe(DIAS_HABILES_DEFAULT);
  });

  it('respeta un valor distinto por bodega (Zacapa/Petén más lejos)', () => {
    const c: EtaConfig = { porDestino: { 'bodega-peten': 6 }, default: 4 };
    expect(diasHabilesDe('bodega-peten', c)).toBe(6);
    expect(diasHabilesDe('bodega-san-jose', c)).toBe(4);
  });
});

describe('resolverEta', () => {
  it('sin ETA manual usa la calculada', () => {
    const r = resolverEta(
      { fecha: '2026-08-13', destino: 'bodega-san-jose', eta: null }, CONFIG);
    expect(r).toEqual({ fecha: '2026-08-19', fuente: 'calculada', calculadaDistinta: null });
  });

  it('la ETA manual gana y expone la calculada cuando difiere', () => {
    // El override se conserva para excepciones reales (un furgón que Alexis sabe
    // atrasado). Ninguna fila lo usa hoy: las ETAs de carpeta se borraron el
    // 2026-08-14 cuando él confirmó que la calculada era la correcta.
    const r = resolverEta(
      { fecha: '2026-08-12', destino: 'bodega-peten', eta: '2026-08-17' }, CONFIG);
    expect(r.fecha).toBe('2026-08-17');
    expect(r.fuente).toBe('manual');
    expect(r.calculadaDistinta).toBe('2026-08-18');
  });

  it('si manual y calculada coinciden no marca diferencia', () => {
    const c: EtaConfig = { porDestino: { 'bodega-peten': 3 }, default: 4 };
    const r = resolverEta(
      { fecha: '2026-08-12', destino: 'bodega-peten', eta: '2026-08-17' }, c);
    expect(r.fuente).toBe('manual');
    expect(r.calculadaDistinta).toBeNull();
  });

  it('sin fecha de factura no hay ETA (no se inventa)', () => {
    expect(resolverEta({ fecha: null, destino: 'bodega-san-jose', eta: null }, CONFIG))
      .toEqual({ fecha: null, fuente: null, calculadaDistinta: null });
  });
});

describe('etaCalculada — las facturas reales de agosto 2026', () => {
  // Regla confirmada por Alexis el 2026-08-14: 4 días hábiles desde la fecha
  // IMPRESA de la factura. (Las estimaciones de los nombres de carpeta — 14-ago,
  // 17-ago — resultaron erróneas y se borraron; no son casos de prueba válidos.)
  it('reproduce la ETA de cada furgón de agosto', () => {
    const casos: Array<[string, string, string]> = [
      ['2026-08-07', 'bodega-san-jose', '2026-08-13'], // G-216..219, viernes → jueves
      ['2026-08-10', 'bodega-san-jose', '2026-08-14'], // G-220, lunes → viernes
      ['2026-08-11', 'bodega-zacapa', '2026-08-17'],   // G-223, martes → lunes
      ['2026-08-12', 'bodega-peten', '2026-08-18'],    // G-225, miércoles → martes
      ['2026-08-13', 'bodega-san-jose', '2026-08-19'], // G-226, jueves → miércoles
    ];
    for (const [fecha, destino, esperado] of casos) {
      expect(etaCalculada({ fecha, destino }, CONFIG)).toBe(esperado);
    }
  });
});
