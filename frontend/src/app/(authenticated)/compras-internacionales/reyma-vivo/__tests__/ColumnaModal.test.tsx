import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ColumnaProvider, ThCol } from '../ColumnaModal';
import type { ColumnaId } from '../explicacionColumnas';

function Tabla() {
  const [abierta, setAbierta] = useState<ColumnaId | null>(null);
  return (
    <ColumnaProvider abierta={abierta} onAbrir={setAbierta} onCerrar={() => setAbierta(null)}>
      <table>
        <thead>
          <tr>
            <ThCol id="modelo.invDisp" align="right">Inv. Disp.</ThCol>
            <ThCol id="codigo">Código</ThCol>
          </tr>
        </thead>
      </table>
    </ColumnaProvider>
  );
}

describe('encabezado de columna', () => {
  it('abre la cuenta itemizada y la cierra', async () => {
    const user = userEvent.setup();
    render(<Tabla />);

    await user.click(screen.getByRole('button', { name: 'Inv. Disp.' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('San José + Zona 11 + Petén + Zacapa + Patios − PxS (≤8 días).');
    expect(dialog).toHaveTextContent('San José');
    expect(dialog).toHaveTextContent('Se resta');

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('un encabezado sin fórmula dice de dónde sale el dato', async () => {
    const user = userEvent.setup();
    render(<Tabla />);

    await user.click(screen.getByRole('button', { name: 'Código' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('No es un cálculo.');
    expect(dialog).toHaveTextContent('El código de producto de Plasticentro');
    expect(dialog).not.toHaveTextContent('La misma cuenta para todos los productos.');
  });
});
