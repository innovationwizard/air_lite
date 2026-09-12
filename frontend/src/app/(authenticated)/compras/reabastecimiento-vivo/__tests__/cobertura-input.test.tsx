/**
 * «Sugerido a N días» digitado (Wilmer, 2026-09-11): 65 por un lead time de
 * 35. Monta el árbol REAL de VivoClient con fetch mockeado y comprueba que
 * un número tecleado + Enter llega al POST /cobertura, que un valor fuera de
 * 1–120 no se manda, y que Escape devuelve el guardado.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VivoClient } from '../VivoClient';

const payload = {
  bodega: 'General', bodegas: ['General'], rows: [],
  meta: { count: 0, asOf: null, month: '2026-09', coberturaDias: 30, lastSync: null },
};

let posts: { url: string; body: unknown }[];
beforeEach(() => {
  posts = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(String(init.body)) }); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => payload };
  }) as unknown as typeof fetch;
});

it('teclear 65 + Enter guarda 65 para la bodega', async () => {
  const user = userEvent.setup();
  render(<VivoClient />);
  const input = await screen.findByLabelText('Días que cubre el Sugerido en General');
  expect(input).toHaveValue(30);
  await user.clear(input);
  await user.type(input, '65{Enter}');
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0].url).toBe('/api/compras/reabastecimiento/cobertura');
  expect(posts[0].body).toEqual({ bodega: 'General', dias: 65 });
});

it('fuera de 1–365 no se guarda y vuelve al valor guardado al salir', async () => {
  const user = userEvent.setup();
  render(<VivoClient />);
  const input = await screen.findByLabelText('Días que cubre el Sugerido en General');
  await user.clear(input);
  await user.type(input, '500');
  expect(screen.getByText('entre 1 y 365')).toBeInTheDocument();
  await user.tab();
  expect(posts).toHaveLength(0);
  expect(input).toHaveValue(30);
});

it('el mismo valor no dispara un guardado', async () => {
  const user = userEvent.setup();
  render(<VivoClient />);
  const input = await screen.findByLabelText('Días que cubre el Sugerido en General');
  await user.click(input);
  await user.tab();
  expect(posts).toHaveLength(0);
});
