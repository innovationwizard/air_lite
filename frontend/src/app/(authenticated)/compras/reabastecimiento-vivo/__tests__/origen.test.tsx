/**
 * W18 — columnas de la bodega que ABASTECE. Monta el árbol REAL de VivoClient
 * (fetch mockeado) mirando Zacapa: San José tiene que aparecer al lado, con
 * su existencia, su venta y su DOH; sin fila allá se pinta — y no 0; y en
 * General / San José las columnas no existen.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VivoClient } from '../VivoClient';

function row(over: Record<string, unknown>) {
  return {
    productId: over.productId,
    cod: over.cod, desc: over.desc ?? '', prov: over.prov ?? '', cat: '',
    abc: 'A', purchaseOk: true, volM3: null, origen: null,
    exist: over.exist ?? 0, existencias: over.exist ?? 0, reserved: 0, patio: 0,
    pending: null, trans: 0, transOverridden: false,
    adic: 0, adicComercial: 0, sugBodega: null, adicRevision: 0, adicPorArea: {},
    transitoDetalle: [],
    p6: over.p6 ?? 0, p3: over.p3 ?? 0, h: 0, win: 5,
    f6: null, f3: null,
    mtd: null, mtdDias: null, mtdRitmo: null,
    seasonalMotivo: null,
    tendencia: { estado: 'no-evaluable', meses: [], subida: null },
    alerta: { estado: 'no-evaluable', motivo: null },
    doh: over.doh ?? 0, sug: over.sug ?? 0,
    flags: {
      pendingUnknown: false, seasonalLowConfidence: false, seasonalExcluded: false,
      tendenciaCreciente: false, revisar: false, sinReferenciaAnioAnterior: false,
    },
    ...over,
  };
}

const rows = [
  row({
    productId: 1, cod: 'A1', desc: 'Con origen', doh: 1, sug: 5,
    origen: { exist: 5000, existencias: 5200, reserved: 200, patio: 0, pending: 0, p3: 200, doh: 650 },
  }),
  row({ productId: 2, cod: 'B2', desc: 'Sin fila en San José', doh: 5, sug: 3, origen: null }),
];

function mockPayload(bodega: string, bodegaOrigen: string | null) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      bodega, bodegas: ['General', 'San Jose VN', 'Zacapa', 'Petén'], rows,
      meta: { count: rows.length, asOf: null, month: '2026-09', coberturaDias: 15, lastSync: null, bodegaOrigen },
    }),
  }) as unknown as typeof fetch;
}

it('en Zacapa aparecen «Exist. San José» y «DOH San José», con la venta debajo y — sin fila allá', async () => {
  mockPayload('Zacapa', 'San Jose VN');
  render(<VivoClient />);
  await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());

  expect(screen.getByText('Exist. San José')).toBeInTheDocument();
  expect(screen.getByText('DOH San José')).toBeInTheDocument();

  const filaA = screen.getByText('A1').closest('tr')!;
  expect(within(filaA).getByText('5,000')).toBeInTheDocument();
  expect(within(filaA).getByText('vende 200/mes')).toBeInTheDocument();
  expect(within(filaA).getByText('650.0')).toBeInTheDocument();

  const filaB = screen.getByText('B2').closest('tr')!;
  expect(within(filaB).getByTitle('El producto no existe en San José')).toHaveTextContent('—');
});

it('ordenar por «DOH San José» pone primero lo que un traslado cubriría, y sin origen al final', async () => {
  mockPayload('Zacapa', 'San Jose VN');
  const user = userEvent.setup();
  render(<VivoClient />);
  await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());

  // Por defecto B2 (doh 5) va después de A1 (doh 1); al ordenar asc por
  // origen, A1 sigue primero y B2 (sin origen) queda al final igual.
  await user.click(screen.getByText('DOH San José'));
  await user.click(screen.getByText('DOH San José'));
  const cods = screen.getAllByRole('row').slice(1).map((tr) => tr.querySelector('td')!.textContent);
  expect(cods).toEqual(['A1', 'B2']);
});

it('en General no hay columnas de origen', async () => {
  mockPayload('General', null);
  render(<VivoClient />);
  await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
  expect(screen.queryByText(/^Exist\. San José$/)).not.toBeInTheDocument();
  expect(screen.queryByText(/^DOH San José$/)).not.toBeInTheDocument();
});
