/**
 * The config_rules keys the admin page edits, and the shapes the calculation
 * accepts. The first six are the stock and transit rules. The last five are
 * the calculation constants seeded in 20261111000003.
 *
 * Saving a value this module rejects would not change a calculation — the
 * readers fall back — so the admin save refuses it instead of pretending it
 * applied. The seed values are the previous constants.
 */

/** Rules the SKU preview compares. The calculation constants are not part of that read. */
export const PREVIEW_KEYS = [
  'stock.existencias.locations',
  'stock.patio',
  'transit.rules',
  'transit.prefix_map',
  'pendiente.rules',
  'bodega.general_excluded_wh',
] as const;

export const RULE_KEYS = [
  ...PREVIEW_KEYS,
  'doh.bands',
  'engine.factors',
  'abc.cutoffs',
  'trend.thresholds',
  'cobertura.defaults',
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];

export type ColumnaPorque =
  | 'exist' | 'patio' | 'trans' | 'pend'
  | 'doh' | 'sug' | 'abc' | 'tend' | 'mes' | 'p6' | 'p3' | 'adic' | 'pide';

/** Columns whose detail is a live Odoo read. The others explain the figure already on the row. */
export const COLUMNAS_VIVAS: readonly ColumnaPorque[] = ['exist', 'patio', 'trans', 'pend'];

export const FALLBACK: Record<RuleKey, unknown> = {
  'stock.existencias.locations': { kind: 'Existencias' },
  'stock.patio': { location: '1CET/Entrada', bodegas: ['San Jose VN', 'General'] },
  'transit.rules': { states: ['purchase', 'done'], date_cutoff: 'today_utc' },
  'transit.prefix_map': {
    'PO-P-': '1CET',
    'PO-PE-': '3PET',
    'PO-PZ-': '4ZAC',
    'PO-PT11-': '1CET',
    'PO-PT9-': '1CET',
    'PO-PT17-': '1CET',
    'PO-PTTorre-': '1CET',
    'PO-PT6-': '1CET',
  },
  'pendiente.rules': {
    sequence_codes: ['OUT', 'INT'],
    excluded_states: ['cancel', 'done'],
    origin: 'warehouse_lot_stock',
  },
  'bodega.general_excluded_wh': ['5DEP'],
  'doh.bands': { critico: 3, bajo: 7, normal: 30 },
  'engine.factors': {
    general_growth: 1.1, t_divisor: 20, weekdays: 26, win_general: 10, win_other: 5,
  },
  'abc.cutoffs': { min_qty_for_class: 10, a_share: 0.50, b_share: 0.80 },
  'trend.thresholds': { rises: 2, divergence: 0.40, mtd_color_high: 1.15, mtd_color_low: 0.85 },
  'cobertura.defaults': { default_dias: 30, min_dias: 1, max_dias: 365 },
};

export const REGLA_TITULO: Record<RuleKey, string> = {
  'stock.existencias.locations': 'Existencias',
  'stock.patio': 'Patio',
  'transit.rules': 'Tránsito — qué órdenes entran',
  'transit.prefix_map': 'Tránsito — prefijo de la sucursal',
  'pendiente.rules': 'Pendiente de tomar reserva',
  'bodega.general_excluded_wh': 'Almacenes fuera de General',
  'doh.bands': 'Semáforo de DOH',
  'engine.factors': 'Factores del Sugerido',
  'abc.cutoffs': 'Clases ABC',
  'trend.thresholds': 'Tendencia y mes en curso',
  'cobertura.defaults': 'Días de cobertura',
};

const TEXTO = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v === v.trim();

function listaTexto(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every(TEXTO)) return null;
  return value;
}

function numero(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function objeto(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function aceptarRegla(key: RuleKey, value: unknown): unknown | null {
  if (key === 'stock.existencias.locations') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const kind = (value as { kind?: unknown }).kind;
    if (!TEXTO(kind) || kind.includes('/')) return null;
    return { kind };
  }
  if (key === 'stock.patio') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rec = value as { location?: unknown; bodegas?: unknown };
    const bodegas = listaTexto(rec.bodegas);
    if (!TEXTO(rec.location) || !bodegas) return null;
    return { location: rec.location, bodegas };
  }
  if (key === 'transit.rules') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rec = value as { states?: unknown; date_cutoff?: unknown };
    const states = listaTexto(rec.states);
    if (!states || states.length === 0 || rec.date_cutoff !== 'today_utc') return null;
    return { states, date_cutoff: 'today_utc' as const };
  }
  if (key === 'transit.prefix_map') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (!TEXTO(k) || !TEXTO(v) || v.includes('/')) return null;
      out[k] = v;
    }
    return out;
  }
  if (key === 'pendiente.rules') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const rec = value as { sequence_codes?: unknown; excluded_states?: unknown; origin?: unknown };
    const codes = listaTexto(rec.sequence_codes);
    const states = listaTexto(rec.excluded_states);
    if (!codes || codes.length === 0 || !states || states.length === 0) return null;
    if (rec.origin !== 'warehouse_lot_stock') return null;
    return { sequence_codes: codes, excluded_states: states, origin: 'warehouse_lot_stock' as const };
  }
  if (key === 'doh.bands') {
    const rec = objeto(value);
    if (!rec) return null;
    const critico = numero(rec.critico);
    const bajo = numero(rec.bajo);
    const normal = numero(rec.normal);
    if (critico === null || bajo === null || normal === null) return null;
    return { critico, bajo, normal };
  }
  if (key === 'engine.factors') {
    const rec = objeto(value);
    if (!rec) return null;
    const general_growth = numero(rec.general_growth);
    const t_divisor = numero(rec.t_divisor);
    const weekdays = numero(rec.weekdays);
    const win_general = numero(rec.win_general);
    const win_other = numero(rec.win_other);
    if (general_growth === null || t_divisor === null || weekdays === null
      || win_general === null || win_other === null) return null;
    if (t_divisor === 0 || weekdays === 0 || win_general <= 0 || win_other <= 0) return null;
    return { general_growth, t_divisor, weekdays, win_general, win_other };
  }
  if (key === 'abc.cutoffs') {
    const rec = objeto(value);
    if (!rec) return null;
    const min_qty_for_class = numero(rec.min_qty_for_class);
    const a_share = numero(rec.a_share);
    const b_share = numero(rec.b_share);
    if (min_qty_for_class === null || a_share === null || b_share === null) return null;
    if (a_share < 0 || b_share > 1 || a_share > b_share) return null;
    return { min_qty_for_class, a_share, b_share };
  }
  if (key === 'trend.thresholds') {
    const rec = objeto(value);
    if (!rec) return null;
    const rises = numero(rec.rises);
    const divergence = numero(rec.divergence);
    const mtd_color_high = numero(rec.mtd_color_high);
    const mtd_color_low = numero(rec.mtd_color_low);
    if (rises === null || !Number.isInteger(rises) || rises < 1) return null;
    if (divergence === null || mtd_color_high === null || mtd_color_low === null) return null;
    if (mtd_color_low >= mtd_color_high) return null;
    return { rises, divergence, mtd_color_high, mtd_color_low };
  }
  if (key === 'cobertura.defaults') {
    const rec = objeto(value);
    if (!rec) return null;
    const default_dias = numero(rec.default_dias);
    const min_dias = numero(rec.min_dias);
    const max_dias = numero(rec.max_dias);
    if (default_dias === null || min_dias === null || max_dias === null) return null;
    if (!Number.isInteger(default_dias) || !Number.isInteger(min_dias) || !Number.isInteger(max_dias)) {
      return null;
    }
    if (min_dias > default_dias || default_dias > max_dias) return null;
    return { default_dias, min_dias, max_dias };
  }
  const codes = listaTexto(value);
  if (!codes || codes.some((c) => c.includes('/'))) return null;
  return codes;
}

export function resumenRegla(key: RuleKey, value: unknown): string {
  const accepted = aceptarRegla(key, value) ?? FALLBACK[key];
  if (key === 'stock.existencias.locations') {
    const kind = (accepted as { kind: string }).kind;
    return `Cada bodega suma la ubicación {código}/${kind}. General suma toda ubicación interna que termina en /${kind}, menos los almacenes excluidos.`;
  }
  if (key === 'stock.patio') {
    const p = accepted as { location: string; bodegas: string[] };
    const quienes = p.bodegas.length ? p.bodegas.join(', ') : 'ninguna bodega';
    return `El patio es ${p.location}. Se guarda y se muestra en ${quienes}. En las demás bodegas el patio es 0 y no entra al Sugerido.`;
  }
  if (key === 'transit.rules') {
    const t = accepted as { states: string[] };
    return `Entran las órdenes en estado ${t.states.join(' o ')} cuya fecha del encabezado es hoy (UTC) o posterior. Una fecha vacía o pasada queda fuera. El destino lo decide el prefijo de la sucursal.`;
  }
  if (key === 'transit.prefix_map') {
    const n = Object.keys(accepted as Record<string, string>).length;
    return `${n} prefijos de orden de compra tienen almacén. La búsqueda es exacta: PO-PZ11- no es PO-PZ-. Un prefijo ausente no se reparte entre bodegas.`;
  }
  if (key === 'pendiente.rules') {
    const p = accepted as { sequence_codes: string[]; excluded_states: string[] };
    return `Entran los albaranes ${p.sequence_codes.join(' y ')}. Quedan fuera los estados ${p.excluded_states.join(' y ')}. El movimiento tiene que salir de las existencias de la bodega.`;
  }
  if (key === 'doh.bands') {
    const d = accepted as { critico: number; bajo: number; normal: number };
    return `Crítico cuando el DOH es menor que ${d.critico}, bajo cuando es menor que ${d.bajo}, normal hasta ${d.normal}, y exceso por encima de ${d.normal}.`;
  }
  if (key === 'engine.factors') {
    const f = accepted as {
      general_growth: number; t_divisor: number; weekdays: number; win_general: number; win_other: number;
    };
    return `El pronóstico de General multiplica el promedio por ${f.general_growth}. La proyección T usa p3 ÷ ${f.t_divisor}. El DOH divide entre ${f.weekdays} días hábiles. La ventana es ${f.win_general} en General y ${f.win_other} en las demás bodegas.`;
  }
  if (key === 'abc.cutoffs') {
    const a = accepted as { min_qty_for_class: number; a_share: number; b_share: number };
    return `Por debajo de ${a.min_qty_for_class} unidades ordenadas en 3 meses la clase es D. Del resto, A acumula el primer ${Math.round(a.a_share * 100)}% y B llega hasta el ${Math.round(a.b_share * 100)}%. Lo que sigue es C.`;
  }
  if (key === 'trend.thresholds') {
    const t = accepted as { rises: number; divergence: number; mtd_color_high: number; mtd_color_low: number };
    return `La alerta de alza pide ${t.rises} subidas seguidas. Hay divergencia si |p3 − p6| / p6 supera ${t.divergence}. El mes en curso se pinta distinto si el ritmo pasa de ${t.mtd_color_high} o baja de ${t.mtd_color_low} veces el promedio de 3 meses.`;
  }
  if (key === 'cobertura.defaults') {
    const c = accepted as { default_dias: number; min_dias: number; max_dias: number };
    return `Sin una cifra propia de la bodega, el Sugerido cubre ${c.default_dias} días. El número que se puede guardar va de ${c.min_dias} a ${c.max_dias}.`;
  }
  const lista = (accepted as string[]).join(', ') || 'nadie';
  return `General no suma existencias ni tránsito de ${lista}. Esas cantidades no se reparten a otra bodega.`;
}

export function resumenColumna(
  columna: ColumnaPorque,
  reglas: Partial<Record<RuleKey, unknown>>,
): string {
  if (columna === 'exist') {
    return `${resumenRegla('stock.existencias.locations', reglas['stock.existencias.locations'])} ${resumenRegla('bodega.general_excluded_wh', reglas['bodega.general_excluded_wh'])} La neta de la tabla es existencias − reservado − pendiente de tomar reserva. El patio no entra.`;
  }
  if (columna === 'patio') return resumenRegla('stock.patio', reglas['stock.patio']);
  if (columna === 'trans') {
    return `${resumenRegla('transit.rules', reglas['transit.rules'])} ${resumenRegla('transit.prefix_map', reglas['transit.prefix_map'])}`;
  }
  if (columna === 'pend') return resumenRegla('pendiente.rules', reglas['pendiente.rules']);
  if (columna === 'doh') {
    const dias = (aceptarRegla('engine.factors', reglas['engine.factors']) as { weekdays: number } | null)?.weekdays
      ?? (FALLBACK['engine.factors'] as { weekdays: number }).weekdays;
    return `${resumenRegla('doh.bands', reglas['doh.bands'])} El número es exist. neta ÷ (Ord. 3m ÷ ${dias} días hábiles).`;
  }
  if (columna === 'sug') {
    return `${resumenRegla('engine.factors', reglas['engine.factors'])} ${resumenRegla('cobertura.defaults', reglas['cobertura.defaults'])} Sugerido = max(0, pronóstico − max(0, exist. neta + tránsito − T)) + adicionales.`;
  }
  if (columna === 'abc') return resumenRegla('abc.cutoffs', reglas['abc.cutoffs']);
  if (columna === 'tend') {
    const t = aceptarRegla('trend.thresholds', reglas['trend.thresholds']) as {
      rises: number; divergence: number;
    } | null;
    const rises = t?.rises ?? (FALLBACK['trend.thresholds'] as { rises: number }).rises;
    const divergence = t?.divergence ?? (FALLBACK['trend.thresholds'] as { divergence: number }).divergence;
    return `La alerta de alza pide ${rises} subidas seguidas en meses completos. Hay divergencia si |Ord. 3m − Ord. 6m| / Ord. 6m supera ${divergence}. Las dos juntas marcan revisión.`;
  }
  if (columna === 'mes') {
    const t = aceptarRegla('trend.thresholds', reglas['trend.thresholds']) as {
      mtd_color_high: number; mtd_color_low: number;
    } | null;
    const high = t?.mtd_color_high ?? (FALLBACK['trend.thresholds'] as { mtd_color_high: number }).mtd_color_high;
    const low = t?.mtd_color_low ?? (FALLBACK['trend.thresholds'] as { mtd_color_low: number }).mtd_color_low;
    return `Mes en curso es lo ordenado en los días que van del mes. El ritmo a 30 días se compara con Ord. 3m: por encima de ${high} veces se marca alto, por debajo de ${low} veces se marca bajo.`;
  }
  if (columna === 'p6') {
    return 'Ord. 6m es el promedio mensual de lo ordenado en los últimos 6 meses completos, en la unidad de stock. Es una entrada del pronóstico, no una regla aparte.';
  }
  if (columna === 'p3') {
    return 'Ord. 3m es el promedio mensual de lo ordenado en los últimos 3 meses completos. El DOH y la proyección T parten de este número.';
  }
  if (columna === 'pide') {
    return 'Pide bodega es lo que el encargado del centro de distribución pidió de más para esta bodega. Se suma a Adicionales y, con eso, al Sugerido.';
  }
  return 'Adicionales es la compra extraordinaria de los canales que entra al pedido, más lo que pidió la bodega. Temporada y faltante crítico se muestran aparte.';
}

export function esRuleKey(value: string): value is RuleKey {
  return (RULE_KEYS as readonly string[]).includes(value);
}
