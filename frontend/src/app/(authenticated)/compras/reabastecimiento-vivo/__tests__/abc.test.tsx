/**
 * «no puedo ordenar o filtrar ABC» (Wilmer). Monta el árbol REAL de
 * VivoClient con fetch mockeado: clic en el encabezado ordena A→D y luego
 * D→A; las fichas A/B/C/D filtran, y apagarlas todas devuelve todo.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VivoClient } from '../VivoClient';

function row(over: Record<string, unknown>) {
  return {
    productId: over.productId,
    cod: over.cod, desc: '', prov: '', cat: '',
    abc: over.abc, purchaseOk: true, volM3: null, origen: null,
    exist: 0, existencias: 0, reserved: 0, patio: 0,
    pending: null, trans: 0, transOverridden: false,
    adic: 0, adicComercial: 0, sugBodega: null, adicRevision: 0, adicPorArea: {},
    transitoDetalle: [],
    p6: 0, p3: 10, h: 0, win: 5,
    f6: null, f3: null,
    mtd: null, mtdDias: null, mtdRitmo: null,
    seasonalMotivo: null,
    tendencia: { estado: 'no-evaluable', meses: [], subida: null },
    alerta: { estado: 'no-evaluable', motivo: null },
    doh: 5, sug: 1,
    flags: {
      pendingUnknown: false, seasonalLowConfidence: false, seasonalExcluded: false,
      tendenciaCreciente: false, revisar: false, sinReferenciaAnioAnterior: false,
    },
  };
}

const rows = [
  row({ productId: 1, cod: 'X1', abc: 'C' }),
  row({ productId: 2, cod: 'Y2', abc: 'A' }),
  row({ productId: 3, cod: 'Z3', abc: 'D' }),
];

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      bodega: 'General', bodegas: ['General'], rows,
      meta: { count: rows.length, asOf: null, month: '2026-09', coberturaDias: 30, lastSync: null },
    }),
  }) as unknown as typeof fetch;
});

const cods = () => screen.getAllByRole('row').slice(1).map((tr) => tr.querySelector('td')!.textContent);

it('clic en el encabezado ABC ordena A→D; otro clic, D→A', async () => {
  const user = userEvent.setup();
  render(<VivoClient />);
  await waitFor(() => expect(screen.getByText('X1')).toBeInTheDocument());
  const th = screen.getByText('ABC', { selector: 'th span' }).closest('th')!;
  await user.click(th);
  expect(cods()).toEqual(['Y2', 'X1', 'Z3']);
  expect(th.getAttribute('aria-sort')).toBe('ascending');
  await user.click(th);
  expect(cods()).toEqual(['Z3', 'X1', 'Y2']);
});

it('las fichas filtran por clase y apagarlas devuelve todo', async () => {
  const user = userEvent.setup();
  render(<VivoClient />);
  await waitFor(() => expect(screen.getByText('X1')).toBeInTheDocument());
  const chipA = screen.getByRole('button', { name: 'A', pressed: false });
  await user.click(chipA);
  expect(cods()).toEqual(['Y2']);
  await user.click(screen.getByRole('button', { name: 'D', pressed: false }));
  expect(cods().sort()).toEqual(['Y2', 'Z3']);
  await user.click(screen.getByRole('button', { name: 'A', pressed: true }));
  await user.click(screen.getByRole('button', { name: 'D', pressed: true }));
  expect(cods()).toHaveLength(3);
});
