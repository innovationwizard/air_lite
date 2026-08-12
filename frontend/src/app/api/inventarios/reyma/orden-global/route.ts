import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/orden-global — register which Odoo PO is the
 * monthly global order (C7 baseline). Body: { mes: 'YYYY-MM', poName: string }.
 * Append-only history; latest row per mes wins (sync + GET resolve it).
 * The sync picks the lines up on its next hourly run.
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const mesRaw = typeof body.mes === 'string' ? body.mes.trim() : '';
  const m = mesRaw.match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    return badRequest('mes requerido en formato YYYY-MM');
  }
  const poName = typeof body.poName === 'string' ? body.poName.trim().toUpperCase() : '';
  if (!/^PO-[A-Z0-9-]{1,25}$/.test(poName)) {
    return badRequest('poName requerido con formato de orden de Odoo (p. ej. PO-P-3003)');
  }
  return insertRow(service, 'reyma_orden_global', {
    mes: `${m[1]}-${m[2]}-01`,
    po_name: poName,
    autor: autor(user),
  });
}
