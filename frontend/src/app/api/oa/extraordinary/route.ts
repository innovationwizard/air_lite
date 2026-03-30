import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const supplierIdParam = searchParams.get('supplier_id');

    const p_supplier_ids = supplierIdParam
      ? supplierIdParam.split(',').map(Number)
      : null;

    const { data, error } = await supabase.rpc('rpc_oa_detect_extraordinary', {
      p_supplier_ids,
    });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('OA extraordinary error:', error);
    return NextResponse.json(
      { error: 'Error al detectar pedidos extraordinarios' },
      { status: 500 },
    );
  }
}
