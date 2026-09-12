import { NextResponse } from 'next/server';
import { badRequest, withWriteAuth } from '../../lib';

export const dynamic = 'force-dynamic';

const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

/**
 * POST /api/compras-internacionales/reyma/factura/reevaluar — Body: { ticket }
 *
 * Alexis acaba de confirmar un identificador en la misma pantalla de carga,
 * ANTES de darle Cargar. El veredicto de esa factura vive en
 * `reyma_factura_staging.parse` (nunca en el navegador — ver /extraer), así
 * que hay que volver a evaluar las líneas del staging contra los mapas de
 * hoy y guardar el veredicto nuevo. El servicio ML corre la MISMA
 * `evaluar()` del preview; acá sólo se releen las líneas y se persiste.
 *
 * Devuelve el `parse` actualizado, con la línea ya en `filas` en vez de
 * `retenidas` — la pantalla lo reemplaza y Cargar escribe la factura entera.
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { body, service } = ctx;

  const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
  if (!ticket) return badRequest('ticket requerido');

  if (!ML_URL || !ML_KEY) {
    console.error('[reyma/factura/reevaluar] ML_SERVICE_URL / ML_SERVICE_API_KEY sin configurar');
    return NextResponse.json({ error: 'El servicio de lectura de facturas no está configurado. Avisale a Jorge.' }, { status: 503 });
  }

  const { data: staging, error: errStaging } = await service
    .from('reyma_factura_staging')
    .select('id, estado, archivo, sha256, parse')
    .eq('id', ticket)
    .maybeSingle();
  if (errStaging) {
    console.error('[reyma/factura/reevaluar] staging:', errStaging);
    return NextResponse.json({ error: errStaging.message }, { status: 500 });
  }
  if (!staging) return NextResponse.json({ error: 'Esa subida ya no existe' }, { status: 404 });
  if (staging.estado === 'cargada') {
    return NextResponse.json({ error: 'Esa factura ya se cargó' }, { status: 409 });
  }

  const parse = (staging.parse ?? {}) as Record<string, unknown>;
  const cabecera = (parse.cabecera ?? null) as Record<string, unknown> | null;
  const lineas = Array.isArray(parse.lineas) ? parse.lineas : [];
  if (!cabecera || lineas.length === 0) {
    return NextResponse.json({ error: 'Esa subida no tiene líneas para reevaluar' }, { status: 422 });
  }

  let veredicto: { guia: string | null; filas: unknown[]; retenidas: unknown[]; errores: string[] };
  try {
    const r = await fetch(`${ML_URL.replace(/\/$/, '')}/reyma/factura/reevaluar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ML_KEY },
      body: JSON.stringify({
        archivo: staging.archivo,
        sha256: staging.sha256,
        cabecera,
        lineas,
        destino: typeof body.destino === 'string' ? body.destino : null,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok || !cuerpo) {
      const detalle = (cuerpo as { error?: string } | null)?.error;
      return NextResponse.json(
        { error: detalle ?? 'No se pudo reevaluar la factura' },
        { status: r.status >= 400 && r.status < 500 ? r.status : 502 },
      );
    }
    veredicto = cuerpo;
  } catch (e) {
    console.error('[reyma/factura/reevaluar] el servicio ML falló:', e);
    return NextResponse.json({ error: 'El servicio de lectura de facturas no respondió.' }, { status: 502 });
  }

  const flags = Array.isArray(parse.flags) ? parse.flags : [];
  const parseNuevo = {
    ...parse,
    filas: veredicto.filas,
    retenidas: veredicto.retenidas,
    errores: veredicto.errores,
    ok: veredicto.errores.length === 0 && flags.length === 0,
  };

  const { error: errUpdate } = await service
    .from('reyma_factura_staging')
    .update({ parse: parseNuevo })
    .eq('id', ticket);
  if (errUpdate) {
    console.error('[reyma/factura/reevaluar] update staging:', errUpdate);
    return NextResponse.json({ error: errUpdate.message }, { status: 500 });
  }

  return NextResponse.json({ ticket, parse: parseNuevo });
}
