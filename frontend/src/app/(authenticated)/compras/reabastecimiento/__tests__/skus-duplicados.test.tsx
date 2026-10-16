/**
 * La pastilla naranja y el modal «Revisar» — los SKU repetidos que el sync
 * cuenta y que la página no mostraba.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { skusDuplicados } from '@/app/api/compras/reabastecimiento/rows';
import { VivoClient } from '../VivoClient';

function payload(duplicados: unknown, sinCodigo: string[] = [], finishedAt = new Date().toISOString()) {
  return {
    bodega: 'General', bodegas: ['General'], rows: [],
    skusDuplicados: duplicados,
    meta: {
      count: 0, asOf: null, month: '2026-10', coberturaDias: 30,
      lastSync: {
        id: 's1', status: 'success', started_at: finishedAt, finished_at: finishedAt,
        counts: { data_horizon: '2026-10-14 11:03:00', productos_sin_codigo: sinCodigo },
      },
    },
  };
}

function payloadWithSinCodigo(nombres: string[]) {
  return payload([], nombres);
}

const grupos = [
  {
    sku: 'IMP',
    filas: [
      { id: 69, nombre: 'ATC', usada: true },
      { id: 73, nombre: 'Agente aduanero', usada: false },
    ],
  },
  {
    sku: 'RCT',
    filas: [
      { id: 1171, nombre: 'RECARGO POR COMPRA CON TARJETA', usada: true },
      { id: 1172, nombre: 'RECARGO POR COMPRA CON TARJETA', usada: false },
    ],
  },
];

it('cuenta las filas de más, no los códigos', () => {
  const lista = skusDuplicados([
    { id: 69, sku: 'IMP', name: 'ATC' },
    { id: 70, sku: 'UNICO', name: 'Uno' },
    { id: 73, sku: 'IMP', name: 'Agente aduanero' },
    { id: 1171, sku: 'RCT', name: 'RECARGO' },
    { id: 1172, sku: 'RCT', name: 'RECARGO' },
    { id: 9, sku: null, name: 'sin código' },
  ]);
  expect(lista.map((g) => g.sku)).toEqual(['IMP', 'RCT']);
  expect(lista[0].filas.map((f) => f.usada)).toEqual([true, false]);
  expect(lista[0].filas[0].nombre).toBe('ATC');
});

it('una sincronización de hace más de tres horas se queda en ámbar y dice la edad', async () => {
  const finished = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload([], [], finished),
  }) as unknown as typeof fetch;
  render(<VivoClient />);
  const pastilla = await screen.findByText(/Datos de Odoo al/);
  expect(pastilla).toHaveTextContent('hace 5 h');
  expect(pastilla.className).toContain('amber');
  expect(pastilla).not.toHaveTextContent('failed');
});

it('no pinta la pastilla cuando no hay duplicados', async () => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload([]),
  }) as unknown as typeof fetch;
  render(<VivoClient />);
  await waitFor(() => expect(screen.getByText(/Datos de Odoo al/)).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /SKUs duplicados/ })).not.toBeInTheDocument();
});

it('la pastilla gris abre Productos sin código, sólo para leer', async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payloadWithSinCodigo(['Peaje', 'Combustible Flota Cd']),
  }) as unknown as typeof fetch;
  render(<VivoClient />);
  const pastilla = await screen.findByRole('button', { name: 'Hay 2 productos sin código en esta descarga' });
  await user.click(pastilla);
  const dialog = screen.getByRole('dialog', { name: 'Productos sin código' });
  expect(dialog).toHaveTextContent('No aparecen en la tabla de compra');
  expect(dialog).toHaveTextContent('Peaje');
  expect(dialog).toHaveTextContent('Combustible Flota Cd');
  expect(dialog.querySelector('input, textarea')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByRole('dialog', { name: 'Productos sin código' })).not.toBeInTheDocument();
});

it('la pastilla abre Revisar con la fila que se usa y las que no', async () => {
  const user = userEvent.setup();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => payload(grupos),
  }) as unknown as typeof fetch;
  render(<VivoClient />);
  const pastilla = await screen.findByRole('button', { name: 'Hay 2 SKUs duplicados en esta descarga' });
  await user.click(pastilla);
  const dialog = screen.getByRole('dialog', { name: 'Revisar' });
  expect(dialog).toHaveTextContent('La sincronización se queda con la primera fila de cada código');
  expect(dialog).toHaveTextContent('IMP');
  expect(dialog).toHaveTextContent('ATC');
  expect(dialog).toHaveTextContent('Agente aduanero');
  expect(screen.getAllByText('Se usa')).toHaveLength(2);
  expect(screen.getAllByText('No se usa')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(screen.queryByRole('dialog', { name: 'Revisar' })).not.toBeInTheDocument();
});
