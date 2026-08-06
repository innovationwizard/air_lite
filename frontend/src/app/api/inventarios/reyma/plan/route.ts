import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/plan — persist a weekly dispatch plan
 * (bin-packing output, possibly hand-edited: "me lo pase en fórmula, para que
 * yo pueda quitar productos y subir cantidades"). Append-only history per week.
 * Body: { semana: string(YYYY-MM-DD, lunes), payload: { dias: [...] } }
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const semana = body.semana;
  if (!(typeof semana === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(semana))) {
    return badRequest('semana debe ser YYYY-MM-DD (lunes de la semana)');
  }
  const payload = body.payload;
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return badRequest('payload debe ser un objeto');
  }
  if (JSON.stringify(payload).length > 200_000) {
    return badRequest('payload demasiado grande');
  }
  return insertRow(service, 'reyma_plan_despacho', {
    semana,
    payload,
    autor: autor(user),
  });
}
