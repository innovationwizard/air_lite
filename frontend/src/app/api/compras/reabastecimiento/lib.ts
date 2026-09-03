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

/** G4 — retail perimeter, deliberately never merged into a purchasing bodega. */
interface TiendaRow { product_id: number; tienda: string; f6: number; f3: number }

export interface Tiendas {
  porTienda: { tienda: string; f6: number; f3: number }[];
  total: { f6: number; f3: number };
  productos: number;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Shared by GET /api/compras/reabastecimiento and the proof-of-status
 * snapshot route — both need the exact same tiendas panel the page renders.
 *
 * In July 2026 this block was 501,014 units, ~0% of them traceable to a sale
 * order: it is the whole reason Wilmer's and Raquel's totals differ, so it is
 * shown, labelled, and never folded into a purchasing bodega.
 */
export async function buildTiendas(service: SupabaseClient): Promise<Tiendas> {
  const tiendaRows = await fetchAll<TiendaRow>((a, b) =>
    service.from('invoiced_tiendas').select('product_id, tienda, f6, f3').range(a, b));

  const porTiendaMap = new Map<string, { f6: number; f3: number }>();
  for (const t of tiendaRows) {
    const acc = porTiendaMap.get(t.tienda) ?? { f6: 0, f3: 0 };
    acc.f6 += t.f6;
    acc.f3 += t.f3;
    porTiendaMap.set(t.tienda, acc);
  }
  const porTienda = [...porTiendaMap.entries()]
    .map(([tienda, v]) => ({ tienda, f6: round1(v.f6), f3: round1(v.f3) }))
    .sort((a, b) => b.f6 - a.f6);
  return {
    porTienda,
    total: {
      f6: round1(porTienda.reduce((s, t) => s + t.f6, 0)),
      f3: round1(porTienda.reduce((s, t) => s + t.f3, 0)),
    },
    productos: porTiendaMap.size ? new Set(tiendaRows.map((t) => t.product_id)).size : 0,
  };
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
