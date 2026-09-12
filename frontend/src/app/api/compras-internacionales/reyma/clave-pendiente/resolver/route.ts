import { NextResponse } from 'next/server';
import { autor, badRequest, withWriteAuth } from '../../lib';

export const dynamic = 'force-dynamic';

const ML_URL = process.env.ML_SERVICE_URL;
const ML_KEY = process.env.ML_SERVICE_API_KEY;

interface PendienteRow {
  id: string; clave: string; descripcion: string; guia: string; factura: string;
  folio_fiscal: string; archivo: string; fecha: string; observ_destino: string;
  destino: string; eta: string | null; cantidad_cfdi: number; unidad: string;
  bultos: number | null; importe: number | null; precio_unitario: number | null;
  motivo: string; autor: string; estado: string;
}

/**
 * POST /api/compras-internacionales/reyma/clave-pendiente/resolver — A12b, el "un clic"
 * de /compras-internacionales/facturas/pendientes.
 *
 * Body: { clave, codigo, descripcion?, uom?, cubicaje?, fuente? }
 *
 * Decisión de Jorge 2026-09-09: sigue siendo Alexis quien resuelve — es quien
 * conoce el producto — sólo que no en el momento de descargar el furgón.
 *
 * Tres escrituras, en orden, y NINGUNA se reintenta a medias si falla una
 * intermedia — cada una deja al sistema en un estado consistente por sí sola:
 *
 *   1. `reyma_products` — upsert QUE NUNCA PISA una fila existente
 *      (ignoreDuplicates): si el código ya está en el catálogo, sus datos
 *      —incluida `en_alcance`— se quedan como están. Sólo crea la fila
 *      cuando el código es nuevo para el modelo.
 *   2. `reyma_clave_map` — el cruce en sí, append-only (histórico, nunca se
 *      pisa). A partir de acá `_mapas_reyma()` (ml/api.py) ya lo ve en
 *      cualquier factura nueva que llegue.
 *   3. Las líneas que ya estaban esperando esta clave se REEVALÚAN llamando
 *      al servicio ML (`/reyma/factura/pendiente/reintentar`), que corre la
 *      MISMA `evaluar()` que carga facturas nuevas — nunca una
 *      reimplementación acá. Si esa llamada falla, la clave YA QUEDÓ resuelta
 *      (pasos 1-2 no se deshacen) — un reintento posterior de esta misma
 *      acción, o la próxima factura con esa clave, la recogen solas.
 */
export async function POST(request: Request) {
  const ctx = await withWriteAuth(request);
  if (ctx instanceof Response) return ctx;
  const { user, body, service } = ctx;

  const clave = typeof body.clave === 'string' ? body.clave.trim() : '';
  const codigo = typeof body.codigo === 'string' ? body.codigo.trim() : '';
  if (!clave) return badRequest('identificador requerido');
  if (!codigo) return badRequest('SKU requerido');

  const descripcion = typeof body.descripcion === 'string' ? body.descripcion.slice(0, 300) : null;
  const nombreOdoo = typeof body.nombreOdoo === 'string' ? body.nombreOdoo.slice(0, 200) : null;
  const uom = typeof body.uom === 'string' ? body.uom.slice(0, 40) : null;
  const cubicaje = typeof body.cubicaje === 'number' && Number.isFinite(body.cubicaje) ? body.cubicaje : 0;
  const fuente = typeof body.fuente === 'string' ? body.fuente : 'manual';

  // ── Líneas que estaban esperando esta clave, ANTES de escribir nada ────────
  const { data: pendientes, error: errPendientes } = await service
    .from('reyma_factura_pendiente')
    .select('*')
    .eq('clave', clave)
    .eq('estado', 'pendiente')
    .returns<PendienteRow[]>();
  if (errPendientes) {
    console.error('[clave-pendiente/resolver] leer pendientes:', errPendientes);
    return NextResponse.json({ error: errPendientes.message }, { status: 500 });
  }

  // ── 1. reyma_products — crea el código si es nuevo; nunca pisa uno existente ──
  const { error: errProducto } = await service
    .from('reyma_products')
    .upsert({
      codigo,
      clave,
      nombre_odoo: nombreOdoo,
      descripcion: descripcion ?? nombreOdoo ?? clave,
      // David todavía debe la categoría real (ver CATEGORIAS_PARA_DAVID.md) —
      // esto es un valor visible de "falta clasificar", no una categoría real.
      categoria: 'Sin categorizar',
      categoria_fuente: 'odoo',
      cubicaje,
      uom,
      activo: true,
      en_alcance: true, // decisión de Jorge 2026-09-09: mapear = entrar al modelo
    }, { onConflict: 'codigo', ignoreDuplicates: true });
  if (errProducto) {
    console.error('[clave-pendiente/resolver] reyma_products:', errProducto);
    return NextResponse.json({ error: errProducto.message }, { status: 500 });
  }

  // ── 2. reyma_clave_map — el cruce, append-only ──────────────────────────────
  const { error: errMapa } = await service
    .from('reyma_clave_map')
    .insert({
      clave,
      codigo,
      descripcion,
      evidencia: { fuente, nombre_odoo: nombreOdoo, resuelto_desde: 'facturas/pendientes' },
      autor: autor(user),
    });
  if (errMapa) {
    console.error('[clave-pendiente/resolver] reyma_clave_map:', errMapa);
    return NextResponse.json({ error: errMapa.message }, { status: 500 });
  }

  if (!pendientes || pendientes.length === 0) {
    // Clave resuelta sin que nada la estuviera esperando (p. ej. mapeo
    // anticipado). Válido: la próxima factura con esta clave ya entra bien.
    return NextResponse.json({ ok: true, clave, codigo, aplicadas: 0, siguenPendientes: 0 });
  }

  if (!ML_URL || !ML_KEY) {
    console.error('[clave-pendiente/resolver] ML_SERVICE_URL / ML_SERVICE_API_KEY sin configurar');
    return NextResponse.json({
      ok: true, clave, codigo, aplicadas: 0, siguenPendientes: pendientes.length,
      aviso: 'El identificador quedó asignado, pero el servicio que aplica las líneas en cola no está '
           + 'configurado. Van a quedar pendientes hasta que se reintente.',
    });
  }

  // ── 3. Reevaluar las líneas en cola con la MISMA regla (evaluar()) ─────────
  const lineas = pendientes.map((p) => ({
    archivo: p.archivo, folio_fiscal: p.folio_fiscal, factura: p.factura, fecha: p.fecha,
    identificador: p.clave, cantidad: p.cantidad_cfdi, unidad: p.unidad, bultos: p.bultos,
    importe: p.importe, precio_unitario: p.precio_unitario, observ_destino: p.observ_destino,
    destino: p.destino, eta: p.eta,
  }));

  let resultado: { filas: Record<string, unknown>[]; retenidas: { folio_fiscal: string; motivo: string }[]; errores: string[] };
  try {
    const r = await fetch(`${ML_URL.replace(/\/$/, '')}/reyma/factura/pendiente/reintentar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': ML_KEY },
      body: JSON.stringify({ lineas }),
      signal: AbortSignal.timeout(30_000),
    });
    const cuerpo = await r.json().catch(() => null);
    if (!r.ok || !cuerpo) {
      throw new Error((cuerpo as { error?: string } | null)?.error ?? `HTTP ${r.status}`);
    }
    resultado = cuerpo;
  } catch (e) {
    // La clave YA quedó resuelta (pasos 1-2 ya escribieron). Esto sólo afecta
    // el "aplicar ahora" — las líneas se quedan `pendiente` para reintentar.
    console.error('[clave-pendiente/resolver] reintentar falló:', e);
    return NextResponse.json({
      ok: true, clave, codigo, aplicadas: 0, siguenPendientes: pendientes.length,
      aviso: `El identificador quedó asignado, pero no se pudieron aplicar las líneas en cola ahora `
           + `(${e instanceof Error ? e.message : 'error de red'}). Reintentá desde esta pantalla.`,
    });
  }

  const porFolio = new Map(pendientes.map((p) => [p.folio_fiscal, p]));

  if (resultado.filas.length > 0) {
    const { error: errUpsert } = await service
      .from('reyma_facturas_pdf')
      .upsert(resultado.filas, { onConflict: 'folio_fiscal,codigo' });
    if (errUpsert) {
      console.error('[clave-pendiente/resolver] reyma_facturas_pdf:', errUpsert);
      return NextResponse.json({
        ok: true, clave, codigo, aplicadas: 0, siguenPendientes: pendientes.length,
        aviso: `El identificador quedó asignado, pero no se pudieron escribir las líneas: ${errUpsert.message}. `
             + 'Reintentá desde esta pantalla.',
      });
    }

    const idsAplicados = resultado.filas
      .map((f) => porFolio.get(String(f.folio_fiscal))?.id)
      .filter((id): id is string => Boolean(id));
    if (idsAplicados.length > 0) {
      await service
        .from('reyma_factura_pendiente')
        .update({ estado: 'aplicada', aplicada_at: new Date().toISOString() })
        .in('id', idsAplicados);
    }
  }

  const cajas = resultado.filas.reduce((s, f) => s + Number(f.cantidad ?? 0), 0);
  return NextResponse.json({
    ok: true,
    clave,
    codigo,
    aplicadas: resultado.filas.length,
    cajas,
    siguenPendientes: resultado.retenidas.length,
    // Por si alguna línea sigue sin poderse aplicar por OTRO motivo (p. ej.
    // KGM sin tablita de conversión) — se anuncia con números, nunca en silencio.
    motivosPendientes: resultado.retenidas.map((r) => r.motivo),
  });
}
