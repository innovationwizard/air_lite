import { NextResponse } from 'next/server';
import { withReadAuth } from '../../lib';

export const dynamic = 'force-dynamic';

const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

/**
 * GET /api/compras-internacionales/reyma/clave-pendiente/buscar?q=... — A12b.
 *
 * Proxy de sólo lectura hacia el servicio ML, que es quien de verdad consulta
 * Odoo en vivo (`GET /reyma/productos/buscar`). Existe como endpoint APARTE
 * de la carga de facturas a propósito: subir un PDF nunca depende de que
 * Odoo esté arriba; buscar un candidato para resolver una clave, sí — y sólo
 * cuando Alexis está en esta pantalla, no en la de subir el furgón.
 */
export async function GET(request: Request) {
  const auth = await withReadAuth();
  if (auth instanceof Response) return auth;

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (q.length < 2) {
    return NextResponse.json({ error: 'q debe tener al menos 2 caracteres' }, { status: 400 });
  }

  if (!ML_URL || !ML_KEY) {
    console.error('[reyma/clave-pendiente/buscar] ML_SERVICE_URL / ML_SERVICE_API_KEY sin configurar');
    return NextResponse.json(
      { error: 'El servicio de búsqueda no está configurado. Avisale a Jorge.' },
      { status: 503 },
    );
  }

  try {
    const r = await fetch(
      `${ML_URL.replace(/\/$/, '')}/reyma/productos/buscar?q=${encodeURIComponent(q)}`,
      { headers: { 'X-API-Key': ML_KEY }, signal: AbortSignal.timeout(20_000) },
    );
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) {
      const detalle = (cuerpo as { error?: string } | null)?.error;
      return NextResponse.json(
        { error: detalle ?? 'No se pudo buscar en Odoo' },
        { status: r.status >= 400 && r.status < 500 ? r.status : 502 },
      );
    }
    return NextResponse.json(cuerpo);
  } catch (e) {
    console.error('[reyma/clave-pendiente/buscar] el servicio ML falló:', e);
    return NextResponse.json(
      { error: 'El servicio de búsqueda no respondió. Probá de nuevo.' },
      { status: 502 },
    );
  }
}
