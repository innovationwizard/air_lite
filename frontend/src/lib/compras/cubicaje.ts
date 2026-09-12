/**
 * m³ del Sugerido — CON LOS HUECOS DECLARADOS (decisión de Jorge, 2026-09-07).
 *
 * Una sola fórmula para la pantalla, el Excel y el snapshot de estado: si
 * hubiera dos, un día el archivo diría un cubicaje y la pantalla otro, y él
 * reservaría furgones con el equivocado.
 *
 * `ml/probe_cubicaje.py` lo advierte y la advertencia se respeta: *"Un
 * cubicaje incompleto o en la unidad equivocada es PEOR que no tenerlo: lo
 * usaría para reservar camiones."* Wilmer tiene un tope físico duro — *"tengo
 * un límite de 3 furgones locales, entonces yo tengo que cubicar no más de
 * eso"*.
 *
 * Medido el 2026-09-07 sobre los productos de esta página: 1,115 de 1,333
 * tienen `volume_m3 > 0` (83.6%); 218 no tienen ninguno.
 *
 * Por eso: sin medida el m³ va VACÍO, nunca 0 — un 0 dice «no ocupa espacio»
 * y es lo que haría subestimar un furgón — y toda suma de la columna viene
 * acompañada de cuántas filas quedaron sin medida, para que no se pueda leer
 * como completa. Siguen abiertas la verificación de unidad y la remedición de
 * las bolsas (O7); ambas se declaran donde se muestra la suma.
 */
export function m3Sugerido(sug: number, volM3: number | null): number | null {
  if (typeof volM3 !== 'number' || !Number.isFinite(volM3) || volM3 <= 0) return null;
  if (!Number.isFinite(sug)) return null;
  return sug * volM3;
}

/** Cuántas filas no tienen cubicaje medido. */
export function sinCubicaje(
  filas: readonly { sug: number; volM3: number | null }[],
): number {
  return filas.filter((f) => m3Sugerido(f.sug, f.volM3) === null).length;
}

/**
 * Formato de m³ para pantalla: dos decimales siempre. `fmt` redondea a entero
 * y un pedido de 3 unidades × 0.0042 m³ se leería como 0 — que es exactamente
 * la lectura «no ocupa espacio» que este módulo existe para impedir.
 */
export function fmtM3(n: number): string {
  return n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
