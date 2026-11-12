/**
 * Armado de furgones — función pura.
 *
 * Recibe líneas ya medidas (cajas, m³ por caja, semanas de cobertura) y la
 * capacidad del furgón. No lee base de datos, no escribe Odoo, no asume 100 m³
 * ni el calendario de Reyma: si no llegan días y un máximo por día, los
 * furgones quedan en `sinDia`.
 *
 * El objeto que devuelve es el payload que hoy se guarda en
 * `reyma_plan_despacho`: `{ dias: [{ dia, furgones: [{ no, lineas: [{ codigo, cajas }] }] }], sinDia }`.
 *
 * Reglas (las mismas que usaba `generarPlan`):
 *  - menor `semanas_cobertura` primero;
 *  - se parte un producto entre furgones consecutivos cuando no cabe entero;
 *  - `cod_furgon_completo`, si viene, viaja solo, en múltiplos exactos de
 *    floor(capacidad / m³ por caja); el resto que no completa un furgón no se
 *    sube (el llamador avisa).
 */
export interface PackLine {
  codigo: string;
  cajas: number;
  m3_por_caja: number;
  semanas_cobertura: number;
}

export interface PackSettings {
  /** Días de despacho, en el orden en que se van llenando. */
  dias?: string[];
  /** Tope de furgones en cada día. Sin esto no hay asignación de días. */
  max_por_dia?: number;
  /**
   * Código que despacha en furgones dedicados de múltiplo exacto.
   * Reyma: vaso térmico 10 (`77201046`). Omitirlo mezcla ese código con el resto.
   */
  cod_furgon_completo?: string | null;
}

export interface PlanDespachoFurgon {
  no: number;
  lineas: Array<{ codigo: string; cajas: number }>;
}

/** Forma persistida en `reyma_plan_despacho.payload`. */
export interface PlanDespachoPayload {
  dias: Array<{ dia: string; furgones: PlanDespachoFurgon[] }>;
  sinDia: PlanDespachoFurgon[];
}

interface FurgonAbierto {
  no: number;
  dedicado: boolean;
  lineas: Array<{ codigo: string; cajas: number }>;
  totalM3: number;
}

export function packLines(
  lines: PackLine[],
  capacidad_m3: number,
  settings?: PackSettings,
): PlanDespachoPayload {
  if (!Number.isFinite(capacidad_m3) || capacidad_m3 <= 0) {
    throw new Error('packLines: capacidad_m3 debe ser un número mayor que cero');
  }
  const cap = capacidad_m3;
  const codDedicado = settings?.cod_furgon_completo || null;
  const dias = (settings?.dias ?? []).filter((d) => d.trim() !== '');
  const maxPorDia = settings?.max_por_dia;
  const asignaDias = dias.length > 0
    && maxPorDia != null
    && Number.isFinite(maxPorDia)
    && maxPorDia > 0;

  const candidatos = lines
    .filter((l) => l.cajas > 0 && l.m3_por_caja > 0)
    .sort((a, b) => a.semanas_cobertura - b.semanas_cobertura);

  const furgones: FurgonAbierto[] = [];
  let actual: FurgonAbierto | null = null;

  const abrir = (dedicado = false): FurgonAbierto => {
    const f: FurgonAbierto = {
      no: furgones.length + 1,
      dedicado,
      lineas: [],
      totalM3: 0,
    };
    furgones.push(f);
    return f;
  };
  const agregar = (f: FurgonAbierto, codigo: string, cajas: number, cubicaje: number) => {
    f.lineas.push({ codigo, cajas });
    f.totalM3 += cajas * cubicaje;
  };

  for (const c of candidatos) {
    if (codDedicado && c.codigo === codDedicado) {
      const porFurgon = Math.floor(cap / c.m3_por_caja);
      let resto = c.cajas;
      while (resto >= porFurgon && porFurgon > 0) {
        const f = abrir(true);
        agregar(f, c.codigo, porFurgon, c.m3_por_caja);
        resto -= porFurgon;
      }
      actual = null;
      continue;
    }
    let resto = c.cajas;
    while (resto > 0) {
      if (!actual || actual.dedicado) actual = abrir();
      const espacio = cap - actual.totalM3;
      const caben = Math.floor(espacio / c.m3_por_caja);
      if (caben < 1) {
        actual = abrir();
        continue;
      }
      const poner = Math.min(resto, caben);
      agregar(actual, c.codigo, poner, c.m3_por_caja);
      resto -= poner;
      if (resto > 0) actual = abrir();
    }
  }

  const cupo = asignaDias ? dias.length * (maxPorDia as number) : 0;
  const conDia = furgones.map((f, i) => ({
    no: f.no,
    dia: asignaDias && i < cupo ? dias[Math.floor(i / (maxPorDia as number))] : null,
    lineas: f.lineas,
  }));

  return {
    dias: dias.map((dia) => ({
      dia,
      furgones: conDia
        .filter((f) => f.dia === dia)
        .map((f) => ({ no: f.no, lineas: f.lineas })),
    })),
    sinDia: conDia
      .filter((f) => f.dia === null)
      .map((f) => ({ no: f.no, lineas: f.lineas })),
  };
}
