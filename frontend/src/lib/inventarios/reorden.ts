/**
 * MOTOR DE PUNTO DE REORDEN + LEAD TIME + ALCANCE MÁXIMO — A4.27.
 *
 * Sirve a Darnel y a Asia/Contenedor. En palabras de quien lo mandó (20-ago):
 * *«trabaja bajo el modelo de punto de reorden + lead time y alcance máximo
 * para generar el pedido. Siempre la columna vertebral es la venta.»*
 *
 * ⚠️ NO ES EL MOTOR DE REYMA y no debe fusionarse con él. Reyma es orden global
 * mensual + MRP semanal + armado de furgones. Esto es niveles de inventario y
 * un pedido que sale de la diferencia contra el máximo. Son dos cálculos, no
 * dos configuraciones del mismo.
 *
 * TODAS las fórmulas de abajo se verificaron celda por celda contra el libro
 * del 20-ago el 2026-09-01, reproduciendo sus valores en caché. Cada una lleva
 * la columna del libro de la que sale.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DOS UNIDADES, Y CONFUNDIRLAS ES EL ERROR CARO
 * ═══════════════════════════════════════════════════════════════════════════
 * El inventario se captura en FARDOS. Todo lo demás —tránsito, venta, niveles,
 * pedido— corre en MILLARES (ML). El puente es `und_fardo`:
 *     ML = fardos × und_fardo / 1000
 * Un producto sin `und_fardo` NO se puede convertir, y por eso no se calcula:
 * se marca y se deja fuera, en lugar de suponer 1 y arrastrar el error hasta
 * el pedido.
 */

/** Un mes en semanas, tal como lo fija el libro (`PARAMETROS`). 30/7. */
export const SEMANAS_POR_MES = 4.2857;

/** Parámetros del modelo. `null` = nadie lo declaró para ese proveedor. */
export interface ParamsReorden {
  /** Semanas de cobertura mínima deseada. Libro: 3. */
  semanasSeguridad: number | null;
  /** Semanas desde el pedido hasta la bodega. Libro: 7. */
  semanasLeadTime: number | null;
  /**
   * Punto de reorden en semanas. Libro: 9.
   *
   * ⚠️ El libro lo rotula «SS + LT», y 3 + 7 = 10, no 9. Se respeta el 9 que el
   * libro USA, porque es el que clasifica los productos hoy; corregirlo a 10
   * movería productos de REORDENAR a OK sin que nadie lo haya pedido. La
   * inconsistencia se declara en pantalla en vez de resolverse por nuestra
   * cuenta.
   */
  semanasReorden: number | null;
  /**
   * Base del inventario máximo, en semanas. Libro: 10.
   *
   * El máximo real es `base + semanasPorContenedorGlobal` — se le suma lo que
   * tarda en venderse un contenedor entero, porque no tiene sentido pedir menos
   * de lo que cabe en el flete que ya se está pagando.
   *
   * ⚠️ Acá el libro se contradice consigo mismo: `RESUMEN EJECUTIVO` dice
   * «MAX = 9.7 sem» (9 + 0.68) mientras la columna del modelo calcula 10.66
   * (10 + 0.6566). La que CLASIFICA es la del modelo, así que es la que se
   * implementa. Medido el 2026-09-01.
   */
  semanasInvMaximoBase: number | null;
  /** Capacidad del contenedor marítimo. Libro: 70 m³, no los 100 del furgón. */
  capacidadContenedorM3: number | null;
}

export interface FilaReorden {
  codigo: string;
  descripcion: string | null;
  undFardo: number | null;
  cubMillar: number | null;
  /** Existencias por bodega, en FARDOS. */
  sj: number; z11: number; zacapa: number; peten: number; patiosSj: number;
  /** Pendientes por surtir, en FARDOS: comprometidos, ya no disponibles. */
  pendSurtirSj: number; pendSurtirPeten: number; pendSurtirZacapa: number;
  /** Tránsito confirmado (en aguas, con fecha) y pendiente (en fábrica), en ML. */
  transitoConfirmado: number;
  transitoPendiente: number;
  /** Venta proyectada mensual, en ML. */
  ventaProyMensual: number | null;
  precioMl: number | null;
  estadoProducto: 'ACTIVO' | 'LIQUIDACION' | 'SIN MOV.';
}

export type EstadoReorden =
  | 'CRITICO' | 'REORDENAR' | 'OK' | 'EXCESO' | 'SIN MOVIMIENTO' | 'EN LIQUIDACION'
  | 'SIN CONVERSION';

export interface ResultadoReorden {
  codigo: string;
  descripcion: string | null;
  /** Existencias netas: bodegas + patios − pendientes por surtir. FARDOS. */
  invNetoFardos: number;
  invNetoMl: number | null;
  transitoConfirmado: number;
  transitoPendiente: number;
  /** Neto + tránsito confirmado + tránsito pendiente. ML. */
  invTotalMl: number | null;
  ventaSemanal: number | null;
  /** Semanas de cobertura mirando sólo lo que está en bodega. */
  coberturaNeta: number | null;
  /** Semanas de cobertura contando el tránsito. Es la que decide el estado. */
  coberturaTotal: number | null;
  stockSeguridadMl: number | null;
  puntoReordenMl: number | null;
  invMaximoMl: number | null;
  /** Cuánto pedir, en millares. 0 cuando no hay que pedir. */
  pedirMl: number;
  pedirFardos: number | null;
  valorPedidoUsd: number | null;
  estado: EstadoReorden;
  /** Por qué no se pudo calcular, cuando aplica. */
  motivo: string | null;
}

export interface ModeloReordenResult {
  filas: ResultadoReorden[];
  /**
   * Semanas que tarda en venderse UN contenedor de todos los productos:
   * `capacidad / Σ(cubicaje × venta semanal)`. Es global, no por producto, y
   * por eso el cálculo necesita dos pasadas.
   */
  semanasPorContenedorGlobal: number | null;
  /** `semanasInvMaximoBase + semanasPorContenedorGlobal`. */
  semanasInvMaximo: number | null;
  totales: {
    productos: number;
    pedirMl: number;
    valorUsd: number;
    /** Filas que no se pudieron calcular; nunca se esconden. */
    sinConversion: number;
  };
  /** Parámetros que nadie declaró para este modelo. La pantalla los pide. */
  parametrosFaltantes: string[];
}

/** Umbrales del semáforo, tal como los declara `PARAMETROS`. */
export const UMBRAL_CRITICO_SEM = 7;
export const UMBRAL_REORDENAR_SEM = 10.7;
/** EXCESO cuando la cobertura supera el máximo por este factor. */
export const FACTOR_EXCESO = 1.5;

/** Fardos → millares. `null` cuando no hay conversión posible. */
function aMillares(fardos: number, undFardo: number | null): number | null {
  if (undFardo === null || !Number.isFinite(undFardo) || undFardo <= 0) return null;
  return (fardos * undFardo) / 1000;
}

/**
 * Corre el modelo sobre todas las filas.
 *
 * DOS PASADAS, y no es un detalle de implementación: `semanasPorContenedorGlobal`
 * depende de la venta semanal de TODOS los productos, y a su vez entra en el
 * inventario máximo de CADA UNO. No se puede resolver fila por fila.
 */
export function calcularModelo(
  filas: readonly FilaReorden[],
  params: ParamsReorden,
): ModeloReordenResult {
  // ── Pasada 1: lo que no depende de nadie más ──────────────────────────────
  const base = filas.map((f) => {
    const invNetoFardos =
      f.sj + f.z11 + f.zacapa + f.peten + f.patiosSj
      - f.pendSurtirSj - f.pendSurtirPeten - f.pendSurtirZacapa;
    const invNetoMl = aMillares(invNetoFardos, f.undFardo);
    const invTotalMl = invNetoMl === null
      ? null
      : invNetoMl + f.transitoConfirmado + f.transitoPendiente;
    const ventaSemanal = f.ventaProyMensual !== null && f.ventaProyMensual > 0
      ? f.ventaProyMensual / SEMANAS_POR_MES
      : 0;
    return { f, invNetoFardos, invNetoMl, invTotalMl, ventaSemanal };
  });

  // ── Global: semanas para vender un contenedor de todo ─────────────────────
  // Σ(cubicaje × venta semanal) = m³ que salen por semana considerando el mix
  // completo. La capacidad dividida por eso son las semanas que dura un
  // contenedor. Sin capacidad declarada no hay número, y no se inventa.
  const m3PorSemana = base.reduce(
    (a, b) => a + (b.f.cubMillar ?? 0) * b.ventaSemanal, 0);
  const semanasPorContenedorGlobal =
    params.capacidadContenedorM3 !== null && m3PorSemana > 0
      ? params.capacidadContenedorM3 / m3PorSemana
      : null;

  const semanasInvMaximo =
    params.semanasInvMaximoBase !== null && semanasPorContenedorGlobal !== null
      ? params.semanasInvMaximoBase + semanasPorContenedorGlobal
      : params.semanasInvMaximoBase;

  // ── Pasada 2: niveles, estado y pedido ────────────────────────────────────
  const resultados: ResultadoReorden[] = base.map(
    ({ f, invNetoFardos, invNetoMl, invTotalMl, ventaSemanal }) => {
      const comun = {
        codigo: f.codigo,
        descripcion: f.descripcion,
        invNetoFardos,
        invNetoMl,
        transitoConfirmado: f.transitoConfirmado,
        transitoPendiente: f.transitoPendiente,
        invTotalMl,
      };

      // Sin conversión no hay modelo. Se dice, no se supone.
      if (invNetoMl === null || invTotalMl === null) {
        return {
          ...comun,
          ventaSemanal: null, coberturaNeta: null, coberturaTotal: null,
          stockSeguridadMl: null, puntoReordenMl: null, invMaximoMl: null,
          pedirMl: 0, pedirFardos: null, valorPedidoUsd: null,
          estado: 'SIN CONVERSION' as const,
          motivo: 'sin unidades por fardo: no se puede convertir a millares',
        };
      }

      const stockSeguridadMl = params.semanasSeguridad !== null
        ? params.semanasSeguridad * ventaSemanal : null;
      const puntoReordenMl = params.semanasReorden !== null
        ? params.semanasReorden * ventaSemanal : null;
      const invMaximoMl = semanasInvMaximo !== null
        ? semanasInvMaximo * ventaSemanal : null;

      // Cobertura infinita cuando no hay venta: no es un error, es un producto
      // que no rota. El libro usa 9999; acá es `null` y el estado lo explica.
      const coberturaNeta = ventaSemanal > 0 ? invNetoMl / ventaSemanal : null;
      const coberturaTotal = ventaSemanal > 0 ? invTotalMl / ventaSemanal : null;

      const estado = clasificar(
        f.estadoProducto, ventaSemanal, coberturaTotal, semanasInvMaximo);

      // EN LIQUIDACION no se pide nunca: el libro lo dice explícito
      // («producto descontinuado, no se pedirá más»).
      const pedirMl = estado === 'EN LIQUIDACION' || invMaximoMl === null
        ? 0
        : Math.max(0, round3(invMaximoMl - invTotalMl));
      const pedirFardos = pedirMl > 0 && f.undFardo
        ? Math.round((pedirMl * 1000) / f.undFardo) : null;
      const valorPedidoUsd = pedirMl > 0 && f.precioMl !== null
        ? round2(pedirMl * f.precioMl) : null;

      return {
        ...comun,
        ventaSemanal, coberturaNeta, coberturaTotal,
        stockSeguridadMl, puntoReordenMl, invMaximoMl,
        pedirMl, pedirFardos, valorPedidoUsd,
        estado, motivo: null,
      };
    });

  const faltantes: string[] = [];
  if (params.semanasSeguridad === null) faltantes.push('semanas de seguridad');
  if (params.semanasLeadTime === null) faltantes.push('lead time');
  if (params.semanasReorden === null) faltantes.push('punto de reorden');
  if (params.semanasInvMaximoBase === null) faltantes.push('inventario máximo');
  if (params.capacidadContenedorM3 === null) faltantes.push('capacidad del contenedor');

  return {
    filas: resultados,
    semanasPorContenedorGlobal,
    semanasInvMaximo,
    totales: {
      productos: resultados.length,
      pedirMl: round3(resultados.reduce((a, r) => a + r.pedirMl, 0)),
      valorUsd: round2(resultados.reduce((a, r) => a + (r.valorPedidoUsd ?? 0), 0)),
      sinConversion: resultados.filter((r) => r.estado === 'SIN CONVERSION').length,
    },
    parametrosFaltantes: faltantes,
  };
}

/**
 * El semáforo, en el orden en que el libro lo evalúa. El orden importa: un
 * producto en liquidación con cobertura baja es LIQUIDACION, no CRITICO — no
 * tiene sentido gritar por algo que se decidió no volver a comprar.
 *
 * ⚠️ En el libro esta primera rama está ROTA: consulta un rango `#REF!` que
 * `IFERROR` traga, así que hoy clasifica CERO productos como liquidación
 * cuando 11 lo están. Acá el dato viene de la hoja de precios, donde sí existe.
 */
function clasificar(
  estadoProducto: FilaReorden['estadoProducto'],
  ventaSemanal: number,
  coberturaTotal: number | null,
  semanasInvMaximo: number | null,
): EstadoReorden {
  if (estadoProducto === 'LIQUIDACION') return 'EN LIQUIDACION';
  if (ventaSemanal <= 0 || coberturaTotal === null) return 'SIN MOVIMIENTO';
  if (coberturaTotal < UMBRAL_CRITICO_SEM) return 'CRITICO';
  if (coberturaTotal < UMBRAL_REORDENAR_SEM) return 'REORDENAR';
  if (semanasInvMaximo !== null && coberturaTotal > semanasInvMaximo * FACTOR_EXCESO) {
    return 'EXCESO';
  }
  return 'OK';
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;
