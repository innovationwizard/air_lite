import { createHash } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { etiquetaMes } from '@/lib/comercial/forecast';

/**
 * «Bloquear cambios» — helpers shared by the lock route and the capture
 * route (which must refuse writes while a lock is active).
 */

export interface BloqueoResumen { version: number; autor: string; at: string }

export async function bloqueoActivo(
  db: SupabaseClient, area: string, month: string,
): Promise<BloqueoResumen | null> {
  const { data } = await db.from('comercial_forecast_bloqueos')
    .select('version, autor, created_at')
    .eq('area', area).eq('month', month).eq('activo', true)
    .maybeSingle();
  return data ? { version: data.version, autor: data.autor, at: data.created_at } : null;
}

export function mensajeBloqueado(lock: BloqueoResumen, month: string): string {
  const cuando = new Date(lock.at).toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Guatemala' });
  return `El forecast de ${etiquetaMes(month)} está bloqueado desde el ${cuando} por ${lock.autor}. `
    + 'Sólo la gerencia de ventas o un administrador pueden desbloquearlo.';
}

/**
 * sha256 of the canonical JSON of the frozen rows: sorted by productId, keys
 * in a fixed order, so the same content always hashes the same and «this is
 * the record that was locked» can be checked byte for byte later.
 */
export function hashFilas(filas: { productId: number }[]): string {
  const canon = [...filas].sort((a, b) => a.productId - b.productId);
  return createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}
