/**
 * GET / POST /api/compras/reabastecimiento/export/emitido
 *
 * The immutable record of every purchase-plan file actually downloaded for a
 * supplier — see migration 20260821000005.
 *
 * The draft says what he was thinking; this says what went out. It is what a
 * later fill-rate comparison (W6) measures against, and it is the evidence for
 * the argument he already has with Carvajal — *"ellos tienen demasiado de eso…
 * me manda esto primero y lo que me urge no me lo manda"*.
 *
 * Each POST is a new row: re-downloading after a correction is legitimate and
 * each emission is its own fact. UPDATE is blocked by a DB trigger.
 *
 * ⚠️ INERT by decision (Jorge, 2026-08-21): nothing reads this back into a
 * calculation.
 *
 * RBAC: middleware `check_route_access` + in-handler requireAuth(CAN_VIEW_COMPRAS).
 */
import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_COMPRAS } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';
import {
  MAX_DRAFT_LINEAS, readDraftCantidades, readDraftKey,
} from '@/lib/compras/draft';
import { badRequest, isPositiveInt } from '../../lib';

export const dynamic = 'force-dynamic';

const MAX_ARCHIVO = 300;
const SHA256_RE = /^[0-9a-f]{64}$/;

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const key = readDraftKey({
    proveedor: url.searchParams.get('proveedor'),
    semana: url.searchParams.get('semana'),
    mes: url.searchParams.get('mes'),
  });
  if (typeof key === 'string') return badRequest(key);

  try {
    const service = createServiceRoleClient();
    const { data, error } = await service
      .from('export_plan_emitido')
      .select('id, archivo, total_lineas, total_unidades, sha256, autor, created_at')
      .eq('proveedor', key.proveedor)
      .eq('semana', key.semana)
      .eq('mes', key.mes)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return NextResponse.json({ emisiones: data ?? [] });
  } catch (e) {
    console.error('[export/emitido] GET failed:', e);
    return NextResponse.json({ error: 'Error leyendo las emisiones' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAuth(CAN_VIEW_COMPRAS);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return badRequest('cuerpo inválido: se esperaba JSON');
  }

  const key = readDraftKey(body);
  if (typeof key === 'string') return badRequest(key);

  const archivo = typeof body.archivo === 'string' ? body.archivo.trim() : '';
  if (!archivo) return badRequest('archivo es obligatorio');
  if (archivo.length > MAX_ARCHIVO) return badRequest(`archivo excede ${MAX_ARCHIVO} caracteres`);

  // A hash we cannot compute is recorded as NULL — never faked, never omitted
  // silently. It is what proves "this is the file that went out".
  const sha256 = typeof body.sha256 === 'string' && SHA256_RE.test(body.sha256)
    ? body.sha256 : null;
  if (body.sha256 != null && sha256 === null) return badRequest('sha256 debe ser 64 hex');

  const rawLineas = body.lineas;
  if (!Array.isArray(rawLineas)) return badRequest('lineas debe ser un arreglo');
  if (rawLineas.length === 0) return badRequest('no se registra una emisión sin líneas');
  if (rawLineas.length > MAX_DRAFT_LINEAS) {
    return badRequest(`demasiadas líneas (${rawLineas.length}); el máximo es ${MAX_DRAFT_LINEAS}`);
  }

  const lineas = [];
  for (const [i, raw] of rawLineas.entries()) {
    if (raw === null || typeof raw !== 'object') return badRequest(`línea ${i}: debe ser un objeto`);
    const l = raw as Record<string, unknown>;
    if (!isPositiveInt(l.product_id)) return badRequest(`línea ${i}: product_id inválido`);
    const cantidades = readDraftCantidades(l.cantidades);
    if (typeof cantidades === 'string') return badRequest(`línea ${i}: ${cantidades}`);
    // The Sugerido the app was proposing at emission time. Optional — an older
    // client may not send it — but never invented when absent.
    const sugerido = l.sugerido === undefined ? null : readDraftCantidades(l.sugerido);
    if (typeof sugerido === 'string') return badRequest(`línea ${i}: sugerido ${sugerido}`);
    lineas.push({
      product_id: l.product_id,
      cod: String(l.cod ?? '').slice(0, 40),
      desc: String(l.desc ?? '').slice(0, 300),
      prioridad: Number.isInteger(l.prioridad) ? (l.prioridad as number) : i + 1,
      cantidades,
      sugerido,
    });
  }

  // Totals are DERIVED here, never taken from the client: a stored total that
  // disagrees with its own lines is worse than no total at all.
  const totalUnidades = lineas.reduce(
    (sum, l) => sum + Object.values(l.cantidades).reduce(
      (s: number, v) => s + (typeof v === 'number' ? v : 0), 0),
    0,
  );

  try {
    const service = createServiceRoleClient();
    const autor = auth.displayName ? `${auth.displayName} (${auth.email})` : auth.email;
    const { data, error } = await service
      .from('export_plan_emitido')
      .insert({
        proveedor: key.proveedor,
        semana: key.semana,
        mes: key.mes,
        archivo,
        lineas,
        total_lineas: lineas.length,
        total_unidades: totalUnidades,
        sha256,
        autor,
      })
      .select('id, created_at')
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({
      ok: true, id: data?.id, created_at: data?.created_at,
      total_lineas: lineas.length, total_unidades: totalUnidades, autor,
    });
  } catch (e) {
    console.error('[export/emitido] POST failed:', e);
    return NextResponse.json({ error: 'Error registrando la emisión' }, { status: 500 });
  }
}
