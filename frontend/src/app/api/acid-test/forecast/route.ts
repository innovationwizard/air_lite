import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Read the latest forecast_results. Filters:
 *   ?scope=top|all       (default 'top' — top 23 SKUs)
 *   ?forecast_month=YYYY-MM-DD (optional, else returns all months present)
 *   ?training_end=YYYY-MM-DD  (optional, else returns the latest snapshot per cell)
 *   ?sku=<default_code>  (optional)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();
    const scope = req.nextUrl.searchParams.get('scope') ?? 'top';
    const forecastMonth = req.nextUrl.searchParams.get('forecast_month');
    const trainingEnd = req.nextUrl.searchParams.get('training_end');
    const sku = req.nextUrl.searchParams.get('sku');

    // Build list of in-scope products
    let prodQuery = supabase
      .from('products_acid_test_active')
      .select('default_code, representative_name, supplier_class, source_indicator, movement_rank_within_class, is_top_10_in_class');
    if (scope === 'top') prodQuery = prodQuery.eq('is_top_10_in_class', true);
    if (sku) prodQuery = prodQuery.eq('default_code', sku);
    const { data: products, error: pErr } = await prodQuery;
    if (pErr) throw pErr;

    const skuSet = new Set((products ?? []).map((p) => p.default_code));
    if (skuSet.size === 0) return NextResponse.json({ forecasts: [] });

    // Resolve product.id for those SKUs
    const { data: supaProducts, error: spErr } = await supabase
      .from('products')
      .select('id, sku, stock_uom')
      .in('sku', Array.from(skuSet));
    if (spErr) throw spErr;
    const productIdToSku = new Map((supaProducts ?? []).map((p) => [p.id, p.sku]));
    const skuToUom = new Map((supaProducts ?? []).map((p) => [p.sku, p.stock_uom]));
    const productIds = Array.from(productIdToSku.keys());

    // Query forecast_results
    let fq = supabase
      .from('forecast_results')
      .select('*')
      .in('product_id', productIds);
    if (forecastMonth) fq = fq.eq('forecast_month', forecastMonth);
    if (trainingEnd) fq = fq.eq('training_end_date', trainingEnd);
    const { data: forecasts, error: fErr } = await fq;
    if (fErr) throw fErr;

    // If training_end not specified, keep only latest per (product, ssot, metric, month)
    let finalRows = forecasts ?? [];
    if (!trainingEnd) {
      const latest = new Map<string, typeof finalRows[number]>();
      for (const r of finalRows) {
        const key = `${r.product_id}|${r.ssot_label}|${r.metric}|${r.forecast_month}`;
        const prior = latest.get(key);
        if (!prior || new Date(r.training_end_date) > new Date(prior.training_end_date)) {
          latest.set(key, r);
        }
      }
      finalRows = Array.from(latest.values());
    }

    // Attach SKU meta for convenience
    const skuMeta = new Map((products ?? []).map((p) => [p.default_code, p]));
    const enriched = finalRows.map((r) => ({
      ...r,
      sku: productIdToSku.get(r.product_id) ?? null,
      product_name: skuMeta.get(productIdToSku.get(r.product_id) ?? '')?.representative_name ?? null,
      supplier_class: skuMeta.get(productIdToSku.get(r.product_id) ?? '')?.supplier_class ?? null,
      movement_rank_within_class: skuMeta.get(productIdToSku.get(r.product_id) ?? '')?.movement_rank_within_class ?? null,
      stock_uom: skuToUom.get(productIdToSku.get(r.product_id) ?? '') ?? null,
    }));

    return NextResponse.json({
      forecasts: enriched,
      scope,
      sku_count: skuSet.size,
    });
  } catch (error) {
    console.error('acid-test/forecast GET error:', error);
    return NextResponse.json(
      { error: 'Error al leer forecasts', details: String(error) },
      { status: 500 },
    );
  }
}
