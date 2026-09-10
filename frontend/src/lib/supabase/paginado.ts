/**
 * Paginado de lecturas PostgREST — UNA sola implementación, a propósito.
 *
 * Vivía duplicada: una copia en `api/compras/reabastecimiento/lib.ts` (Wilmer)
 * y otra privada, calcada, en `api/compras-internacionales/reyma/route.ts`
 * (Alexis). Cuando la primera se arregló el 2026-09-09, la segunda se quedó
 * con el defecto — que es exactamente lo que pasa siempre con una función
 * copiada. Ahora las dos importan de acá.
 */

/**
 * The little that pagination needs from a PostgREST query builder. Typed
 * structurally so this module does not depend on postgrest-js internals.
 */
interface Paginable<T> {
  order(columna: string, opciones: { ascending: boolean }): Paginable<T>;
  range(desde: number, hasta: number): PromiseLike<{
    data: T[] | null; error: { message: string } | null;
  }>;
}

/** A UNIQUE column, and the direction to read it in. */
export interface Desempate {
  columna: string;
  ascending?: boolean;
}

/**
 * Page through a PostgREST query — supabase-js caps a single select at 1000
 * rows.
 *
 * ⚠️ `desempate` IS THE POINT OF THIS FUNCTION, and it MUST name a column that
 * is unique in the result. It is not a style preference; it is what makes
 * paging correct at all.
 *
 * LIMIT/OFFSET without a TOTAL order is undefined behaviour in PostgreSQL: two
 * rows the ORDER BY cannot separate may come back in either order, and each
 * page is a separate query. A row that sat at index 999 in page 1 can sit at
 * index 1000 in page 2's plan — so it arrives TWICE and another row never
 * arrives at all. It is silent, intermittent and looks like a data problem.
 *
 * WHAT IT COST (2026-09-09). Wilmer sorted the live table by tránsito, and:
 *
 *   «ordeno de mayor a menor el tránsito y aparecen primero ceros»
 *
 * The sort was fine. `reabastecimiento_inputs` for General is 1337 rows = two
 * pages, one product came back twice, and two `<tr>` shared a React key —
 * which makes React keep those nodes where they were instead of moving them
 * when the list re-sorts (measured, not assumed). So a zero-tránsito row sat
 * pinned above 27,154 units. The row that got dropped in exchange was the
 * expensive half: it vanished from the table, from the Excel export and from
 * the clipboard copy, which is a SKU quietly missing from a purchase order.
 *
 * ⚠️ EN REYMA NO SE VE. Esa mitad barata —una fila fuera de lugar— sólo existe
 * porque la tabla de Wilmer pinta una fila por registro. Del lado de Alexis
 * las filas se SUMAN (cajas pendientes, cantidades facturadas, ventas por mes):
 * un duplicado no descoloca nada, infla un total, y un total inflado se lee
 * como un dato. Es el mismo defecto y es más difícil de notar, no menos.
 *
 * Every table read through here has a unique key — `id` (uuidv7 or serial) in
 * almost all of them, `codigo` in `reyma_products`, `supplier_id` in
 * `supplier_group_members`. There is always a right answer. For the
 * append-only tables read newest-first, pass `{ columna: 'id', ascending:
 * false }`: uuidv7 sorts in creation order, so the tiebreaker also settles
 * which row wins when two share a `created_at`.
 */
export async function fetchAll<T>(
  consulta: () => Paginable<T>,
  desempate: string | Desempate,
  page = 1000,
): Promise<T[]> {
  const columna = typeof desempate === 'string' ? desempate : desempate.columna;
  const ascending = typeof desempate === 'string' ? true : desempate.ascending ?? true;
  const out: T[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await consulta()
      .order(columna, { ascending })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) return out;
  }
}
