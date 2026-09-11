import { buildWorkbook } from '@/lib/xlsx/writer';
import {
  columnasForecast, construirHojaOrigen, construirLibroForecast, describirFiltros, estadoFila, nombreArchivo,
  type ContextoForecastExport, type FilaForecastExport,
} from '../forecastExport';

/**
 * «Exportar a Excel» — the file is the screen, nothing else. These pin the
 * column set (headers carry real month labels), the state wording, the
 * Origen sheet, and that the workbook actually builds.
 */
const fila = (o: Partial<FilaForecastExport> = {}): FilaForecastExport => ({
  productId: 1, sku: '77205190', nombre: 'BANDEJA', uom: 'Unidades', etiqueta: 'medio',
  proveedor: { nombre: 'DARNEL', grupoNombre: null }, categoria: 'BANDEJAS',
  serie: ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'].map((mes, i) => ({ mes, pedido: 100 + i })),
  meses3: [
    { mes: '2026-06', pedido: 2430, entregado: 1868, falta: 562, critica: true },
    { mes: '2026-07', pedido: 2237, entregado: 2230, falta: 7, critica: false },
    { mes: '2026-08', pedido: 1522, entregado: 1522, falta: 0, critica: false },
  ],
  anteriores: [{ mes: '2025-10', pedido: 1874, entregado: 1874, diverge: false }, { mes: '2024-10', pedido: 2455, entregado: 2455, diverge: true }],
  clientes: { n: 3, principal: 'OPERADORA', share: 0.52 },
  recomendacion: { avg3: 2063, avg6: 1997, base: 2030, factor: 0.8265, indiceMes: 0.8265, aplicado: true, valor: 2030, rango: [1502, 2497], etiqueta: 'medio' },
  ventaPublico: null, compras: { compra: 0, proyeccion: 2117, bodega: 'San Jose VN', coberturaDias: 30 },
  capturado: null, cicloAnterior: null, miForecast: 2030, motivoGuardado: null, fueraDePantalla: false,
  ...o,
});
const ctx: ContextoForecastExport = {
  areaSlug: 'supermercados', areaNombre: 'Supermercados', mes: '2026-10-01', bodega: 'San José',
  generadoEn: new Date(2026, 8, 11, 20, 5), autor: 'Ana <ana@x>', asOf: '2026-09-11T02:00:00Z', bloqueo: null,
  filtros: { busqueda: null, proveedor: null, categoria: null, etiqueta: null, modificados: false },
  enPantalla: 1, guardadasFueraDePantalla: 0,
};

it('headers carry the real month labels and the three months go out expanded', () => {
  const headers = columnasForecast([fila()], '2026-10-01').map((c) => c.header);
  expect(headers).toEqual(expect.arrayContaining([
    'Pedido Mar 2026', 'Pedido Ago 2026',
    'Jun 2026 pedido', 'Jun 2026 entregado', 'Jun 2026 falta', 'Ago 2026 falta',
    'Faltó entregar 3 m', 'Faltante crítico', 'Pedido Oct 2025', 'Pedido Oct 2024',
    'Compra planificada (Compras)', 'Proyección Compras', 'Recomendación', 'Rango desde', 'Rango hasta',
    'Mi forecast', 'Estado', 'Fuera de pantalla',
  ]));
});

it('values land under the right headers', () => {
  const cols = columnasForecast([fila()], '2026-10-01');
  const f = fila();
  const v = (h: string) => cols.find((c) => c.header === h)!.valor(f);
  expect(v('Jun 2026 falta')).toBe(562);
  expect(v('Faltó entregar 3 m')).toBe(569);
  expect(v('Faltante crítico')).toBe('Sí');
  expect(v('Pedido Oct 2024')).toBe(2455);
  expect(v('% cliente principal')).toBe(52);
  expect(v('Compra planificada (Compras)')).toBe(0);
  expect(v('Factor aplicado')).toBe('Sí');
  expect(v('Mi forecast')).toBe(2030);
});

it('estado says what the saved row is', () => {
  expect(estadoFila({ motivoGuardado: null, miForecast: 2030 })).toBe('sin cargar');
  expect(estadoFila({ motivoGuardado: 'base', miForecast: 2030 })).toBe('aprobado tal cual');
  expect(estadoFila({ motivoGuardado: 'ajustado', miForecast: 1800 })).toBe('ajustado');
  expect(estadoFila({ motivoGuardado: 'temporada', miForecast: 500 })).toBe('Compra por temporada');
});

it('the Origen sheet explains the file, including lock and filters', () => {
  const hoja = construirHojaOrigen({
    ...ctx, bloqueo: { version: 2, autor: 'Ana <ana@x>', at: '2026-09-11T20:15:00Z' },
    filtros: { busqueda: 'vaso', proveedor: 'DARNEL', categoria: null, etiqueta: 'estable', modificados: true },
    guardadasFueraDePantalla: 4,
  });
  const texto = hoja.rows.map((r) => r.join(' | ')).join('\n');
  expect(texto).toMatch(/Canal \| Supermercados/);
  expect(texto).toMatch(/Mes del forecast \| Octubre 2026/);
  expect(texto).toMatch(/Bloqueado el .* por Ana <ana@x> \(versión 2\)/);
  expect(texto).toMatch(/Búsqueda: «vaso»/);
  expect(texto).toMatch(/Sólo modificados/);
  expect(texto).toMatch(/Filas guardadas fuera de pantalla \| 4/);
  expect(describirFiltros(ctx.filtros)).toEqual(['Sin filtros: los 50 códigos con más riesgo de faltante']);
});

it('names the file by channel, month and moment, and the workbook builds', () => {
  expect(nombreArchivo(ctx)).toBe('Forecast_supermercados_2026-10_2026-09-11_2005.xlsx');
  const bytes = buildWorkbook(construirLibroForecast([fila(), fila({ productId: 2, sku: 'X', fueraDePantalla: true })], ctx));
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes[0]).toBe(0x50); // 'P' of the zip signature
  expect(bytes[1]).toBe(0x4b);
});
