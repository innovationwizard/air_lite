/**
 * Coverage horizon for the Sugerido — how many days of demand it should
 * cover, configurable per bodega (bodega_cobertura, migration
 * 20260821000006). Originally a one-off hardcode for Zacapa/Petén (Wilmer,
 * 2026-08-21); now a dropdown filter any bodega can set (Jorge, 2026-09-04).
 *
 * Shared between the write route's validation and the dropdown's options so
 * the two can't drift.
 */
export const COBERTURA_OPCIONES = [7, 10, 15, 20, 30, 45] as const;
export type CoberturaDias = typeof COBERTURA_OPCIONES[number];

export function esCoberturaValida(v: unknown): v is CoberturaDias {
  return typeof v === 'number' && (COBERTURA_OPCIONES as readonly number[]).includes(v);
}
