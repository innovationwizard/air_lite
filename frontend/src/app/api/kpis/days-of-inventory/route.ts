import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 1000;
const MAX_PAGES = 20; // 20k rows ceiling; current RPC returns ~2.7k.

export async function GET() {
  try {
    const supabase = createServiceRoleClient();

    // PostgREST caps per-response rows at the project's max_rows (1000 here),
    // so page the RPC until it drains.
    const rows: unknown[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .rpc('rpc_days_of_inventory')
        .range(from, to);

      if (error) throw error;
      if (!data || data.length === 0) break;

      rows.push(...data);
      if (data.length < PAGE_SIZE) break;
    }

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Days of inventory error:', error);
    return NextResponse.json(
      { error: 'Error al obtener días de inventario' },
      { status: 500 },
    );
  }
}
