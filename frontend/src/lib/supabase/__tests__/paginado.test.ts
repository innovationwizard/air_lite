/**
 * Paginado estable — la regresión del 2026-09-09.
 *
 * Wilmer, mirando la tabla en vivo ordenada por tránsito de mayor a menor:
 *
 *   «ordeno de mayor a menor el tránsito y aparecen primero ceros»
 *
 * El orden de la tabla estaba bien. Lo que estaba mal era el paginado que
 * arma las filas: `LIMIT/OFFSET` sin un orden TOTAL deja que PostgreSQL
 * devuelva las filas en distinto orden en cada página, y entonces una fila
 * llega DOS VECES y otra no llega nunca. Dos filas con la misma key hacen que
 * React deje esos `<tr>` donde estaban en vez de moverlos al reordenar, y un
 * tránsito 0 se quedó clavado arriba de uno de 27,154.
 *
 * Medido contra la base el mismo día: `reabastecimiento_inputs` de General son
 * 1,337 filas = dos páginas, y el fetch sin orden devolvía 1,337 filas con
 * 1,336 productos distintos. La fila que se perdía a cambio del duplicado es
 * la mitad cara: desaparecía de la tabla, del Excel y del portapapeles — un
 * SKU que se cae de una orden de compra sin que nadie lo note.
 *
 * El fake de acá abajo REPRODUCE ese planner: baraja antes de ordenar, así que
 * lo que el ORDER BY no separa queda en orden arbitrario, igual que en la base.
 */
import { fetchAll } from '../paginado';

interface Fila { id: number; grupo: string }

/** PRNG con semilla — el desorden tiene que ser reproducible en CI. */
function barajar<T>(arr: readonly T[], semilla: number): T[] {
  const out = [...arr];
  let s = semilla;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Una tabla PostgREST de mentira que se comporta como el planner real: cada
 * consulta parte de un orden arbitrario y sólo respeta lo que el ORDER BY
 * pide. Los empates NO se conservan entre páginas — que es justo el punto.
 */
function tablaFalsa(filas: readonly Fila[]) {
  let consultas = 0;
  const ordenes: { columna: string; ascending: boolean }[] = [];
  const construir = () => {
    const claves: { columna: string; ascending: boolean }[] = [];
    const builder = {
      order(columna: string, opciones: { ascending: boolean }) {
        claves.push({ columna, ascending: opciones.ascending });
        ordenes.push({ columna, ascending: opciones.ascending });
        return builder;
      },
      range(desde: number, hasta: number) {
        consultas += 1;
        const base = barajar(filas, consultas * 7919);
        const ordenado = [...base].sort((a, b) => {
          for (const k of claves) {
            const va = a[k.columna as keyof Fila];
            const vb = b[k.columna as keyof Fila];
            if (va === vb) continue;
            return (va > vb ? 1 : -1) * (k.ascending ? 1 : -1);
          }
          return 0; // empate: se queda como lo dejó el barajado
        });
        return Promise.resolve({
          data: ordenado.slice(desde, hasta + 1),
          error: null as { message: string } | null,
        });
      },
    };
    return builder;
  };
  return { construir, ordenes, consultas: () => consultas };
}

const FILAS: Fila[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  grupo: i < 20 ? 'A' : 'B', // columna NO única, como `created_at` o `fecha`
}));

describe('fetchAll — paginado', () => {
  it('devuelve cada fila exactamente una vez cuando el desempate es único', async () => {
    const t = tablaFalsa(FILAS);
    const out = await fetchAll<Fila>(t.construir, 'id', 10);

    expect(out).toHaveLength(FILAS.length);
    expect(new Set(out.map((r) => r.id)).size).toBe(FILAS.length);
    expect(out.map((r) => r.id)).toEqual(FILAS.map((r) => r.id));
  });

  it('el fake SÍ reproduce el bug si el orden no es total — si no, este test no probaría nada',
    async () => {
      const t = tablaFalsa(FILAS);
      // Exactamente lo que hacía el código viejo: ordenar por una columna que
      // no separa las filas (o por ninguna) y paginar encima.
      const out: Fila[] = [];
      for (let desde = 0; desde < 30; desde += 10) {
        const { data } = await t.construir()
          .order('grupo', { ascending: true })
          .range(desde, desde + 9);
        out.push(...(data ?? []));
      }
      expect(out).toHaveLength(FILAS.length);
      expect(new Set(out.map((r) => r.id)).size).toBeLessThan(FILAS.length); // duplicados
    });

  it('pasa la dirección del desempate al ORDER BY', async () => {
    const t = tablaFalsa(FILAS);
    const out = await fetchAll<Fila>(t.construir, { columna: 'id', ascending: false }, 10);

    expect(t.ordenes.every((o) => o.columna === 'id' && o.ascending === false)).toBe(true);
    expect(out.map((r) => r.id)).toEqual([...FILAS].map((r) => r.id).reverse());
  });

  it('para cuando el total es múltiplo exacto del tamaño de página', async () => {
    const t = tablaFalsa(FILAS.slice(0, 20));
    const out = await fetchAll<Fila>(t.construir, 'id', 10);

    expect(out).toHaveLength(20);
    expect(new Set(out.map((r) => r.id)).size).toBe(20);
    expect(t.consultas()).toBe(3); // 10, 10, y la vacía que confirma el final
  });

  it('propaga el error en vez de devolver una tabla a medias', async () => {
    const consulta = () => ({
      order() { return this; },
      range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    });
    await expect(fetchAll<Fila>(consulta, 'id', 10)).rejects.toThrow('boom');
  });
});
