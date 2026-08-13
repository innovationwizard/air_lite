/**
 * Shared helpers for the live reabastecimiento API routes.
 *
 * Bodega names are validated against `bodega_map` (+ 'General', the display
 * aggregate) so a typo in a write-back can never silently no-op against the
 * synced inputs.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const GENERAL_BODEGA = 'General';

/** Page through a PostgREST query — supabase-js caps a single select at 1000 rows. */
export async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  page = 1000,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await query(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}

/** Known bodega names = bodega_map values + the General display aggregate. */
export async function knownBodegas(service: SupabaseClient): Promise<string[]> {
  const { data, error } = await service.from('bodega_map').select('bodega');
  if (error) throw new Error(error.message);
  const set = new Set<string>((data ?? []).map((r: { bodega: string }) => r.bodega));
  set.add(GENERAL_BODEGA);
  return [...set];
}

export function badRequest(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0;
}

/** Normalize 'YYYY-MM' or 'YYYY-MM-DD' to the first day of that month. */
export function normalizeMonth(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}
