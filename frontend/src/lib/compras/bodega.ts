/**
 * Bodega display order and labels — shared between VivoClient.tsx (the tab
 * strip) and the proof-of-status PDF header, so the
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

/**
 * La cadena de abastecimiento — W18 (Wilmer, 2026-08-20 y 2026-08-26).
 *
 *   San José Villanueva (central) → Zacapa → Petén      *"es una cadenita"*
 *
 * San José compra al proveedor; Zacapa se resurte desde San José; Petén
 * desde Zacapa (*"Petén se abastece de Zacapa"*). Mirando una bodega, la
 * decisión de media jornada es comprar o TRASLADAR desde la de arriba —
 * *"hay muchos que dice que no compro, sino que los traslado de San José
 * para Zacapa"* — y para eso hacen falta la existencia Y la venta de la
 * bodega que abastece: *"si aquí me dijera que en San José hay 50, pero la
 * venta mensual de San José son 200, yo no voy a trasladar esos 50"*.
 *
 * Es configuración en código y no una tabla a propósito: son tres bodegas y
 * una sola cadena, igual que `BODEGA_LABEL`; una bodega nueva ya exige un
 * despliegue por el `bodega_map`. General y San José no tienen origen —
 * General es la suma y San José compra.
 */
export const BODEGA_ORIGEN: Readonly<Record<string, string>> = {
  Zacapa: 'San Jose VN',
  'Petén': 'Zacapa',
};

/** La bodega que abastece a `bodega`, o null si compra al proveedor / es General. */
export function bodegaOrigen(bodega: string): string | null {
  return BODEGA_ORIGEN[bodega] ?? null;
}

/**
 * Canales comerciales que son una SEDE y no un tipo de cliente — Jorge,
 * 2026-09-11: en la página de Wilmer las columnas por canal van en dos
 * juegos, primero los tipos de cliente (Institucional, Mayoreo,
 * Supermercados, Tiendas) y después las bodegas lejanas (Zacapa, Petén), y
 * el total «Adicionales» cierra el bloque. Alfabético mezclaba los dos juegos.
 *
 * Slug de `comercial_areas` → bodega. Configuración en código por la misma
 * razón que `BODEGA_ORIGEN`: son dos sedes y una bodega nueva ya exige
 * despliegue.
 */
export const AREA_SEDE: Readonly<Record<string, string>> = {
  zacapa: 'Zacapa',
  peten: 'Petén',
};

/**
 * Orden de las columnas por canal: tipos de cliente por nombre, luego las
 * sedes en el orden canónico de bodega. No muta la entrada.
 */
export function ordenarAreas<T extends { slug: string; nombre: string }>(areas: readonly T[]): T[] {
  const clientes = areas.filter((a) => !(a.slug in AREA_SEDE))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const sedes = areas.filter((a) => a.slug in AREA_SEDE)
    .sort((a, b) => ordenBodega(AREA_SEDE[a.slug]) - ordenBodega(AREA_SEDE[b.slug]));
  return [...clientes, ...sedes];
}
