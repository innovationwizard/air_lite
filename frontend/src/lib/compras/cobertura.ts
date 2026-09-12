/**
 * Coverage horizon for the Sugerido — how many days of demand it should
 * cover, configurable per bodega (bodega_cobertura, migration
 * 20260821000006). Originally a one-off hardcode for Zacapa/Petén (Wilmer,
 * 2026-08-21); a dropdown of six values from 2026-09-04; a TYPED number from
 * 2026-09-11, because his real horizon is arithmetic, not a menu item:
 *
 *   «necesito enviar orden de compra a este proveedor que tienen un lead time
 *    de 35 días, entonces entiendo debería colocar sugerido 65 por mi lead time»
 *
 * The bounds are the table's own CHECK — 1–365 since migration 20260911000006
 * (was 1–120; import lead times of 90–120 days plus cover overflow it) — so
 * the route, the input and the database can't disagree about what is a valid
 * horizon. ⚠️ Change this and the CHECK together, never one alone.
 */
export const COBERTURA_MIN_DIAS = 1;
export const COBERTURA_MAX_DIAS = 365;

export function esCoberturaValida(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
    && v >= COBERTURA_MIN_DIAS && v <= COBERTURA_MAX_DIAS;
}
