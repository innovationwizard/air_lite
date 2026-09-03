/**
 * W18 — filtro ≤/≥ por columna. Monta el árbol REAL de VivoClient (fetch
 * mockeado) en vez de un usuario abriendo el navegador con sesión de
 * Supabase, para probar el flujo completo: click en el ícono del
 * encabezado → popover → aplicar → filas visibles → limpiar.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VivoClient } from '../VivoClient';

function row(over: Record<string, unknown>) {
  return {
    productId: over.productId,
    cod: over.cod, desc: over.desc ?? '', prov: over.prov ?? '', cat: '',
    abc: 'A', purchaseOk: true,
    exist: over.exist ?? 0, existencias: over.exist ?? 0, reserved: 0, patio: 0,
    pending: null, trans: 0, transOverridden: false,
    destino: null, destinoProvisional: false,
    adic: 0, adicComercial: 0, sugBodega: null,
    transitoDetalle: [],
    p6: over.p6 ?? 0, p3: over.p3 ?? 0, h: 0, win: 10,
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
  row({ productId: 1, cod: 'A1', desc: 'Producto bajo', doh: 1, sug: 5 }),
  row({ productId: 2, cod: 'B2', desc: 'Producto medio', doh: 5, sug: 3 }),
  row({ productId: 3, cod: 'C3', desc: 'Producto alto', doh: 20, sug: 1 }),
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

it('el filtro DOH ≤ 5 deja solo A1 y B2, y limpiar lo devuelve todo — sin disparar el orden', async () => {
  const user = userEvent.setup();
  render(<VivoClient />);

  await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
  expect(screen.getByText('C3')).toBeInTheDocument();

  const dohHeader = screen.getByText('DOH').closest('th')!;
  const filtroBtn = dohHeader.querySelector('button[title="Filtrar esta columna"]') as HTMLButtonElement;
  expect(filtroBtn).toBeTruthy();

  await user.click(filtroBtn);
  // El click en el ícono de filtro NO debe haber cambiado el aria-sort de la columna.
  expect(dohHeader.getAttribute('aria-sort')).toBeNull();

  const valorInput = screen.getByPlaceholderText('valor');
  await user.type(valorInput, '5');
  await user.click(screen.getByRole('button', { name: 'Aplicar' }));

  await waitFor(() => expect(screen.queryByText('C3')).not.toBeInTheDocument());
  expect(screen.getByText('A1')).toBeInTheDocument();
  expect(screen.getByText('B2')).toBeInTheDocument();

  // Reabrir y limpiar
  await user.click(filtroBtn);
  await user.click(screen.getByTitle('Quitar filtro'));
  await waitFor(() => expect(screen.getByText('C3')).toBeInTheDocument());
});
