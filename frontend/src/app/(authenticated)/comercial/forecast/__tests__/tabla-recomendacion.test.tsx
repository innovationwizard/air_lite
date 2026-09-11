/**
 * Nivel 2 — la tabla del jefe de canal. Monta el árbol REAL de ForecastClient
 * con fetch mockeado por URL, y prueba lo que la spec promete en pantalla:
 * el faltante crítico en rojo, el año anterior en ámbar cuando diverge, el
 * cliente dominante sólo al 50 %, «Aprobar todo» manda exactamente las filas
 * visibles, un 0 limpia, y un canal sin historial muestra el formulario y
 * ningún número inventado.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForecastClient } from '../ForecastClient';

const DATOS = {
  filas: [], productos: [], proyeccion: [],
  areas: [{ slug: 'supermercados', nombre: 'Supermercados' }, { slug: 'mayoreo', nombre: 'Mayoreo' }],
  miArea: 'supermercados', puedeCapturar: true,
  mesesAbiertos: ['2026-09-01', '2026-10-01', '2026-11-01'],
};

function fila(over: Record<string, unknown>) {
  return {
    productId: 1, sku: '77205190', nombre: 'BANDEJA No.2', uom: 'Unidades', etiqueta: 'medio',
    serie: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map((mes, i) => ({ mes, pedido: 100 + i })),
    meses3: [
      { mes: '2026-06', pedido: 2430, entregado: 1868, falta: 562, critica: true },
      { mes: '2026-07', pedido: 2237, entregado: 2230, falta: 7, critica: false },
      { mes: '2026-08', pedido: 1522, entregado: 1522, falta: 0, critica: false },
    ],
    anteriores: [{ mes: '2025-10', pedido: 1874, entregado: 1874, diverge: false }],
    clientes: { n: 3, principal: 'OPERADORA DE TIENDAS, S.A.', share: 0.52 },
    recomendacion: {
      avg3: 2063, avg6: 1997, base: 2030, factor: 0.8265, indiceMes: 0.8265, aplicado: true,
      valor: 2030, rango: [1502, 2497], etiqueta: 'medio',
    },
    ventaPublico: null, capturado: null, cicloAnterior: null,
    compras: { compra: 1200, proyeccion: 6500, bodega: 'San Jose VN', coberturaDias: 30 },
    ...over,
  };
}

const HISTORIAL = {
  area: { slug: 'supermercados', nombre: 'Supermercados', aplicaEstacional: true },
  mes: '2026-10-01', historialDisponible: true, asOf: '2026-09-11T02:00:00Z', bodega: 'San Jose VN',
  total: 162,
  filas: [
    fila({}),
    fila({
      productId: 2, sku: '88201006', nombre: 'PAJILLA', etiqueta: 'estable',
      meses3: [
        { mes: '2026-06', pedido: 100, entregado: 100, falta: 0, critica: false },
        { mes: '2026-07', pedido: 100, entregado: 90, falta: 10, critica: false },
        { mes: '2026-08', pedido: 100, entregado: 100, falta: 0, critica: false },
      ],
      anteriores: [{ mes: '2025-10', pedido: 400, entregado: 400, diverge: true }],
      clientes: { n: 12, principal: 'ALGUIEN', share: 0.3 },
      recomendacion: {
        avg3: 100, avg6: 100, base: 100, factor: 1, indiceMes: 0.87, aplicado: false,
        valor: 100, rango: [83, 122], etiqueta: 'estable',
      },
    }),
    fila({
      productId: 3, sku: '11111111', nombre: 'YA CARGADO', etiqueta: 'estable',
      meses3: [
        { mes: '2026-06', pedido: 50, entregado: 50, falta: 0, critica: false },
        { mes: '2026-07', pedido: 50, entregado: 50, falta: 0, critica: false },
        { mes: '2026-08', pedido: 50, entregado: 50, falta: 0, critica: false },
      ],
      anteriores: [],
      clientes: { n: 5, principal: 'OTRO', share: 0.2 },
      recomendacion: {
        avg3: 50, avg6: 50, base: 50, factor: 1, indiceMes: null, aplicado: false,
        valor: 50, rango: [42, 61], etiqueta: 'estable',
      },
      capturado: { quantity: 500, motivo: 'temporada' },
      cicloAnterior: { mes: '2026-08', capturado: 1200, pedidoReal: 1300, entregadoReal: 1250 },
    }),
  ],
};

let puts: { url: string; body: Record<string, unknown> }[];
let gets: string[];

function mockFetch(historial: unknown = HISTORIAL, buscado: unknown = null) {
  puts = []; gets = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/comercial/historial')) {
      gets.push(url);
      const q = new URL(url, 'http://x').searchParams.get('q');
      return { ok: true, json: async () => (q && buscado ? buscado : historial) } as Response;
    }
    if (url === '/api/comercial/forecast' && init?.method === 'PUT') {
      const body = JSON.parse(String(init.body));
      puts.push({ url, body });
      return { ok: true, json: async () => ({ guardadas: body.filas.length, quitadas: 0, filas: [] }) } as Response;
    }
    return { ok: true, json: async () => DATOS } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  jest.useFakeTimers({ now: new Date('2026-09-10T12:00:00Z') });
  mockFetch();
});
afterEach(() => jest.useRealTimers());

async function montar() {
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<ForecastClient />);
  await waitFor(() => expect(screen.getByText('77205190')).toBeInTheDocument());
  return user;
}

it('los meses arrancan colapsados en una columna con lo que faltó; un click los abre y otro los cierra', async () => {
  const user = await montar();
  expect(screen.queryByText('Jun')).not.toBeInTheDocument();
  const resumen = screen.getAllByTestId('falta-3m');
  expect(resumen).toHaveLength(3);
  expect(resumen[0]).toHaveTextContent('falta 569 !');     // 562 + 7, one critical month
  expect(resumen[0].querySelector('span')!.className).toMatch(/text-red-700/);
  expect(resumen[1]).toHaveTextContent('falta 10');        // 10, none critical
  expect(resumen[1].querySelector('span')!.className).not.toMatch(/text-red-700/);
  expect(resumen[2]).toHaveTextContent('—');

  await user.click(screen.getByRole('button', { name: 'Ver los meses' }));
  expect(screen.getByText('Jun')).toBeInTheDocument();
  expect(screen.getByText('Ago')).toBeInTheDocument();
  expect(screen.queryByTestId('falta-3m')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Ocultar los meses' }));
  expect(screen.queryByText('Jun')).not.toBeInTheDocument();
  expect(screen.getAllByTestId('falta-3m')).toHaveLength(3);
});

it('el faltante crítico va en rojo con «!», el no crítico en gris', async () => {
  const user = await montar();
  await user.click(screen.getByRole('button', { name: 'Ver los meses' }));
  const criticas = screen.getAllByTestId('falta-critica');
  expect(criticas).toHaveLength(1);
  expect(criticas[0]).toHaveTextContent('falta 562 !');
  expect(criticas[0].className).toMatch(/text-red-700/);
  const normales = screen.getAllByTestId('falta');
  expect(normales.map((e) => e.textContent)).toEqual(['falta 7', 'falta 10']);
});

it('el año anterior va en ámbar sólo cuando diverge', async () => {
  await montar();
  expect(screen.getAllByTestId('anterior-diverge')).toHaveLength(1);
  expect(screen.getByTestId('anterior-diverge')).toHaveTextContent('2025: 400');
  expect(screen.getAllByTestId('anterior')).toHaveLength(1);
});

it('el cliente dominante se nombra al 50 %; abajo de eso sólo cuenta', async () => {
  await montar();
  expect(screen.getByText('OPERADORA DE TIENDAS, S.A.')).toBeInTheDocument();
  expect(screen.getByText('· 52 %')).toBeInTheDocument();
  expect(screen.queryByText('ALGUIEN')).not.toBeInTheDocument();
  expect(screen.getByText(/12 clientes/)).toBeInTheDocument();
});

it('«Forecast Compras» muestra lo que Compras planea comprar y lo que proyecta, antes de los formularios', async () => {
  await montar();
  const celdas = screen.getAllByTestId('forecast-compras');
  expect(celdas[0]).toHaveTextContent('1,200');
  expect(celdas[0]).toHaveTextContent('proyecta 6,500');
  expect(screen.getByText(/compra · proyección San José/)).toBeInTheDocument();
});

it('sin fila de Compras para el código, la celda dice — y no inventa un cero', async () => {
  mockFetch({ ...HISTORIAL, filas: [fila({ compras: null })] });
  await montar();
  expect(screen.getByTestId('forecast-compras')).toHaveTextContent('—');
  expect(screen.getByTestId('forecast-compras')).not.toHaveTextContent('0');
});

it('la recomendación trae su rango y la frase del factor, aplicado o no', async () => {
  await montar();
  expect(screen.getByText('normalmente 1,502–2,497')).toBeInTheDocument();
  const frases = screen.getAllByTestId('factor').map((e) => e.textContent);
  expect(frases).toContain('Oct = 0.83× mes normal');
  expect(frases).toContain('Oct suele ser 0.87× mes normal (no se aplica)');
});

it('la celda arranca con la recomendación, o con lo ya cargado, y muestra el ciclo anterior', async () => {
  await montar();
  expect(screen.getByLabelText('Mi forecast 77205190')).toHaveValue(2030);
  expect(screen.getByLabelText('Mi forecast 11111111')).toHaveValue(500);
  expect(screen.getByTestId('ciclo-anterior')).toHaveTextContent('Tu forecast de Ago: 1,200 · real 1,300');
});

it('«Aprobar todo» manda exactamente las filas visibles, base salvo lo cargado a mano', async () => {
  const user = await montar();
  await user.click(screen.getByRole('button', { name: /Aprobar todo \(3\)/ }));
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0].body).toEqual({
    month: '2026-10-01',
    filas: [
      { productId: 1, quantity: 2030, motivo: 'base' },
      { productId: 2, quantity: 100, motivo: 'base' },
      { productId: 3, quantity: 500, motivo: 'temporada' },
    ],
  });
  await waitFor(() => expect(screen.getByText(/Se guardaron 3 códigos para Octubre 2026/)).toBeInTheDocument());
  expect(screen.getByText(/Cargado: 3 de 3/)).toBeInTheDocument();
});

it('editar una celda la guarda al salir; un 0 la limpia; pasar sin editar no escribe', async () => {
  const user = await montar();
  const input = screen.getByLabelText('Mi forecast 77205190');
  await user.clear(input);
  await user.type(input, '1800');
  await user.tab();
  await waitFor(() => expect(puts).toHaveLength(1));
  expect(puts[0].body).toEqual({ month: '2026-10-01', filas: [{ productId: 1, quantity: 1800, motivo: 'base' }] });

  // tab through the next input without touching it: nothing is written
  await user.tab();
  expect(puts).toHaveLength(1);

  const otro = screen.getByLabelText('Mi forecast 88201006');
  await user.clear(otro);
  await user.type(otro, '0');
  await user.tab();
  await waitFor(() => expect(puts).toHaveLength(2));
  expect(puts[1].body.filas).toEqual([{ productId: 2, quantity: 0, motivo: 'base' }]);
});

it('un canal sin historial muestra el formulario y ningún número', async () => {
  mockFetch({
    area: { slug: 'supermercados', nombre: 'Supermercados', aplicaEstacional: true },
    mes: '2026-10-01', historialDisponible: false, asOf: null, bodega: 'San Jose VN', total: 0, filas: [],
  });
  render(<ForecastClient />);
  await waitFor(() => expect(screen.getByText(/Sin historial en este canal/)).toBeInTheDocument());
  expect(screen.queryByText(/Aprobar todo/)).not.toBeInTheDocument();
  expect(screen.queryByText(/normalmente/)).not.toBeInTheDocument();
  // the four-field form is still there
  expect(screen.getByPlaceholderText(/77205049/)).toBeInTheDocument();
});

it('quien sólo lee elige un canal y ve la tabla sin editar', async () => {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/comercial/historial')) return { ok: true, json: async () => HISTORIAL } as Response;
    return { ok: true, json: async () => ({ ...DATOS, miArea: null, puedeCapturar: false }) } as Response;
  }) as unknown as typeof fetch;
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  render(<ForecastClient />);
  await waitFor(() => expect(screen.getByText(/Ver la tabla de un canal/)).toBeInTheDocument());
  await user.selectOptions(screen.getByRole('combobox'), 'supermercados');
  await waitFor(() => expect(screen.getByText('77205190')).toBeInTheDocument());
  expect(screen.queryByLabelText(/Mi forecast/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Aprobar todo/)).not.toBeInTheDocument();
  expect(within(screen.getByRole('table')).getByText('normalmente 1,502–2,497')).toBeInTheDocument();
});

it('la búsqueda filtra al instante y, tras la pausa, pregunta al servidor por todo el canal', async () => {
  const lejano = fila({
    productId: 99, sku: '55555555', nombre: 'VASO LEJANO', etiqueta: 'estable',
    recomendacion: { avg3: 10, avg6: 10, base: 10, factor: 1, indiceMes: null, aplicado: false, valor: 10, rango: [8, 12], etiqueta: 'estable' },
  });
  mockFetch(HISTORIAL, { ...HISTORIAL, busqueda: 'vaso', total: 1, totalCanal: 162, filas: [lejano] });
  const user = await montar();
  const caja = screen.getByLabelText('Buscar por código o nombre');
  await user.type(caja, 'pajilla');
  // client-side, right away: only the PAJILLA row of the 50
  expect(screen.queryByText('77205190')).not.toBeInTheDocument();
  expect(screen.getByText('88201006')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Aprobar todo \(1\)/ })).toBeInTheDocument();

  await user.clear(caja);
  await user.type(caja, 'vaso');
  jest.advanceTimersByTime(400);
  await waitFor(() => expect(gets.some((u) => u.includes('q=vaso'))).toBe(true));
  await waitFor(() => expect(screen.getByText('55555555')).toBeInTheDocument());
  expect(screen.getByText(/1 códigos de Supermercados para «vaso»/)).toBeInTheDocument();
});

it('sin coincidencias en el canal, lo dice y manda al formulario de abajo', async () => {
  mockFetch(HISTORIAL, { ...HISTORIAL, busqueda: 'zzz', total: 0, totalCanal: 162, filas: [] });
  const user = await montar();
  await user.type(screen.getByLabelText('Buscar por código o nombre'), 'zzz');
  jest.advanceTimersByTime(400);
  await waitFor(() => expect(screen.getByTestId('sin-resultados')).toHaveTextContent(/nunca pidió, agregalo abajo/));
  expect(screen.getByRole('button', { name: /Aprobar todo \(0\)/ })).toBeDisabled();
});

it('el filtro por variabilidad deja sólo esa etiqueta y «Aprobar todo» cuenta lo visible', async () => {
  const user = await montar();
  await user.click(screen.getByRole('button', { name: 'estable' }));
  expect(screen.queryByText('77205190')).not.toBeInTheDocument();     // medio
  expect(screen.getByText('88201006')).toBeInTheDocument();           // estable
  expect(screen.getByText('11111111')).toBeInTheDocument();           // estable
  expect(screen.getByRole('button', { name: /Aprobar todo \(2\)/ })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Todas' }));
  expect(screen.getByRole('button', { name: /Aprobar todo \(3\)/ })).toBeInTheDocument();
});
