import { NextRequest, NextResponse } from 'next/server';
import { createServiceRoleClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Backs /superuser/forecast-diagnostic.
 *
 * Read-only aggregation of revenue_daily (history) + forecast_results (Feb/Mar
 * 2026 predictions) for the 23-SKU forecast scope. Designed against the §3
 * UoM standardization policy in docs/april_jumpstart/_FORECAST_DEEP_DIVE_APR24.md:
 *
 *   - Single SKU and same-UoM groups: absolute-quantity sums are allowed.
 *   - Cross-UoM aggregation: forbidden. The page consumes per-UoM groups.
 *
 * Optional query params:
 *   ?class=REYMA|CARVAJAL    (default: all 23 SKUs)
 *
 * Auth: gated by middleware via route_permissions (/api/superuser/* → superuser
 * only). This handler trusts that gate; it uses service-role to read the
 * underlying tables (revenue_daily, forecast_results, products,
 * products_acid_test_active) which are otherwise RLS-restricted.
 */

interface ScopeRow {
  default_code: string;
  representative_name: string;
  supplier_class: string;
  movement_rank_within_class: number;
  net_sales_quantity: number;
  product_template_id: number;
}

interface ProductRow {
  id: number;
  sku: string;
  name: string;
  stock_uom: string | null;
  is_active: boolean;
}

interface RevenueDailyRow {
  product_id: number;
  metric: 'sales' | 'purchases_ordered' | 'purchases_received' | 'demand';
  observation_date: string;
  quantity: number;
  revenue_gtq: number | null;
}

interface ForecastResultRow {
  product_id: number;
  metric: 'sales' | 'purchases_ordered' | 'purchases_received' | 'demand';
  forecast_month: string;
  training_end_date: string;
  yhat_sum: number;
  yhat_lower_sum: number | null;
  yhat_upper_sum: number | null;
  model_status: string;
}

const METRICS = ['sales', 'purchases_ordered', 'purchases_received', 'demand'] as const;
type Metric = typeof METRICS[number];

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

/**
 * Stable paginated reads — paging always orders by `id` ASC so offset paging
 * is deterministic (see step0_audit lessons-learned: offset pagination without
 * ORDER BY can silently drop rows on PostgREST).
 *
 * Two thin per-table helpers below; we deliberately don't try to abstract a
 * single generic paginator because Supabase's typed query builder narrows the
 * return type at each `.select()` / `.in()` step and a single `<T>` helper
 * fights the type system more than it helps. Two ~20-line functions read
 * cleaner than one over-generic one.
 */
async function readRevenueDaily(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productIds: number[],
): Promise<RevenueDailyRow[]> {
  const rows: RevenueDailyRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('revenue_daily')
      .select('product_id,metric,observation_date,quantity,revenue_gtq')
      .in('product_id', productIds)
      .order('id', { ascending: true })
      .range(start, end);
    if (error) throw error;
    const batch = (data ?? []) as unknown as RevenueDailyRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

async function readForecastResults(
  supabase: ReturnType<typeof createServiceRoleClient>,
  productIds: number[],
): Promise<ForecastResultRow[]> {
  const rows: ForecastResultRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const end = start + PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from('forecast_results')
      .select(
        'product_id,metric,forecast_month,training_end_date,yhat_sum,yhat_lower_sum,yhat_upper_sum,model_status',
      )
      .in('product_id', productIds)
      .order('id', { ascending: true })
      .range(start, end);
    if (error) throw error;
    const batch = (data ?? []) as unknown as ForecastResultRow[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceRoleClient();
    const classParam = req.nextUrl.searchParams.get('class');
    const supplierClass =
      classParam === 'REYMA' || classParam === 'CARVAJAL' ? classParam : null;

    // 1. Scope — 23 forecast SKUs (optionally class-filtered).
    const scopeRows: ScopeRow[] = (
      await (() => {
        let q = supabase
          .from('products_acid_test_active')
          .select(
            'default_code,representative_name,supplier_class,' +
              'movement_rank_within_class,net_sales_quantity,product_template_id',
          )
          .eq('is_top_10_in_class', true);
        if (supplierClass) q = q.eq('supplier_class', supplierClass);
        return q;
      })()
    ).data as ScopeRow[] | null ?? [];

    if (scopeRows.length === 0) {
      return NextResponse.json(
        { error: 'No SKUs en alcance para los filtros seleccionados.' },
        { status: 404 },
      );
    }

    const skus = scopeRows.map((r) => r.default_code).filter((s): s is string => Boolean(s));

    // 2. Resolve products (id, stock_uom) for those default_codes.
    const { data: prodData, error: prodErr } = await supabase
      .from('products')
      .select('id,sku,name,stock_uom,is_active')
      .in('sku', skus);
    if (prodErr) throw prodErr;
    const products = (prodData ?? []) as ProductRow[];
    const skuToProduct = new Map<string, ProductRow>();
    for (const p of products) skuToProduct.set(p.sku, p);

    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) {
      return NextResponse.json(
        { error: 'Ningún SKU del alcance está presente en la tabla products.' },
        { status: 500 },
      );
    }

    // 3. Fetch revenue_daily history for all in-scope product_ids.
    const historyRows = await readRevenueDaily(supabase, productIds);

    // 4. Fetch forecast_results (we keep latest training_end_date per cell, ok-only).
    const forecastRows = await readForecastResults(supabase, productIds);

    // Two maps keyed by product_id|metric|forecast_month:
    //   latestForecast  — forward predictions  (model_status: ok / ok_derived)
    //   latestInSample  — in-sample model fit  (model_status: ok_in_sample)
    const latestForecast = new Map<string, ForecastResultRow>();
    const latestInSample = new Map<string, ForecastResultRow>();
    for (const r of forecastRows) {
      const k = `${r.product_id}|${r.metric}|${r.forecast_month}`;
      if (r.model_status === 'ok_in_sample') {
        const prior = latestInSample.get(k);
        if (!prior || r.training_end_date > prior.training_end_date) latestInSample.set(k, r);
      } else {
        const prior = latestForecast.get(k);
        if (!prior || r.training_end_date > prior.training_end_date) latestForecast.set(k, r);
      }
    }

    // 5. Build per-SKU history (monthly) and forecast.
    interface MonthlyAgg {
      month: string;
      sales: number;
      purchases_ordered: number;
      purchases_received: number;
      demand: number;
      sales_gtq: number | null;
    }
    interface ForecastMonth {
      month: string;
      sales: number;
      sales_lower: number | null;
      sales_upper: number | null;
      sales_model_status: string;
      purchases_ordered: number;
      purchases_ordered_lower: number | null;
      purchases_ordered_upper: number | null;
      purchases_ordered_model_status: string;
      purchases_received: number;
      purchases_received_lower: number | null;
      purchases_received_upper: number | null;
      purchases_received_model_status: string;
      demand: number;
      demand_lower: number | null;
      demand_upper: number | null;
      demand_model_status: string;
    }
    // Prophet in-sample fit for each training-period month (sales only).
    // Lets the user compare actual vs model-predicted for the same month.
    interface InSampleMonth {
      month: string;
      sales_fit: number;
      sales_fit_lower: number | null;
      sales_fit_upper: number | null;
    }
    interface PerSku {
      sku: string;
      product_id: number;
      representative_name: string;
      supplier_class: string;
      uom: string;
      movement_rank_within_class: number;
      history: MonthlyAgg[];
      forecast: ForecastMonth[];
      in_sample_fit: InSampleMonth[];
      history_12m_mean: Record<Metric, number>;
      forecast_mean: Record<Metric, number>;
      ratio: Record<Metric, number | null>;
      forecast_status: Record<Metric, string>; // worst status across forecast months
    }

    const productIdToScope = new Map<number, ScopeRow>();
    for (const s of scopeRows) {
      const p = skuToProduct.get(s.default_code);
      if (p) productIdToScope.set(p.id, s);
    }

    // Accumulate history per (product_id, month, metric).
    const histAgg = new Map<number, Map<string, { sales: number; purchases_ordered: number; purchases_received: number; demand: number; sales_gtq: number }>>();
    let globalMinMonth: string | null = null;
    let globalMaxMonth: string | null = null;
    for (const r of historyRows) {
      const month = monthKey(r.observation_date);
      if (globalMinMonth === null || month < globalMinMonth) globalMinMonth = month;
      if (globalMaxMonth === null || month > globalMaxMonth) globalMaxMonth = month;
      let pidMap = histAgg.get(r.product_id);
      if (!pidMap) {
        pidMap = new Map();
        histAgg.set(r.product_id, pidMap);
      }
      let cell = pidMap.get(month);
      if (!cell) {
        cell = { sales: 0, purchases_ordered: 0, purchases_received: 0, demand: 0, sales_gtq: 0 };
        pidMap.set(month, cell);
      }
      const qty = num(r.quantity);
      if (r.metric === 'sales') {
        cell.sales += qty;
        cell.sales_gtq += num(r.revenue_gtq);
      } else if (r.metric === 'purchases_ordered') {
        cell.purchases_ordered += qty;
      } else if (r.metric === 'purchases_received') {
        cell.purchases_received += qty;
      } else if (r.metric === 'demand') {
        cell.demand += qty;
      }
    }

    // Build the canonical month axis: every month from globalMinMonth → 2026-03 (covers history + forecast).
    function monthRange(start: string, endInclusive: string): string[] {
      const out: string[] = [];
      const [sy, sm] = start.split('-').map(Number);
      const [ey, em] = endInclusive.split('-').map(Number);
      let y = sy;
      let m = sm;
      while (y < ey || (y === ey && m <= em)) {
        out.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) {
          m = 1;
          y += 1;
        }
      }
      return out;
    }
    const historyStartMonth = globalMinMonth ?? '2024-10';
    const historyEndMonth = globalMaxMonth ?? '2026-01';
    const allMonths = monthRange(historyStartMonth, '2026-03');

    // Compose per-SKU payload.
    const perSku: PerSku[] = [];
    let trainingEndDate: string | null = null;
    for (const product of products) {
      const scope = productIdToScope.get(product.id);
      if (!scope) continue;
      const monthMap = histAgg.get(product.id) ?? new Map();
      const history: MonthlyAgg[] = [];
      const in_sample_fit: InSampleMonth[] = [];
      // Only include history months <= 2026-01 (training cutoff). Forecast months go in `forecast`.
      for (const m of allMonths) {
        if (m > '2026-01') break;
        const cell = monthMap.get(m);
        history.push({
          month: m,
          sales: cell?.sales ?? 0,
          purchases_ordered: cell?.purchases_ordered ?? 0,
          purchases_received: cell?.purchases_received ?? 0,
          demand: cell?.demand ?? 0,
          sales_gtq: cell ? cell.sales_gtq : 0,
        });
        // In-sample sales fit from Prophet (stored with model_status='ok_in_sample').
        const fkey = `${m}-01`;
        const isr = latestInSample.get(`${product.id}|sales|${fkey}`);
        in_sample_fit.push({
          month: m,
          sales_fit: isr ? num(isr.yhat_sum) : 0,
          sales_fit_lower: isr?.yhat_lower_sum !== null && isr?.yhat_lower_sum !== undefined ? num(isr.yhat_lower_sum) : null,
          sales_fit_upper: isr?.yhat_upper_sum !== null && isr?.yhat_upper_sum !== undefined ? num(isr.yhat_upper_sum) : null,
        });
      }

      const forecast: ForecastMonth[] = [];
      const forecastStatus: Record<Metric, string> = { sales: 'ok', purchases_ordered: 'ok', purchases_received: 'ok', demand: 'ok' };
      for (const fmonth of ['2026-02', '2026-03']) {
        const fkey = `${fmonth}-01`;
        const fSales = latestForecast.get(`${product.id}|sales|${fkey}`);
        const fOrd = latestForecast.get(`${product.id}|purchases_ordered|${fkey}`);
        const fRec = latestForecast.get(`${product.id}|purchases_received|${fkey}`);
        const fDemand = latestForecast.get(`${product.id}|demand|${fkey}`);
        if (fSales && fSales.training_end_date && (!trainingEndDate || fSales.training_end_date > trainingEndDate)) {
          trainingEndDate = fSales.training_end_date;
        }
        forecast.push({
          month: fmonth,
          sales: fSales && fSales.model_status === 'ok' ? num(fSales.yhat_sum) : 0,
          sales_lower: fSales && fSales.model_status === 'ok' ? (fSales.yhat_lower_sum !== null ? num(fSales.yhat_lower_sum) : null) : null,
          sales_upper: fSales && fSales.model_status === 'ok' ? (fSales.yhat_upper_sum !== null ? num(fSales.yhat_upper_sum) : null) : null,
          sales_model_status: fSales?.model_status ?? 'missing',
          purchases_ordered: fOrd && ['ok', 'ok_derived'].includes(fOrd.model_status) ? num(fOrd.yhat_sum) : 0,
          purchases_ordered_lower: fOrd && ['ok', 'ok_derived'].includes(fOrd.model_status) ? (fOrd.yhat_lower_sum !== null ? num(fOrd.yhat_lower_sum) : null) : null,
          purchases_ordered_upper: fOrd && ['ok', 'ok_derived'].includes(fOrd.model_status) ? (fOrd.yhat_upper_sum !== null ? num(fOrd.yhat_upper_sum) : null) : null,
          purchases_ordered_model_status: fOrd?.model_status ?? 'missing',
          purchases_received: fRec && ['ok', 'ok_derived'].includes(fRec.model_status) ? num(fRec.yhat_sum) : 0,
          purchases_received_lower: fRec && ['ok', 'ok_derived'].includes(fRec.model_status) ? (fRec.yhat_lower_sum !== null ? num(fRec.yhat_lower_sum) : null) : null,
          purchases_received_upper: fRec && ['ok', 'ok_derived'].includes(fRec.model_status) ? (fRec.yhat_upper_sum !== null ? num(fRec.yhat_upper_sum) : null) : null,
          purchases_received_model_status: fRec?.model_status ?? 'missing',
          demand: fDemand && fDemand.model_status === 'ok' ? num(fDemand.yhat_sum) : 0,
          demand_lower: fDemand && fDemand.model_status === 'ok' ? (fDemand.yhat_lower_sum !== null ? num(fDemand.yhat_lower_sum) : null) : null,
          demand_upper: fDemand && fDemand.model_status === 'ok' ? (fDemand.yhat_upper_sum !== null ? num(fDemand.yhat_upper_sum) : null) : null,
          demand_model_status: fDemand?.model_status ?? 'missing',
        });
        // Track worst status — ok_derived is valid; only flag truly unexpected statuses.
        if (fSales?.model_status && fSales.model_status !== 'ok') forecastStatus.sales = fSales.model_status;
        if (fOrd?.model_status && !['ok', 'ok_derived'].includes(fOrd.model_status)) forecastStatus.purchases_ordered = fOrd.model_status;
        if (fRec?.model_status && !['ok', 'ok_derived'].includes(fRec.model_status)) forecastStatus.purchases_received = fRec.model_status;
        if (fDemand?.model_status && fDemand.model_status !== 'ok') forecastStatus.demand = fDemand.model_status;
      }

      // 12-month rolling history mean (last 12 history months ending 2026-01).
      const last12 = history.slice(-12);
      const history12m: Record<Metric, number> = {
        sales: last12.length ? last12.reduce((s, m) => s + m.sales, 0) / last12.length : 0,
        purchases_ordered: last12.length ? last12.reduce((s, m) => s + m.purchases_ordered, 0) / last12.length : 0,
        purchases_received: last12.length ? last12.reduce((s, m) => s + m.purchases_received, 0) / last12.length : 0,
        demand: last12.length ? last12.reduce((s, m) => s + m.demand, 0) / last12.length : 0,
      };
      const forecastMean: Record<Metric, number> = {
        sales: forecast.length ? forecast.reduce((s, m) => s + m.sales, 0) / forecast.length : 0,
        purchases_ordered: forecast.length ? forecast.reduce((s, m) => s + m.purchases_ordered, 0) / forecast.length : 0,
        purchases_received: forecast.length ? forecast.reduce((s, m) => s + m.purchases_received, 0) / forecast.length : 0,
        demand: forecast.length ? forecast.reduce((s, m) => s + m.demand, 0) / forecast.length : 0,
      };
      const ratio: Record<Metric, number | null> = {
        sales: history12m.sales > 0 ? forecastMean.sales / history12m.sales : null,
        purchases_ordered: history12m.purchases_ordered > 0 ? forecastMean.purchases_ordered / history12m.purchases_ordered : null,
        purchases_received: history12m.purchases_received > 0 ? forecastMean.purchases_received / history12m.purchases_received : null,
        demand: history12m.demand > 0 ? forecastMean.demand / history12m.demand : null,
      };

      perSku.push({
        sku: product.sku,
        product_id: product.id,
        representative_name: scope.representative_name,
        supplier_class: scope.supplier_class,
        uom: product.stock_uom ?? 'UNKNOWN',
        movement_rank_within_class: scope.movement_rank_within_class,
        history,
        forecast,
        in_sample_fit,
        history_12m_mean: history12m,
        forecast_mean: forecastMean,
        ratio,
        forecast_status: forecastStatus,
      });
    }

    // 6. UoM groups + per-UoM aggregates (UoM-safe summation per §3.3).
    interface UomGroup {
      uom: string;
      skus: string[];
      product_ids: number[];
    }
    const uomGroupMap = new Map<string, UomGroup>();
    for (const sku of perSku) {
      let g = uomGroupMap.get(sku.uom);
      if (!g) {
        g = { uom: sku.uom, skus: [], product_ids: [] };
        uomGroupMap.set(sku.uom, g);
      }
      g.skus.push(sku.sku);
      g.product_ids.push(sku.product_id);
    }
    const uomGroups = Array.from(uomGroupMap.values()).sort((a, b) => b.skus.length - a.skus.length);

    interface PerUomMonth {
      month: string;
      sales: number;
      purchases_ordered: number;
      purchases_received: number;
      demand: number;
      sales_gtq: number;
      // Forecast confidence bands (yhat_lower / yhat_upper) for all metrics.
      sales_lower: number | null;
      sales_upper: number | null;
      po_lower: number | null;
      po_upper: number | null;
      pr_lower: number | null;
      pr_upper: number | null;
      demand_lower: number | null;
      demand_upper: number | null;
      // Prophet in-sample fit for the training period (sales only; null when not yet populated).
      in_sample_fit_sales: number | null;
      in_sample_fit_sales_lower: number | null;
      in_sample_fit_sales_upper: number | null;
      // Bookkeeping flags so the chart can mark non-ok cells.
      any_status_not_ok: boolean;
      is_forecast: boolean;
    }
    const perUomTimeSeries: Record<string, PerUomMonth[]> = {};
    for (const g of uomGroups) {
      const series: PerUomMonth[] = [];
      const skuObjs = perSku.filter((s) => s.uom === g.uom);
      for (const m of allMonths) {
        const isForecast = m > '2026-01';
        let sales = 0, po = 0, pr = 0, demand = 0, salesGtq = 0;
        let salesLower = 0, salesUpper = 0, poLower = 0, poUpper = 0, prLower = 0, prUpper = 0;
        let demandLower = 0, demandUpper = 0;
        let anyLower = false, anyUpper = false, anyPoLower = false, anyPoUpper = false;
        let anyPrLower = false, anyPrUpper = false, anyDemandLower = false, anyDemandUpper = false;
        let anyNotOk = false;
        let isFitSales = 0, isFitSalesLower = 0, isFitSalesUpper = 0;
        let anyFitSales = false, anyFitSalesLower = false, anyFitSalesUpper = false;
        for (const s of skuObjs) {
          if (!isForecast) {
            const h = s.history.find((x) => x.month === m);
            if (h) {
              sales += h.sales;
              po += h.purchases_ordered;
              pr += h.purchases_received;
              demand += h.demand;
              salesGtq += h.sales_gtq ?? 0;
            }
            const is = s.in_sample_fit.find((x) => x.month === m);
            if (is && is.sales_fit > 0) {
              isFitSales += is.sales_fit;
              anyFitSales = true;
              if (is.sales_fit_lower !== null) { isFitSalesLower += is.sales_fit_lower; anyFitSalesLower = true; }
              if (is.sales_fit_upper !== null) { isFitSalesUpper += is.sales_fit_upper; anyFitSalesUpper = true; }
            }
          } else {
            const f = s.forecast.find((x) => x.month === m);
            if (f) {
              sales += f.sales;
              po += f.purchases_ordered;
              pr += f.purchases_received;
              demand += f.demand;
              if (f.sales_lower !== null) { salesLower += f.sales_lower; anyLower = true; }
              if (f.sales_upper !== null) { salesUpper += f.sales_upper; anyUpper = true; }
              if (f.purchases_ordered_lower !== null) { poLower += f.purchases_ordered_lower; anyPoLower = true; }
              if (f.purchases_ordered_upper !== null) { poUpper += f.purchases_ordered_upper; anyPoUpper = true; }
              if (f.purchases_received_lower !== null) { prLower += f.purchases_received_lower; anyPrLower = true; }
              if (f.purchases_received_upper !== null) { prUpper += f.purchases_received_upper; anyPrUpper = true; }
              if (f.demand_lower !== null) { demandLower += f.demand_lower; anyDemandLower = true; }
              if (f.demand_upper !== null) { demandUpper += f.demand_upper; anyDemandUpper = true; }
              if (
                f.sales_model_status !== 'ok' ||
                !['ok', 'ok_derived'].includes(f.purchases_ordered_model_status) ||
                !['ok', 'ok_derived'].includes(f.purchases_received_model_status) ||
                f.demand_model_status !== 'ok'
              ) {
                anyNotOk = true;
              }
            }
          }
        }
        series.push({
          month: m,
          sales,
          purchases_ordered: po,
          purchases_received: pr,
          demand,
          sales_gtq: salesGtq,
          sales_lower: anyLower ? salesLower : null,
          sales_upper: anyUpper ? salesUpper : null,
          po_lower: anyPoLower ? poLower : null,
          po_upper: anyPoUpper ? poUpper : null,
          pr_lower: anyPrLower ? prLower : null,
          pr_upper: anyPrUpper ? prUpper : null,
          demand_lower: anyDemandLower ? demandLower : null,
          demand_upper: anyDemandUpper ? demandUpper : null,
          in_sample_fit_sales: !isForecast && anyFitSales ? isFitSales : null,
          in_sample_fit_sales_lower: !isForecast && anyFitSalesLower ? isFitSalesLower : null,
          in_sample_fit_sales_upper: !isForecast && anyFitSalesUpper ? isFitSalesUpper : null,
          any_status_not_ok: anyNotOk,
          is_forecast: isForecast,
        });
      }
      perUomTimeSeries[g.uom] = series;
    }

    // 7. Status counts across all forecast cells.
    const statusCounts: Record<string, number> = {};
    for (const r of latestForecast.values()) {
      if (!productIds.includes(r.product_id)) continue;
      statusCounts[r.model_status] = (statusCounts[r.model_status] ?? 0) + 1;
    }

    return NextResponse.json({
      scope: {
        sku_count: perSku.length,
        metrics: METRICS,
        class_filter: supplierClass ?? 'all',
      },
      uom_groups: uomGroups,
      per_uom_history_forecast: perUomTimeSeries,
      per_sku: perSku,
      training_end_date: trainingEndDate,
      history_start_month: historyStartMonth,
      history_end_month: historyEndMonth,
      status_counts: statusCounts,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('superuser/forecast-diagnostic GET error:', error);
    return NextResponse.json(
      { error: 'Error generando diagnóstico de forecast', details: String(error) },
      { status: 500 },
    );
  }
}
