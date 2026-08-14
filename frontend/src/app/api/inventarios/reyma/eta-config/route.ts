import { autor, badRequest, insertRow, withWriteAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/eta-config — días hábiles de ETA por bodega.
 * Body: { destino: string, diasHabiles: number }.
 *
 * La ETA se calcula desde la FECHA IMPRESA de la factura (decisión de Jorge
 * 2026-08-14) sumando estos días hábiles, saltando sábado y domingo. Historial
 * append-only; la última fila por destino manda. Cambiar este número recalcula
 * las ETAs de todas las facturas de ese destino que no tengan ETA manual.
 */
const DESTINOS = new Set([
  'bodega-san-jose', 'bodega-zacapa', 'bodega-peten', 'entrega-directa',
]);

export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const destino = typeof body.destino === 'string' ? body.destino.trim() : '';
  if (!DESTINOS.has(destino)) {
    return badRequest(`destino inválido; se esperaba uno de: ${[...DESTINOS].join(', ')}`);
  }
  const dias = body.diasHabiles;
  if (typeof dias !== 'number' || !Number.isInteger(dias) || dias < 0 || dias > 60) {
    return badRequest('diasHabiles debe ser un entero entre 0 y 60');
  }
  return insertRow(service, 'reyma_eta_config', {
    destino,
    dias_habiles: dias,
    autor: autor(user),
  });
}
