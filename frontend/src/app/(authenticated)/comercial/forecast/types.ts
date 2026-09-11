import type { Motivo } from '@/lib/comercial/forecast';

export interface BloqueoResumen { version: number; autor: string; at: string }

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
  /** Active areas. A child carries `padre`; a parent captures nothing and rolls its children up. */
  areas: { slug: string; nombre: string; padre?: string | null }[];
  miArea: string | null;
  /** The viewer's area is a parent (e.g. institucional): read-only over its children. */
  esPadre?: boolean;
  puedeCapturar: boolean;
  /** sales_manager / admin / superuser: may lift a «Bloquear cambios» lock. */
  puedeDesbloquear?: boolean;
  /** Active locks, keyed `area|month` ('YYYY-MM-DD'). */
  bloqueos?: Record<string, BloqueoResumen>;
  mesesAbiertos: string[];
  /** Readers only (nivel 2): the closed previous month + the open ones. */
  mesesVista?: string[];
  mesCerrado?: string;
  /** area -> month ('YYYY-MM-01') -> productId -> recommended qty. */
  recomendaciones?: Record<string, Record<string, Record<number, number>>>;
  /** area -> productId -> 'YYYY-MM' -> real requested / delivered. */
  reales?: Record<string, Record<number, Record<string, { pedido: number; entregado: number }>>>;
  /** 'YYYY-MM' -> units requested by teams no channel owns. */
  sinAsignar?: Record<string, number>;
}
