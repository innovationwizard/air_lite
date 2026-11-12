import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_ADMIN } from '@/lib/auth/roles';
import { PREVIEW_KEYS, aceptarRegla, esRuleKey } from '@/lib/compras/reglasConfig';
import { explicarSku } from '@/lib/compras/explicarSku';

export const dynamic = 'force-dynamic';

/**
 * POST /api/configuracion/reglas/preview
 *
 * Current vs draft for one SKU. The ML service reads Odoo once and applies
 * both rule sets in memory. Nothing is written to reabastecimiento_inputs.
 */
export async function POST(request: Request) {
  const auth = await requireAuth(CAN_VIEW_ADMIN);
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null) as {
    sku?: unknown;
    reglas?: unknown;
  } | null;
  const sku = typeof body?.sku === 'string' ? body.sku.trim() : '';
  if (!sku) return NextResponse.json({ error: 'Escriba un SKU' }, { status: 400 });
  if (!body?.reglas || typeof body.reglas !== 'object' || Array.isArray(body.reglas)) {
    return NextResponse.json({ error: 'Falta el borrador de reglas' }, { status: 400 });
  }

  const propuesto: Record<string, unknown> = {};
  for (const key of PREVIEW_KEYS) {
    if (!(key in (body.reglas as Record<string, unknown>))) continue;
    const value = (body.reglas as Record<string, unknown>)[key];
    if (!esRuleKey(key) || aceptarRegla(key, value) === null) {
      return NextResponse.json({
        error: `${key} no tiene la forma que el cálculo sabe aplicar`,
      }, { status: 400 });
    }
    propuesto[key] = value;
  }

  try {
    const explicacion = await explicarSku(sku, propuesto);
    return NextResponse.json(explicacion);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'No se pudo armar la vista previa';
    const status = /no tiene un producto/i.test(message) ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
