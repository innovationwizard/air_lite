import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { searchParams } = new URL(request.url);
    const openOrderId = searchParams.get('open_order_id');

    if (!openOrderId) {
      return NextResponse.json(
        { error: 'El parámetro open_order_id es requerido' },
        { status: 400 },
      );
    }

    const p_open_order_id = Number(openOrderId);

    const [weeklyResult, globalResult] = await Promise.all([
      supabase.rpc('rpc_oa_compliance', { p_open_order_id }),
      supabase.rpc('rpc_oa_global_compliance', { p_open_order_id }),
    ]);

    if (weeklyResult.error) throw weeklyResult.error;
    if (globalResult.error) throw globalResult.error;

    return NextResponse.json({
      weekly: weeklyResult.data,
      global: globalResult.data,
    });
  } catch (error) {
    console.error('OA compliance error:', error);
    return NextResponse.json(
      { error: 'Error al obtener cumplimiento de OA' },
      { status: 500 },
    );
  }
}
