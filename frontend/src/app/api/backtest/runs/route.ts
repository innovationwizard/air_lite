import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    const { data, error } = await supabase
      .from('backtest_runs')
      .select(`
        id,
        training_start_date,
        training_end_date,
        prediction_month,
        status,
        products_modeled,
        training_duration_ms,
        created_at
      `)
      .eq('status', 'completed')
      .order('prediction_month', { ascending: true });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('List runs error:', error);
    return NextResponse.json({ error: 'Error al obtener los ciclos' }, { status: 500 });
  }
}
