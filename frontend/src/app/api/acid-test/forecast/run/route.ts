import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // Vercel Pro allows 5min; this may still exceed — see note below

const ML_URL = process.env.ML_SERVICE_URL!;
const ML_KEY = process.env.ML_SERVICE_API_KEY!;

const SSOT_TRIPLET = [
  { label: 'aml_income_posted_invoice_refund_neg_invoice_date_c40', metric: 'sales' },
  { label: 'pol_confirmed_date_planned_product_qty_c40',             metric: 'purchases_ordered' },
  { label: 'pol_purchase_done_date_planned_qty_received_c40',        metric: 'purchases_received' },
];

/**
 * POST body (all optional):
 *   training_start: "2024-10-01"     (default)
 *   training_end:   "2026-01-31"     (default — last month with data)
 *   prediction_end: "2026-03-31"     (default — covers Feb + Mar 2026)
 *   scope:          "top" | "all"    (default "top" = 23 SKUs)
 *   sku:            "77201046"       (optional — single SKU)
 *   dry_run:        true/false       (default false — if true, don't persist)
 *
 * Iterates (SKUs × 3 SSOT triplets), calls the ML service per cell, UPSERTs
 * the monthly aggregates into forecast_results.
 *
 * Long-running. Vercel function limit is 5min (maxDuration). With 23 SKUs ×
 * 3 metrics × ~5s Prophet fit each = ~6 minutes typical. If we hit the
 * timeout, we'd need Railway cron or a pre-split queue — noted as a follow-up.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const trainingStart = body.training_start ?? '2024-10-01';
    const trainingEnd   = body.training_end   ?? '2026-01-31';
    const predictionEnd = body.prediction_end ?? '2026-03-31';
    const scope         = body.scope ?? 'top';
    const skuFilter     = body.sku ?? null;
    const dryRun        = Boolean(body.dry_run);

    const supabase = createServiceRoleClient();

    // 1. Build the SKU list from products_acid_test_active
    let skuQuery = supabase
      .from('products_acid_test_active')
      .select('default_code, representative_name, supplier_class, movement_rank_within_class, is_top_10_in_class');
    if (scope === 'top') skuQuery = skuQuery.eq('is_top_10_in_class', true);
    if (skuFilter) skuQuery = skuQuery.eq('default_code', skuFilter);
    const { data: activeSkus, error: skuErr } = await skuQuery;
    if (skuErr) throw skuErr;

    const defaultCodes = (activeSkus ?? []).map((s) => s.default_code);
    if (defaultCodes.length === 0) {
      return NextResponse.json({ error: 'No SKUs in scope' }, { status: 400 });
    }

    // 2. Resolve products.id for each default_code
    const { data: supaProducts, error: pErr } = await supabase
      .from('products')
      .select('id, sku')
      .in('sku', defaultCodes);
    if (pErr) throw pErr;
    const skuToPid = new Map((supaProducts ?? []).map((p) => [p.sku, p.id]));

    // 3. Orchestrate: one ML call per (product × ssot) triplet. Sequential to
    //    avoid hammering the ML service.
    const results: unknown[] = [];
    let okCount = 0;
    let failCount = 0;
    const startMs = Date.now();

    for (const sku of defaultCodes) {
      const productId = skuToPid.get(sku);
      if (!productId) {
        results.push({ sku, error: 'not in products table' });
        failCount += 1;
        continue;
      }

      for (const { label, metric } of SSOT_TRIPLET) {
        try {
          const mlResp = await fetch(`${ML_URL}/forecast/revenue-daily`, {
            method: 'POST',
            headers: {
              'X-API-Key': ML_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              product_id: productId,
              ssot_label: label,
              metric,
              training_start: trainingStart,
              training_end: trainingEnd,
              prediction_end: predictionEnd,
            }),
          });
          if (!mlResp.ok) {
            results.push({ sku, metric, error: `ML HTTP ${mlResp.status}`, body: (await mlResp.text()).slice(0, 300) });
            failCount += 1;
            continue;
          }
          const data = await mlResp.json() as {
            status: string;
            training_points?: number;
            nonzero_points?: number;
            monthly?: Array<{ month: string; yhat_sum: number; yhat_lower_sum: number; yhat_upper_sum: number }>;
          };

          if (data.status !== 'ok' || !data.monthly) {
            results.push({ sku, metric, status: data.status, training_points: data.training_points, nonzero_points: data.nonzero_points });
            failCount += 1;
            // Still persist a status row so UI can show "insufficient history"
            if (!dryRun) {
              await supabase.from('forecast_results').upsert({
                product_id: productId,
                ssot_label: label,
                metric,
                forecast_month: `${predictionEnd.slice(0, 7)}-01`,  // placeholder month
                training_start_date: trainingStart,
                training_end_date: trainingEnd,
                yhat_sum: 0,
                yhat_lower_sum: null,
                yhat_upper_sum: null,
                training_points: data.training_points ?? null,
                nonzero_points: data.nonzero_points ?? null,
                model_status: data.status,
              }, { onConflict: 'product_id,ssot_label,metric,forecast_month,training_end_date' });
            }
            continue;
          }

          // Persist each monthly prediction as its own row
          const rows = data.monthly.map((m) => ({
            product_id: productId,
            ssot_label: label,
            metric,
            forecast_month: `${m.month}-01`,
            training_start_date: trainingStart,
            training_end_date: trainingEnd,
            yhat_sum: Number(m.yhat_sum.toFixed(4)),
            yhat_lower_sum: Number(m.yhat_lower_sum.toFixed(4)),
            yhat_upper_sum: Number(m.yhat_upper_sum.toFixed(4)),
            training_points: data.training_points ?? null,
            nonzero_points: data.nonzero_points ?? null,
            model_status: data.status,
          }));
          if (!dryRun) {
            const { error: upErr } = await supabase
              .from('forecast_results')
              .upsert(rows, { onConflict: 'product_id,ssot_label,metric,forecast_month,training_end_date' });
            if (upErr) throw upErr;
          }
          okCount += 1;
          results.push({ sku, metric, status: 'ok', monthly: data.monthly });
        } catch (err) {
          results.push({ sku, metric, error: String(err) });
          failCount += 1;
        }
      }
    }

    return NextResponse.json({
      summary: {
        sku_count: defaultCodes.length,
        cells_attempted: defaultCodes.length * SSOT_TRIPLET.length,
        ok: okCount,
        failed: failCount,
        duration_ms: Date.now() - startMs,
        training_start: trainingStart,
        training_end: trainingEnd,
        prediction_end: predictionEnd,
        dry_run: dryRun,
      },
      results,
    });
  } catch (error) {
    console.error('acid-test/forecast/run POST error:', error);
    return NextResponse.json(
      { error: 'Error ejecutando forecasts', details: String(error) },
      { status: 500 },
    );
  }
}
