/**
 * `volumenM3` — el único punto donde un cubicaje sin medir podría convertirse
 * en un cero.
 *
 * Importa porque el destino de este número es reservar furgones: Wilmer tiene
 * un tope físico duro (*"tengo un límite de 3 furgones locales, entonces yo
 * tengo que cubicar no más de eso"*). Un 0 dice «no ocupa espacio» y hace
 * subestimar la carga; un vacío dice «no se midió», que es la verdad para 218
 * de los 1,333 productos de esta página (medido 2026-09-07).
 *
 * PostgREST entrega NUMERIC como STRING, así que el parseo es real y no una
 * formalidad: `Number('')` es 0, y ése es exactamente el bug que no puede pasar.
 */
import { volumenM3 } from '../rows';

describe('volumenM3', () => {
  it('acepta el string que manda PostgREST para un NUMERIC', () => {
    expect(volumenM3('0.004200')).toBe(0.0042);
  });

  it('acepta un número ya parseado', () => {
    expect(volumenM3(0.0042)).toBe(0.0042);
  });

  it('trata la cadena vacía como SIN MEDIR — Number("") sería 0', () => {
    expect(volumenM3('')).toBeNull();
  });

  it('null y undefined son sin medir', () => {
    expect(volumenM3(null)).toBeNull();
    expect(volumenM3(undefined)).toBeNull();
  });

  it('un 0 guardado es «sin medir», no «no ocupa espacio»', () => {
    expect(volumenM3(0)).toBeNull();
    expect(volumenM3('0')).toBeNull();
    expect(volumenM3('0.000000')).toBeNull();
  });

  it('un negativo no es un volumen', () => {
    expect(volumenM3(-1)).toBeNull();
  });

  it('la basura no se convierte en un número', () => {
    expect(volumenM3('n/a')).toBeNull();
    expect(volumenM3('NaN')).toBeNull();
  });
});
