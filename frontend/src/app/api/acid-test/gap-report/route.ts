import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

/**
 * Backs /gerencia/gap-report. Two endpoints multiplexed via ?action=:
 *   GET ?action=skus           → list of SKUs in scope
 *   GET ?action=report&...     → pivoted (SKU × month) gap-report data
 *
 * Filters for action=report:
 *   sku=<default_code>          (optional, exact match)
 *   from=YYYY-MM                (default '2024-09')
 *   to=YYYY-MM                  (default null = latest)
 *   scope=top|all               (default 'top' — 23 SKUs flagged in_top_10)
 *   class=REYMA|CARVAJAL|BOTH   (optional)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();
    const action = req.nextUrl.searchParams.get('action') ?? 'report';
    const scope = req.nextUrl.searchParams.get('scope') ?? 'top';

    if (action === 'skus') {
      const { data, error } = await supabase.rpc('rpc_acid_gap_report_skus', { p_scope: scope });
      if (error) throw error;
      return NextResponse.json({ skus: data ?? [] });
    }

    if (action === 'report') {
      const sku = req.nextUrl.searchParams.get('sku');
      const from = req.nextUrl.searchParams.get('from') ?? '2024-09';
      const to = req.nextUrl.searchParams.get('to');
      const supplierClass = req.nextUrl.searchParams.get('class');

      const args: Record<string, string | null> = {
        p_sku_filter: sku || null,
        p_from_month: from,
        p_to_month: to,
        p_scope: scope,
        p_supplier_class: supplierClass || null,
      };

      const rows: unknown[] = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        const start = page * PAGE_SIZE;
        const end = start + PAGE_SIZE - 1;
        const { data, error } = await supabase
          .rpc('rpc_acid_gap_report', args)
          .range(start, end);

        if (error) throw error;
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
      }

      return NextResponse.json({ rows });
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (error) {
    console.error('acid-test/gap-report error:', error);
    return NextResponse.json(
      { error: 'Error al obtener el reporte de gap', details: String(error) },
      { status: 500 },
    );
  }
}
