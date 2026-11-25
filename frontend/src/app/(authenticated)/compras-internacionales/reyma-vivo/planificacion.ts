/**
 * Bin-packing del plan semanal de despacho — L3 (Alexis / Reyma).
 *
 * Reglas (docs/inventarios/RESPUESTAS_ALEXIS_2026-08-04.md + skill de Alexis):
 *  - Orden de prioridad: MENOR nivel de inventario primero (skill: "se ordena
 *    cuál es el que está con menos inventario").
 *  - Furgón = la capacidad m³ que recibe (Reyma: 100). Al llenarse se abre el
 *    siguiente (skill: "llenar furgones de 100 m3 secuencialmente").
 *  - Un producto que no cabe completo se PARTE entre furgones consecutivos.
 *  - El código furgón-completo (VT10) despacha en furgones dedicados de
 *    múltiplos exactos (regla medida del libro, FLOOR sobre cap/cubicaje).
 *  - Días disponibles y máximo de furgones/día son parámetros (rule 4: jueves
 *    excluido por preferencia, no prohibido; máx 3/día es su mitad práctica
 *    de la capacidad de recepción compartida de 6/día con Wilmer — rule 5).
 *
 * Módulo puro (sin IO) — testeado en __tests__/planificacion.test.ts.
 */
import { xround, WORKBOOK_CONSTANTS, type MrpDerived } from '../reyma/engine';
import { packLines, type PackLine } from './packLines';
import type { VivoRow } from './types';

export { packLines } from './packLines';
export type { PackLine, PackSettings, PlanDespachoPayload } from './packLines';

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

// ─── L3.5: MRP regional (Zacapa / Petén / Zona 11) ──────────────────────────
//
// RESPUESTAS regla 4 (Alexis, 2026-08-04): "para sacar un pedido para Petén y
// Zacapa tengo que poner el inventario de Zacapa… el mismo modelo del MRP",
// nivelando TODOS los productos a un mismo objetivo (~3 semanas): "el que está
// de una semana sube a tres y el que está de dos sube a tres… que no sobre,
// pero que tampoco falte". Demanda = ventas de ESA bodega (promedio móvil del
// sync por warehouse — nunca la demanda global, que sobre-pediría).

export const OBJETIVO_SEMANAS_REGIONAL_DEFAULT = 3;

export interface MrpRegionalRow {
  cod: string;
  clave: string;
  desc: string;
  inv: number;       // existencias en la bodega
  psx: number;       // pendientes por surtir (≤8 días) originados en la bodega
  transito: number;  // facturado-no-recibido con destino a la bodega
  neto: number;      // inv − psx + transito
  proyMensual: number; // promedio móvil de ventas de la bodega
  ventaSem: number;
  pedido: number;    // max(0, round(objetivo×ventaSem − neto))
  nivel: number;     // neto / ventaSem (999 sin demanda)
  m3: number;        // pedido × cubicaje
}

export interface MrpRegionalResult {
  rows: MrpRegionalRow[];
  totalCajas: number;
  totalM3: number;
  /** null cuando el modelo no tiene capacidad de furgón: no se estima con 100 m³. */
  furgonesEstimados: number | null;
}

const INV_POR_BODEGA: Record<string, (r: VivoRow) => number> = {
  SJ: (r) => r.sj + r.pat, // San José incluye patios (regla confirmada)
  Z11: (r) => r.z11,
  PET: (r) => r.pet,
  ZAC: (r) => r.zac,
};

export function mrpRegional(
  rows: VivoRow[],
  bodega: 'ZAC' | 'PET' | 'Z11',
  objetivoSemanas: number,
  capacidadM3: number | null,
): MrpRegionalResult {
  const { weeksPerMonth, coverageSentinel } = WORKBOOK_CONSTANTS;
  const getInv = INV_POR_BODEGA[bodega];
  const out: MrpRegionalRow[] = [];
  for (const r of rows) {
    const inv = getInv(r);
    const psx = r.psxPorBodega[bodega] ?? 0;
    const transito = r.transitoPorDestino[bodega] ?? 0;
    const neto = inv - psx + transito;
    const proy = r.proyeccionPorBodega[bodega] ?? 0;
    const ventaSem = xround(proy / weeksPerMonth);
    const pedido = Math.max(0, xround(objetivoSemanas * ventaSem - neto));
    if (pedido <= 0 && neto === 0 && proy === 0) continue; // sin datos en la bodega
    const nivel = ventaSem === 0 ? coverageSentinel : xround(neto / ventaSem, 2);
    out.push({
      cod: r.cod,
      clave: r.clave,
      desc: r.desc || r.prodReyma,
      inv, psx, transito, neto,
      proyMensual: proy,
      ventaSem, pedido, nivel,
      m3: pedido * r.cub,
    });
  }
  out.sort((a, b) => a.nivel - b.nivel);
  const totalCajas = out.reduce((a, x) => a + x.pedido, 0);
  const totalM3 = out.reduce((a, x) => a + x.m3, 0);
  const furgonesEstimados = capacidadM3 != null && Number.isFinite(capacidadM3) && capacidadM3 > 0
    ? Math.ceil(totalM3 / capacidadM3)
    : null;
  return { rows: out, totalCajas, totalM3, furgonesEstimados };
}

/**
 * Plan semanal de Reyma/Carvajal. El armado vive en `packLines`; acá se
 * traducen las filas del MRP y se vuelven a armar las tarjetas que pinta
 * la pantalla (clave, descripción, dedicado, avisos). Con la misma capacidad,
 * los mismos días y el mismo máximo por día, el resultado es el de antes.
 */
export function generarPlan(mrpRows: MrpDerived[], opts: PlanOpts): PlanResult {
  const meta = new Map<string, { clave: string; desc: string; cubicaje: number }>();
  const lines: PackLine[] = [];
  for (const r of mrpRows) {
    if (!meta.has(r.cod)) {
      meta.set(r.cod, { clave: r.clave, desc: r.descProv, cubicaje: r.m });
    }
    lines.push({
      codigo: r.cod,
      cajas: r.w ?? 0,
      m3_por_caja: r.m,
      semanas_cobertura: r.l,
    });
  }

  const cap = opts.capacidadM3;
  const packed = packLines(lines, cap, {
    dias: opts.dias,
    max_por_dia: opts.maxPorDia,
    cod_furgon_completo: opts.codFurgonCompleto,
  });

  const armar = (
    f: { no: number; lineas: Array<{ codigo: string; cajas: number }> },
    dia: string | null,
  ): PlanFurgon => {
    const lineas: PlanLinea[] = f.lineas.map((l) => {
      const src = meta.get(l.codigo);
      const cubicaje = src?.cubicaje ?? 0;
      return {
        cod: l.codigo,
        clave: src?.clave ?? '',
        desc: src?.desc ?? '',
        cajas: l.cajas,
        cubicaje,
        m3: l.cajas * cubicaje,
      };
    });
    const totalCajas = lineas.reduce((a, l) => a + l.cajas, 0);
    const totalM3 = lineas.reduce((a, l) => a + l.m3, 0);
    const cubDedicado = opts.codFurgonCompleto
      ? (meta.get(opts.codFurgonCompleto)?.cubicaje ?? 0)
      : 0;
    const porFurgon = cubDedicado > 0 ? Math.floor(cap / cubDedicado) : 0;
    const dedicado = lineas.length === 1
      && lineas[0].cod === opts.codFurgonCompleto
      && porFurgon > 0
      && lineas[0].cajas === porFurgon;
    return {
      no: f.no,
      dia,
      dedicado,
      lineas,
      totalCajas,
      totalM3,
      pct: totalM3 / cap,
    };
  };

  const furgones: PlanFurgon[] = [
    ...packed.dias.flatMap((d) => d.furgones.map((f) => armar(f, d.dia))),
    ...packed.sinDia.map((f) => armar(f, null)),
  ];

  const avisos: string[] = [];
  if (opts.codFurgonCompleto) {
    const fuentes = mrpRows
      .filter((r) => r.cod === opts.codFurgonCompleto && (r.w ?? 0) > 0 && r.m > 0)
      .sort((a, b) => a.l - b.l);
    for (const r of fuentes) {
      const porFurgon = Math.floor(cap / r.m);
      const cajas = r.w as number;
      const resto = porFurgon > 0
        ? cajas - Math.floor(cajas / porFurgon) * porFurgon
        : cajas;
      if (resto > 0) {
        avisos.push(
          `${r.cod}: ${resto} cajas fuera de múltiplo de furgón completo — verificar W del motor`,
        );
      }
    }
  }
  const sinDia = furgones.filter((f) => f.dia === null).length;
  if (sinDia > 0) {
    avisos.push(
      `${sinDia} furgones exceden el cupo semanal (${opts.dias.length} días × ${opts.maxPorDia}/día) — ` +
        'recuerda que la recepción es compartida con Wilmer (6/día en total)',
    );
  }
  return { furgones, avisos };
}
