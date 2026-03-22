import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('rpc_slow_moving_items');

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Slow moving items error:', error);
    return NextResponse.json(
      { error: 'Error al obtener inventario de movimiento lento' },
      { status: 500 },
    );
  }
}
