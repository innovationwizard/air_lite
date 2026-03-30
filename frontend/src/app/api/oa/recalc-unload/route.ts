import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('rpc_oa_recalc_unload_times');

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('OA recalc unload error:', error);
    return NextResponse.json(
      { error: 'Error al recalcular tiempos de descarga' },
      { status: 500 },
    );
  }
}
