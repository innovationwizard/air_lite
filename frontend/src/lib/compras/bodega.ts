/**
 * Bodega display order and labels — shared between VivoClient.tsx (the tab
 * strip, the destino dropdown) and the proof-of-status PDF header, so the
 * canonical order/labels can't drift between the screen and the printed
 * record. The underlying identifier stays 'San Jose VN' everywhere else
 * (API params, DB, filters, the Carvajal export) — this only changes what a
 * human reads, never what's stored or sent (Jorge, 2026-09-04).
 */

/** Canonical display order — the API/DB order is unordered. */
export const BODEGA_ORDEN = ['General', 'San Jose VN', 'Zacapa', 'Petén'];

export function ordenBodega(b: string): number {
  const i = BODEGA_ORDEN.indexOf(b);
  return i === -1 ? BODEGA_ORDEN.length : i;
}

export const BODEGA_LABEL: Record<string, string> = { 'San Jose VN': 'San José' };

export function ordenarBodegas<T extends string>(bodegas: readonly T[]): T[] {
  return [...bodegas].sort((a, b) => ordenBodega(a) - ordenBodega(b));
}
