/**
 * Bin-packing rules (L3): capacity, dedicated full-furgón code, splitting,
 * day assignment with shared-capacity awareness. Pure module, no IO.
 */
import { generarPlan, DIAS_DEFAULT, type PlanOpts } from '../planificacion';
import type { MrpDerived } from '../../reyma/engine';

const OPTS: PlanOpts = {
  capacidadM3: 100,
  codFurgonCompleto: '77201046',
  dias: DIAS_DEFAULT,
  maxPorDia: 3,
};

function row(partial: Partial<MrpDerived> & { cod: string; w: number; m: number; l: number }): MrpDerived {
  return {
    furgon: null,
    a: 0,
    clave: partial.cod,
    descProv: `prod ${partial.cod}`,
    cat: '',
    f: 0, g: 0, h: 0, i: 0, j: 0, k: partial.w, n: 0,
    o: 'OK >= 4 sem',
    sj: 0, z11: 0, pet: 0, zac: 0, pat: 0,
    x: partial.w * partial.m,
    y: null, aa: null, ab: null,
    ...partial,
  } as MrpDerived;
}

describe('generarPlan — bin-packing del despacho semanal', () => {
  it('never exceeds furgón capacity and orders by nivel ascendente', () => {
    const rows = [
      row({ cod: 'A', w: 500, m: 0.15, l: 2.0 }), // 75 m³
      row({ cod: 'B', w: 400, m: 0.10, l: 0.5 }), // 40 m³ — más urgente, va primero
      row({ cod: 'C', w: 100, m: 0.20, l: 1.0 }), // 20 m³
    ];
    const { furgones } = generarPlan(rows, OPTS);
    for (const f of furgones) {
      expect(f.totalM3).toBeLessThanOrEqual(OPTS.capacidadM3 + 1e-9);
    }
    expect(furgones[0].lineas[0].cod).toBe('B'); // menor nivel primero
    expect(furgones[0].lineas[1].cod).toBe('C');
  });

  it('splits a product that does not fit into consecutive furgones (nothing dropped)', () => {
    const rows = [row({ cod: 'X', w: 2500, m: 0.1, l: 1 })]; // 250 m³ → 3 furgones
    const { furgones } = generarPlan(rows, OPTS);
    expect(furgones.length).toBe(3);
    const total = furgones.reduce((a, f) => a + f.totalCajas, 0);
    expect(total).toBe(2500); // se parte, nunca se pierde
    expect(furgones[0].totalM3).toBeCloseTo(100);
    expect(furgones[2].totalM3).toBeCloseTo(50);
  });

  it('gives the furgón-completo code dedicated exact-multiple furgones', () => {
    // VT10: floor(100/0.15898)=629 cajas/furgón; W=1258 → 2 furgones dedicados
    const rows = [
      row({ cod: '77201046', w: 1258, m: 0.15898, l: 0.4 }),
      row({ cod: 'A', w: 100, m: 0.1, l: 1 }),
    ];
    const { furgones, avisos } = generarPlan(rows, OPTS);
    const dedicados = furgones.filter((f) => f.dedicado);
    expect(dedicados.length).toBe(2);
    for (const f of dedicados) {
      expect(f.lineas.length).toBe(1);
      expect(f.lineas[0].cajas).toBe(629);
    }
    // el producto normal NO se mezcla en furgones dedicados
    const normal = furgones.find((f) => !f.dedicado);
    expect(normal?.lineas[0].cod).toBe('A');
    expect(avisos.length).toBe(0);
  });

  it('assigns days sequentially with maxPorDia and flags weekly-capacity overflow', () => {
    // 14 furgones de un producto grande: cupo = 4 días × 3 = 12 → 2 sin día
    const rows = [row({ cod: 'X', w: 14000, m: 0.1, l: 1 })];
    const { furgones, avisos } = generarPlan(rows, { ...OPTS });
    expect(furgones.length).toBe(14);
    expect(furgones[0].dia).toBe('Lunes');
    expect(furgones[2].dia).toBe('Lunes');
    expect(furgones[3].dia).toBe('Martes');
    expect(furgones[11].dia).toBe('Viernes');
    expect(furgones[12].dia).toBeNull();
    expect(avisos.some((a) => a.includes('exceden el cupo'))).toBe(true);
    expect(avisos.some((a) => a.includes('Wilmer'))).toBe(true); // capacidad compartida visible
  });

  it('excludes rows without pedido (w=0) and is deterministic', () => {
    const rows = [
      row({ cod: 'A', w: 0, m: 0.1, l: 0.1 }),
      row({ cod: 'B', w: 10, m: 0.1, l: 5 }),
    ];
    const r1 = generarPlan(rows, OPTS);
    const r2 = generarPlan(rows, OPTS);
    expect(r1.furgones.length).toBe(1);
    expect(r1.furgones[0].lineas.map((l) => l.cod)).toEqual(['B']);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
