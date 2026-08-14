/**
 * ETA de las facturas del proveedor — cálculo puro (sin I/O), estilo motor.
 *
 * Regla (Alexis 2026-08-12, decisiones de Jorge 2026-08-14):
 *   ETA = fecha IMPRESA de la factura + N días hábiles, saltando sábado y
 *   domingo. N es configurable POR BODEGA (`reyma_eta_config`); default 4.
 *
 * Convención de conteo, explícita: N son días hábiles DESPUÉS de la fecha de
 * factura — la fecha de factura NO cuenta como día 1. (Medido: las ETAs que
 * Alexis escribió a mano equivalen a +3 con esta convención; ver la migración
 * 20260814000002. La manual siempre gana, y la UI muestra ambas cuando difieren.)
 *
 * Feriados: NO se consideran todavía — pregunta abierta P3. Cuando se responda,
 * se agrega un set de feriados a `sumarDiasHabiles` sin tocar a los llamadores.
 */

/** Días hábiles por defecto cuando un destino no tiene fila de config. */
export const DIAS_HABILES_DEFAULT = 4;

export type EtaFuente = 'manual' | 'calculada';

export interface EtaConfig {
  /** destino → días hábiles (última fila por destino manda). */
  porDestino: Record<string, number>;
  default: number;
}

export interface EtaResuelta {
  fecha: string | null;
  fuente: EtaFuente | null;
  /** Presente solo si hay ETA manual Y difiere de la calculada — para mostrar ambas. */
  calculadaDistinta: string | null;
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Suma `dias` días hábiles a una fecha ISO (YYYY-MM-DD), saltando sáb/dom.
 * Trabaja en UTC a propósito: estas son fechas de calendario, no instantes —
 * usar la zona local haría que la misma factura cambiara de ETA según el reloj
 * de quien mira. Devuelve null si la fecha de entrada no es interpretable
 * (nunca inventa una fecha).
 */
export function sumarDiasHabiles(fechaIso: string | null, dias: number): string | null {
  if (!fechaIso) return null;
  const m = ISO.exec(fechaIso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  if (!Number.isFinite(dias) || dias < 0) return null;

  let restantes = Math.floor(dias);
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay(); // 0 domingo, 6 sábado
    if (dow !== 0 && dow !== 6) restantes -= 1;
  }
  return d.toISOString().slice(0, 10);
}

export function diasHabilesDe(destino: string | null, config: EtaConfig): number {
  if (destino && config.porDestino[destino] !== undefined) return config.porDestino[destino];
  return config.default;
}

/** ETA calculada de una factura (sin considerar la manual). */
export function etaCalculada(
  factura: { fecha: string | null; destino: string | null },
  config: EtaConfig,
): string | null {
  return sumarDiasHabiles(factura.fecha, diasHabilesDe(factura.destino, config));
}

/**
 * ETA efectiva: la manual gana sobre la calculada (misma disciplina que las
 * proyecciones). Si hay manual y la calculada difiere, se devuelven ambas para
 * que la pantalla pueda mostrar la diferencia en vez de esconderla.
 */
export function resolverEta(
  factura: { fecha: string | null; destino: string | null; eta: string | null },
  config: EtaConfig,
): EtaResuelta {
  const calc = etaCalculada(factura, config);
  if (factura.eta) {
    return {
      fecha: factura.eta,
      fuente: 'manual',
      calculadaDistinta: calc && calc !== factura.eta ? calc : null,
    };
  }
  return { fecha: calc, fuente: calc ? 'calculada' : null, calculadaDistinta: null };
}
