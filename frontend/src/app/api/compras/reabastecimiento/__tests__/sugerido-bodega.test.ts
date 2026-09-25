/**
 * `consolidarSugeridoBodega` — A4.17, y el defecto que Wilmer reportó el
 * 2026-09-25: *«modifico columna pide bodega para ver cubicaje y no modifica
 * cubicaje»*.
 *
 * POR QUÉ IMPORTA: la lectura filtraba `.eq('bodega', bodega)`, pero el POST
 * rechaza `General` a propósito (es la suma de las otras, no un lugar donde
 * alguien pida). Así que toda captura vive bajo una bodega física y en General
 * la consulta no casaba ninguna: el Sugerido no se movía y el m³ tampoco. La
 * fórmula del cubicaje estaba bien; el número que le entraba, no.
 *
 * El destino de ese m³ es reservar furgones, y Wilmer tiene un tope físico duro
 * de 3 furgones locales. Un aditivo que General no suma es capacidad que no se
 * reserva.
 *
 * Las filas llegan SIEMPRE de más nueva a más vieja — así las ordena
 * `fetchAll` con el desempate `{ columna: 'id', ascending: false }`.
 */
import { consolidarSugeridoBodega } from '../rows';

type Fila = { product_id: number; bodega: string; qty: number | null; created_at: string };

/** Filas en el orden en que llegan de la consulta: la primera es la más nueva. */
const filas = (...fs: [number, string, number | null][]): Fila[] =>
  fs.map(([product_id, bodega, qty], i) => ({
    product_id, bodega, qty,
    created_at: `2026-09-${String(25 - i).padStart(2, '0')}T00:00:00Z`,
  }));

describe('consolidarSugeridoBodega', () => {
  describe('una bodega física ve SÓLO lo suyo', () => {
    it('no muestra lo que pidió otra bodega', () => {
      const m = consolidarSugeridoBodega(filas([1, 'Zacapa', 30], [1, 'Petén', 20]), 'Zacapa');
      expect(m.get(1)).toBe(30);
    });

    it('la última captura de esa bodega gana', () => {
      const m = consolidarSugeridoBodega(filas([1, 'Zacapa', 45], [1, 'Zacapa', 30]), 'Zacapa');
      expect(m.get(1)).toBe(45);
    });

    it('un producto sin captura no está en el mapa — nadie pidió', () => {
      expect(consolidarSugeridoBodega(filas([1, 'Zacapa', 30]), 'Zacapa').has(2)).toBe(false);
    });
  });

  describe('General SUMA las bodegas físicas', () => {
    it('EL BUG DE WILMER: dos bodegas piden el mismo código y General los suma', () => {
      const m = consolidarSugeridoBodega(filas([1, 'Zacapa', 30], [1, 'Petén', 20]), 'General');
      expect(m.get(1)).toBe(50);
    });

    it('una sola captura llega entera a General — antes llegaba 0', () => {
      expect(consolidarSugeridoBodega(filas([1, 'Zacapa', 30]), 'General').get(1)).toBe(30);
    });

    it('suma las tres bodegas de la cadena', () => {
      const m = consolidarSugeridoBodega(
        filas([1, 'San Jose VN', 100], [1, 'Zacapa', 30], [1, 'Petén', 20]), 'General');
      expect(m.get(1)).toBe(150);
    });

    it('dentro de cada bodega gana la última ANTES de sumar', () => {
      // Zacapa corrigió 30 → 45; Petén pidió 20. General ve 65, nunca 95.
      const m = consolidarSugeridoBodega(
        filas([1, 'Zacapa', 45], [1, 'Petén', 20], [1, 'Zacapa', 30]), 'General');
      expect(m.get(1)).toBe(65);
    });

    it('cada producto se suma por separado', () => {
      const m = consolidarSugeridoBodega(
        filas([1, 'Zacapa', 30], [2, 'Petén', 7], [1, 'Petén', 20]), 'General');
      expect(m.get(1)).toBe(50);
      expect(m.get(2)).toBe(7);
    });
  });

  describe('borrar (qty null) es una entrada nueva, no un DELETE', () => {
    it('borrar en su bodega la deja sin captura', () => {
      const m = consolidarSugeridoBodega(filas([1, 'Zacapa', null], [1, 'Zacapa', 30]), 'Zacapa');
      expect(m.get(1)).toBeNull();
    });

    it('BORRAR EN UNA BODEGA NO BORRA LO QUE PIDIÓ OTRA', () => {
      // Zacapa se arrepiente; Petén sigue pidiendo 20. General debe ver 20.
      const m = consolidarSugeridoBodega(
        filas([1, 'Zacapa', null], [1, 'Petén', 20], [1, 'Zacapa', 30]), 'General');
      expect(m.get(1)).toBe(20);
    });

    it('un borrado no tapa una cantidad ya sumada, llegue en el orden que llegue', () => {
      // El borrado de Petén se ve DESPUÉS de la cantidad de Zacapa.
      const m = consolidarSugeridoBodega(
        filas([1, 'Zacapa', 30], [1, 'Petén', null]), 'General');
      expect(m.get(1)).toBe(30);
    });

    it('borrado en todas las bodegas = null, que NO es cero', () => {
      const m = consolidarSugeridoBodega(
        filas([1, 'Zacapa', null], [1, 'Petén', null]), 'General');
      expect(m.get(1)).toBeNull();
    });

    it('un cero capturado es un cero, no un borrado', () => {
      expect(consolidarSugeridoBodega(filas([1, 'Zacapa', 0]), 'Zacapa').get(1)).toBe(0);
    });
  });

  describe('General cuadra con la suma de las pestañas', () => {
    it('lo que muestra General es exactamente lo que muestran las otras sumado', () => {
      const fs = filas(
        [1, 'San Jose VN', 100], [1, 'Zacapa', 30], [1, 'Petén', 20],
        [2, 'Zacapa', 5], [2, 'Zacapa', 8]);
      const porBodega = ['San Jose VN', 'Zacapa', 'Petén']
        .map((b) => consolidarSugeridoBodega(fs, b));
      const general = consolidarSugeridoBodega(fs, 'General');
      for (const pid of [1, 2]) {
        const suma = porBodega.reduce((s, m) => s + (m.get(pid) ?? 0), 0);
        expect(general.get(pid)).toBe(suma);
      }
    });
  });
});
