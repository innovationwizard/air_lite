export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const supabase = createServiceRoleClient();
  const { searchParams } = new URL(request.url);
  const runId = searchParams.get('runId');

  if (runId) {
    // Get specific run with its lines
    const { data: run } = await supabase
      .from('purchase_schedule_runs')
      .select('*')
      .eq('id', runId)
      .single();

    if (!run) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }

    const { data: lines } = await supabase
      .from('purchase_schedule_lines')
      .select('*, products(name, sku, stock_uom, cost)')
      .eq('run_id', runId)
      .order('recommended_date')
      .order('supplier_name')
      .order('recommended_qty', { ascending: false });

    return NextResponse.json({ run, lines: lines || [] });
  }

  // List all completed runs
  const { data: runs } = await supabase
    .from('purchase_schedule_runs')
    .select('*')
    .eq('status', 'completed')
    .order('schedule_week_start');

  return NextResponse.json({ runs: runs || [] });
}
