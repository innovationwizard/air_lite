import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get('date');
    const p_date = dateParam || new Date().toISOString().split('T')[0];

    const warehouseParam = searchParams.get('warehouse_id');
    const p_warehouse_id = warehouseParam ? Number(warehouseParam) : null;

    const { data, error } = await supabase.rpc('rpc_oa_reception_saturation', {
      p_date,
      p_warehouse_id,
    });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('OA reception error:', error);
    return NextResponse.json(
      { error: 'Error al obtener saturación de recepción' },
      { status: 500 },
    );
  }
}
