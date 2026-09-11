/**
 * «Pendiente de tomar reserva» — LIVE from Odoo, per request, never stored.
 *
 * Wilmer's own path (2026-09-11): Odoo «Análisis de movimientos» with his
 * saved favorite «Wilmer - Reservas.» — `stock.move` in any non-final state
 * on the bodega's delivery orders AND internal transfers; Demanda
 * (`product_uom_qty`) − Cantidad (`quantity`, already reserved) — plus one
 * refinement his Bodega Central screen does not need but Zacapa/Petén do:
 * the move must LEAVE the bodega's Existencias (there, the same «Traslados
 * internos» type also carries the second leg of receipts, `Entrada →
 * Existencias`, which is stock arriving, not demand). The ML service does
 * the reads (`GET /reabastecimiento/pendiente-reserva`; definition and the
 * measured before/after in `ml/pendiente_reserva.py`) and this module turns
 * the answer into the one number `buildRows` subtracts from net availability.
 *
 * Why it is fetched and not synced: Odoo reserves confirmed demand almost
 * immediately, so the unreserved sliver churns minute to minute (2026-09-03:
 * the same SKU×bodega returned 40 vs 275 open moves 20 minutes apart; the
 * 2026-09-11 build watched 77205001 go 2340 → 1312 within the hour). A
 * synced column or a hand-typed value is stale by construction — that is
 * exactly what the manual `pending_reserve_overrides` input was, and why it
 * was retired.
 *
 * Failure is honest, not zero: if the service or Odoo does not answer, every
 * row's `pending` is null → the page shows ¿? and says why. A SKU Odoo did
 * answer for but has no open moves is a KNOWN 0.
 */

const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

/** One SKU's open demand in one Odoo warehouse. */
export interface PendienteSku { demanda: number; cantidad: number; pendiente: number }

export interface PendienteLive {
  /** Odoo warehouse code → SKU → figures. A requested code with nothing open is `{}`. */
  bodegas: Record<string, Record<string, PendienteSku>>;
  /** Which picking types each code resolved to — `1CET → [2, 5]` is Wilmer's filter verbatim. */
  pickingTypes: Record<string, number[]>;
  asOf: string;
}

export type PendienteResultado =
  | { ok: true; live: PendienteLive }
  | { ok: false; error: string };

/**
 * Fetches the live figures for the given Odoo warehouse codes. Never throws:
 * a failure is a value the caller shows, not an exception that hides the
 * rest of the page.
 */
export async function fetchPendienteReserva(codigos: string[]): Promise<PendienteResultado> {
  if (codigos.length === 0) return { ok: true, live: { bodegas: {}, pickingTypes: {}, asOf: new Date().toISOString() } };
  if (!ML_URL || !ML_KEY) {
    return { ok: false, error: 'El servicio ML no está configurado (ML_SERVICE_URL / ML_SERVICE_API_KEY)' };
  }
  try {
    const r = await fetch(
      `${ML_URL.replace(/\/$/, '')}/reabastecimiento/pendiente-reserva?bodegas=${encodeURIComponent(codigos.join(','))}`,
      { headers: { 'X-API-Key': ML_KEY }, signal: AbortSignal.timeout(20_000), cache: 'no-store' },
    );
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) {
      const detalle = (cuerpo as { error?: string } | null)?.error;
      return { ok: false, error: detalle ?? `El servicio ML respondió ${r.status}` };
    }
    return { ok: true, live: cuerpo as PendienteLive };
  } catch (e) {
    return { ok: false, error: `El servicio ML no respondió: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/**
 * The number a row subtracts: the SKU's pendiente SUMMED over the warehouse
 * codes that make up the bodega (General = every in-scope code; Zacapa =
 * 4ZAC alone). A SKU absent from every requested code is a known 0 — Odoo
 * answered and there is nothing open for it.
 */
export function pendientePorSku(live: PendienteLive, codigos: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const codigo of codigos) {
    const porSku = live.bodegas[codigo];
    if (!porSku) continue;
    for (const [sku, v] of Object.entries(porSku)) {
      out.set(sku, (out.get(sku) ?? 0) + v.pendiente);
    }
  }
  return out;
}
