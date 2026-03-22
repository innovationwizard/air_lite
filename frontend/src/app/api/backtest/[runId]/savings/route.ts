import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: { runId: string } },
) {
  try {
    const supabase = createServiceRoleClient();
    const runId = parseInt(params.runId, 10);

    const { data, error } = await supabase
      .from('backtest_savings')
      .select('*')
      .eq('run_id', runId)
      .single();

    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: 'No se encontraron resultados para este ciclo' },
        { status: 404 },
      );
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('Savings fetch error:', error);
    return NextResponse.json(
      { error: 'Error al obtener los ahorros' },
      { status: 500 },
    );
  }
}
