/**
 * Bin-packing del plan semanal de despacho — L3 (Alexis / Reyma).
 *
 * Reglas (docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md + skill de Alexis):
 *  - Orden de prioridad: MENOR nivel de inventario primero (skill: "se ordena
 *    cuál es el que está con menos inventario").
 *  - Furgón = capacidad m³ fija (100); al llenarse se abre el siguiente
 *    (skill: "llenar furgones de 100 m3 secuencialmente").
 *  - Un producto que no cabe completo se PARTE entre furgones consecutivos.
 *  - El código furgón-completo (VT10) despacha en furgones dedicados de
 *    múltiplos exactos (regla medida del libro, FLOOR sobre cap/cubicaje).
 *  - Días disponibles y máximo de furgones/día son parámetros (rule 4: jueves
 *    excluido por preferencia, no prohibido; máx 3/día es su mitad práctica
 *    de la capacidad de recepción compartida de 6/día con Wilmer — rule 5).
 *
 * Módulo puro (sin IO) — testeado en __tests__/planificacion.test.ts.
 */
import type { MrpDerived } from '../reyma/engine';

export interface PlanLinea {
  cod: string;
  clave: string;
  desc: string;
  cajas: number;
  cubicaje: number;
  m3: number;
}

export interface PlanFurgon {
  no: number;
  dia: string | null; // null = excede la capacidad semanal configurada
  dedicado: boolean;  // furgón completo del código dedicado
  lineas: PlanLinea[];
  totalCajas: number;
  totalM3: number;
  pct: number;
}

export interface PlanOpts {
  capacidadM3: number;
  codFurgonCompleto: string;
  /** Días hábiles de despacho en orden (default regla 4: sin jueves). */
  dias: string[];
  maxPorDia: number;
}

export interface PlanResult {
  furgones: PlanFurgon[];
  avisos: string[];
}

export const DIAS_DEFAULT = ['Lunes', 'Martes', 'Miércoles', 'Viernes'];

interface Candidato {
  cod: string;
  clave: string;
  desc: string;
  cajas: number;
  cubicaje: number;
}

export function generarPlan(mrpRows: MrpDerived[], opts: PlanOpts): PlanResult {
  const avisos: string[] = [];
  const cap = opts.capacidadM3;
  // prioridad: nivel ascendente; solo filas con pedido semanal despachable
  const candidatos: Candidato[] = [...mrpRows]
    .filter((r) => (r.w ?? 0) > 0 && r.m > 0)
    .sort((a, b) => a.l - b.l)
    .map((r) => ({ cod: r.cod, clave: r.clave, desc: r.descProv, cajas: r.w as number, cubicaje: r.m }));

  const furgones: PlanFurgon[] = [];
  let actual: PlanFurgon | null = null;

  const abrir = (dedicado = false): PlanFurgon => {
    const f: PlanFurgon = {
      no: furgones.length + 1,
      dia: null,
      dedicado,
      lineas: [],
      totalCajas: 0,
      totalM3: 0,
      pct: 0,
    };
    furgones.push(f);
    return f;
  };
  const agregar = (f: PlanFurgon, c: Candidato, cajas: number) => {
    const m3 = cajas * c.cubicaje;
    f.lineas.push({ cod: c.cod, clave: c.clave, desc: c.desc, cajas, cubicaje: c.cubicaje, m3 });
    f.totalCajas += cajas;
    f.totalM3 += m3;
    f.pct = f.totalM3 / cap;
  };

  for (const c of candidatos) {
    if (c.cod === opts.codFurgonCompleto) {
      // furgones dedicados de múltiplos exactos (el W ya viene FLOOR-eado por el motor)
      const porFurgon = Math.floor(cap / c.cubicaje);
      let resto = c.cajas;
      while (resto >= porFurgon && porFurgon > 0) {
        const f = abrir(true);
        agregar(f, c, porFurgon);
        resto -= porFurgon;
      }
      if (resto > 0) {
        avisos.push(
          `${c.cod}: ${resto} cajas fuera de múltiplo de furgón completo — verificar W del motor`,
        );
      }
      actual = null; // lo que siga abre furgón nuevo (no se mezcla con dedicados)
      continue;
    }
    let resto = c.cajas;
    while (resto > 0) {
      if (!actual || actual.dedicado) actual = abrir();
      const espacio = cap - actual.totalM3;
      const caben = Math.floor(espacio / c.cubicaje);
      if (caben < 1) {
        actual = abrir();
        continue;
      }
      const poner = Math.min(resto, caben);
      agregar(actual, c, poner);
      resto -= poner;
      if (resto > 0) actual = abrir(); // se partió: el resto va al siguiente
    }
  }

  // asignación de días: secuencial, máx N por día
  const cupo = opts.dias.length * opts.maxPorDia;
  furgones.forEach((f, i) => {
    f.dia = i < cupo ? opts.dias[Math.floor(i / opts.maxPorDia)] : null;
  });
  const sinDia = furgones.filter((f) => f.dia === null).length;
  if (sinDia > 0) {
    avisos.push(
      `${sinDia} furgones exceden el cupo semanal (${opts.dias.length} días × ${opts.maxPorDia}/día) — ` +
        'recuerda que la recepción es compartida con Wilmer (6/día en total)',
    );
  }
  return { furgones, avisos };
}
