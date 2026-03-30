import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const warehouseParam = searchParams.get('warehouse_id');
    const p_warehouse_id = warehouseParam ? Number(warehouseParam) : null;

    const { data, error } = await supabase.rpc('rpc_oa_warehouse_space', {
      p_warehouse_id,
    });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('OA warehouse space error:', error);
    return NextResponse.json(
      { error: 'Error al obtener espacio de bodega' },
      { status: 500 },
    );
  }
}
