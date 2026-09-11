import { hashFilas, mensajeBloqueado } from '../lib';

/**
 * «Bloquear cambios»: the hash is the proof that a record is the one that
 * was locked. It must not depend on the order the rows arrived in, and it
 * must change with any content change.
 */
describe('hashFilas', () => {
  const a = { productId: 2, sku: 'B', quantity: 10, motivo: 'base' };
  const b = { productId: 1, sku: 'A', quantity: 5, motivo: 'temporada' };

  it('is order-independent', () => {
    expect(hashFilas([a, b])).toBe(hashFilas([b, a]));
  });
  it('is 64 hex chars and changes with any content change', () => {
    const h = hashFilas([a, b]);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashFilas([a, { ...b, quantity: 6 }])).not.toBe(h);
    expect(hashFilas([a])).not.toBe(h);
  });
});

describe('mensajeBloqueado', () => {
  it('says the month, when, who, and who can unlock', () => {
    const m = mensajeBloqueado({ version: 1, autor: 'Ana <ana@x>', at: '2026-09-11T20:15:00Z' }, '2026-10-01');
    expect(m).toMatch(/Octubre 2026/);
    expect(m).toMatch(/Ana <ana@x>/);
    expect(m).toMatch(/gerencia de ventas/);
  });
});
