import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/pedido — pedido mensual (orden global) generado
 * desde el Modelo y editado por Alexis (C5: "sacar la orden global para el
 * siguiente mes… que sean editables"). Append-only history per month.
 * Body: { mes: string(YYYY-MM-01), payload: { lineas: [...] } }
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const mes = body.mes;
  if (!(typeof mes === 'string' && /^\d{4}-\d{2}-01$/.test(mes))) {
    return badRequest('mes debe ser YYYY-MM-01 (primer día del mes pedido)');
  }
  const payload = body.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return badRequest('payload debe ser un objeto');
  }
  if (JSON.stringify(payload).length > 300_000) {
    return badRequest('payload demasiado grande');
  }
  return insertRow(service, 'reyma_pedido_mensual', { mes, payload, autor: autor(user) });
}
