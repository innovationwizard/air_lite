import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_FORECAST_COMERCIAL, CAN_CAPTURE_FORECAST, isAuthorized } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  MAX_CODIGOS_POR_MES, mesDentroDelHorizonte, mesesAbiertos, type Motivo,
} from '@/lib/comercial/forecast';

export const dynamic = 'force-dynamic';

const MOTIVOS_VALIDOS: Motivo[] = ['extraordinaria', 'temporada', 'critico'];

function badRequest(msg: string) {
  return NextResponse.json({ error: msg }, { status: 400 });
}

/**
 * El área sobre la que puede escribir quien pide.
 *
 * Un jefe de canal escribe SÓLO la suya, y eso se decide contra su perfil, no
 * contra lo que mande en el cuerpo — si viniera del cuerpo, cualquiera con rol
 * `ventas` podría cargar cifras en nombre de otro canal. `admin` y `superuser`
 * sí pueden indicar el área, porque cargan en representación de alguien.
 */
function areaPermitida(
  usuario: { role: string; area: string | null },
  areaPedida: unknown,
): { ok: true; area: string } | { ok: false; msg: string } {
  if (usuario.role === 'ventas') {
    if (!usuario.area) {
      return { ok: false, msg: 'Tu usuario no tiene un canal comercial asignado. Pedile a un administrador que te lo configure.' };
    }
    if (typeof areaPedida === 'string' && areaPedida !== usuario.area) {
      return { ok: false, msg: 'Sólo podés cargar el forecast de tu propio canal.' };
    }
    return { ok: true, area: usuario.area };
  }
  if (typeof areaPedida !== 'string' || !areaPedida.trim()) {
    return { ok: false, msg: 'area es obligatoria' };
  }
  return { ok: true, area: areaPedida };
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

  return NextResponse.json({
    filas: filas ?? [],
    productos,
    proyeccion,
    areas: areas ?? [],
    miArea: auth.area,
    puedeCapturar: isAuthorized(auth.role, CAN_CAPTURE_FORECAST),
    mesesAbiertos: mesesAbiertos(new Date()),
  });
}

/**
 * PUT /api/comercial/forecast — carga o corrige UN código.
 *
 *   { productId, month, quantity, motivo, note?, area? }
 *
 * Es upsert sobre (área, mes, producto), no inserción: volver a cargar un
 * código CORRIGE la cantidad en vez de sumar una fila. En una captura hecha
 * contra reloj el duplicado silencioso es el error más caro, porque infla el
 * pedido sin que nadie lo note hasta que llega de más.
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

  const { productId, month, quantity, motivo, note } = body;

  if (!Number.isInteger(productId) || (productId as number) <= 0) {
    return badRequest('productId inválido');
  }
  if (typeof month !== 'string' || !mesDentroDelHorizonte(month, new Date())) {
    return badRequest(`El mes debe ser uno de los abiertos: ${mesesAbiertos(new Date()).join(', ')}`);
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    return badRequest('La cantidad debe ser un número mayor que cero');
  }
  if (typeof motivo !== 'string' || !MOTIVOS_VALIDOS.includes(motivo as Motivo)) {
    return badRequest('motivo inválido');
  }
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    return badRequest('La nota admite hasta 500 caracteres');
  }

  const db = createServiceRoleClient();

  const { data: producto } = await db
    .from('products').select('id').eq('id', productId).maybeSingle();
  if (!producto) return badRequest('Ese código no existe en el catálogo');

  // Tope de códigos por área y mes. Se cuenta ANTES de escribir, y sólo aplica
  // si el código es nuevo: corregir la cantidad de uno ya cargado nunca puede
  // quedar bloqueado por el tope.
  const { data: yaCargado } = await db.from('comercial_forecast')
    .select('id').eq('area', area).eq('month', month).eq('product_id', productId).maybeSingle();
  if (!yaCargado) {
    const { count } = await db.from('comercial_forecast')
      .select('id', { count: 'exact', head: true }).eq('area', area).eq('month', month);
    if ((count ?? 0) >= MAX_CODIGOS_POR_MES) {
      return badRequest(
        `Ya cargaste ${MAX_CODIGOS_POR_MES} códigos para ese mes, que es el máximo acordado. `
        + 'Corregí alguno o quitá uno antes de agregar otro.');
    }
  }

  const { data, error } = await db.from('comercial_forecast')
    .upsert({
      product_id: productId, month, quantity, motivo, area,
      note: (note as string | null) ?? null, created_by: auth.id,
    }, { onConflict: 'area,month,product_id' })
    .select('id, product_id, month, quantity, motivo, area, note')
    .single();

  if (error) {
    return NextResponse.json(
      { error: 'No se pudo guardar', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ fila: data });
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
  const { error } = await db.from('comercial_forecast').delete()
    .eq('area', permiso.area).eq('month', month).eq('product_id', productId);
  if (error) {
    return NextResponse.json(
      { error: 'No se pudo quitar', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ quitado: true });
}
