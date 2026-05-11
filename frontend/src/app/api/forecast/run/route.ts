import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ML_URL = process.env.ML_SERVICE_URL!;
const ML_KEY = process.env.ML_SERVICE_API_KEY!;

/**
 * SSOT triplets — split by forecast method.
 *
 * Sales:     Prophet (dense daily data, 75–97% nonzero — ideal for additive
 *            time-series decomposition).
 * Purchases: Derived from sales forecast × historical ratio (purchase orders
 *            are business decisions with 4–17% daily density — structurally
 *            incompatible with Prophet).
 *
 * Architecture documented in ML_TRAINING_DATA_FINDINGS_2026-04-28.md.
 */
const SALES_TRIPLET = {
  label: 'aml_income_posted_invoice_refund_neg_invoice_date_c40',
  metric: 'sales',
} as const;

const PURCHASE_TRIPLETS = [
  { label: 'pol_confirmed_date_planned_product_qty_c40',          metric: 'purchases_ordered'  },
  { label: 'pol_purchase_done_date_planned_qty_received_c40',     metric: 'purchases_received' },
] as const;

/**
 * POST /api/forecast/run
 *
 * Two-pass orchestration:
 *   Pass 1 — Prophet for sales (all SKUs).  Results persisted to
 *            forecast_results so that Pass 2 can read them.
 *   Pass 2 — Derived purchase forecasts (all SKUs × 2 purchase metrics).
 *            Reads sales forecasts from forecast_results, multiplies by
 *            the per-SKU median PO/Sales ratio (Tukey outlier-excluded).
 *
 * Body (all optional):
 *   training_start  "2024-10-01"   (default)
 *   training_end    "2026-01-31"   (default)
 *   prediction_end  "2026-03-31"   (default — covers Feb + Mar 2026)
 *   scope           "top" | "all"  (default "top" = 23 demo SKUs)
 *   sku             "77201046"     (optional — single SKU)
 *   dry_run         true/false     (default false)
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

    // ── Resolve SKU list ─────────────────────────────────────────────────

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

    const { data: supaProducts, error: pErr } = await supabase
      .from('products')
      .select('id, sku')
      .in('sku', defaultCodes);
    if (pErr) throw pErr;
    const skuToPid = new Map((supaProducts ?? []).map((p) => [p.sku, p.id]));

    const results: unknown[] = [];
    let okCount = 0;
    let failCount = 0;
    const startMs = Date.now();

    // ── Pass 1: Sales via Prophet ────────────────────────────────────────

    for (const sku of defaultCodes) {
      const productId = skuToPid.get(sku);
      if (!productId) {
        results.push({ sku, metric: SALES_TRIPLET.metric, error: 'not in products table' });
        failCount += 1;
        continue;
      }

      const outcome = await runProphetForecast(
        supabase, productId, sku, SALES_TRIPLET.label, SALES_TRIPLET.metric,
        trainingStart, trainingEnd, predictionEnd, dryRun,
      );
      results.push(outcome.result);
      if (outcome.ok) okCount += 1; else failCount += 1;
    }

    // ── Pass 2: Purchases via derived ratio ──────────────────────────────

    for (const sku of defaultCodes) {
      const productId = skuToPid.get(sku);
      if (!productId) {
        for (const { metric } of PURCHASE_TRIPLETS) {
          results.push({ sku, metric, error: 'not in products table' });
          failCount += 1;
        }
        continue;
      }

      for (const { label, metric } of PURCHASE_TRIPLETS) {
        const outcome = await runDerivedForecast(
          supabase, productId, sku, label, metric,
          trainingStart, trainingEnd, predictionEnd, dryRun,
        );
        results.push(outcome.result);
        if (outcome.ok) okCount += 1; else failCount += 1;
      }
    }

    return NextResponse.json({
      summary: {
        sku_count: defaultCodes.length,
        cells_attempted: defaultCodes.length * (1 + PURCHASE_TRIPLETS.length),
        ok: okCount,
        failed: failCount,
        duration_ms: Date.now() - startMs,
        training_start: trainingStart,
        training_end: trainingEnd,
        prediction_end: predictionEnd,
        dry_run: dryRun,
        method_sales: 'prophet',
        method_purchases: 'derived_ratio',
      },
      results,
    });
  } catch (error) {
    console.error('forecast/run POST error:', error);
    return NextResponse.json(
      { error: 'Error ejecutando forecasts', details: String(error) },
      { status: 500 },
    );
  }
}


// ── Pass 1 helper: Prophet forecast (sales only) ─────────────────────────────

type CellOutcome = { ok: boolean; result: unknown };

async function runProphetForecast(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productId: number,
  sku: string,
  label: string,
  metric: string,
  trainingStart: string,
  trainingEnd: string,
  predictionEnd: string,
  dryRun: boolean,
): Promise<CellOutcome> {
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
      const errText = (await mlResp.text()).slice(0, 300);
      return {
        ok: false,
        result: { sku, metric, error: `ML HTTP ${mlResp.status}`, body: errText },
      };
    }

    const data = await mlResp.json() as {
      status: string;
      training_points?: number;
      nonzero_points?: number;
      monthly?: Array<{ month: string; yhat_sum: number; yhat_lower_sum: number; yhat_upper_sum: number }>;
    };

    if (data.status !== 'ok' || !data.monthly) {
      if (!dryRun) {
        await persistStatusRow(supabase, productId, label, metric,
          predictionEnd, trainingStart, trainingEnd, data);
      }
      return {
        ok: false,
        result: { sku, metric, status: data.status, training_points: data.training_points, nonzero_points: data.nonzero_points },
      };
    }

    if (!dryRun) {
      await persistMonthlyRows(supabase, productId, label, metric,
        trainingStart, trainingEnd, data);
    }

    return {
      ok: true,
      result: { sku, metric, status: 'ok', method: 'prophet', monthly: data.monthly },
    };
  } catch (err) {
    return { ok: false, result: { sku, metric, error: String(err) } };
  }
}


// ── Pass 2 helper: Derived purchase forecast ─────────────────────────────────

async function runDerivedForecast(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productId: number,
  sku: string,
  label: string,
  metric: string,
  trainingStart: string,
  trainingEnd: string,
  predictionEnd: string,
  dryRun: boolean,
): Promise<CellOutcome> {
  try {
    const mlResp = await fetch(`${ML_URL}/forecast/purchases-derived`, {
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
      const errText = (await mlResp.text()).slice(0, 300);
      return {
        ok: false,
        result: { sku, metric, error: `ML HTTP ${mlResp.status}`, body: errText },
      };
    }

    const data = await mlResp.json() as {
      status: string;
      training_points?: number;
      nonzero_points?: number;
      monthly?: Array<{ month: string; yhat_sum: number; yhat_lower_sum: number; yhat_upper_sum: number }>;
      ratio_detail?: {
        R: number;
        months_used: number;
        months_excluded: number;
        ratios_excluded: Array<[string, number]>;
      };
    };

    const isOk = data.status === 'ok_derived';

    if (!isOk || !data.monthly) {
      if (!dryRun) {
        await persistStatusRow(supabase, productId, label, metric,
          predictionEnd, trainingStart, trainingEnd, data);
      }
      return {
        ok: false,
        result: {
          sku, metric,
          status: data.status,
          training_points: data.training_points,
          nonzero_points: data.nonzero_points,
          ratio_detail: data.ratio_detail,
        },
      };
    }

    if (!dryRun) {
      await persistMonthlyRows(supabase, productId, label, metric,
        trainingStart, trainingEnd, data);
    }

    return {
      ok: true,
      result: {
        sku, metric,
        status: 'ok_derived',
        method: 'derived_ratio',
        R: data.ratio_detail?.R,
        months_excluded: data.ratio_detail?.months_excluded,
        monthly: data.monthly,
      },
    };
  } catch (err) {
    return { ok: false, result: { sku, metric, error: String(err) } };
  }
}


// ── Shared persistence helpers ───────────────────────────────────────────────

async function persistStatusRow(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productId: number,
  label: string,
  metric: string,
  predictionEnd: string,
  trainingStart: string,
  trainingEnd: string,
  data: { status: string; training_points?: number; nonzero_points?: number },
) {
  await supabase.from('forecast_results').upsert({
    product_id: productId,
    ssot_label: label,
    metric,
    forecast_month: `${predictionEnd.slice(0, 7)}-01`,
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

async function persistMonthlyRows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productId: number,
  label: string,
  metric: string,
  trainingStart: string,
  trainingEnd: string,
  data: {
    status: string;
    training_points?: number;
    nonzero_points?: number;
    monthly?: Array<{ month: string; yhat_sum: number; yhat_lower_sum: number; yhat_upper_sum: number }>;
  },
) {
  const rows = (data.monthly ?? []).map((m) => ({
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

  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from('forecast_results')
      .upsert(rows, { onConflict: 'product_id,ssot_label,metric,forecast_month,training_end_date' });
    if (upErr) throw upErr;
  }
}
