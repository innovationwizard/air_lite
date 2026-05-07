import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Real purchase history from revenue_daily — no synthetic or derived data.
 *
 * Source: revenue_daily
 *   metric     = 'purchases_ordered'
 *   ssot_label = 'pol_confirmed_date_planned_product_qty_c40'
 *
 * find_15 (purchase_order_lines) and find_15b (stock_moves) both write to
 * revenue_daily with this label. smooth_oct2024 and find_16 write only to
 * revenue_daily_for_ml. So this table contains only real confirmed-PO data.
 *
 * Returns: { history: { [sku]: { [YYYY-MM]: number } } }
 *
 * Query params:
 *   ?scope=top   — the 23 demo SKUs (default)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();
    const scope = req.nextUrl.searchParams.get('scope') ?? 'top';

    // 1. Resolve in-scope SKUs
    let prodQuery = supabase
      .from('products_acid_test_active')
      .select('default_code');
    if (scope === 'top') prodQuery = prodQuery.eq('is_top_10_in_class', true);
    const { data: acidRows, error: aErr } = await prodQuery;
    if (aErr) throw aErr;

    const skus = (acidRows ?? []).map((r: { default_code: string }) => r.default_code);
    if (skus.length === 0) return NextResponse.json({ history: {} });

    // 2. SKU → product_id
    const { data: products, error: pErr } = await supabase
      .from('products')
      .select('id, sku')
      .in('sku', skus);
    if (pErr) throw pErr;

    const pidToSku = new Map((products ?? []).map((p: { id: number; sku: string }) => [p.id, p.sku]));
    const productIds = Array.from(pidToSku.keys());

    // 3. Fetch real purchase rows from revenue_daily in batches
    const PAGE = 1000;
    let offset = 0;
    const allRows: { product_id: number; observation_date: string; quantity: number }[] = [];
    while (true) {
      const { data, error } = await supabase
        .from('revenue_daily')
        .select('product_id, observation_date, quantity')
        .in('product_id', productIds)
        .eq('metric', 'purchases_ordered')
        .eq('ssot_label', 'pol_confirmed_date_planned_product_qty_c40')
        .gte('observation_date', '2024-01-01')
        .lte('observation_date', '2026-12-31')
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allRows.push(...data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }

    // 4. Aggregate: sku → YYYY-MM → sum(quantity)
    const history: Record<string, Record<string, number>> = {};
    for (const r of allRows) {
      const sku = pidToSku.get(r.product_id);
      if (!sku) continue;
      const month = String(r.observation_date).slice(0, 7);
      if (!history[sku]) history[sku] = {};
      history[sku][month] = (history[sku][month] ?? 0) + Number(r.quantity);
    }
    for (const sku of Object.keys(history)) {
      for (const m of Object.keys(history[sku])) {
        history[sku][m] = Math.round(history[sku][m]);
      }
    }

    return NextResponse.json({ history });
  } catch (error) {
    console.error('purchase-history GET error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
