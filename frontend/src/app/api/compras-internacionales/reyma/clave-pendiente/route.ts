import { NextResponse } from 'next/server';
import { withReadAuth } from '../lib';

export const dynamic = 'force-dynamic';

/**
 * GET /api/compras-internacionales/reyma/clave-pendiente — A12b, la cola de
 * /compras-internacionales/facturas/pendientes.
 *
 * Agrupa por CLAVE (no por línea): la misma clave nueva de REYMA suele
 * repetirse en varios furgones de la misma semana antes de que alguien la
 * resuelva, y resolverla una vez aplica TODAS sus líneas retenidas de un
 * tirón (ver /clave-pendiente/resolver). Alexis no necesita ver 6 líneas
 * idénticas — necesita ver 1 clave con "6 líneas esperando".
 */
export async function GET() {
  const auth = await withReadAuth();
  if (auth instanceof Response) return auth;

  const { createServiceRoleClient } = await import('@/lib/supabase/server');
  const service = createServiceRoleClient();

  const { data, error } = await service
    .from('reyma_factura_pendiente')
    .select('clave, descripcion, guia, factura, folio_fiscal, unidad, cantidad_cfdi, created_at')
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true });
  if (error) {
    console.error('[reyma/clave-pendiente] GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  interface Grupo {
    clave: string; descripcion: string; primeraVez: string;
    facturas: Set<string>; guias: Set<string>; lineas: number; cantidad: number; unidad: string;
  }
  const porClave = new Map<string, Grupo>();
  for (const r of data ?? []) {
    let g = porClave.get(r.clave);
    if (!g) {
      g = {
        clave: r.clave, descripcion: r.descripcion, primeraVez: r.created_at,
        facturas: new Set(), guias: new Set(), lineas: 0, cantidad: 0, unidad: r.unidad,
      };
      porClave.set(r.clave, g);
    }
    g.facturas.add(r.factura);
    g.guias.add(r.guia);
    g.lineas += 1;
    g.cantidad += Number(r.cantidad_cfdi ?? 0);
  }

  const pendientes = [...porClave.values()]
    .map((g) => ({
      clave: g.clave,
      descripcion: g.descripcion,
      primeraVez: g.primeraVez,
      facturas: g.facturas.size,
      guias: [...g.guias].sort(),
      lineas: g.lineas,
      cantidad: g.cantidad,
      unidad: g.unidad,
    }))
    .sort((a, b) => a.primeraVez.localeCompare(b.primeraVez));

  return NextResponse.json({ pendientes, total: pendientes.length });
}
