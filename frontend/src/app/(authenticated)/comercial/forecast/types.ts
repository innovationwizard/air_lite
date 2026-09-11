import type { Motivo } from '@/lib/comercial/forecast';

/** The shape of GET /api/comercial/forecast, shared by the three views. */
export interface Producto { id: number; sku: string; name: string; stock_uom?: string }
export interface FilaApi {
  id: string; product_id: number; month: string;
  quantity: number; motivo: Motivo; area: string; note: string | null;
}
export interface Datos {
  filas: FilaApi[];
  productos: Producto[];
  proyeccion: { product_id: number; p3: number | null }[];
  areas: { slug: string; nombre: string }[];
  miArea: string | null;
  puedeCapturar: boolean;
  mesesAbiertos: string[];
}
