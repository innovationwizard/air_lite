import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/furgon-nota — ETA/nota sobre una PO de tránsito.
 * Las fechas de PO Reyma no se mantienen en Odoo; el ETA lo conoce Alexis por
 * la factura/correo y se anota aquí (equivalente vivo de la fila 5 de su
 * SALDOS). Append-only history, latest per po_name wins.
 * Body: { poName: string, eta?: string(YYYY-MM-DD)|null, nota?: string }
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const poName = typeof body.poName === 'string' ? body.poName.trim().slice(0, 200) : '';
  if (!poName) return badRequest('poName requerido');
  const eta = body.eta;
  if (eta !== undefined && eta !== null &&
      !(typeof eta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(eta))) {
    return badRequest('eta debe ser YYYY-MM-DD o null');
  }
  return insertRow(service, 'reyma_furgon_notas', {
    po_name: poName,
    eta: eta ?? null,
    nota: typeof body.nota === 'string' ? body.nota.slice(0, 500) : null,
    autor: autor(user),
  });
}
