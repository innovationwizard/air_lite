/**
 * Payload contract of GET /api/inventarios/reyma — the live Reyma model.
 * Shared by the API route (assembler) and VivoClient (consumer). The math is
 * NOT here: both sides defer to the phase-1 engine (engine.ts, 2,752/2,752
 * xlsx parity); this is data shape only.
 */
import type { ModeloRow, VentasRow } from '../reyma/engine';

/** ModeloRow + live-only visibility fields the workbook never had. */
export interface VivoRow extends ModeloRow {
  /** Tránsito de entregas directas (destino Z11) — NO incluido en `transito` (regla 6). */
  entregaDirecta: number;
  /** Pendientes por surtir totales, sin filtro de edad (transparencia de la regla de 8 días). */
  psxTotal: number;
  /** Categoría aún desde el xlsx (P7 pendiente) — false cuando Odoo ya la tenga. */
  categoriaEsFallback: boolean;
  /** Override persistido de proyección (L3) — cuando existe, proyeccion ya lo trae aplicado. */
  proyeccionInfo: { autor: string; fecha: string } | null;
  /** L3.5 MRP regional — desagregados por bodega (SJ/Z11/PET/ZAC): */
  /** Pendientes por surtir ≤8 días por bodega de origen. */
  psxPorBodega: Record<string, number>;
  /** Tránsito facturado-no-recibido por destino (sin entregas directas). */
  transitoPorDestino: Record<string, number>;
  /** Proyección regional: promedio móvil (mismos meses que la global) de las ventas de esa bodega. */
  proyeccionPorBodega: Record<string, number>;
}

export interface TransitoDetalle {
  codigo: string;
  poName: string;
  fechaPlaneada: string | null;
  cantidad: number;
  destino: string | null;
  esEntregaDirecta: boolean;
  esFechaPasada: boolean;
  /**
   * ETA de Alexis — la que él anotó a mano (L3), por factura o por correo.
   * `null` significa que NO la dijo, y se muestra vacía a propósito: rellenarla
   * con la calculada esconde que 20 de 26 facturas están mostrando fórmula.
   */
  eta: string | null;
  /** ETA App — la fórmula: fecha impresa + N días hábiles según la bodega. */
  etaCalculada: string | null;
  nota: string | null;
  notaAutor: string | null;
}

export interface FacturaLinea {
  factura: string;
  fecha: string | null;
  referencia: string | null;
  tipo: 'factura' | 'nota_credito';
  codigo: string;
  cantidad: number;
  precioUnit: number;
}

export interface NcConfig {
  tarifaUsd: number;
  vigenteHasta: string | null;
  nota: string | null;
  autor: string;
  fecha: string;
}

export interface PlanGuardado {
  semana: string;
  autor: string;
  fecha: string;
  payload: unknown;
}

export interface PedidoGuardado {
  mes: string; // YYYY-MM-01
  autor: string;
  fecha: string;
  payload: unknown;
}

export interface SyncIssue {
  severity: string;
  entity: string | null;
  message: string;
}

/** C7: línea de la PO global del mes, sincronizada de Odoo (baseline de saldos/fill rate). */
export interface PoLinea {
  codigo: string;
  cajas: number;
  recibidas: number;
  precioUnit: number | null;
}

/** C7: la orden global configurada (dato, no código — Alexis la registra cada mes). */
export interface OrdenGlobal {
  mes: string; // YYYY-MM-01
  poName: string; // e.g. 'PO-P-3003'
  autor: string;
  fecha: string;
  lineas: PoLinea[];
}

/**
 * C7/L4: línea de factura capturada del PDF del proveedor (llega por correo
 * días antes de que contabilidad la registre en Odoo — manifest R2). Cuando la
 * misma factura aparece en Odoo (reyma_facturas), la versión Odoo gana y la
 * PDF se marca como duplicada (dedupe por número de factura).
 */
export interface FacturaPdfLinea {
  folioFiscal: string;
  factura: string; // 'F171849'
  guia: string | null; // 'G-216-2026'
  destino: string | null;
  fecha: string;
  /** ETA del furgón (Alexis la codifica en la carpeta del drop, p. ej. 'zacapa-eta-agosto-14'). */
  eta: string | null;
  codigo: string;
  clave: string;
  cantidad: number;
  precioUnit: number;
}

/**
 * N14 — enlace persistido factura PDF ↔ vendor bill de Odoo, con su
 * procedencia. Viene de `reyma_factura_match` (append-only, última fila por
 * par manda). El payload trae SÓLO las filas vigentes.
 */
export interface EnlaceFactura {
  folioFiscal: string;
  factura: string; // 'F171849'
  odooFactura: string; // 'BILL/2026/08/0054'
  tier: 0 | 1 | 2;
  regla: string;
  estado: 'auto' | 'confirmado' | 'rechazado';
  autor: string;
  fecha: string;
}

/**
 * A4.26 — qué modelo de proveedor se está mirando y con qué números.
 *
 * El motor es UNO SOLO para todos los modelos («Ese mismo modelo hay que
 * replicarlo en Carvajal. Es el mismo», 13-ago); lo que cambia son estos
 * valores y el alcance de códigos.
 *
 * Un campo en `null` significa QUE NADIE LO HA DECLARADO para ese proveedor, y
 * la pantalla lo dice así. No se hereda el de Reyma en silencio: una pantalla
 * que se ve completa y usa el lead time de otro proveedor es peor que una que
 * admite el hueco, porque el comprador no tiene forma de notarlo.
 */
export interface ModeloProveedor {
  slug: string;
  nombre: string;
  /** El alcance de códigos se derivó y nadie lo confirmó. */
  provisional: boolean;
  furgonesSemana: number | null;
  maxFurgonesDia: number | null;
  diasDespacho: string[] | null;
  semanasSeguridad: number | null;
  leadTimeDias: number | null;
  objetivoSemanas: number | null;
  alzasPrecioAnio: number | null;
  descComodin: string | null;
  notas: string | null;
}

export interface ReymaVivoPayload {
  modelo?: ModeloProveedor;
  sync: {
    id: string;
    startedAt: string;
    finishedAt: string | null;
    counts: Record<string, number>;
  };
  /** Config the engine needs (measured workbook constants, server-owned). */
  config: {
    capacidadM3: number;
    codFurgonCompleto: string;
    /** Meses de promedio móvil para la proyección por defecto (RESPUESTAS regla 1). */
    mesesPromedioMovil: number;
    /** Regla de edad de pendientes por surtir (RESPUESTAS regla 3). */
    maxEdadPendientesDias: number;
    /**
     * Productos que acumulan NC Duroport — lista medida de la hoja NC del
     * libro (8 claves VT), confirmada por Alexis 2026-08-04. Ya no puede
     * derivarse de la categoría: desde 2026-08-05 la categoría es
     * x_studio_material y "Duroport" también cubre bandejas/biodegradables.
     */
    ncCodigos: string[];
  };
  rows: VivoRow[];
  ventas: VentasRow[];
  transitoDetalle: TransitoDetalle[];
  issues: SyncIssue[];
  /** L3: facturas del proveedor (NC + verificación de precios). */
  facturas: FacturaLinea[];
  ncConfig: NcConfig;
  ultimoPlan: PlanGuardado | null;
  ultimoPedido: PedidoGuardado | null;
  /** C7: PO global del mes + líneas sincronizadas (null si no hay configurada). */
  ordenGlobal: OrdenGlobal | null;
  /** C7/L4: facturas capturadas de los PDFs del proveedor (fuente adelantada). */
  facturasPdf: FacturaPdfLinea[];
  /**
   * N14: enlaces vigentes de conciliación. `computeSaldos` los usa para no
   * contar dos veces la misma factura; la cola de excepciones se calcula en el
   * cliente con el mismo motor puro.
   */
  enlacesFactura: EnlaceFactura[];
  /** Lote 1: días hábiles de ETA por bodega (configurable; default 4). */
  etaConfig: EtaConfigPayload;
}

export interface EtaConfigPayload {
  porDestino: Record<string, number>;
  default: number;
  /** Quién fijó cada valor y cuándo — para el tooltip de procedencia. */
  detalle: Array<{ destino: string; diasHabiles: number; autor: string; fecha: string }>;
}
