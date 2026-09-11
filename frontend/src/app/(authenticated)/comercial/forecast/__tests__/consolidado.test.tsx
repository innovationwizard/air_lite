/**
 * Nivel 2 — el consolidado de compras/gerencia. Monta ForecastClient como
 * lector (fetch mockeado) y prueba: la recomendación en gris bajo cada
 * captura, la columna «Aprobado» que se muestra y no se suma, el mes cerrado
 * con lo real bajo lo capturado, y el pie con la demanda sin canal.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForecastClient } from '../ForecastClient';

const DATOS = {
  filas: [
    { id: 'a', product_id: 1, month: '2026-10-01', quantity: 500, motivo: 'extraordinaria', area: 'mayoreo', note: null },
    { id: 'b', product_id: 1, month: '2026-10-01', quantity: 1245, motivo: 'base', area: 'supermercados', note: null },
    { id: 'c', product_id: 1, month: '2026-10-01', quantity: 40, motivo: 'critico', area: 'tiendas', note: null },
    { id: 'd', product_id: 1, month: '2026-08-01', quantity: 1200, motivo: 'base', area: 'mayoreo', note: null },
  ],
  productos: [{ id: 1, sku: '77205049', name: 'VASO 10' }],
  proyeccion: [{ product_id: 1, p3: 900 }],
  areas: [
    { slug: 'mayoreo', nombre: 'Mayoreo' }, { slug: 'supermercados', nombre: 'Supermercados' },
    { slug: 'tiendas', nombre: 'Tiendas' },
  ],
  miArea: null, puedeCapturar: false,
  mesesAbiertos: ['2026-09-01', '2026-10-01', '2026-11-01'],
  mesesVista: ['2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01'],
  mesCerrado: '2026-08-01',
  recomendaciones: {
    mayoreo: { '2026-10-01': { 1: 480 }, '2026-08-01': { 1: 1100 } },
    supermercados: { '2026-10-01': { 1: 1245 } },
    tiendas: { '2026-10-01': { 1: 35 } },
  },
  reales: {
    mayoreo: { 1: { '2026-08': { pedido: 1300, entregado: 1250 } } },
  },
  sinAsignar: { '2026-03': 1356, '2026-04': 2708, '2026-05': 1868, '2026-06': 1480, '2026-07': 3799, '2026-08': 920 },
};

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-09-10T12:00:00Z') });
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => DATOS })) as unknown as typeof fetch;
});
afterEach(() => jest.useRealTimers());

async function montar() {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<ForecastClient />);
  await waitFor(() => expect(screen.getByText('77205049')).toBeInTheDocument());
  return user;
}

it('bajo cada captura va, en gris, lo que la app recomendaba a ese canal', async () => {
  await montar();
  const may = screen.getByTestId('celda-mayoreo');
  expect(may).toHaveTextContent('500');
  expect(within(may).getByTestId('recomendado')).toHaveTextContent('480');
  const sup = screen.getByTestId('celda-supermercados');
  expect(sup).toHaveTextContent('1,245');
  expect(within(sup).getByTestId('recomendado')).toHaveTextContent('1,245');
});

it('lo aprobado (base) se muestra en su columna y no entra al directo ni a revisión', async () => {
  await montar();
  const fila = screen.getByText('77205049').closest('tr')!;
  const celdas = within(fila).getAllByRole('cell').map((c) => c.textContent);
  // Total 1,785 = 500 + 1,245 + 40; Directo 500; A revisión 40; Aprobado 1,245; proyección 900
  expect(celdas.slice(-5)).toEqual(['1,785', '500', '40', '1,245', '900']);
  expect(screen.getByTestId('base-total')).toHaveTextContent('1,245 aprobado, no sumado');
  // 40 a revisión does not exceed 900: no highlight
  expect(fila.className).not.toMatch(/bg-amber-50/);
});

it('el mes cerrado está en los botones y muestra lo capturado contra lo real', async () => {
  const user = await montar();
  await user.click(screen.getByRole('button', { name: /Agosto 2026 · cerrado/ }));
  await waitFor(() => expect(screen.getByText(/mes cerrado: capturado contra real/)).toBeInTheDocument());
  const may = screen.getByTestId('celda-mayoreo');
  expect(may).toHaveTextContent('1,200');
  expect(within(may).getByTestId('real')).toHaveTextContent('1,300 / 1,250');
  expect(within(may).queryByTestId('recomendado')).not.toBeInTheDocument();
});

it('al pie se ve la demanda que ningún canal tiene asignada', async () => {
  await montar();
  expect(screen.getByTestId('sin-asignar')).toHaveTextContent('Sin canal asignado: 12,131 unidades pedidas en 6 meses (2026-03 a 2026-08).');
});
