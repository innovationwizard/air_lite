/**
 * Manual-quantity validation for the reabastecimiento write-backs (tránsito,
 * pendiente de tomar reserva, comercial), shared by the API routes
 * (authoritative) and the live client (pre-flight, so the rejection is
 * explained without a round-trip).
 *
 * MAX_MANUAL_QTY exists because of the 2026-08-12 prod incident: an entry of
 * 1,000,000,000 fit NUMERIC(15,4), saved, and poisoned exist. neta on the
 * live page; the next larger entry overflowed the column and surfaced as an
 * opaque 500. The largest real monthly volume measured to date is ~41k units
 * (p6, bodega General), so 1,000,000 gives >20× headroom while rejecting
 * orders-of-magnitude fat-fingers. Mirrored by the `*_qty_sane` DB CHECKs
 * (migration 20260813000001) so no future write path can bypass it.
 */
export const MAX_MANUAL_QTY = 1_000_000;

export type ManualQtyResult =
  | { ok: true; qty: number }
  | { ok: false; error: string };

export type ManualQtyOrClearResult =
  | { ok: true; qty: number | null }
  | { ok: false; error: string };

export function validateManualQty(qty: unknown): ManualQtyResult {
  if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) {
    return { ok: false, error: 'qty debe ser un número ≥ 0' };
  }
  if (qty > MAX_MANUAL_QTY) {
    return {
      ok: false,
      error: `qty supera el máximo de captura manual (${MAX_MANUAL_QTY.toLocaleString('es-GT')})`
        + ' — si el valor real es mayor, reportalo con el botón de bugs',
    };
  }
  return { ok: true, qty };
}

/** qty === null means "quitar la captura manual" (the override reverts). */
export function validateManualQtyOrClear(qty: unknown): ManualQtyOrClearResult {
  if (qty === null) return { ok: true, qty: null };
  return validateManualQty(qty);
}
