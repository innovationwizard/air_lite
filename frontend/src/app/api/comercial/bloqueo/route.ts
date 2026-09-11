import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import {
  CAN_CAPTURE_FORECAST, CAN_DESBLOQUEAR_FORECAST, CAN_VIEW_FORECAST_COMERCIAL,
} from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import { fetchAll } from '@/lib/supabase/paginado';
import { mesDentroDelHorizonte, mesesAbiertos } from '@/lib/comercial/forecast';
import { areaPermitida } from '@/lib/comercial/permisos';
import { bodegaQueSirve } from '@/lib/comercial/recomendacion';
import {
  cargarContexto, cargarDemanda, cargarForecastCompras, computarFilas, type CapturaRow,
} from '../historial/lib';
import { bloqueoActivo, hashFilas } from './lib';

export const dynamic = 'force-dynamic';

/**
 * «Bloquear cambios» (PM, 2026-09-11).
 *
 *   GET    ?area=&month=   the active lock, if any (with its approval)
 *   POST   { month, area? } «Bloquear cambios»: freeze and store — NOT sent
 *   PATCH  { month, area? } «Aprobar pedido»: send the frozen record to Compras
 *                           (requires the active lock; no partial approval)
 *   DELETE ?area=&month=   unlock (sales_manager / admin / superuser) — withdraws the approval
 *
 * The record is SERVER-AUTHORITATIVE: the rows are read from
 * comercial_forecast and their context is recomputed with the same lib the
 * leader's table uses — never taken from the client. A leader can therefore
 * not freeze something other than what the system holds, and the record
 * proves both what they sent and what they were looking at.
 */

function esMesValido(month: unknown): month is string {
  return typeof month === 'string' && /^\d{4}-\d{2}-01$/.test(month);
}

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_FORECAST_COMERCIAL);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const month = url.searchParams.get('month') ?? '';
  const areaPedida = url.searchParams.get('area');
  const area = auth.role === 'ventas' ? auth.area : areaPedida;
  if (!area || !esMesValido(month)) return NextResponse.json({ error: 'area y month son obligatorios' }, { status: 400 });
  if (auth.role === 'ventas' && areaPedida && areaPedida !== auth.area) {
    return NextResponse.json({ error: 'Sólo podés ver el bloqueo de tu propio canal.' }, { status: 403 });
  }
  const db = createServiceRoleClient();
  return NextResponse.json({ bloqueo: await bloqueoActivo(db, area, month) });
}

export async function POST(request: Request) {
  const auth = await requireAuth(CAN_CAPTURE_FORECAST);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'cuerpo JSON inválido' }, { status: 400 }); }

  const permiso = areaPermitida(auth, body.area);
  if (!permiso.ok) return NextResponse.json({ error: permiso.msg }, { status: 403 });
  const area = permiso.area;
  const { month } = body;
  const hoy = new Date();
  if (!esMesValido(month) || !mesDentroDelHorizonte(month, hoy)) {
    return NextResponse.json(
      { error: `El mes debe ser uno de los abiertos: ${mesesAbiertos(hoy).join(', ')}` }, { status: 400 });
  }

  const db = createServiceRoleClient();
  const { data: hijos } = await db.from('comercial_areas').select('slug').eq('padre', area).eq('activa', true).limit(1);
  if (hijos && hijos.length) {
    return NextResponse.json({ error: 'Este canal se pronostica por vendedor; cada vendedor bloquea el suyo.' }, { status: 403 });
  }
  const yaActivo = await bloqueoActivo(db, area, month);
  if (yaActivo) return NextResponse.json({ error: 'Ese mes ya está bloqueado.', bloqueo: yaActivo }, { status: 409 });

  // What gets frozen: every saved row of the area for the month…
  const capturas = await fetchAll<CapturaRow>(() => db.from('comercial_forecast')
    .select('id, product_id, month, quantity, motivo, area').eq('area', area).eq('month', month), 'id');
  if (capturas.length === 0) {
    return NextResponse.json(
      { error: 'No hay nada que bloquear: todavía no cargaste ningún código para ese mes.' }, { status: 400 });
  }
  // …with the facts the leader was looking at, recomputed here.
  const [ctx, demanda, forecastCompras] = await Promise.all([
    cargarContexto(db), cargarDemanda(db, area), cargarForecastCompras(db, bodegaQueSirve(area)),
  ]);
  const areaCfg = ctx.areas.get(area);
  if (!areaCfg) return NextResponse.json({ error: 'Canal desconocido o inactivo' }, { status: 404 });
  const contexto = new Map(
    computarFilas(ctx, areaCfg, demanda, capturas, month, hoy, forecastCompras).map((f) => [f.productId, f]));
  const filas = capturas
    .map((c) => {
      const f = contexto.get(c.product_id);
      const p = ctx.productoPorId.get(c.product_id);
      return {
        productId: c.product_id,
        sku: f?.sku ?? p?.sku ?? `#${c.product_id}`,
        nombre: f?.nombre ?? p?.name ?? '',
        quantity: Number(c.quantity),
        motivo: c.motivo,
        contexto: f ? {
          etiqueta: f.etiqueta, recomendacion: f.recomendacion, meses3: f.meses3, anteriores: f.anteriores,
          clientes: f.clientes, compras: f.compras, proveedor: f.proveedor, categoria: f.categoria,
        } : null,
      };
    })
    .sort((a, b) => a.productId - b.productId);

  const { data: previas } = await db.from('comercial_forecast_bloqueos')
    .select('version').eq('area', area).eq('month', month).order('version', { ascending: false }).limit(1);
  const version = ((previas?.[0]?.version as number | undefined) ?? 0) + 1;
  const autor = `${auth.displayName ?? ''} <${auth.email}>`.trim();

  const { data, error } = await db.from('comercial_forecast_bloqueos')
    .insert({
      area, month, version, user_id: auth.id, autor, filas, total_filas: filas.length,
      hash: hashFilas(filas),
    })
    .select('id, area, month, version, autor, created_at, total_filas, hash')
    .single();
  if (error) {
    // A concurrent lock lands on the partial unique index: report it as such.
    const conflicto = /uq_comercial_forecast_bloqueos_activo|duplicate/i.test(error.message);
    return NextResponse.json(
      { error: conflicto ? 'Ese mes ya está bloqueado.' : 'No se pudo bloquear', detail: error.message },
      { status: conflicto ? 409 : 500 });
  }
  return NextResponse.json({ bloqueo: data });
}

export async function PATCH(request: Request) {
  const auth = await requireAuth(CAN_CAPTURE_FORECAST);
  if (auth instanceof Response) return auth;
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'cuerpo JSON inválido' }, { status: 400 }); }
  const permiso = areaPermitida(auth, body.area);
  if (!permiso.ok) return NextResponse.json({ error: permiso.msg }, { status: 403 });
  const { month } = body;
  if (!esMesValido(month)) return NextResponse.json({ error: 'month inválido' }, { status: 400 });

  const db = createServiceRoleClient();
  const lock = await bloqueoActivo(db, permiso.area, month);
  if (!lock) {
    return NextResponse.json(
      { error: 'Primero bloqueá los cambios: se aprueba el pedido bloqueado, no uno que todavía se puede editar.' }, { status: 409 });
  }
  if (lock.aprobadoAt) return NextResponse.json({ error: 'Ese pedido ya fue aprobado.', bloqueo: lock }, { status: 409 });
  const autor = `${auth.displayName ?? ''} <${auth.email}>`.trim();
  const { error } = await db.from('comercial_forecast_bloqueos')
    .update({ aprobado_at: new Date().toISOString(), aprobado_por: auth.id, aprobado_autor: autor })
    .eq('id', lock.id);
  if (error) return NextResponse.json({ error: 'No se pudo aprobar', detail: error.message }, { status: 500 });
  return NextResponse.json({ bloqueo: await bloqueoActivo(db, permiso.area, month) });
}

export async function DELETE(request: Request) {
  const auth = await requireAuth(CAN_DESBLOQUEAR_FORECAST);
  if (auth instanceof Response) return auth;
  const url = new URL(request.url);
  const area = url.searchParams.get('area') ?? '';
  const month = url.searchParams.get('month') ?? '';
  if (!area || !esMesValido(month)) return NextResponse.json({ error: 'area y month son obligatorios' }, { status: 400 });

  const db = createServiceRoleClient();
  const { data: activo } = await db.from('comercial_forecast_bloqueos')
    .select('id').eq('area', area).eq('month', month).eq('activo', true).maybeSingle();
  if (!activo) return NextResponse.json({ error: 'Ese mes no está bloqueado.' }, { status: 404 });

  const autor = `${auth.displayName ?? ''} <${auth.email}>`.trim();
  const { error } = await db.from('comercial_forecast_bloqueos')
    .update({ activo: false, desbloqueado_por: auth.id, desbloqueado_autor: autor,
              desbloqueado_at: new Date().toISOString() })
    .eq('id', activo.id);
  if (error) return NextResponse.json({ error: 'No se pudo desbloquear', detail: error.message }, { status: 500 });
  return NextResponse.json({ desbloqueado: true });
}
