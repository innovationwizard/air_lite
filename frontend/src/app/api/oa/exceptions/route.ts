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

    const warehouseParam = searchParams.get('warehouse_id');
    const p_warehouse_id = warehouseParam ? Number(warehouseParam) : null;

    const [hotResult, holdResult] = await Promise.all([
      supabase.rpc('rpc_oa_hot_list', { p_supplier_ids, p_warehouse_id }),
      supabase.rpc('rpc_oa_hold_list', { p_supplier_ids, p_warehouse_id }),
    ]);

    if (hotResult.error) throw hotResult.error;
    if (holdResult.error) throw holdResult.error;

    return NextResponse.json({
      hot: hotResult.data,
      hold: holdResult.data,
    });
  } catch (error) {
    console.error('OA exceptions error:', error);
    return NextResponse.json(
      { error: 'Error al obtener excepciones de OA' },
      { status: 500 },
    );
  }
}
