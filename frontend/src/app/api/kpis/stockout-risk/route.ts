import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const [stockout, abcxyz] = await Promise.all([
      supabase.rpc('rpc_stockout_risks'),
      supabase.rpc('rpc_abc_xyz_classification'),
    ]);

    if (stockout.error) throw stockout.error;

    const classMap = new Map<number, { abc_class: string | null; xyz_class: string | null }>();
    for (const row of (abcxyz.data ?? [])) {
      classMap.set(row.product_id, {
        abc_class: row.abc_class ?? null,
        xyz_class: row.xyz_class ?? null,
      });
    }

    const enriched = (stockout.data ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      ...(classMap.get(r.product_id as number) ?? { abc_class: null, xyz_class: null }),
    }));

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Stockout risks error:', error);
    return NextResponse.json(
      { error: 'Error al obtener riesgos de desabastecimiento' },
      { status: 500 },
    );
  }
}
