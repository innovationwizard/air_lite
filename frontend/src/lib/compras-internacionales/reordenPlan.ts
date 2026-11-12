/**
 * Líneas que `packLines` espera, armadas con el pedido que ya calculó el
 * modelo de punto de reorden (Darnel / Asia).
 *
 * Este módulo no empaca. La pantalla llama a `packLines` con la capacidad del
 * contenedor. Acá sólo se traduce el pedido que la pantalla ya muestra:
 *   - cantidad = `pedirMl` (columna Pedir, en millares);
 *   - m³ por unidad = `cub_millar` de `reorden_inventario` (m³ por millar);
 *   - prioridad = cobertura total en semanas (menor cobertura primero).
 *     Sin cobertura medible, la prioridad es 0: un pedido con inventario
 *     negativo y sin venta entra al primer furgón.
 */

export interface InsumoFurgon {
  codigo: string;
  descripcion: string | null;
  pedirMl: number;
  coberturaTotal: number | null;
  cubMillar: number | null;
}

/** Misma forma que `PackLine`. Se declara acá para no acoplar este módulo al archivo de Reyma. */
export interface LineaEmpaque {
  codigo: string;
  cajas: number;
  m3_por_caja: number;
  semanas_cobertura: number;
}

export interface MetaLinea {
  codigo: string;
  descripcion: string;
  m3PorMillar: number;
  semanasCobertura: number;
}

export interface LineasEmpaque {
  lines: LineaEmpaque[];
  meta: MetaLinea[];
  avisos: string[];
}

/** Resultado de `packLines`, leído sólo en la forma que este plan necesita. */
export interface PlanEmpacado {
  dias: Array<{
    dia: string;
    furgones: Array<{ no: number; lineas: Array<{ codigo: string; cajas: number }> }>;
  }>;
  sinDia: Array<{ no: number; lineas: Array<{ codigo: string; cajas: number }> }>;
}

export interface FurgonVista {
  no: number;
  lineas: Array<{
    codigo: string;
    descripcion: string;
    cantidadMl: number;
    m3: number;
  }>;
  totalMl: number;
  totalM3: number;
}

export interface PayloadPlanReorden {
  capacidad_m3: number;
  unidad: 'ML';
  plan: PlanEmpacado;
  meta: MetaLinea[];
}

/** null, 0 o un valor que no es un m³ usable. No se sustituye por 70. */
export function capacidadContenedor(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function listaCorta(codigos: readonly string[]): string {
  const mostrados = codigos.slice(0, 8);
  const resto = codigos.length - mostrados.length;
  return resto > 0 ? `${mostrados.join(', ')} y ${resto} más` : mostrados.join(', ');
}

/**
 * Traduce el pedido sugerido a líneas de empaque.
 * Un millar que no cabe entero en el contenedor se deja fuera: `packLines`
 * no puede colocarlo y abriría furgones sin avanzar.
 */
export function lineasDeSugerido(
  filas: readonly InsumoFurgon[],
  capacidadM3: number,
): LineasEmpaque {
  const lines: LineaEmpaque[] = [];
  const meta: MetaLinea[] = [];
  const sinCubicaje: string[] = [];
  const noCaben: string[] = [];

  for (const f of filas) {
    if (!Number.isFinite(f.pedirMl) || f.pedirMl <= 0) continue;
    const m3 = f.cubMillar;
    if (m3 == null || !Number.isFinite(m3) || m3 <= 0) {
      sinCubicaje.push(f.codigo);
      continue;
    }
    if (Math.floor(capacidadM3 / m3) < 1) {
      noCaben.push(f.codigo);
      continue;
    }
    const semanas = f.coberturaTotal != null && Number.isFinite(f.coberturaTotal)
      ? f.coberturaTotal
      : 0;
    lines.push({
      codigo: f.codigo,
      cajas: f.pedirMl,
      m3_por_caja: m3,
      semanas_cobertura: semanas,
    });
    meta.push({
      codigo: f.codigo,
      descripcion: f.descripcion ?? '',
      m3PorMillar: m3,
      semanasCobertura: semanas,
    });
  }

  const avisos: string[] = [];
  if (sinCubicaje.length > 0) {
    const n = sinCubicaje.length;
    avisos.push(
      `${n} ${n === 1 ? 'producto tiene' : 'productos tienen'} pedido pero no m³ por millar, `
      + `y ${n === 1 ? 'queda' : 'quedan'} fuera del plan: ${listaCorta(sinCubicaje)}.`,
    );
  }
  if (noCaben.length > 0) {
    const n = noCaben.length;
    avisos.push(
      `${n} ${n === 1 ? 'producto no cabe' : 'productos no caben'} en el contenedor ni con un millar, `
      + `y ${n === 1 ? 'queda' : 'quedan'} fuera del plan: ${listaCorta(noCaben)}.`,
    );
  }
  return { lines, meta, avisos };
}

export function proyectarFurgones(
  plan: PlanEmpacado,
  meta: readonly MetaLinea[],
): FurgonVista[] {
  const porCodigo = new Map(meta.map((m) => [m.codigo, m]));
  const crudos = [
    ...plan.dias.flatMap((d) => d.furgones),
    ...plan.sinDia,
  ];
  return crudos.map((f) => {
    const lineas = f.lineas.map((l) => {
      const src = porCodigo.get(l.codigo);
      const m3PorMillar = src?.m3PorMillar ?? 0;
      return {
        codigo: l.codigo,
        descripcion: src?.descripcion ?? '',
        cantidadMl: l.cajas,
        m3: l.cajas * m3PorMillar,
      };
    });
    return {
      no: f.no,
      lineas,
      totalMl: lineas.reduce((a, l) => a + l.cantidadMl, 0),
      totalM3: lineas.reduce((a, l) => a + l.m3, 0),
    };
  });
}

export function payloadPlan(
  capacidadM3: number,
  plan: PlanEmpacado,
  meta: readonly MetaLinea[],
): PayloadPlanReorden {
  return {
    capacidad_m3: capacidadM3,
    unidad: 'ML',
    plan,
    meta: meta.map((m) => ({ ...m })),
  };
}

/** null cuando el objeto se puede guardar. El texto es el error para el comprador. */
export function validarPayloadPlan(payload: unknown, capacidadM3: number): string | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return 'payload debe ser un objeto';
  }
  const p = payload as Record<string, unknown>;
  if (p.unidad !== 'ML') return 'la cantidad del plan está en millares (unidad ML)';
  const declarada = capacidadContenedor(p.capacidad_m3);
  if (declarada === null || Math.abs(declarada - capacidadM3) > 0.001) {
    return 'la capacidad del plan no coincide con el contenedor del modelo';
  }
  const plan = p.plan;
  if (typeof plan !== 'object' || plan === null || Array.isArray(plan)) {
    return 'payload.plan debe ser el resultado de packLines';
  }
  const pl = plan as Record<string, unknown>;
  if (!Array.isArray(pl.dias) || !Array.isArray(pl.sinDia)) {
    return 'payload.plan debe traer dias y sinDia';
  }
  if (!Array.isArray(p.meta)) return 'payload.meta debe ser una lista';
  return null;
}
