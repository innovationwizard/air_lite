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
}

export interface TransitoDetalle {
  codigo: string;
  poName: string;
  fechaPlaneada: string | null;
  cantidad: number;
  destino: string | null;
  esEntregaDirecta: boolean;
  esFechaPasada: boolean;
  /** Anotación manual (L3): ETA real conocida por factura/correo + nota. */
  eta: string | null;
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

export interface ReymaVivoPayload {
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
}
