/**
 * One-SKU live read. The ML route applies the saved rules and, when asked,
 * a draft, over a single Odoo read. It does not write the sync tables.
 */

const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

export interface LineaUbicacion {
  ubicacion: string;
  cantidad: number;
  reservado?: number;
}

export interface LineaOrden {
  orden: string | null;
  cantidad: number;
  fecha: string | null;
}

export interface LineaMovimiento {
  referencia: string;
  demanda: number;
  cantidad: number;
  pendiente: number;
  origen: string;
  estado: string;
}

export interface MetricasSku {
  existencias: number;
  reservado: number;
  pendiente: number;
  existNeta: number;
  patio: number;
  transito: number;
  ubicaciones: LineaUbicacion[];
  patioUbicaciones: { ubicacion: string; cantidad: number }[];
  ordenes: LineaOrden[];
  movimientos: LineaMovimiento[];
  movimientosRecortados: boolean;
  uomSinConvertir: number;
}

export interface BodegaExplicada {
  bodega: string;
  actual: MetricasSku;
  propuesto: MetricasSku | null;
}

export interface ExplicacionSku {
  sku: string;
  producto: string;
  bodegas: BodegaExplicada[];
  escribe: false;
}

export async function explicarSku(
  sku: string,
  propuesto?: Record<string, unknown>,
): Promise<ExplicacionSku> {
  if (!ML_URL || !ML_KEY) {
    throw new Error('El servicio ML no está configurado (ML_SERVICE_URL / ML_SERVICE_API_KEY)');
  }
  const r = await fetch(`${ML_URL.replace(/\/$/, '')}/reabastecimiento/explicar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': ML_KEY },
    body: JSON.stringify({ sku, propuesto: propuesto ?? null }),
    signal: AbortSignal.timeout(55_000),
    cache: 'no-store',
  });
  const cuerpo = await r.json().catch(() => null) as { error?: string } | null;
  if (!r.ok) throw new Error(cuerpo?.error ?? `El servicio ML respondió ${r.status}`);
  return cuerpo as ExplicacionSku;
}
