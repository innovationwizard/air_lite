/**
 * Validation for the purchase-plan draft (`export_plan_draft`).
 *
 * Pure and separately tested because one of these rules exists to stop a bug
 * that already reached production: on 2026-08-12 a manual entry of 1e9 fit
 * NUMERIC(15,4), saved, and poisoned the live page until it was cleared by
 * hand. A draft is a manual entry too, so it gets the SAME ceiling as the
 * tránsito / pendiente / comercial write-backs — `MAX_MANUAL_QTY`, shared, not
 * a second copy of the number.
 */
import { MAX_MANUAL_QTY } from './qty';
import { CARVAJAL_BODEGAS } from './carvajal';

export const MAX_DRAFT_LINEAS = 3000;
export const MAX_PROVEEDOR_LEN = 120;

export interface DraftKey { proveedor: string; semana: number; mes: string }

/** 'YYYY-MM' or 'YYYY-MM-DD' → first day of that month. Mirrors lib.normalizeMonth. */
function normalizeMonth(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

/** Returns the key, or an error STRING — never throws, never a silent default. */
export function readDraftKey(src: {
  proveedor?: unknown; semana?: unknown; mes?: unknown;
}): DraftKey | string {
  const proveedor = typeof src.proveedor === 'string' ? src.proveedor.trim() : '';
  if (!proveedor) return 'proveedor es obligatorio';
  if (proveedor.length > MAX_PROVEEDOR_LEN) {
    return `proveedor excede ${MAX_PROVEEDOR_LEN} caracteres`;
  }
  const semana = Number(src.semana);
  if (!Number.isInteger(semana) || semana < 1 || semana > 5) {
    return 'semana debe ser un entero entre 1 y 5';
  }
  const mes = normalizeMonth(src.mes);
  if (!mes) return 'mes debe ser YYYY-MM o YYYY-MM-DD';
  return { proveedor, semana, mes };
}

/**
 * A quantity is a finite number in [0, MAX_MANUAL_QTY], or null for an EMPTY
 * cell. null and 0 are kept distinct all the way to the file: 0 tells the
 * supplier "order none of this", blank says "not on this shipment".
 */
export function readDraftCantidades(raw: unknown): Record<string, number | null> | string {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return 'cantidades debe ser un objeto';
  }
  const out: Record<string, number | null> = {};
  for (const b of CARVAJAL_BODEGAS) {
    const v = (raw as Record<string, unknown>)[b];
    if (v === undefined || v === null) { out[b] = null; continue; }
    if (typeof v !== 'number' || !Number.isFinite(v)) return `cantidad inválida en ${b}`;
    if (v < 0) return `cantidad negativa en ${b}`;
    if (v > MAX_MANUAL_QTY) return `cantidad en ${b} excede el máximo (${MAX_MANUAL_QTY})`;
    out[b] = v;
  }
  return out;
}
