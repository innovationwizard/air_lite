import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_REABASTECIMIENTO } from '@/lib/auth/roles';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  COLUMNAS_VIVAS, FALLBACK, RULE_KEYS, aceptarRegla, resumenColumna,
  type ColumnaPorque, type RuleKey,
} from '@/lib/compras/reglasConfig';
import { explicarSku } from '@/lib/compras/explicarSku';

export const dynamic = 'force-dynamic';

const COLUMNAS = new Set<ColumnaPorque>([
  'exist', 'patio', 'trans', 'pend',
  'doh', 'sug', 'abc', 'tend', 'mes', 'p6', 'p3', 'adic', 'pide',
]);

/**
 * GET /api/compras/reabastecimiento/porque?columna=&bodega=&sku=
 *
 * Plain-language rule from config_rules (missing or unusable row → the seed
 * constant). Existencias, patio, tránsito and pendiente also return the live
 * Odoo lines. The other columns return the rule and its numbers; the drawer
 * attaches the figure already on the row. This route does not recompute it.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_REABASTECIMIENTO);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const columna = url.searchParams.get('columna') ?? '';
  const bodega = url.searchParams.get('bodega') ?? '';
  const sku = (url.searchParams.get('sku') ?? '').trim();
  if (!COLUMNAS.has(columna as ColumnaPorque)) {
    return NextResponse.json({ error: 'columna desconocida' }, { status: 400 });
  }
  if (!bodega) return NextResponse.json({ error: 'bodega es obligatoria' }, { status: 400 });

  const db = await createServerSupabaseClient();
  const { data, error: lectura } = await db.from('config_rules').select('key, value');
  const reglas: Partial<Record<RuleKey, unknown>> = {};
  if (!lectura) {
    for (const row of data ?? []) {
      const key = (row as { key?: string }).key;
      if (key && (RULE_KEYS as readonly string[]).includes(key)) {
        reglas[key as RuleKey] = (row as { value: unknown }).value;
      }
    }
  }
  for (const key of RULE_KEYS) {
    if (aceptarRegla(key, reglas[key]) === null) reglas[key] = FALLBACK[key];
  }

  const respuesta: {
    columna: ColumnaPorque;
    bodega: string;
    sku: string | null;
    resumen: string;
    parametros: Record<string, number> | null;
    vivo: unknown;
    error: string | null;
  } = {
    columna: columna as ColumnaPorque,
    bodega,
    sku: sku || null,
    resumen: resumenColumna(columna as ColumnaPorque, reglas),
    parametros: parametrosColumna(columna as ColumnaPorque, reglas),
    vivo: null,
    error: null,
  };

  // Existencias, patio, tránsito and pendiente keep the live Odoo breakdown.
  // The other columns explain the figure already on the row.
  if (!sku || !COLUMNAS_VIVAS.includes(columna as ColumnaPorque)) {
    return NextResponse.json(respuesta);
  }

  try {
    const explicacion = await explicarSku(sku);
    respuesta.vivo = explicacion.bodegas.find((b) => b.bodega === bodega)?.actual ?? null;
    if (!respuesta.vivo) {
      respuesta.error = `${bodega} no está en el alcance de bodega_map`;
    }
  } catch (e) {
    respuesta.error = e instanceof Error ? e.message : 'No se pudo leer el detalle en Odoo';
  }
  return NextResponse.json(respuesta);
}

/** Numbers from the accepted rule, so the drawer can name the inputs. Null for columns with no factor. */
function parametrosColumna(
  columna: ColumnaPorque,
  reglas: Partial<Record<RuleKey, unknown>>,
): Record<string, number> | null {
  const regla = (key: RuleKey) => (aceptarRegla(key, reglas[key]) ?? FALLBACK[key]) as Record<string, number>;
  if (columna === 'doh') {
    return { ...regla('doh.bands'), weekdays: regla('engine.factors').weekdays };
  }
  if (columna === 'sug') return { ...regla('engine.factors'), ...regla('cobertura.defaults') };
  if (columna === 'abc') return regla('abc.cutoffs');
  if (columna === 'tend' || columna === 'mes') return regla('trend.thresholds');
  return null;
}
