import { NextResponse } from 'next/server';
import { withReadAuth } from '../../lib';

export const dynamic = 'force-dynamic';

const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

/**
 * GET /api/compras-internacionales/reyma/clave-pendiente/verificar-sku?sku=77201001
 *
 * Cuando Alexis contesta «No» y escribe el SKU correcto a mano, esto lo busca
 * en Odoo para mostrarle el nombre del producto ANTES de guardar — y le avisa
 * si el SKU no existe, no es de REYMA, o ya está asignado a otro
 * identificador. Sólo lectura. 404 si el SKU no existe.
 */
export async function GET(request: Request) {
  const auth = await withReadAuth();
  if (auth instanceof Response) return auth;

  const sku = new URL(request.url).searchParams.get('sku')?.trim() ?? '';
  if (!sku) return NextResponse.json({ error: 'sku requerido' }, { status: 400 });

  if (!ML_URL || !ML_KEY) {
    console.error('[clave-pendiente/verificar-sku] ML_SERVICE_URL / ML_SERVICE_API_KEY sin configurar');
    return NextResponse.json({ error: 'El servicio de verificación no está configurado. Avisale a Jorge.' }, { status: 503 });
  }

  try {
    const r = await fetch(
      `${ML_URL.replace(/\/$/, '')}/reyma/sku/verificar?sku=${encodeURIComponent(sku)}`,
      { headers: { 'X-API-Key': ML_KEY }, signal: AbortSignal.timeout(20_000) },
    );
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
    console.error('[clave-pendiente/verificar-sku] el servicio ML falló:', e);
    return NextResponse.json({ error: 'El servicio de verificación no respondió.' }, { status: 502 });
  }
}
