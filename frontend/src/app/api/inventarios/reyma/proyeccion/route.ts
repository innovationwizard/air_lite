import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/proyeccion — Alexis' "yo corrijo" persisted.
 * Body: { codigo: string, cajas: number | null } — null returns the product
 * to the automatic proyección (promedio móvil). Append-only history.
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const codigo = typeof body.codigo === 'string' ? body.codigo.trim() : '';
  const cajas = body.cajas;
  if (!codigo) return badRequest('codigo requerido');
  if (cajas !== null && (typeof cajas !== 'number' || !isFinite(cajas) || cajas < 0)) {
    return badRequest('cajas debe ser un número ≥ 0 o null (volver a automática)');
  }
  return insertRow(service, 'reyma_proyeccion_overrides', {
    codigo,
    cajas,
    autor: autor(user),
  });
}
