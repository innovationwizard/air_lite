import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    // Get row counts for key tables
    const tables = [
      'products', 'customers', 'suppliers', 'sale_orders',
      'sale_order_lines', 'purchase_orders', 'purchase_order_lines',
      'stock_moves', 'inventory_daily', 'demand_daily',
      'backtest_runs', 'backtest_results',
    ];

    const counts: Record<string, number> = {};
    for (const table of tables) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      counts[table] = error ? 0 : (count ?? 0);
    }

    // Get date ranges
    const { data: demandRange } = await supabase
      .from('demand_daily')
      .select('demand_date')
      .order('demand_date', { ascending: true })
      .limit(1)
      .single();

    const { data: demandRangeEnd } = await supabase
      .from('demand_daily')
      .select('demand_date')
      .order('demand_date', { ascending: false })
      .limit(1)
      .single();

    return NextResponse.json({
      table_counts: counts,
      date_range: {
        start: demandRange?.demand_date ?? null,
        end: demandRangeEnd?.demand_date ?? null,
      },
    });
  } catch (error) {
    console.error('Data status error:', error);
    return NextResponse.json(
      { error: 'Error al obtener estado de datos' },
      { status: 500 },
    );
  }
}
