import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase.rpc('rpc_stockout_risks_by_warehouse');

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Stockout risks by warehouse error:', error);
    return NextResponse.json(
      { error: 'Error al obtener riesgos de desabastecimiento por bodega' },
      { status: 500 },
    );
  }
}
