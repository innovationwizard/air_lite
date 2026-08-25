/**
 * Catálogo de destinos de un furgón de REYMA — el vocabulario compartido entre
 * la pantalla de carga y los endpoints.
 *
 * El `id` es lo que vive en `reyma_facturas_pdf.destino` y lo que las reglas de
 * carga validan (`ml/reyma_factura_carga.DESTINOS_VALIDOS` — los dos catálogos
 * tienen que decir lo mismo).
 *
 * El `nombre` es como lo dice ALEXIS, no como lo guarda la base. Él escribe
 * «SAN JOSE VILLA NUEVA» en WhatsApp; pedirle que reconozca `bodega-san-jose`
 * es hacerle traducir a nuestro vocabulario para usar su propia herramienta.
 *
 * Por qué importa acertarle (N13): los furgones a Zacapa y Petén salen contra
 * sus propias órdenes (`PO-PZ-*`, `PO-PE-*`), no contra la orden global del
 * mes. Un destino mal marcado hace que esas cajas descuenten la PO equivocada
 * e inflen el fill rate. Por eso el destino se pregunta siempre y nunca tiene
 * un valor por defecto.
 */

export interface Destino {
  id: string;
  /** Como lo dice Alexis. */
  nombre: string;
  /** Desambiguación corta, cuando el nombre solo no alcanza. */
  detalle?: string;
}

export const DESTINOS: readonly Destino[] = [
  { id: 'bodega-san-jose', nombre: 'San José', detalle: 'Villa Nueva' },
  { id: 'bodega-zacapa', nombre: 'Zacapa' },
  { id: 'bodega-peten', nombre: 'Petén' },
  { id: 'entrega-directa', nombre: 'Entrega directa', detalle: 'a cliente' },
] as const;

export function nombreDestino(id: string | null | undefined): string {
  if (!id) return '—';
  return DESTINOS.find((d) => d.id === id)?.nombre ?? id;
}
