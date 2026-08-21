/**
 * GET / PUT /api/compras/reabastecimiento/export/draft
 *
 * The resumable draft of the supplier sheet (W1 format (a)). Wilmer edits every
 * cell before sending; before this existed those edits lived only in React
 * state and were lost on close — see migration 20260821000004.
 *
 * ⚠️ INERT by explicit decision (Jorge, 2026-08-21): this is storage only.
 * Nothing reads it back into tránsito, Sugerido or fill-rate. Wiring it into a
 * calculation is a separate, deliberate decision — never a side effect of the
 * draft having been saved.
 *
 * One draft per (proveedor, semana, mes), SHARED rather than per-user —
 * *"la operación debe seguir sin depender de una persona"* (Wilmer, 08-06).
 * `autor` records who touched it last, not who owns it.
 *
 * RBAC: middleware `check_route_access` (route_permissions rows in the same
 * migration) + in-handler requireAuth(CAN_VIEW_COMPRAS).
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

interface DraftLinea {
  product_id: number;
  cod: string;
  desc: string;
  orden: number;
  cantidades: Record<string, number | null>;
}

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
      .from('export_plan_draft')
      .select('lineas, autor, updated_at')
      .eq('proveedor', key.proveedor)
      .eq('semana', key.semana)
      .eq('mes', key.mes)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // null is a real answer: "no hay borrador", not an error.
    return NextResponse.json({ draft: data ?? null });
  } catch (e) {
    console.error('[export/draft] GET failed:', e);
    return NextResponse.json({ error: 'Error leyendo el borrador' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
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

  const rawLineas = body.lineas;
  if (!Array.isArray(rawLineas)) return badRequest('lineas debe ser un arreglo');
  if (rawLineas.length > MAX_DRAFT_LINEAS) {
    return badRequest(`demasiadas líneas (${rawLineas.length}); el máximo es ${MAX_DRAFT_LINEAS}`);
  }

  const lineas: DraftLinea[] = [];
  for (const [i, raw] of rawLineas.entries()) {
    if (raw === null || typeof raw !== 'object') return badRequest(`línea ${i}: debe ser un objeto`);
    const l = raw as Record<string, unknown>;
    if (!isPositiveInt(l.product_id)) return badRequest(`línea ${i}: product_id inválido`);
    const cantidades = readDraftCantidades(l.cantidades);
    if (typeof cantidades === 'string') return badRequest(`línea ${i}: ${cantidades}`);
    lineas.push({
      product_id: l.product_id,
      cod: String(l.cod ?? '').slice(0, 40),
      desc: String(l.desc ?? '').slice(0, 300),
      orden: Number.isInteger(l.orden) ? (l.orden as number) : i,
      cantidades,
    });
  }

  try {
    const service = createServiceRoleClient();
    const autor = auth.displayName ? `${auth.displayName} (${auth.email})` : auth.email;
    const { error } = await service
      .from('export_plan_draft')
      .upsert(
        {
          proveedor: key.proveedor,
          semana: key.semana,
          mes: key.mes,
          lineas,
          autor,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'proveedor,semana,mes' },
      );
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, lineas: lineas.length, autor });
  } catch (e) {
    console.error('[export/draft] PUT failed:', e);
    return NextResponse.json({ error: 'Error guardando el borrador' }, { status: 500 });
  }
}
