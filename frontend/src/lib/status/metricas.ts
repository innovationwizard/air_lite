/**
 * Aritmética del gap analysis de `/status`.
 *
 * Todo lo que produce un número de la página vive acá y es puro, por la misma
 * razón que el motor de reabastecimiento se importa en vez de reimplementarse:
 * un porcentaje calculado de dos maneras distintas termina en una página que
 * se contradice a sí misma. La API sirve filas; este módulo las convierte en
 * el titular, la brecha de confirmación y el orden del plan.
 */

export type Estado =
  | 'funcionando' | 'construido' | 'parcial'
  | 'no_construido' | 'fuera_alcance' | 'no_software' | 'sin_determinar';

export type Origen = 'contrato' | 'verbal' | 'prerrequisito' | 'anadido' | 'contexto';
export type Bloqueo = 'jorge' | 'cliente' | 'tercero' | 'nadie' | 'na';
export type Temporada = 'critico' | 'mejora' | 'puede_esperar' | 'na';
export type Esfuerzo = 'horas' | 'dias' | 'semanas' | 'no_estimable' | 'na';
export type Area = 'compras_local' | 'compras_intl' | 'gerencia' | 'gerencia_proyecto' | 'na';

export interface StatusItem {
  id: string;
  cat: string;
  orden_natural: number;
  item: string;
  tipo: string;
  flag: string | null;
  src: string;
  notes: string | null;
  estado: Estado;
  estado_sugerido: boolean;
  evidencia: string | null;
  origen: Origen;
  bloqueo: Bloqueo;
  espera_que: string | null;
  area: Area;
  temporada: Temporada;
  esfuerzo: Esfuerzo;
  rodeo: string | null;
  confirmable_con: string | null;
  criterio_aceptacion: string | null;
  orden_sugerido: number | null;
}

export interface PlanRow {
  item_id: string;
  prioridad: number | null;
  fecha_objetivo: string | null;
  nota: string | null;
}

/**
 * REGLA DE CONTEO (0/100). Sólo estos estados entran al denominador: son las
 * cosas que alguna vez hubo que construir.
 *
 * `no_software` (contexto, evidencia, cronología, prerrequisitos que ejecuta
 * el cliente) y `fuera_alcance` quedan fuera. Meterlos inventaría una brecha
 * que no existe: nunca fueron entregables, así que no pueden estar incompletos.
 */
export const ENTREGABLES: Estado[] = [
  'funcionando', 'construido', 'parcial', 'no_construido', 'sin_determinar',
];

/** El toggle de alcance. Por defecto la página excluye lo añadido después. */
export type Alcance = 'contratado' | 'todo';

export function enAlcance(item: StatusItem, alcance: Alcance): boolean {
  if (alcance === 'todo') return true;
  return item.origen === 'contrato' || item.origen === 'verbal';
}

export interface Titular {
  denominador: number;
  funcionando: number;
  construido: number;
  parcial: number;
  noConstruido: number;
  sinDeterminar: number;
  /** El titular. Terminado = construido Y confirmado por el cliente. */
  pctTerminado: number;
  /** Proyección rotulada, nunca el titular: qué pasaría si se confirma todo. */
  pctSiSeConfirma: number;
}

export function titular(items: StatusItem[], alcance: Alcance): Titular {
  const d = items.filter((i) => enAlcance(i, alcance) && ENTREGABLES.includes(i.estado));
  const n = d.length;
  const c = (e: Estado) => d.filter((i) => i.estado === e).length;
  const funcionando = c('funcionando');
  const construido = c('construido');
  return {
    denominador: n,
    funcionando,
    construido,
    parcial: c('parcial'),
    noConstruido: c('no_construido'),
    sinDeterminar: c('sin_determinar'),
    pctTerminado: n ? funcionando / n : 0,
    pctSiSeConfirma: n ? (funcionando + construido) / n : 0,
  };
}

/**
 * La brecha de confirmación, agrupada por a quién hay que convocar.
 *
 * Es lo que convierte un titular bajo en una acción de calendario: la
 * aceptación es trabajo pendiente con dueño y criterio, igual que cualquier
 * otra brecha, y no un trámite que ocurre solo.
 *
 * El agrupador es una persona — la única excepción a la regla de no nombrar
 * gente en la interfaz — porque acá el nombre no es una imputación sino a
 * quién hay que sentar en una silla.
 */
export interface GrupoConfirmacion {
  persona: string;
  items: StatusItem[];
  /** El titular si se confirma SÓLO este grupo. Escenario, no avance. */
  pctSiSeConfirmaEste: number;
}

export function brechaConfirmacion(items: StatusItem[], alcance: Alcance): GrupoConfirmacion[] {
  const t = titular(items, alcance);
  const construidos = items.filter(
    (i) => enAlcance(i, alcance) && i.estado === 'construido',
  );
  const porPersona = new Map<string, StatusItem[]>();
  for (const i of construidos) {
    const k = i.confirmable_con ?? 'Sin asignar';
    porPersona.set(k, [...(porPersona.get(k) ?? []), i]);
  }
  return [...porPersona.entries()]
    .map(([persona, grupo]) => ({
      persona,
      items: grupo,
      pctSiSeConfirmaEste: t.denominador
        ? (t.funcionando + grupo.length) / t.denominador
        : 0,
    }))
    .sort((a, b) => b.items.length - a.items.length || a.persona.localeCompare(b.persona));
}

/**
 * Reparto de lo que falta por QUÉ se está esperando, nunca por quién.
 *
 * `bloqueo` se rotula por función y el detalle se da como sustantivo en
 * `espera_que`: un insumo nombrado se puede conseguir, una persona nombrada
 * sólo se puede culpar. El hecho es el mismo y la fuente sigue en `src`.
 */
export const ETIQUETA_BLOQUEO: Record<Bloqueo, string> = {
  jorge: 'Nuestro',
  cliente: 'Del cliente',
  tercero: 'De un tercero',
  nadie: 'Nada — listo para empezar',
  na: 'No aplica',
};

export function esperandoQue(
  items: StatusItem[],
  alcance: Alcance,
): { bloqueo: Bloqueo; etiqueta: string; items: StatusItem[] }[] {
  const abiertos = items.filter(
    (i) => enAlcance(i, alcance) && (i.estado === 'parcial' || i.estado === 'no_construido'),
  );
  const orden: Bloqueo[] = ['jorge', 'cliente', 'tercero', 'nadie', 'na'];
  return orden
    .map((b) => ({
      bloqueo: b,
      etiqueta: ETIQUETA_BLOQUEO[b],
      items: abiertos.filter((i) => i.bloqueo === b),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * Orden del plan. `orden_sugerido` lo calcula `scripts/sync_status.py` con la
 * fórmula temporada × bloqueo × esfuerzo × estado; `prioridad` es la posición
 * que el PM escribe a mano.
 *
 * LAS DOS VIVEN EN EL MISMO ESPACIO DE POSICIONES (1..N) y por eso la clave de
 * orden es `prioridad ?? orden_sugerido`. La alternativa —mandar todas las
 * filas con prioridad manual al principio— hace que mover UNA fila al puesto 12
 * la salte hasta arriba de las once que no tocó, que es justo lo contrario de
 * lo que pidió. Con esta clave, escribir «12» la pone en el puesto 12 y el
 * resto se acomoda alrededor.
 *
 * Empates: gana la manual, porque es una decisión y la otra es un cálculo.
 */
export function ordenarPlan(
  items: StatusItem[],
  plan: Map<string, PlanRow>,
  alcance: Alcance,
): StatusItem[] {
  const clave = (i: StatusItem) => plan.get(i.id)?.prioridad ?? i.orden_sugerido ?? 1e9;
  const esManual = (i: StatusItem) => plan.get(i.id)?.prioridad != null;
  return items
    .filter((i) => enAlcance(i, alcance) && (i.estado === 'parcial' || i.estado === 'no_construido'))
    .sort((a, b) =>
      clave(a) - clave(b)
      || Number(esManual(b)) - Number(esManual(a))
      || (a.orden_sugerido ?? 1e9) - (b.orden_sugerido ?? 1e9)
      || a.id.localeCompare(b.id));
}

/**
 * Prontitud por función, NO por persona: un semáforo con el nombre de alguien
 * encima es un veredicto sobre esa persona, aunque se quiera decir del software.
 *
 * Un defecto CON rodeo no pinta rojo — pinta ámbar y nombra el rodeo. Un ámbar
 * sin rodeo escrito es un rojo disfrazado, que es el modo clásico en que un
 * semáforo deja de informar.
 */
export type Luz = 'verde' | 'ambar' | 'rojo';

export interface Prontitud {
  area: Area;
  etiqueta: string;
  luz: Luz;
  criterio: string;
  criticosAbiertos: StatusItem[];
  rodeos: string[];
}

/** Rótulos por FUNCIÓN. Un semáforo con el nombre de una persona encima es un
 *  veredicto sobre esa persona, aunque se quiera decir del software. */
export const ETIQUETA_AREA: Record<Area, string> = {
  compras_local: 'Compras locales',
  compras_intl: 'Compras internacionales',
  gerencia: 'Gerencia',
  gerencia_proyecto: 'Gerencia de proyecto',
  na: 'Sin área',
};

/** Las áreas que llevan semáforo, en orden de presentación. */
export const AREAS_PRONTITUD: Area[] = [
  'compras_local', 'compras_intl', 'gerencia', 'gerencia_proyecto',
];

export function prontitud(items: StatusItem[], area: Area): Prontitud {
  const enArea = items.filter((i) => i.area === area);
  const criticos = enArea.filter(
    (i) => i.temporada === 'critico' && (i.estado === 'parcial' || i.estado === 'no_construido'),
  );
  const rodeos = [...new Set(criticos.map((c) => c.rodeo).filter((r): r is string => !!r?.trim()))];
  const sinRodeo = criticos.filter((c) => !c.rodeo?.trim());

  let luz: Luz;
  let criterio: string;
  if (criticos.length === 0) {
    luz = 'verde';
    criterio = 'Sin pendientes críticos para la temporada.';
  } else if (sinRodeo.length > 0) {
    luz = 'rojo';
    criterio = `${sinRodeo.length} pendiente(s) crítico(s) sin forma de trabajar alrededor.`;
  } else {
    luz = 'ambar';
    criterio = `${criticos.length} pendiente(s) crítico(s), todos con una forma de trabajar alrededor.`;
  }
  return { area, etiqueta: ETIQUETA_AREA[area], luz, criterio, criticosAbiertos: criticos, rodeos };
}
