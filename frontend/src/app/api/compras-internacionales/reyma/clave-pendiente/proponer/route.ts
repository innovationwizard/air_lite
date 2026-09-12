import { NextResponse } from 'next/server';
import { badRequest, withWriteAuth } from '../../lib';

export const dynamic = 'force-dynamic';

const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

/**
 * POST /api/compras-internacionales/reyma/clave-pendiente/proponer
 *
 * «Por favor confirme que el identificador X corresponde al SKU Y» — esto trae
 * la Y. Body: { identificador, descripcion, fecha?, cantidad?, unidad? }.
 * Proxy de sólo lectura al servicio ML, que infiere el SKU con la orden de
 * compra, la palabra de REYMA en Odoo y la estructura de la descripción.
 *
 * NO escribe nada: la app nunca asigna un identificador sin que Alexis lo
 * confirme (decisión de Jorge 2026-09-12). Es POST porque lleva cuerpo, no
 * porque cambie estado.
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { body } = ctx;

  const identificador = typeof body.identificador === 'string' ? body.identificador.trim() : '';
  if (!identificador) return badRequest('identificador requerido');

  if (!ML_URL || !ML_KEY) {
    console.error('[clave-pendiente/proponer] ML_SERVICE_URL / ML_SERVICE_API_KEY sin configurar');
    return NextResponse.json({ error: 'El servicio de propuestas no está configurado. Avisale a Jorge.' }, { status: 503 });
  }

  try {
    const r = await fetch(`${ML_URL.replace(/\/$/, '')}/reyma/identificador/proponer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ML_KEY },
      body: JSON.stringify({
        identificador,
        descripcion: typeof body.descripcion === 'string' ? body.descripcion : '',
        fecha: typeof body.fecha === 'string' ? body.fecha : null,
        cantidad: typeof body.cantidad === 'number' ? body.cantidad : null,
        unidad: typeof body.unidad === 'string' ? body.unidad : null,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) {
      const detalle = (cuerpo as { error?: string } | null)?.error;
      return NextResponse.json(
        { error: detalle ?? 'No se pudo consultar Odoo' },
        { status: r.status >= 400 && r.status < 500 ? r.status : 502 },
      );
    }
    return NextResponse.json(cuerpo);
  } catch (e) {
    console.error('[clave-pendiente/proponer] el servicio ML falló:', e);
    return NextResponse.json({ error: 'El servicio de propuestas no respondió.' }, { status: 502 });
  }
}
