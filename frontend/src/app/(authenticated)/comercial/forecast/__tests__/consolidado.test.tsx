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

it('cada canal dice si está en borrador, bloqueado o aprobado', async () => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
    ...DATOS, bloqueos: {
      'supermercados|2026-10-01': { version: 1, autor: 'Ana <ana@x>', at: '2026-09-11T20:15:00Z', aprobadoAt: null, aprobadoAutor: null },
      'tiendas|2026-10-01': { version: 2, autor: 'Olga <o@x>', at: '2026-09-11T20:15:00Z', aprobadoAt: '2026-09-11T21:00:00Z', aprobadoAutor: 'Olga <o@x>' },
    },
  }) })) as unknown as typeof fetch;
  await montar();
  expect(screen.getByTestId('estado-mayoreo')).toHaveTextContent('borrador');
  expect(screen.getByTestId('estado-supermercados')).toHaveTextContent('bloqueado');
  expect(screen.getByTestId('estado-tiendas')).toHaveTextContent('aprobado');
});

it('al pie se ve la demanda que ningún canal tiene asignada', async () => {
  await montar();
  expect(screen.getByTestId('sin-asignar')).toHaveTextContent('Sin canal asignado: 12,131 unidades pedidas en 6 meses (2026-03 a 2026-08).');
});

describe('Institucional por vendedor (2026-09-11)', () => {
  const AREAS = [
    { slug: 'mayoreo', nombre: 'Mayoreo', padre: null },
    { slug: 'institucional', nombre: 'Institucional', padre: null },
    { slug: 'institucional_ortiz', nombre: 'Institucional · Alejandra Ortiz', padre: 'institucional' },
    { slug: 'institucional_cerezo', nombre: 'Institucional · Lucrecia Cerezo', padre: 'institucional' },
  ];
  const FILAS = [
    { id: 'a', product_id: 1, month: '2026-10-01', quantity: 500, motivo: 'base', area: 'mayoreo', note: null },
    { id: 'b', product_id: 1, month: '2026-10-01', quantity: 120, motivo: 'ajustado', area: 'institucional_ortiz', note: null },
    { id: 'c', product_id: 1, month: '2026-10-01', quantity: 80, motivo: 'base', area: 'institucional_cerezo', note: null },
  ];
  const REC = {
    mayoreo: { '2026-10-01': { 1: 480 } },
    institucional_ortiz: { '2026-10-01': { 1: 100 } },
    institucional_cerezo: { '2026-10-01': { 1: 90 } },
  };

  it('para compras/gerencia: una columna Institucional que suma, con cada vendedor adentro', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
      ...DATOS, areas: AREAS, filas: FILAS, recomendaciones: REC,
      bloqueos: { 'institucional_cerezo|2026-10-01': { version: 1, autor: 'Lucrecia <l@x>', at: '2026-09-11T20:15:00Z', aprobadoAt: null, aprobadoAutor: null } },
    }) })) as unknown as typeof fetch;
    render(<ForecastClient />);
    await waitFor(() => expect(screen.getByText('77205049')).toBeInTheDocument());
    // one column per top-level area: no seller column
    expect(screen.queryByTestId('celda-institucional_ortiz')).not.toBeInTheDocument();
    const inst = screen.getByTestId('celda-institucional');
    expect(inst).toHaveTextContent('200');                                   // 120 + 80
    expect(within(inst).getByTestId('recomendado')).toHaveTextContent('190'); // 100 + 90
    expect(within(inst).getByTestId('desglose-institucional_ortiz')).toHaveTextContent('Alejandra Ortiz 120');
    expect(within(inst).getByTestId('desglose-institucional_cerezo')).toHaveTextContent('Lucrecia Cerezo 80 🔒');
    expect(screen.getByTestId('bloqueados')).toHaveTextContent('Bloqueados: Lucrecia Cerezo');
    expect(screen.queryByTestId('th-total-canal')).not.toBeInTheDocument();
  });

  it('para institucional@: una columna por vendedor, el total del canal, y nada que editar', async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
      ...DATOS, areas: AREAS, filas: FILAS.filter((f) => f.area.startsWith('institucional_')),
      recomendaciones: REC, miArea: 'institucional', esPadre: true, puedeCapturar: false,
    }) })) as unknown as typeof fetch;
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ForecastClient />);
    await waitFor(() => expect(screen.getByText('77205049')).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: /Institucional por vendedor — Octubre 2026/ })).toBeInTheDocument();
    expect(screen.getByTestId('celda-institucional_ortiz')).toHaveTextContent('120');
    expect(screen.getByTestId('celda-institucional_cerezo')).toHaveTextContent('80');
    expect(screen.getByTestId('th-total-canal')).toBeInTheDocument();
    expect(screen.getByTestId('total-canal')).toHaveTextContent('200');
    expect(screen.queryByTestId('celda-mayoreo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Tomar las|Bloquear cambios/ })).not.toBeInTheDocument();
    // the selector offers only the sellers
    const opciones = within(screen.getByRole('combobox')).getAllByRole('option').map((o) => o.textContent);
    expect(opciones).toEqual(['—', 'Institucional · Alejandra Ortiz', 'Institucional · Lucrecia Cerezo']);
    await user.selectOptions(screen.getByRole('combobox'), 'institucional_ortiz');
    expect(screen.getByText(/Ver la tabla de un vendedor/)).toBeInTheDocument();
  });
});
