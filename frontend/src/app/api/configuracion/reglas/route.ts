import { NextResponse } from 'next/server';
import { requireAuth, type AuthUser } from '@/lib/auth/server';
import { CAN_MANAGE_REGLAS } from '@/lib/auth/roles';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  FALLBACK, RULE_KEYS, aceptarRegla, esRuleKey, resumenRegla, type RuleKey,
} from '@/lib/compras/reglasConfig';

export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/configuracion/reglas
 *
 * Read and write of the calculation rules for admin, compras, and superuser.
 * PUT updates one key, or restores a row from config_rules_history.
 * The history trigger records the new value, including a restore. A shape
 * the sync would ignore is rejected, so a save cannot look applied while
 * the calculation keeps the previous constant.
 *
 * History stays on this path (`?historial=<key>`) so the roles that already
 * have GET and PUT can read it and restore it. No other role is added.
 */

export async function GET(request: Request) {
  const auth = await requireAuth(CAN_MANAGE_REGLAS);
  if (auth instanceof Response) return auth;

  const historial = new URL(request.url).searchParams.get('historial');
  if (historial !== null) return leerHistorial(historial);

  const db = await createServerSupabaseClient();
  const { data, error } = await db.from('config_rules').select('key, value, updated_at, updated_by');
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const porClave = new Map((data ?? []).map((r: { key: string }) => [r.key, r]));
  const reglas = RULE_KEYS.map((key) => {
    const row = porClave.get(key) as { value: unknown; updated_at: string | null; updated_by: string | null } | undefined;
    if (!row) {
      return {
        key, value: FALLBACK[key], origen: 'constante' as const,
        resumen: resumenRegla(key, FALLBACK[key]), updatedAt: null, updatedBy: null,
      };
    }
    if (aceptarRegla(key, row.value) === null) {
      return {
        key, value: row.value, origen: 'ignorado' as const,
        resumen: `El valor guardado no tiene la forma que el cálculo aplica, así que sigue vigente la regla anterior. ${resumenRegla(key, FALLBACK[key])}`,
        updatedAt: row.updated_at, updatedBy: row.updated_by,
      };
    }
    return {
      key, value: row.value, origen: 'tabla' as const,
      resumen: resumenRegla(key, row.value),
      updatedAt: row.updated_at, updatedBy: row.updated_by,
    };
  });
  return NextResponse.json({ reglas });
}

export async function PUT(request: Request) {
  const auth = await requireAuth(CAN_MANAGE_REGLAS);
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null) as {
    key?: unknown; value?: unknown; historyId?: unknown;
  } | null;
  if (body && 'historyId' in body) return restaurar(auth, body.historyId);

  const key = typeof body?.key === 'string' ? body.key : '';
  if (!esRuleKey(key)) {
    return NextResponse.json({ error: 'Regla desconocida' }, { status: 400 });
  }
  const accepted = aceptarRegla(key, body?.value);
  if (accepted === null) {
    return NextResponse.json({
      error: 'Esa forma no la aplica el cálculo. La regla anterior seguiría vigente, así que no se guardó.',
    }, { status: 400 });
  }
  return escribirRegla(auth, key, accepted);
}

/** Newest first. The session client reads; RLS already allows any signed-in profile. */
async function leerHistorial(key: string) {
  if (!esRuleKey(key)) {
    return NextResponse.json({ error: 'Regla desconocida' }, { status: 400 });
  }
  const db = await createServerSupabaseClient();
  const { data, error } = await db
    .from('config_rules_history')
    .select('id, value, changed_at, changed_by')
    .eq('key', key)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const historial = (data ?? []).map((row: {
    id: number | string;
    value: unknown;
    changed_at: string | null;
    changed_by: string | null;
  }) => ({
    id: row.id,
    value: row.value,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    resumen: aceptarRegla(key, row.value) === null ? null : resumenRegla(key, row.value),
  }));
  return NextResponse.json({ key, historial });
}

/**
 * Write the historical value back through the same upsert as a normal save.
 * The AFTER UPDATE trigger appends the restore; this function does not insert
 * into config_rules_history itself.
 */
async function restaurar(auth: AuthUser, historyId: unknown) {
  const id = idHistorial(historyId);
  if (id === null) {
    return NextResponse.json({ error: 'Historial desconocido' }, { status: 400 });
  }
  const db = await createServerSupabaseClient();
  const { data, error } = await db
    .from('config_rules_history')
    .select('key, value')
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({ error: 'Esa fila de historial no existe' }, { status: 404 });
  }
  const key = typeof data.key === 'string' ? data.key : '';
  if (!esRuleKey(key)) {
    return NextResponse.json({ error: 'Regla desconocida' }, { status: 400 });
  }
  const accepted = aceptarRegla(key, data.value);
  if (accepted === null) {
    return NextResponse.json({
      error: 'Esa forma no la aplica el cálculo. La regla anterior seguiría vigente, así que no se restauró.',
    }, { status: 400 });
  }
  return escribirRegla(auth, key, accepted);
}

async function escribirRegla(auth: AuthUser, key: RuleKey, accepted: unknown) {
  const db = createServiceRoleClient();
  const { error } = await db.from('config_rules').upsert({
    key,
    value: accepted,
    updated_at: new Date().toISOString(),
    updated_by: auth.email || auth.id,
  }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({
    key,
    value: accepted,
    origen: 'tabla' as const,
    resumen: resumenRegla(key, accepted),
  });
}

function idHistorial(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  return null;
}
