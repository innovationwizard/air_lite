import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_FORECAST_COMERCIAL, CAN_CAPTURE_FORECAST, isAuthorized } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  MAX_CODIGOS_POR_MES, MOTIVOS_VALIDOS, esBase, mesDentroDelHorizonte, mesesAbiertos, primerDiaMes,
  type Motivo,
} from '@/lib/comercial/forecast';
import { cargarContexto, cargarDemanda, computarFilas, mesAnterior, type CapturaRow } from '../historial/lib';
import { areaPermitida } from '@/lib/comercial/permisos';
import { bloqueoActivo, mensajeBloqueado, type BloqueoResumen } from '../bloqueo/lib';
import { CAN_DESBLOQUEAR_FORECAST } from '@/lib/auth/roles';

export const dynamic = 'force-dynamic';

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * GET /api/comercial/forecast — lo cargado, el catálogo de áreas y la
 * proyección de la app.
 *
 * Un jefe de canal recibe SÓLO sus filas; compras y gerencia reciben todas,
 * que es el consolidado que hoy se arma descargando una hoja por canal y
 * uniéndolas a mano.
 *
 * La proyección se toma de la bodega `General` porque el forecast comercial no
 * se captura por bodega: el canal proyecta lo que va a vender, no dónde va a
 * estar guardado.
 */
export async function GET() {
  const auth = await requireAuth(CAN_VIEW_FORECAST_COMERCIAL);
  if (auth instanceof Response) return auth;

  const db = createServiceRoleClient();
  const soloMias = auth.role === 'ventas';

  let q = db.from('comercial_forecast')
    .select('id, product_id, month, quantity, motivo, area, note')
    .order('month', { ascending: true });
  if (soloMias) {
    if (!auth.area) return NextResponse.json({ error: 'Tu usuario no tiene un canal comercial asignado.' }, { status: 403 });
    q = q.eq('area', auth.area);
  }

  const [{ data: filas, error }, { data: areas }] = await Promise.all([
    q,
    db.from('comercial_areas').select('slug, nombre').eq('activa', true).order('nombre'),
  ]);
  if (error) {
    return NextResponse.json(
      { error: 'No se pudo leer el forecast', detail: error.message }, { status: 500 });
  }

  // Nombre y código de los productos que aparecen, y su proyección.
  const ids = [...new Set((filas ?? []).map((f) => f.product_id))];
  const productos = ids.length
    ? (await db.from('products').select('id, sku, name').in('id', ids)).data ?? []
    : [];
  const proyeccion = ids.length
    ? (await db.from('reabastecimiento_inputs')
        .select('product_id, p3').eq('bodega', 'General').in('product_id', ids)).data ?? []
    : [];

  const hoy = new Date();
  // Active locks («Bloquear cambios»): the leader's own, or every area's for
  // the readers. Keyed `area|month` so the screen can tell locked from open.
  const { data: locks } = soloMias
    ? await db.from('comercial_forecast_bloqueos')
        .select('area, month, version, autor, created_at').eq('activo', true).eq('area', auth.area!)
    : await db.from('comercial_forecast_bloqueos')
        .select('area, month, version, autor, created_at').eq('activo', true);
  const bloqueos: Record<string, BloqueoResumen> = {};
  for (const l of locks ?? []) {
    bloqueos[`${l.area}|${l.month}`] = { version: l.version, autor: l.autor, at: l.created_at };
  }
  const base = {
    filas: filas ?? [],
    productos,
    proyeccion,
    areas: areas ?? [],
    miArea: auth.area,
    puedeCapturar: isAuthorized(auth.role, CAN_CAPTURE_FORECAST),
    puedeDesbloquear: isAuthorized(auth.role, CAN_DESBLOQUEAR_FORECAST),
    mesesAbiertos: mesesAbiertos(hoy),
    bloqueos,
  };
  if (soloMias) return NextResponse.json(base);

  // NIVEL 2 — what the consolidated view needs beside each capture: the
  // app's recommendation per area for the same product and month, the real
  // requested/delivered once a month has closed, and the demand no channel
  // owns. Computed with the same lib the leader's table uses, so the two
  // screens cannot disagree about a number.
  const consolidado = await contextoConsolidado(db, ids, hoy);
  return NextResponse.json({ ...base, ...consolidado });
}

/**
 * For every active area: recommendation per (month, product) for the months
 * the readers can look at, and the real series per product; plus the
 * unassigned bucket totals per month. Restricted to the captured products,
 * which is all the consolidated table shows.
 */
async function contextoConsolidado(
  db: ReturnType<typeof createServiceRoleClient>, productIds: number[], hoy: Date,
) {
  // The closed previous month is viewable too: that is where "what did the
  // channel forecast vs what really happened" gets answered.
  const mesCerrado = mesAnterior(primerDiaMes(hoy));
  const mesesVista = [mesCerrado, ...mesesAbiertos(hoy)];
  const recomendaciones: Record<string, Record<string, Record<number, number>>> = {};
  const reales: Record<string, Record<number, Record<string, { pedido: number; entregado: number }>>> = {};
  const sinAsignar: Record<string, number> = {};
  if (productIds.length === 0) return { mesesVista, mesCerrado, recomendaciones, reales, sinAsignar };

  const ctx = await cargarContexto(db);
  const quiero = new Set(productIds);
  const areas = [...ctx.areas.values()];
  const demandas = await Promise.all(areas.map((a) => cargarDemanda(db, a.slug)));
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    const demanda = demandas[i].filter((d) => quiero.has(d.product_id));
    const capturas: CapturaRow[] = [];   // recommendations do not depend on captures
    recomendaciones[a.slug] = {};
    reales[a.slug] = {};
    for (const d of demanda) {
      const serie: Record<string, { pedido: number; entregado: number }> = {};
      for (const m of Object.keys(d.pedido_mensual)) {
        serie[m] = { pedido: Number(d.pedido_mensual[m] ?? 0), entregado: Number(d.entregado_mensual[m] ?? 0) };
      }
      reales[a.slug][d.product_id] = serie;
    }
    for (const mes of mesesVista) {
      const porProducto: Record<number, number> = {};
      for (const f of computarFilas(ctx, a, demanda, capturas, mes, hoy)) {
        if (f.recomendacion) porProducto[f.productId] = f.recomendacion.valor;
      }
      recomendaciones[a.slug][mes] = porProducto;
    }
  }
  // Demand no rule claims (`_sin_asignar` is inactive, so it is not in ctx.areas).
  for (const d of await cargarDemanda(db, '_sin_asignar')) {
    for (const [m, q] of Object.entries(d.pedido_mensual)) sinAsignar[m] = (sinAsignar[m] ?? 0) + Number(q);
  }
  return { mesesVista, mesCerrado, recomendaciones, reales, sinAsignar };
}

interface FilaEntrada { productId: number; quantity: number; motivo: Motivo; note: string | null }

/** One line of the body, validated. Returns the error text or the row. */
function validarFila(raw: unknown): { ok: true; fila: FilaEntrada } | { ok: false; msg: string } {
  const f = (raw ?? {}) as Record<string, unknown>;
  const { productId, quantity, motivo, note } = f;
  if (!Number.isInteger(productId) || (productId as number) <= 0) {
    return { ok: false, msg: 'productId inválido' };
  }
  // 0 is allowed ONLY in a batch: it means "clear this code" (the leader
  // emptied the cell). A single PUT keeps the > 0 rule below.
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, msg: 'La cantidad debe ser un número mayor o igual que cero' };
  }
  if (typeof motivo !== 'string' || !MOTIVOS_VALIDOS.includes(motivo as Motivo)) {
    return { ok: false, msg: 'motivo inválido' };
  }
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    return { ok: false, msg: 'La nota admite hasta 500 caracteres' };
  }
  return { ok: true, fila: { productId: productId as number, quantity, motivo: motivo as Motivo,
                             note: (note as string | null) ?? null } };
}

/**
 * PUT /api/comercial/forecast — carga o corrige códigos.
 *
 *   one:   { productId, month, quantity, motivo, note?, area? }
 *   batch: { month, filas: [{ productId, quantity, motivo, note? }], area? }   (nivel 2, «Aprobar todo»)
 *
 * Es upsert sobre (área, mes, producto), no inserción: volver a cargar un
 * código CORRIGE la cantidad en vez de sumar una fila. En una captura hecha
 * contra reloj el duplicado silencioso es el error más caro, porque infla el
 * pedido sin que nadie lo note hasta que llega de más.
 *
 * THE CAP (Q3, 2026-09-10): the 50-code limit applies to codes the leader
 * adds BY HAND, never to approved recommendations (`base`) — the ranked
 * list is itself 50 rows and approving it must never be blocked.
 */
export async function PUT(request: Request) {
  const auth = await requireAuth(CAN_CAPTURE_FORECAST);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return badRequest('cuerpo JSON inválido');
  }

  const permiso = areaPermitida(auth, body.area);
  if (!permiso.ok) return NextResponse.json({ error: permiso.msg }, { status: 403 });
  const area = permiso.area;

  const { month } = body;
  if (typeof month !== 'string' || !mesDentroDelHorizonte(month, new Date())) {
    return badRequest(`El mes debe ser uno de los abiertos: ${mesesAbiertos(new Date()).join(', ')}`);
  }

  const db = createServiceRoleClient();
  // «Bloquear cambios»: a locked area+month refuses every write, batch or single.
  const lock = await bloqueoActivo(db, area, month);
  if (lock) return NextResponse.json({ error: mensajeBloqueado(lock, month) }, { status: 423 });

  const esLote = Array.isArray(body.filas);
  const entradas: FilaEntrada[] = [];
  if (esLote) {
    const filas = body.filas as unknown[];
    if (filas.length === 0) return badRequest('filas está vacío');
    if (filas.length > 500) return badRequest('Máximo 500 filas por lote');
    for (const raw of filas) {
      const v = validarFila(raw);
      if (!v.ok) return badRequest(v.msg);
      entradas.push(v.fila);
    }
    const ids = new Set(entradas.map((f) => f.productId));
    if (ids.size !== entradas.length) return badRequest('Un código aparece dos veces en el lote');
  } else {
    const v = validarFila(body);
    if (!v.ok) return badRequest(v.msg);
    if (v.fila.quantity <= 0) return badRequest('La cantidad debe ser un número mayor que cero');
    entradas.push(v.fila);
  }

  const { data: existentes } = await db
    .from('products').select('id').in('id', entradas.map((f) => f.productId));
  const conocidos = new Set((existentes ?? []).map((p) => p.id as number));
  const desconocido = entradas.find((f) => !conocidos.has(f.productId));
  if (desconocido) return badRequest(`El código ${desconocido.productId} no existe en el catálogo`);

  // Tope de códigos por área y mes — sólo sobre los manuales y sólo si el
  // código es nuevo: corregir uno ya cargado nunca queda bloqueado por el
  // tope, y una recomendación aprobada (`base`) no cuenta contra él.
  const { data: cargados } = await db.from('comercial_forecast')
    .select('product_id, motivo').eq('area', area).eq('month', month);
  const yaCargados = new Map((cargados ?? []).map((c) => [c.product_id as number, c.motivo as Motivo]));
  const manualesHoy = (cargados ?? []).filter((c) => !esBase(c.motivo as Motivo)).length;
  const manualesNuevos = entradas.filter(
    (f) => f.quantity > 0 && !esBase(f.motivo) && !yaCargados.has(f.productId)).length;
  if (manualesHoy + manualesNuevos > MAX_CODIGOS_POR_MES) {
    return badRequest(
      `Ya cargaste ${MAX_CODIGOS_POR_MES} códigos para ese mes, que es el máximo acordado. `
      + 'Corregí alguno o quitá uno antes de agregar otro.');
  }

  const aBorrar = entradas.filter((f) => f.quantity <= 0).map((f) => f.productId);
  const aEscribir = entradas.filter((f) => f.quantity > 0).map((f) => ({
    product_id: f.productId, month, quantity: f.quantity, motivo: f.motivo, area,
    note: f.note, created_by: auth.id,
  }));

  if (aBorrar.length) {
    const { error } = await db.from('comercial_forecast').delete()
      .eq('area', area).eq('month', month).in('product_id', aBorrar);
    if (error) {
      return NextResponse.json({ error: 'No se pudo quitar', detail: error.message }, { status: 500 });
    }
  }
  let filas: unknown[] = [];
  if (aEscribir.length) {
    const { data, error } = await db.from('comercial_forecast')
      .upsert(aEscribir, { onConflict: 'area,month,product_id' })
      .select('id, product_id, month, quantity, motivo, area, note');
    if (error) {
      return NextResponse.json({ error: 'No se pudo guardar', detail: error.message }, { status: 500 });
    }
    filas = data ?? [];
  }
  return esLote
    ? NextResponse.json({ guardadas: filas.length, quitadas: aBorrar.length, filas })
    : NextResponse.json({ fila: filas[0] ?? null });
}

/** DELETE /api/comercial/forecast — quita un código del mes. */
export async function DELETE(request: Request) {
  const auth = await requireAuth(CAN_CAPTURE_FORECAST);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const productId = Number(url.searchParams.get('productId'));
  const month = url.searchParams.get('month') ?? '';
  const permiso = areaPermitida(auth, url.searchParams.get('area') ?? undefined);
  if (!permiso.ok) return NextResponse.json({ error: permiso.msg }, { status: 403 });

  if (!Number.isInteger(productId) || productId <= 0) return badRequest('productId inválido');
  if (!month) return badRequest('month es obligatorio');

  const db = createServiceRoleClient();
  const lock = await bloqueoActivo(db, permiso.area, month);
  if (lock) return NextResponse.json({ error: mensajeBloqueado(lock, month) }, { status: 423 });
  const { error } = await db.from('comercial_forecast').delete()
    .eq('area', permiso.area).eq('month', month).eq('product_id', productId);
  if (error) {
    return NextResponse.json(
      { error: 'No se pudo quitar', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ quitado: true });
}
