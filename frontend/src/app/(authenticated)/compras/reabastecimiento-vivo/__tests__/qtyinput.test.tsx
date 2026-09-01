/**
 * W19 — vaciar la casilla y tabular no hacía NADA, en silencio.
 *
 * Reproduce la secuencia exacta de Wilmer del 2026-08-26: borra el número del
 * tránsito, sale del campo, y espera que el Sugerido reaccione. Antes del
 * arreglo el valor guardado quedaba intacto y la casilla se quedaba vacía —
 * la fila parecía editada y nada había pasado.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QtyInput } from '../VivoClient';

describe('QtyInput — vaciar la casilla (W19)', () => {
  it('vaciar y salir LIMPIA la captura manual cuando hay una que limpiar', async () => {
    const user = userEvent.setup();
    const onClear = jest.fn();
    const onCommit = jest.fn();
    render(
      <QtyInput value={50} edited label="Tránsito 77202156"
                onCommit={onCommit} onClear={onClear} clearTip="quitar" />,
    );

    const input = screen.getByLabelText('Tránsito 77202156');
    await user.clear(input);
    await user.tab(); // «dale tabulación» — Jorge, en la llamada

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('sin captura manual que limpiar, la casilla vuelve al valor real en vez de mentir', async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<QtyInput value={50} edited={false} label="Tránsito X" onCommit={onCommit} />);

    const input = screen.getByLabelText('Tránsito X') as HTMLInputElement;
    await user.clear(input);
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
    expect(input.value).toBe('50');
  });

  it('escribir un número sigue guardando', async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<QtyInput value={50} edited={false} label="Tránsito Y" onCommit={onCommit} />);

    const input = screen.getByLabelText('Tránsito Y');
    await user.clear(input);
    await user.type(input, '120');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(120);
  });

  it('Enter confirma sin tener que salir del campo', async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<QtyInput value={10} edited={false} label="Tránsito Z" onCommit={onCommit} />);

    await user.clear(screen.getByLabelText('Tránsito Z'));
    await user.type(screen.getByLabelText('Tránsito Z'), '33{Enter}');

    expect(onCommit).toHaveBeenCalledWith(33);
  });

  it('el mismo valor no dispara guardado', async () => {
    const user = userEvent.setup();
    const onCommit = jest.fn();
    render(<QtyInput value={50} edited={false} label="Tránsito W" onCommit={onCommit} />);

    await user.click(screen.getByLabelText('Tránsito W'));
    await user.tab();

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('«sin dato» (¿?) que se vacía y tiene ✕ también limpia', async () => {
    const user = userEvent.setup();
    const onClear = jest.fn();
    render(
      <QtyInput value={7} edited unknown={false} label="Pendiente P"
                onCommit={jest.fn()} onClear={onClear} clearTip="quitar" />,
    );
    await user.clear(screen.getByLabelText('Pendiente P'));
    await user.tab();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
