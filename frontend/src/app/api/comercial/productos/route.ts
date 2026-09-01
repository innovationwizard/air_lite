import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { CAN_VIEW_FORECAST_COMERCIAL } from '@/lib/auth/roles';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/comercial/productos?q=… — buscador de códigos.
 *
 * POR QUÉ EN EL SERVIDOR Y NO MANDANDO EL CATÁLOGO ENTERO. Son ~1,670 productos
 * activos: cabrían en el navegador, pero la pantalla está pensada para que la
 * llene alguien que hoy no llena la hoja de cálculo, y una parte lo va a hacer
 * desde el teléfono. Bajar el catálogo completo en cada visita es medio megabyte
 * antes de poder teclear la primera letra.
 *
 * Busca por código Y por nombre, porque el jefe de canal piensa en «vaso 10»
 * tanto como en «77205049», y obligarlo a saber el código de memoria es
 * exactamente la fricción que dejó la hoja actual a medio llenar.
 *
 * Sólo productos activos: sugerir un código archivado es invitar a pedir algo
 * que no se va a comprar.
 */
export async function GET(request: Request) {
  const auth = await requireAuth(CAN_VIEW_FORECAST_COMERCIAL);
  if (auth instanceof Response) return auth;

  const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
  if (q.length < 2) return NextResponse.json({ productos: [] });

  // Escapar los comodines de PostgREST: sin esto, un '%' tecleado por el
  // usuario haría que la consulta devuelva el catálogo entero.
  const seguro = q.replace(/[%_,()]/g, ' ').trim();
  if (!seguro) return NextResponse.json({ productos: [] });

  const db = createServiceRoleClient();
  const { data, error } = await db
    .from('products')
    .select('id, sku, name, stock_uom')
    .eq('is_active', true)
    .or(`sku.ilike.%${seguro}%,name.ilike.%${seguro}%`)
    .order('sku')
    .limit(20);

  if (error) {
    return NextResponse.json(
      { error: 'No se pudo buscar', detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ productos: data ?? [] });
}
