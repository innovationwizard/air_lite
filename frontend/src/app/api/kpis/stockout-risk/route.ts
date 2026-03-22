import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase.rpc('rpc_stockout_risks');

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Stockout risks error:', error);
    return NextResponse.json(
      { error: 'Error al obtener riesgos de desabastecimiento' },
      { status: 500 },
    );
  }
}
