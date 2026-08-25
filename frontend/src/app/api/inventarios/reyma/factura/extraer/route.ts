import { NextResponse } from 'next/server';
import { autor, badRequest, withUploadAuth } from '../../lib';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/factura/extraer — paso 1 de la carga (A12).
 *
 * Recibe UNA factura PDF de REYMA, la guarda en el bucket privado, la manda a
 * leer al servicio ML y persiste el veredicto en `reyma_factura_staging`.
 * Devuelve un `ticket` con el que el paso 2 (`/cargar`) escribe de verdad.
 *
 * **No escribe en `reyma_facturas_pdf`.** Lo único que Alexis todavía no
 * declaró en este punto es lo único que la máquina no puede saber: el destino y
 * el ETA.
 *
 * El veredicto se queda del lado del servidor entre los dos pasos a propósito
 * (ver la migración 20260825000001): si las líneas viajaran al navegador y
 * volvieran, cualquiera con una sesión de `inventario` podría postear
 * cantidades y precios inventados.
 */

const MAX_BYTES = 15 * 1024 * 1024;
const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

/** Ruta en el bucket. `sha256` la hace idempotente: el mismo PDF, el mismo objeto. */
function storagePath(sha256: string): string {
  return `${sha256.slice(0, 2)}/${sha256}.pdf`;
}

export async function POST(request: Request) {
  const ctx = await withUploadAuth();
  if (ctx instanceof Response) return ctx;
  const { user, service } = ctx;

  if (!ML_URL || !ML_KEY) {
    // Fallar en voz alta: sin el servicio no hay lectura posible, y un mensaje
    // genérico mandaría a Alexis a revisar su PDF por un problema nuestro.
    console.error('[reyma/factura/extraer] ML_SERVICE_URL / ML_SERVICE_API_KEY sin configurar');
    return NextResponse.json(
      { error: 'El servicio de lectura de facturas no está configurado. Avisale a Jorge.' },
      { status: 503 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest('Se esperaba un envío multipart con el campo "pdf"');
  }

  const archivo = form.get('pdf');
  if (!(archivo instanceof File)) return badRequest('Falta el archivo (campo "pdf")');
  if (archivo.size === 0) return badRequest('El archivo llegó vacío');
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `El archivo pesa ${(archivo.size / 1024 / 1024).toFixed(1)} MB; el máximo es 15 MB` },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  // Magic bytes, no el content-type: el navegador de un teléfono manda
  // `application/octet-stream` con frecuencia, y el nombre no prueba nada.
  if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return NextResponse.json({ error: 'El archivo no es un PDF' }, { status: 415 });
  }

  const nombre = (archivo.name || 'sin-nombre.pdf').slice(0, 255);

  // ── Leer la factura ────────────────────────────────────────────────────────
  let parse: Record<string, unknown>;
  try {
    const upstream = new FormData();
    upstream.append('pdf', new Blob([bytes], { type: 'application/pdf' }), nombre);
    const r = await fetch(`${ML_URL.replace(/\/$/, '')}/reyma/factura/preview`, {
      method: 'POST',
      headers: { 'X-API-Key': ML_KEY },
      body: upstream,
      signal: AbortSignal.timeout(60_000),
    });
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok) {
      const detalle = (cuerpo as { error?: string } | null)?.error;
      // 4xx del servicio = el documento tiene algo (no es PDF, no se pudo
      // leer). Se pasa tal cual para que la pantalla lo diga con precisión.
      return NextResponse.json(
        { error: detalle ?? 'No se pudo leer la factura' },
        { status: r.status >= 400 && r.status < 500 ? r.status : 502 },
      );
    }
    parse = cuerpo as Record<string, unknown>;
  } catch (e) {
    console.error('[reyma/factura/extraer] el servicio ML falló:', e);
    return NextResponse.json(
      { error: 'El servicio de lectura de facturas no respondió. Probá de nuevo.' },
      { status: 502 },
    );
  }

  const sha256 = String(parse.sha256 ?? '');
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    console.error('[reyma/factura/extraer] el servicio no devolvió sha256');
    return NextResponse.json({ error: 'Respuesta inesperada del servicio de lectura' }, { status: 502 });
  }

  const cabecera = (parse.cabecera ?? null) as Record<string, unknown> | null;
  const folioFiscal = cabecera?.folio_fiscal ? String(cabecera.folio_fiscal) : null;

  // ── ¿Ya está cargada? ──────────────────────────────────────────────────────
  // No es un error: es información. Alexis manda ráfagas y bien puede reenviar
  // una. Se responde antes de escribir nada nuevo.
  if (folioFiscal) {
    const { data: yaCargada } = await service
      .from('reyma_facturas_pdf')
      .select('guia, factura, destino, eta')
      .eq('folio_fiscal', folioFiscal)
      .limit(1);
    if (yaCargada && yaCargada.length > 0) {
      return NextResponse.json({
        yaCargada: true,
        parse,
        existente: yaCargada[0],
      });
    }
  }

  // ── Guardar el PDF (procedencia) ───────────────────────────────────────────
  const path = storagePath(sha256);
  const { error: errStorage } = await service.storage
    .from('reyma-facturas')
    .upload(path, new Blob([bytes], { type: 'application/pdf' }), {
      contentType: 'application/pdf',
      // El mismo PDF va siempre al mismo objeto (la ruta es su sha256), así que
      // resubirlo sobrescribe con bytes idénticos en vez de fallar.
      upsert: true,
    });
  if (errStorage) {
    // El documento es la prueba de lo que se está por escribir. Si no se puede
    // guardar, no se sigue: cargar el dato sin poder mostrar de dónde salió es
    // exactamente el problema que esta pantalla viene a resolver.
    console.error('[reyma/factura/extraer] storage falló:', errStorage);
    return NextResponse.json(
      { error: `No se pudo guardar el PDF: ${errStorage.message}` },
      { status: 500 },
    );
  }

  // ── Persistir el veredicto ─────────────────────────────────────────────────
  const { data: fila, error: errStaging } = await service
    .from('reyma_factura_staging')
    .insert({
      sha256,
      archivo: nombre,
      guia: parse.guia ? String(parse.guia) : null,
      factura: cabecera?.factura ? String(cabecera.factura) : null,
      folio_fiscal: folioFiscal,
      storage_path: path,
      parse,
      estado: 'pendiente',
      autor: autor(user),
    })
    .select('id')
    .single();
  if (errStaging || !fila) {
    console.error('[reyma/factura/extraer] staging falló:', errStaging);
    return NextResponse.json({ error: errStaging?.message ?? 'No se pudo registrar la subida' }, { status: 500 });
  }

  return NextResponse.json({ ticket: fila.id, parse, yaCargada: false });
}
