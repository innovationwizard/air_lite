/**
 * «Destino final» declarado a mano — W15-A.
 *
 * ⚠️ ESTE MÓDULO IMPLEMENTA, A PROPÓSITO, UNA RESPUESTA INCOMPLETA.
 *
 * Decisión de Jorge (Q26, 2026-08-27), con el defecto enunciado por él mismo en
 * la misma frase: **un furgón puede descargar parte en San José, parte en
 * Zacapa y parte en Petén**, así que un único destino por producto no puede ser
 * correcto. Se construye igual, y se construye para provocar la conversación de
 * diseño: la forma más rápida de aprender cómo se comporta de verdad la cadena
 * es verlo intentar declararla y chocar con el límite.
 *
 * QUÉ SABEMOS YA, medido en el código el 2026-08-27:
 *   * El tránsito sincronizado NO tiene dimensión de bodega. `sync_transit()`
 *     devuelve `{product_id: qty}` global y `assemble_inputs()` escribe ESE
 *     MISMO número en las tres bodegas. No está «revuelto»: está REPLICADO.
 *     Esta declaración manual es, mientras tanto, la única forma de que una
 *     bodega deje de ver tránsito ajeno.
 *   * `transito_overrides` ya es por `(product_id, bodega)`, así que él YA
 *     puede expresar el reparto — tecleando la misma remesa tres veces, una por
 *     vista. Esta columna compra una sola cosa: una captura en vez de tres. Y
 *     ese canje es exactamente donde se rompe.
 *
 * POR ESO LA CANTIDAD TECLEADA MANDA SOBRE EL DESTINO DECLARADO: la primera es
 * la herramienta más expresiva y no se puede pisar con la menos expresiva.
 */

/** `null` = no declarado. Nunca se adivina un destino por omisión. */
export type DestinoDeclarado = string | null;

export interface EntradaDestino {
  productId: number;
  destino: DestinoDeclarado;
}

/**
 * Tránsito que le toca a `bodega` después de aplicar la declaración manual.
 *
 * @param bodega          la vista que se está armando
 * @param destino         lo declarado para ese producto (global al producto)
 * @param transitoSync    el tránsito sincronizado (hoy: global y replicado)
 * @param bodegaGeneral   el nombre de la vista de roll-up
 *
 * `General` NUNCA se reparte: es la suma, y la cifra global es justo la que
 * necesita. Repartirla ahí borraría tránsito real de la única vista donde hoy
 * el número está bien.
 */
export function transitoSegunDestino(
  bodega: string,
  destino: DestinoDeclarado,
  transitoSync: number,
  bodegaGeneral: string,
): number {
  if (bodega === bodegaGeneral) return transitoSync;
  if (destino === null) return transitoSync;
  return destino === bodega ? transitoSync : 0;
}

/**
 * ¿Hay que marcar la fila como provisional?
 *
 * Sólo cuando la declaración está cambiando lo que se ve: en `General` no
 * cambia nada, y sin declaración tampoco. Marcar de más entrena a ignorar el
 * aviso, y este aviso es la mitad del valor de W15-A — un número equivocado que
 * nadie ve es un bug; uno rotulado como provisional es un instrumento.
 */
export function destinoAfectaFila(
  bodega: string,
  destino: DestinoDeclarado,
  bodegaGeneral: string,
): boolean {
  return destino !== null && bodega !== bodegaGeneral;
}

/**
 * Última declaración por producto. Las filas llegan más nuevas primero
 * (append-only, igual que `transito_overrides`); una entrada con `destino`
 * nulo es un BORRADO y se conserva como tal en el mapa, para que el consumidor
 * la trate igual que «nunca se declaró».
 */
export function ultimaPorProducto(
  filas: readonly { product_id: number; destino: string | null }[],
): Map<number, DestinoDeclarado> {
  const m = new Map<number, DestinoDeclarado>();
  for (const f of filas) if (!m.has(f.product_id)) m.set(f.product_id, f.destino);
  return m;
}
