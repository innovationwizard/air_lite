/**
 * N14 — Conciliación factura PDF ↔ vendor bill de Odoo. Motor puro (sin I/O),
 * estilo engine, igual que saldos.ts / planificacion.ts.
 *
 * La misma factura del proveedor llega por dos canales: el PDF del CFDI que
 * Alexis reenvía días antes, y la vendor bill que contabilidad carga en Odoo
 * después. Sin un enlace explícito la mercadería se cuenta dos veces.
 *
 * ESCALERA DE REGLAS — exacto primero, compuesto después, difuso NUNCA.
 * En conciliación de dinero el modo de falla de un match difuso es el falso
 * positivo, que es peor que no encontrar nada: por eso acá no hay similitud de
 * texto ni umbrales de puntaje, sólo igualdades.
 *
 *   Tier 1 — el folio del CFDI aparece en la referencia de la bill. Es lo que
 *            Odoo diseñó para esto (campo `ref` / Vendor Reference, con su
 *            propia detección de duplicados). Hoy REYMA escribe ahí la
 *            descripción de la OC, así que casi nunca dispara — pero cuando
 *            dispara es certeza, y si contabilidad adopta la práctica todo
 *            futuro enlace sube a este tier.
 *   Tier 2 — monto total + composición de líneas + fecha, los TRES exactos.
 *
 * POR QUÉ LA FECHA ES OBLIGATORIA: G-216 y G-224 son gemelas — ambas una sola
 * línea de VT10XN 666 @ $22.00 = $14,652.00 (el furgón dedicado de VT10, N7 del
 * manifest). Monto y composición idénticos. Sin la fecha el par es
 * genuinamente ambiguo, y es la forma de factura MÁS común de este proveedor.
 *
 * POR QUÉ ASIGNACIÓN 1:1 Y NO BÚSQUEDA POR FILA: por lo mismo. Un
 * `buscá la bill que calza` deja que las dos gemelas se enganchen a la misma
 * bill. Cada factura consume su contraparte; lo que queda contestado va a la
 * cola de excepciones, no se adivina.
 *
 * LO QUE NO ES EXCEPCIÓN: que una factura PDF no tenga contraparte en Odoo es
 * el estado NORMAL (el PDF llega días antes). La cola sólo recibe casos que un
 * humano tiene que resolver: ambigüedad y calces parciales.
 *
 * Las diferencias de cantidad y precio (R3/R4 del manifest) se tratan DESPUÉS
 * del enlace y aparte; nunca se mezclan dentro del criterio de match.
 */
import type { FacturaLinea, FacturaPdfLinea } from './types';

/** Tolerancia de dinero/cantidad: un centavo / una centésima de caja. */
const EPS = 0.01;

export type Tier = 0 | 1 | 2;
export type EstadoEnlace = 'auto' | 'confirmado' | 'rechazado';

/**
 * Motivos de excepción. Taxonomía cerrada para que la cola se pueda enrutar
 * por tipo (y no sea una lista plana que nadie ordena).
 */
export type MotivoExcepcion =
  /** Más de un candidato al mismo nivel: hace falta que un humano elija. */
  | 'AMBIGUO'
  /** Monto y líneas calzan, pero la fecha no. ¿Contabilidad la cargó con otra fecha? */
  | 'FECHA_DISCREPA'
  /** El monto calza y la fecha también, pero las líneas no. ¿Bill parcial o combinada? */
  | 'LINEAS_DISCREPAN'
  /** Las líneas calzan pero el monto no. Señal de diferencia de precio (R3/NC). */
  | 'MONTO_DISCREPA';

/** Lo que se comparó, guardado verbatim para poder auditar el enlace después. */
export interface Evidencia {
  totalPdf: number;
  totalOdoo: number;
  fechaPdf: string;
  fechaOdoo: string | null;
  lineasPdf: number;
  lineasOdoo: number;
  codigosEnComun: number;
  mismoTotal: boolean;
  mismaFecha: boolean;
  mismasLineas: boolean;
  /**
   * Todas las líneas de un lado están contenidas en el otro con la misma
   * cantidad, pero uno tiene más. Señal de bill parcial o de dos CFDIs
   * combinados en una sola bill — el caso de cardinalidad que NO se puede
   * enlazar 1:1 y tiene que verlo un humano.
   */
  subconjunto: boolean;
  referenciaOdoo: string | null;
}

export interface Enlace {
  factura: string; // 'F171849' — lado PDF
  folioFiscal: string;
  odooFactura: string; // 'BILL/2026/08/0054' — lado Odoo
  tier: Tier;
  regla: string;
  estado: EstadoEnlace;
  /** true cuando el enlace viene de una decisión humana persistida. */
  humano: boolean;
  evidencia: Evidencia;
}

export interface Candidato {
  odooFactura: string;
  tier: Tier | null; // null = calce parcial, no elegible para auto
  regla: string;
  evidencia: Evidencia;
}

export interface Excepcion {
  factura: string;
  folioFiscal: string;
  motivo: MotivoExcepcion;
  detalle: string;
  candidatos: Candidato[];
}

/** Decisión humana ya persistida (última fila por par manda). */
export interface DecisionPersistida {
  folioFiscal: string;
  odooFactura: string;
  estado: EstadoEnlace;
  tier: Tier;
  regla: string;
  autor: string;
  fecha: string;
}

export interface Conciliacion {
  /** Enlaces efectivos: las facturas PDF que NO deben sumar (Odoo ya las tiene). */
  enlaces: Enlace[];
  /** Casos que necesitan a un humano. */
  excepciones: Excepcion[];
  /**
   * Bills de Odoo del mes sin contraparte PDF. No es un error: puede ser una
   * factura cuyo PDF nunca nos llegó (hueco en el canal de Alexis) — por eso
   * se muestra, aunque no bloquea nada.
   */
  odooSinPdf: string[];
  /** Facturas PDF sin contraparte: el estado NORMAL (el PDF va adelante). */
  pdfSinOdoo: string[];
}

/** Agregado de una factura, de cualquiera de los dos lados. */
interface Doc {
  id: string;
  fecha: string | null;
  total: number;
  lineas: Map<string, number>; // codigo → cantidad
  referencia: string | null;
}

function mesDe(fecha: string | null): string | null {
  return fecha && fecha.length >= 7 ? fecha.slice(0, 7) : null;
}

/** Agrupa líneas sueltas en documentos, sumando importe = cantidad × precio. */
function agrupar<T>(
  filas: T[],
  id: (f: T) => string,
  fecha: (f: T) => string | null,
  codigo: (f: T) => string,
  cantidad: (f: T) => number,
  precio: (f: T) => number,
  referencia: (f: T) => string | null,
): Map<string, Doc> {
  const out = new Map<string, Doc>();
  for (const f of filas) {
    const k = id(f);
    let d = out.get(k);
    if (!d) {
      d = { id: k, fecha: fecha(f), total: 0, lineas: new Map(), referencia: referencia(f) };
      out.set(k, d);
    }
    const q = cantidad(f);
    d.lineas.set(codigo(f), (d.lineas.get(codigo(f)) ?? 0) + q);
    d.total = Math.round((d.total + q * precio(f)) * 100) / 100;
  }
  return out;
}

function comparar(pdf: Doc, odoo: Doc): Evidencia {
  const codigosPdf = [...pdf.lineas.keys()];
  const enComun = codigosPdf.filter((c) => odoo.lineas.has(c));
  const cantidadesIguales = (codigos: string[]) =>
    codigos.every((c) => Math.abs((pdf.lineas.get(c) ?? 0) - (odoo.lineas.get(c) ?? 0)) < EPS);
  const mismasLineas =
    pdf.lineas.size === odoo.lineas.size
    && enComun.length === pdf.lineas.size
    && cantidadesIguales(codigosPdf);
  // Contención estricta en cualquiera de los dos sentidos, con cantidades
  // iguales en la parte compartida.
  const subconjunto =
    !mismasLineas
    && enComun.length > 0
    && cantidadesIguales(enComun)
    && (enComun.length === pdf.lineas.size || enComun.length === odoo.lineas.size);
  return {
    totalPdf: pdf.total,
    totalOdoo: odoo.total,
    fechaPdf: pdf.fecha ?? '',
    fechaOdoo: odoo.fecha,
    lineasPdf: pdf.lineas.size,
    lineasOdoo: odoo.lineas.size,
    codigosEnComun: enComun.length,
    mismoTotal: Math.abs(pdf.total - odoo.total) < EPS,
    mismaFecha: !!pdf.fecha && pdf.fecha === odoo.fecha,
    mismasLineas,
    subconjunto,
    referenciaOdoo: odoo.referencia,
  };
}

/**
 * ¿El folio del CFDI aparece en la referencia/nombre de la bill? El número se
 * busca sin la 'F' inicial porque contabilidad lo escribe de las dos formas
 * (se observaron `... JULIO 2026 F170810` y `RALDA - DELTY -F170926`).
 */
function folioEnReferencia(factura: string, odoo: Doc): boolean {
  const num = factura.replace(/^F/i, '');
  if (num.length < 5) return false; // no arriesgar match por un número corto
  return `${odoo.id} ${odoo.referencia ?? ''}`.includes(num);
}

const REGLA_T1 = 'folio del CFDI presente en la referencia de la bill';
const REGLA_T2 = 'monto total + composición de líneas + fecha, exactos';

export function conciliar(
  odooFacturas: FacturaLinea[],
  pdfFacturas: FacturaPdfLinea[],
  mes: string, // 'YYYY-MM'
  decisiones: DecisionPersistida[] = [],
): Conciliacion {
  // ── Blocking: mismo mes de los dos lados. Es el mismo filtro que usa
  // computeSaldos para totalizar, así que una bill cargada en otro mes tampoco
  // estaría sumando y no puede duplicar.
  // Las notas de crédito no participan: son otro documento fiscal, con su
  // propio CFDI. Entran al saldo restando (saldos.ts), no al match.
  const odooDocs = agrupar(
    odooFacturas.filter((f) => mesDe(f.fecha) === mes && f.tipo === 'factura'),
    (f) => f.factura, (f) => f.fecha, (f) => f.codigo, (f) => f.cantidad,
    (f) => f.precioUnit, (f) => f.referencia,
  );
  const pdfDocs = agrupar(
    pdfFacturas.filter((f) => mesDe(f.fecha) === mes),
    (f) => f.factura, (f) => f.fecha, (f) => f.codigo, (f) => f.cantidad,
    (f) => f.precioUnit, () => null,
  );
  const folioDe = new Map<string, string>();
  for (const f of pdfFacturas) if (!folioDe.has(f.factura)) folioDe.set(f.factura, f.folioFiscal);

  // ── Decisiones humanas: la última por par manda (la tabla es append-only y
  // llega ordenada por created_at DESC, así que la primera que vemos gana).
  const decisionPorPar = new Map<string, DecisionPersistida>();
  for (const d of decisiones) {
    const k = `${d.folioFiscal}|${d.odooFactura}`;
    if (!decisionPorPar.has(k)) decisionPorPar.set(k, d);
  }
  const vetado = (factura: string, odooFactura: string) =>
    decisionPorPar.get(`${folioDe.get(factura) ?? ''}|${odooFactura}`)?.estado === 'rechazado';

  const enlaces: Enlace[] = [];
  const excepciones: Excepcion[] = [];
  const pdfTomado = new Set<string>();
  const odooTomado = new Set<string>();

  const enlazar = (
    pdfId: string, odooId: string, tier: Tier, regla: string,
    estado: EstadoEnlace, humano: boolean, evidencia: Evidencia,
  ) => {
    enlaces.push({
      factura: pdfId, folioFiscal: folioDe.get(pdfId) ?? '', odooFactura: odooId,
      tier, regla, estado, humano, evidencia,
    });
    pdfTomado.add(pdfId);
    odooTomado.add(odooId);
  };

  // ── Paso 0: enlaces confirmados a mano. Ganan siempre, aunque el motor ya no
  // los proponga (p. ej. si el sync trajo una cantidad corregida).
  for (const d of decisionPorPar.values()) {
    if (d.estado !== 'confirmado') continue;
    const pdfId = [...pdfDocs.keys()].find((k) => folioDe.get(k) === d.folioFiscal);
    const odooDoc = odooDocs.get(d.odooFactura);
    if (!pdfId || !odooDoc) continue; // fuera del mes/alcance: no aplica acá
    if (pdfTomado.has(pdfId) || odooTomado.has(d.odooFactura)) continue;
    enlazar(pdfId, d.odooFactura, d.tier, d.regla, 'confirmado', true,
      comparar(pdfDocs.get(pdfId)!, odooDoc));
  }

  // ── Candidatos por factura PDF, clasificados por tier.
  const candidatosPorPdf = new Map<string, Candidato[]>();
  for (const [pdfId, pdfDoc] of pdfDocs) {
    if (pdfTomado.has(pdfId)) continue;
    const lista: Candidato[] = [];
    for (const [odooId, odooDoc] of odooDocs) {
      if (odooTomado.has(odooId) || vetado(pdfId, odooId)) continue;
      const ev = comparar(pdfDoc, odooDoc);
      if (folioEnReferencia(pdfId, odooDoc)) {
        lista.push({ odooFactura: odooId, tier: 1, regla: REGLA_T1, evidencia: ev });
      } else if (ev.mismoTotal && ev.mismasLineas && ev.mismaFecha) {
        lista.push({ odooFactura: odooId, tier: 2, regla: REGLA_T2, evidencia: ev });
      } else if (ev.mismoTotal && ev.mismasLineas) {
        lista.push({ odooFactura: odooId, tier: null, regla: 'monto + líneas exactos, fecha distinta', evidencia: ev });
      } else if (ev.mismoTotal && ev.mismaFecha) {
        lista.push({ odooFactura: odooId, tier: null, regla: 'monto + fecha exactos, líneas distintas', evidencia: ev });
      } else if (ev.mismasLineas && ev.mismaFecha) {
        lista.push({ odooFactura: odooId, tier: null, regla: 'líneas + fecha exactas, monto distinto', evidencia: ev });
      } else if (ev.subconjunto && ev.mismaFecha) {
        lista.push({ odooFactura: odooId, tier: null, regla: 'un lado contiene al otro (bill parcial o CFDIs combinados)', evidencia: ev });
      }
    }
    if (lista.length) candidatosPorPdf.set(pdfId, lista);
  }

  // ── Asignación 1:1, tier por tier. Dentro de un tier, un enlace sólo se
  // aplica si es MUTUAMENTE único: una sola opción para esa factura Y ninguna
  // otra factura peleando esa bill. Todo lo demás va a la cola.
  for (const tier of [1, 2] as const) {
    const pretendientes = new Map<string, string[]>(); // odooId → pdfIds
    for (const [pdfId, lista] of candidatosPorPdf) {
      if (pdfTomado.has(pdfId)) continue;
      for (const c of lista) {
        if (c.tier !== tier || odooTomado.has(c.odooFactura)) continue;
        pretendientes.set(c.odooFactura, [...(pretendientes.get(c.odooFactura) ?? []), pdfId]);
      }
    }
    for (const [pdfId, lista] of candidatosPorPdf) {
      if (pdfTomado.has(pdfId)) continue;
      const propios = lista.filter((c) => c.tier === tier && !odooTomado.has(c.odooFactura));
      if (propios.length !== 1) continue;
      const unico = propios[0];
      if ((pretendientes.get(unico.odooFactura) ?? []).length !== 1) continue; // contestada
      enlazar(pdfId, unico.odooFactura, tier, unico.regla, 'auto', false, unico.evidencia);
    }
  }

  // ── Residual → cola de excepciones, con motivo.
  for (const [pdfId, lista] of candidatosPorPdf) {
    if (pdfTomado.has(pdfId)) continue;
    const vivos = lista.filter((c) => !odooTomado.has(c.odooFactura));
    if (!vivos.length) continue;
    const auto = vivos.filter((c) => c.tier !== null);
    // ¿Alguna de mis candidatas elegibles la está peleando OTRA factura que
    // tampoco quedó asignada? Ese es el caso de las gemelas: cada una tiene un
    // solo candidato, pero es el MISMO, así que ninguna puede tomarlo.
    const contestada = auto.some((c) =>
      [...candidatosPorPdf].some(([otroId, otraLista]) =>
        otroId !== pdfId
        && !pdfTomado.has(otroId)
        && otraLista.some((o) => o.tier !== null && o.odooFactura === c.odooFactura)));
    let motivo: MotivoExcepcion;
    let detalle: string;
    if (auto.length > 1 || contestada) {
      motivo = 'AMBIGUO';
      detalle = contestada
        ? 'Otra factura PDF calza con la misma bill de Odoo y ninguna es '
          + 'distinguible por monto, líneas ni fecha. Un humano tiene que decidir.'
        : `${auto.length} bills calzan al mismo nivel. Un humano tiene que elegir `
          + 'cuál es la misma factura.';
    } else if (vivos.some((c) => c.evidencia.mismoTotal && c.evidencia.mismasLineas)) {
      motivo = 'FECHA_DISCREPA';
      detalle = 'Monto y líneas calzan exacto pero la fecha no. Suele ser que '
        + 'contabilidad cargó la bill con otra fecha que la del CFDI.';
    } else if (vivos.some((c) => c.evidencia.mismoTotal || c.evidencia.subconjunto)) {
      motivo = 'LINEAS_DISCREPAN';
      detalle = 'La composición de líneas no coincide (un lado contiene al otro, '
        + 'o difieren). Puede ser una bill parcial, o dos CFDIs combinados en una: '
        + 'ese caso no se enlaza 1:1 y tiene que resolverlo un humano.';
    } else {
      motivo = 'MONTO_DISCREPA';
      detalle = 'Las líneas calzan pero el monto no: revisar diferencia de '
        + 'precio (mecánica de NC, R3 del manifest) antes de enlazar.';
    }
    excepciones.push({
      factura: pdfId, folioFiscal: folioDe.get(pdfId) ?? '', motivo, detalle,
      candidatos: vivos.sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9)),
    });
  }

  return {
    enlaces: enlaces.sort((a, b) => a.factura.localeCompare(b.factura)),
    excepciones: excepciones.sort((a, b) => a.factura.localeCompare(b.factura)),
    odooSinPdf: [...odooDocs.keys()].filter((k) => !odooTomado.has(k)).sort(),
    pdfSinOdoo: [...pdfDocs.keys()]
      .filter((k) => !pdfTomado.has(k) && !candidatosPorPdf.has(k)).sort(),
  };
}

/** Las facturas PDF que NO deben sumar porque Odoo ya las tiene. */
export function facturasSuperseded(c: Conciliacion): string[] {
  return c.enlaces.map((e) => e.factura).sort();
}
