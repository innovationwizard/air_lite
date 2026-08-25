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

/**
 * Las 6 ETAs que Alexis escribió a mano en WhatsApp el 2026-08-24, contra la
 * fórmula. Son las PRIMERAS ETAs manuales que se cargan desde que las tres de
 * nombre de carpeta se borraron como dato malo el 2026-08-14 (`d604d15`).
 *
 * No están acá para decir que la fórmula esté mal —está dentro de ±2 días, que
 * para planear una bodega no es poco—, sino para pinear POR QUÉ hacen falta dos
 * columnas y no una:
 *
 *   G-238, G-239 y G-240 comparten fecha de factura (23-ago) y él les da 27, 28
 *   y 28. La fórmula NO PUEDE separarlas ni en principio: su única entrada es
 *   la fecha impresa. Alexis sí puede — él sabe cuándo salió cada furgón.
 *
 * Si algún día se recalibran los días hábiles (pregunta abierta Q1 para él),
 * esta tabla es donde se ve de inmediato qué mejora y qué empeora.
 */
describe('ETA Alexis vs ETA App — las 6 del 2026-08-24', () => {
  const CASOS: Array<{ guia: string; fecha: string; alexis: string; app: string; delta: number }> = [
    { guia: 'G-236', fecha: '2026-08-21', alexis: '2026-08-25', app: '2026-08-27', delta: -2 },
    { guia: 'G-237', fecha: '2026-08-20', alexis: '2026-08-25', app: '2026-08-26', delta: -1 },
    { guia: 'G-238', fecha: '2026-08-23', alexis: '2026-08-27', app: '2026-08-27', delta: 0 },
    { guia: 'G-239', fecha: '2026-08-23', alexis: '2026-08-28', app: '2026-08-27', delta: +1 },
    { guia: 'G-240', fecha: '2026-08-23', alexis: '2026-08-28', app: '2026-08-27', delta: +1 },
    { guia: 'G-241', fecha: '2026-08-24', alexis: '2026-08-28', app: '2026-08-28', delta: 0 },
  ];

  it.each(CASOS)('$guia: la app calcula $app, Alexis dijo $alexis', ({ fecha, app }) => {
    expect(etaCalculada({ fecha, destino: 'bodega-san-jose' }, CONFIG)).toBe(app);
  });

  it('la manual gana y la calculada queda visible cuando difieren', () => {
    for (const c of CASOS) {
      const r = resolverEta({ fecha: c.fecha, destino: 'bodega-san-jose', eta: c.alexis }, CONFIG);
      expect(r.fecha).toBe(c.alexis);
      expect(r.fuente).toBe('manual');
      expect(r.calculadaDistinta).toBe(c.delta === 0 ? null : c.app);
    }
  });

  it('⭐ tres furgones de la MISMA fecha reciben la MISMA ETA calculada', () => {
    // El límite duro de la fórmula, y la razón de las dos columnas.
    const mismos = CASOS.filter((c) => c.fecha === '2026-08-23');
    expect(mismos).toHaveLength(3);
    const calculadas = new Set(mismos.map((c) => etaCalculada({ fecha: c.fecha, destino: 'bodega-san-jose' }, CONFIG)));
    expect(calculadas.size).toBe(1);                        // la app no los distingue
    expect(new Set(mismos.map((c) => c.alexis)).size).toBe(2); // Alexis sí
  });

  it('2 de 6 coinciden exacto; las otras 4 se apartan 1–2 días', () => {
    const exactas = CASOS.filter((c) => c.delta === 0);
    expect(exactas).toHaveLength(2);
    for (const c of CASOS) expect(Math.abs(c.delta)).toBeLessThanOrEqual(2);
  });

  it('G-235 llegó antes de que Alexis mandara la factura — sin ETA manual, sin estado nuevo', () => {
    // «Salio 18/ agost y ya ingreso a bodega». No es una fecha, así que la fila
    // entró con eta = NULL (precedente G-226) y la app calcula 24-ago. El caso
    // se cubre dejando que el selector acepte fechas pasadas, no con un
    // booleano `ya_recibida`.
    const r = resolverEta({ fecha: '2026-08-18', destino: 'bodega-san-jose', eta: null }, CONFIG);
    expect(r).toEqual({ fecha: '2026-08-24', fuente: 'calculada', calculadaDistinta: null });
  });
});
