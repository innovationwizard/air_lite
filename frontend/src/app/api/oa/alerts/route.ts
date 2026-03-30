import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('rpc_oa_alerts_summary');

    if (error) throw error;

    const result = data?.[0] ?? {
      hot_count: 0,
      hold_count: 0,
      hold_export_count: 0,
      reception_saturated: false,
      reception_trucks_today: 0,
      warehouse_alerts: [],
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error('OA alerts summary error:', error);
    return NextResponse.json(
      { error: 'Error al obtener resumen de alertas' },
      { status: 500 },
    );
  }
}
