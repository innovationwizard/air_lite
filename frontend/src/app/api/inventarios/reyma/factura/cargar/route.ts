import { NextResponse } from 'next/server';
import { autor, badRequest, withReadAuth, withWriteAuth } from '../../lib';
import { DESTINOS, nombreDestino } from '@/lib/reyma/destinos';

export const dynamic = 'force-dynamic';

/**
 * POST /api/inventarios/reyma/factura/cargar — paso 2 de la carga (A12).
 * Body: { ticket: uuid, destino: string, eta?: 'YYYY-MM-DD' | null }
 *
 * Alexis confirma los DOS campos que el documento no puede declarar y esto
 * escribe en `reyma_facturas_pdf`. Las líneas se releen del staging, nunca del
 * cliente: el navegador manda un ticket y dos decisiones, no mercadería.
 *
 * GET — las facturas cargadas recientemente, con la serie de furgones G-nnn y
 * sus huecos. Es el chequeo que hoy sólo hace Jorge y que Alexis está en mejor
 * posición de hacer: él sabe si mandó 7 u 8.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ventana de cordura del ETA. NO es una regla de negocio: es un filtro de
 * dedazo. Un selector de fecha en un teléfono produce años equivocados con
 * facilidad, y un ETA en 2126 envenena la vista de tránsito para siempre.
 * El pasado se permite a propósito (decisión D5): un furgón puede haber
 * llegado antes de que Alexis alcance a mandar la factura — pasó con G-235 —
 * y una fecha en pasado ya significa «ya llegó», sin inventar un estado nuevo.
 * Lo único que se descarta es lo imposible: antes de que la factura existiera.
 */
const ETA_MAX_DIAS = 120;

function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`);
  const b = Date.parse(`${hasta}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const ticket = typeof body.ticket === 'string' ? body.ticket.trim() : '';
  if (!ticket) return badRequest('ticket requerido');

  const destino = typeof body.destino === 'string' ? body.destino.trim() : '';
  if (!DESTINOS.some((d) => d.id === destino)) {
    return badRequest(`destino inválido; se esperaba uno de: ${DESTINOS.map((d) => d.id).join(', ')}`);
  }

  const etaRaw = body.eta;
  if (etaRaw !== undefined && etaRaw !== null && !(typeof etaRaw === 'string' && ISO.test(etaRaw))) {
    return badRequest('eta debe ser YYYY-MM-DD o null');
  }
  const eta = (etaRaw as string | null | undefined) || null;

  // ── Releer el veredicto del servidor ───────────────────────────────────────
  const { data: staging, error: errStaging } = await service
    .from('reyma_factura_staging')
    .select('id, estado, guia, factura, folio_fiscal, archivo, parse')
    .eq('id', ticket)
    .maybeSingle();
  if (errStaging) {
    console.error('[reyma/factura/cargar] staging:', errStaging);
    return NextResponse.json({ error: errStaging.message }, { status: 500 });
  }
  if (!staging) return NextResponse.json({ error: 'Esa subida ya no existe' }, { status: 404 });
  if (staging.estado === 'cargada') {
    return NextResponse.json({ error: 'Esa factura ya se cargó' }, { status: 409 });
  }

  const parse = (staging.parse ?? {}) as {
    cuadra?: boolean;
    errores?: string[];
    retenidas?: unknown[];
    filas?: Record<string, unknown>[];
    cabecera?: { destino_in_band?: string | null; fecha?: string | null } | null;
  };

  // ── Las mismas puertas que en el preview, otra vez del lado del servidor ───
  // El botón deshabilitado en la pantalla es cortesía; esto es la regla.
  if (parse.cuadra !== true) {
    return NextResponse.json(
      { error: 'La factura no cuadra contra su total impreso — no se carga.' },
      { status: 422 },
    );
  }
  if (parse.errores && parse.errores.length > 0) {
    return NextResponse.json({ error: parse.errores.join(' · ') }, { status: 422 });
  }
  const filas = Array.isArray(parse.filas) ? parse.filas : [];
  if (filas.length === 0) {
    return NextResponse.json({ error: 'La factura no tiene líneas cargables.' }, { status: 422 });
  }

  // N10 — el documento manda cuando lo dice. Es la regla con consecuencia de
  // dinero: marcar Zacapa como San José hace que esas cajas descuenten
  // PO-P-3003 sin pertenecerle (N13).
  const inBand = parse.cabecera?.destino_in_band ?? null;
  if (inBand && inBand !== destino) {
    return NextResponse.json(
      {
        error: `La factura dice que va a ${nombreDestino(inBand)}, `
             + `y se está marcando ${nombreDestino(destino)}.`,
        destinoInBand: inBand,
      },
      { status: 409 },
    );
  }

  const fechaFactura = typeof parse.cabecera?.fecha === 'string' ? parse.cabecera.fecha : null;
  const fechaIso = fechaFactura && /^\d{2}\/\d{2}\/\d{4}$/.test(fechaFactura)
    ? `${fechaFactura.slice(6, 10)}-${fechaFactura.slice(3, 5)}-${fechaFactura.slice(0, 2)}`
    : (filas[0]?.fecha as string | undefined) ?? null;

  if (eta && fechaIso) {
    const d = diasEntre(fechaIso, eta);
    if (d < 0) {
      return badRequest(`El ETA (${eta}) es anterior a la fecha de la factura (${fechaIso}).`);
    }
    if (d > ETA_MAX_DIAS) {
      return badRequest(`El ETA (${eta}) cae ${d} días después de la factura. ¿Está bien el año?`);
    }
  }

  // ── Escribir ───────────────────────────────────────────────────────────────
  // El destino y el ETA son de Alexis; el resto viene del documento tal como el
  // servicio lo leyó. `autor` se estampa acá porque acá está la sesión.
  const procedencia = `${autor(user)} — carga en app desde ${staging.archivo}`;
  const aEscribir: Record<string, unknown>[] = filas.map((f) => ({
    ...f,
    destino,
    eta,
    // El preview deja en `autor` la nota de conversión de la bolsa poliseda
    // («KGM → 101 BLTS × 15 rollos/bulto = 1,515»). Se conserva: es la prueba
    // de cómo se obtuvo la cantidad comprable.
    autor: `${procedencia}${notaDeConversion(String(f.autor ?? ''))}`.slice(0, 500),
  }));

  const { error: errUpsert } = await service
    .from('reyma_facturas_pdf')
    .upsert(aEscribir, { onConflict: 'folio_fiscal,codigo' });
  if (errUpsert) {
    console.error('[reyma/factura/cargar] upsert:', errUpsert);
    return NextResponse.json({ error: errUpsert.message }, { status: 500 });
  }

  await service
    .from('reyma_factura_staging')
    .update({ estado: 'cargada', cargada_at: new Date().toISOString() })
    .eq('id', ticket);

  const cajas = aEscribir.reduce((s, f) => s + Number(f.cantidad ?? 0), 0);
  return NextResponse.json({
    ok: true,
    guia: staging.guia,
    factura: staging.factura,
    lineas: aEscribir.length,
    cajas,
    destino,
    eta,
    retenidas: Array.isArray(parse.retenidas) ? parse.retenidas.length : 0,
  });
}

/** Conserva el `[KGM → … BLTS × … ]` que el preview dejó en `autor`. */
function notaDeConversion(autorPreview: string): string {
  const i = autorPreview.indexOf(' [');
  return i === -1 ? '' : autorPreview.slice(i);
}

/**
 * GET — la serie de furgones cargados, con sus huecos. Alexis sabe cuántas
 * facturas mandó; el correlativo `G-nnn` es lo que delata una que se perdió
 * (pasó con G-226 y con G-230).
 */
export async function GET() {
  const auth = await withReadAuth();
  if (auth instanceof Response) return auth;

  const { createServiceRoleClient } = await import('@/lib/supabase/server');
  const service = createServiceRoleClient();

  const { data, error } = await service
    .from('reyma_facturas_pdf')
    .select('guia, factura, destino, fecha, eta, cantidad, created_at')
    .order('fecha', { ascending: false })
    .limit(2000);
  if (error) {
    console.error('[reyma/factura/cargar] GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const porGuia = new Map<string, {
    guia: string; factura: string; destino: string | null; fecha: string;
    eta: string | null; lineas: number; cajas: number; cargadaEl: string;
  }>();
  for (const f of data ?? []) {
    const g = porGuia.get(f.guia);
    if (g) {
      g.lineas += 1;
      g.cajas += Number(f.cantidad ?? 0);
      if (f.created_at > g.cargadaEl) g.cargadaEl = f.created_at;
    } else {
      porGuia.set(f.guia, {
        guia: f.guia, factura: f.factura, destino: f.destino, fecha: f.fecha,
        eta: f.eta, lineas: 1, cajas: Number(f.cantidad ?? 0), cargadaEl: f.created_at,
      });
    }
  }

  const facturas = [...porGuia.values()].sort((a, b) => b.guia.localeCompare(a.guia));

  // Huecos en el correlativo: 'G-236-2026' → 236. Sólo dentro del rango que ya
  // existe — no se inventa que falte lo que todavía no salió de fábrica.
  const numeros = facturas
    .map((f) => Number(/^G-(\d+)-/.exec(f.guia)?.[1] ?? NaN))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const huecos: string[] = [];
  for (let n = numeros[0]; n <= numeros[numeros.length - 1]; n += 1) {
    if (!numeros.includes(n)) huecos.push(`G-${n}`);
  }

  return NextResponse.json({
    facturas: facturas.slice(0, 40),
    total: facturas.length,
    serie: numeros.length > 0
      ? { desde: `G-${numeros[0]}`, hasta: `G-${numeros[numeros.length - 1]}`, huecos }
      : null,
  });
}
