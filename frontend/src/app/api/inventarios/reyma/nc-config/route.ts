import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/nc-config — tarifa NC Duroport + vigencia de la
 * promo, editables (RESPUESTAS rule 8: "que uno pueda editarlo y cambiarlo…
 * le ingresamos la fecha en que se termina y se terminó"). Append-only history.
 * Body: { tarifaUsd: number, vigenteHasta?: string(YYYY-MM-DD)|null, nota?: string }
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const tarifa = body.tarifaUsd;
  if (typeof tarifa !== 'number' || !isFinite(tarifa) || tarifa < 0 || tarifa > 100) {
    return badRequest('tarifaUsd debe ser un número entre 0 y 100');
  }
  const vigenteHasta = body.vigenteHasta;
  if (vigenteHasta !== undefined && vigenteHasta !== null &&
      !(typeof vigenteHasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(vigenteHasta))) {
    return badRequest('vigenteHasta debe ser YYYY-MM-DD o null');
  }
  return insertRow(service, 'reyma_nc_config', {
    tarifa_usd: tarifa,
    vigente_hasta: vigenteHasta ?? null,
    nota: typeof body.nota === 'string' ? body.nota.slice(0, 500) : null,
    autor: autor(user),
  });
}
