import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_MANAGE_REGLAS } from '@/lib/auth/roles';
import { createServerSupabaseClient, createServiceRoleClient } from '@/lib/supabase/server';
import {
  FALLBACK, RULE_KEYS, aceptarRegla, esRuleKey, resumenRegla, type RuleKey,
} from '@/lib/compras/reglasConfig';

export const dynamic = 'force-dynamic';

/**
 * GET/PUT /api/configuracion/reglas
 *
 * Read and write of the calculation rules for admin and compras. PUT updates one key.
 * The history trigger records the new value. A shape the sync would ignore
 * is rejected, so a save cannot look applied while the calculation keeps
 * the previous constant.
 */

export async function GET() {
  const auth = await requireAuth(CAN_MANAGE_REGLAS);
  if (auth instanceof Response) return auth;

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

  const body = await request.json().catch(() => null) as { key?: unknown; value?: unknown } | null;
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

  const db = createServiceRoleClient();
  const { error } = await db.from('config_rules').upsert({
    key,
    value: accepted,
    updated_at: new Date().toISOString(),
    updated_by: auth.email || auth.id,
  }, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    key: key as RuleKey,
    value: accepted,
    origen: 'tabla',
    resumen: resumenRegla(key, accepted),
  });
}
