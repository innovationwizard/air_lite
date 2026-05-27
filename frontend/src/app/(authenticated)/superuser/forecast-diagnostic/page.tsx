'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import dynamicImport from 'next/dynamic';
import { Target, AlertTriangle, RefreshCw } from 'lucide-react';

// echarts-for-react is a client-only library; SSR import must be deferred.
const ReactECharts = dynamicImport(() => import('echarts-for-react'), { ssr: false });

// ─── types — mirror the GET /api/superuser/forecast-diagnostic response ──────
type Metric = 'sales' | 'purchases_ordered' | 'purchases_received' | 'demand';

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
  forecast_status: Record<Metric, string>;
}

interface PerUomMonth {
  month: string;
  sales: number;
  purchases_ordered: number;
  purchases_received: number;
  demand: number;
  sales_gtq: number;
  sales_lower: number | null;
  sales_upper: number | null;
  po_lower: number | null;
  po_upper: number | null;
  pr_lower: number | null;
  pr_upper: number | null;
  demand_lower: number | null;
  demand_upper: number | null;
  in_sample_fit_sales: number | null;
  in_sample_fit_sales_lower: number | null;
  in_sample_fit_sales_upper: number | null;
  any_status_not_ok: boolean;
  is_forecast: boolean;
}

interface UomGroup { uom: string; skus: string[]; product_ids: number[]; }

interface DiagnosticResponse {
  scope: { sku_count: number; metrics: readonly string[]; class_filter: string };
  uom_groups: UomGroup[];
  per_uom_history_forecast: Record<string, PerUomMonth[]>;
  per_sku: PerSku[];
  training_end_date: string | null;
  history_start_month: string;
  history_end_month: string;
  status_counts: Record<string, number>;
  generated_at: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const METRIC_COLOR: Record<Metric, string> = {
  sales: '#10b981',                // emerald-500
  purchases_ordered: '#3b82f6',    // blue-500
  purchases_received: '#a855f7',   // purple-500
  demand: '#f97316',               // orange-500 (uncensored demand)
};
const METRIC_LABEL: Record<Metric, string> = {
  sales: 'Ventas',
  purchases_ordered: 'Compras Ordenadas',
  purchases_received: 'Compras Recibidas',
  demand: 'Demanda (pedidos)',
};

function fmt(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-GT', { maximumFractionDigits: digits });
}

function fmtRatio(r: number | null): string {
  if (r === null || !Number.isFinite(r)) return '—';
  if (r >= 100) return `${r.toFixed(0)}×`;
  if (r >= 10) return `${r.toFixed(1)}×`;
  if (r >= 1) return `${r.toFixed(2)}×`;
  if (r >= 0.01) return `${r.toFixed(3)}×`;
  return r.toExponential(1) + '×';
}

function ratioBucket(r: number | null): 'green' | 'yellow' | 'red' | 'gray' {
  if (r === null || !Number.isFinite(r) || r === 0) return 'gray';
  if (r >= 0.5 && r <= 2.0) return 'green';
  if (r >= 0.1 && r <= 10) return 'yellow';
  return 'red';
}

const BUCKET_COLOR: Record<'green' | 'yellow' | 'red' | 'gray', string> = {
  green: '#10b981',
  yellow: '#eab308',
  red: '#ef4444',
  gray: '#9ca3af',
};

// Encodes metric identity (hue) + ratio health (opacity) for Panel A bars.
function metricColorWithBucketOpacity(metricColor: string, bucket: 'green' | 'yellow' | 'red' | 'gray'): string {
  const alpha = bucket === 'green' ? 1.0 : bucket === 'yellow' ? 0.65 : bucket === 'red' ? 0.45 : 0.2;
  const r = parseInt(metricColor.slice(1, 3), 16);
  const g = parseInt(metricColor.slice(3, 5), 16);
  const b = parseInt(metricColor.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── page component ──────────────────────────────────────────────────────────
export default function ForecastDiagnosticPage() {
  const [data, setData] = useState<DiagnosticResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<'' | 'REYMA' | 'CARVAJAL'>('');
  const [drilldownSku, setDrilldownSku] = useState<string>('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = classFilter ? `?class=${classFilter}` : '';
      const res = await fetch(`/api/superuser/forecast-diagnostic${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j: DiagnosticResponse = await res.json();
      setData(j);
      if (j.per_sku.length > 0 && !j.per_sku.some((s) => s.sku === drilldownSku)) {
        setDrilldownSku(j.per_sku[0].sku);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [classFilter]);

  // ─── Panel A: ratio bars ───────────────────────────────────────────────────
  const panelAOption = useMemo(() => {
    if (!data || data.per_sku.length === 0) return null;
    const skus = [...data.per_sku].sort((a, b) => {
      if (a.supplier_class !== b.supplier_class) return a.supplier_class.localeCompare(b.supplier_class);
      return (a.movement_rank_within_class || 999) - (b.movement_rank_within_class || 999);
    });
    const xLabels = skus.map((s) => s.sku);
    const series = (['sales', 'purchases_ordered', 'purchases_received', 'demand'] as Metric[]).map((m) => ({
      name: METRIC_LABEL[m],
      type: 'bar',
      data: skus.map((s) => {
        const r = s.ratio[m];
        return {
          value: r === null || !Number.isFinite(r) ? null : r,
          itemStyle: { color: metricColorWithBucketOpacity(METRIC_COLOR[m], ratioBucket(r)) },
        };
      }),
      barGap: 0.1,
      barCategoryGap: '20%',
    }));
    return {
      title: { text: 'Panel A — Ratio: forecast / promedio histórico (12 m)', left: 0, textStyle: { fontSize: 14, fontWeight: 600 } },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: { axisValue: string; seriesName: string; value: number | null; color: string }[]) => {
          const sku = params[0].axisValue;
          const meta = skus.find((s) => s.sku === sku);
          if (!meta) return '';
          const lines = [`<b>${sku}</b> — ${meta.representative_name.slice(0, 50)}`,
            `<span style="color:#6b7280">${meta.supplier_class} · UoM ${meta.uom}</span>`];
          for (const p of params) {
            const r = p.value;
            lines.push(`<span style="color:${p.color}">●</span> ${p.seriesName}: <b>${fmtRatio(r)}</b>`);
          }
          return lines.join('<br/>');
        },
      },
      legend: { data: (['sales', 'purchases_ordered', 'purchases_received', 'demand'] as Metric[]).map((m) => METRIC_LABEL[m]), top: 30 },
      grid: { left: 60, right: 30, top: 80, bottom: 60 },
      xAxis: { type: 'category', data: xLabels, axisLabel: { rotate: 45, fontSize: 10 } },
      yAxis: {
        type: 'log',
        logBase: 10,
        name: 'ratio (escala log)',
        nameLocation: 'middle',
        nameGap: 50,
        axisLine: { show: true },
        splitLine: { show: true, lineStyle: { type: 'dashed', color: '#e5e7eb' } },
      },
      series: [
        ...series,
        {
          name: 'banda verde [0.5–2.0]', type: 'line', data: [], markArea: {
            silent: true,
            itemStyle: { color: 'rgba(16,185,129,0.05)' },
            data: [[{ yAxis: 0.5 }, { yAxis: 2.0 }]],
          },
        },
        {
          name: 'paridad', type: 'line', data: [], markLine: {
            silent: true, symbol: 'none',
            label: { formatter: '1×', position: 'end' },
            lineStyle: { color: '#10b981', type: 'dashed' },
            data: [{ yAxis: 1 }],
          },
        },
      ],
      dataZoom: [{ type: 'slider', xAxisIndex: 0, height: 18, bottom: 10 }],
    };
  }, [data]);

  // ─── Panel B: per-UoM time series ──────────────────────────────────────────
  const panelBOptions = useMemo(() => {
    if (!data) return [];
    const trainingEnd = data.training_end_date;
    return data.uom_groups.map((g) => {
      const series = data.per_uom_history_forecast[g.uom] ?? [];
      const months = series.map((p) => p.month);

      // Maps metric to its lower/upper CI field names in PerUomMonth.
      const CI_KEYS: Record<Metric, { lo: keyof PerUomMonth; hi: keyof PerUomMonth }> = {
        sales: { lo: 'sales_lower', hi: 'sales_upper' },
        purchases_ordered: { lo: 'po_lower', hi: 'po_upper' },
        purchases_received: { lo: 'pr_lower', hi: 'pr_upper' },
        demand: { lo: 'demand_lower', hi: 'demand_upper' },
      };
      const buildSeries = (metric: Metric) => {
        const color = METRIC_COLOR[metric];
        const { lo, hi } = CI_KEYS[metric];

        const histData = series.map((p) => (!p.is_forecast ? (p[metric] as number) : null));
        const fcastData = series.map((p) => (p.is_forecast ? (p[metric] as number) : null));
        // CI stacked band: base = lower, fill = upper - lower.
        const ciLower = series.map((p) => (p.is_forecast ? (p[lo] as number | null) : null));
        const ciBand = series.map((p) => {
          if (!p.is_forecast) return null;
          const l = p[lo] as number | null;
          const h = p[hi] as number | null;
          return l !== null && h !== null ? h - l : null;
        });

        const stackId = `ci_${metric}`;
        return [
          // 1. Historic — solid, full opacity.
          {
            name: `${METRIC_LABEL[metric]} (histórico)`,
            type: 'line',
            data: histData,
            smooth: false,
            connectNulls: false,
            itemStyle: { color },
            lineStyle: { color, width: 2 },
            symbol: 'circle',
            symbolSize: 4,
          },
          // 2. CI lower bound — invisible, forms the stack base.
          {
            name: `_ci_lo_${metric}`,
            type: 'line',
            data: ciLower,
            smooth: false,
            connectNulls: false,
            lineStyle: { width: 0, opacity: 0 },
            itemStyle: { opacity: 0 },
            symbol: 'none',
            stack: stackId,
            areaStyle: { opacity: 0 },
            silent: true,
          },
          // 3. CI band — upper minus lower, stacked on the base.
          {
            name: `_ci_band_${metric}`,
            type: 'line',
            data: ciBand,
            smooth: false,
            connectNulls: false,
            lineStyle: { width: 0, opacity: 0 },
            itemStyle: { opacity: 0 },
            symbol: 'none',
            stack: stackId,
            areaStyle: { color, opacity: 0.15 },
            silent: true,
          },
          // 4. Forecast — dashed, reduced opacity so it's visually distinct from historic.
          {
            name: `${METRIC_LABEL[metric]} (forecast)`,
            type: 'line',
            data: fcastData,
            smooth: false,
            connectNulls: false,
            itemStyle: { color, opacity: 0.65 },
            lineStyle: { color, width: 2, type: 'dashed', opacity: 0.65 },
            symbol: 'diamond',
            symbolSize: 7,
          },
          // 5. In-sample model fit (sales only) — dashed, training period only.
          //    Shows what Prophet predicted for each month it was trained on.
          //    Null until run_in_sample_training script is executed.
          ...(metric === 'sales' ? [{
            name: 'Ventas (ajuste modelo)',
            type: 'line',
            data: series.map((p) => (!p.is_forecast ? p.in_sample_fit_sales : null)),
            smooth: false,
            connectNulls: false,
            itemStyle: { color: '#f59e0b' },
            lineStyle: { color: '#f59e0b', width: 1.5, type: 'dotted' },
            symbol: 'none',
          }] : []),
        ];
      };

      const allSeries: Record<string, unknown>[] = [
        ...buildSeries('sales'),
        ...buildSeries('purchases_ordered'),
        ...buildSeries('purchases_received'),
        ...buildSeries('demand'),
      ];

      // Mark line at training cutoff (Jan 2026 month index).
      const trainingMonthLabel = trainingEnd ? trainingEnd.slice(0, 7) : null;
      if (trainingMonthLabel && months.includes(trainingMonthLabel)) {
        allSeries[0].markLine = {
          silent: true,
          symbol: 'none',
          label: { formatter: 'Fin entren.', position: 'insideEndTop', fontSize: 10, color: '#6b7280' },
          lineStyle: { color: '#9ca3af', type: 'dashed' },
          data: [{ xAxis: trainingMonthLabel }],
        };
      }

      return {
        uom: g.uom,
        sku_count: g.skus.length,
        skus: g.skus,
        option: {
          title: {
            text: `Panel B — UoM ${g.uom} (${g.skus.length} SKU${g.skus.length === 1 ? '' : 's'})`,
            left: 0,
            textStyle: { fontSize: 13, fontWeight: 600 },
          },
          tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
          legend: {
            top: 24,
            type: 'scroll',
            data: [
              ...(['sales', 'purchases_ordered', 'purchases_received', 'demand'] as Metric[]).flatMap((m) => [
                `${METRIC_LABEL[m]} (histórico)`,
                `${METRIC_LABEL[m]} (forecast)`,
              ]),
              'Ventas (ajuste modelo)',
            ],
          },
          grid: { left: 70, right: 30, top: 90, bottom: 50 },
          xAxis: { type: 'category', data: months, axisLabel: { fontSize: 10, rotate: 45 } },
          yAxis: { type: 'value', name: `cantidad (${g.uom})`, nameLocation: 'middle', nameGap: 55 },
          series: allSeries,
          dataZoom: [{ type: 'slider', xAxisIndex: 0, height: 18, bottom: 5 }],
        },
      };
    });
  }, [data]);

  // ─── Panel C: SKU drilldown ────────────────────────────────────────────────
  const panelCOption = useMemo(() => {
    if (!data) return null;
    const sku = data.per_sku.find((s) => s.sku === drilldownSku) ?? data.per_sku[0];
    if (!sku) return null;
    const trainingEnd = data.training_end_date;
    const months = [...sku.history.map((m) => m.month), ...sku.forecast.map((m) => m.month)];

    const buildSeries = (metric: Metric) => {
      const color = METRIC_COLOR[metric];
      const status = sku.forecast_status[metric];
      const isError = !['ok', 'ok_derived'].includes(status);

      const nHistory = sku.history.length;
      const histVals = sku.history.map((m) => m[metric] as number);
      const fcstVals = sku.forecast.map((m) => m[metric] as number);
      const histData: (number | null)[] = [...histVals, ...sku.forecast.map(() => null)];
      const fcstData: (number | null)[] = [...sku.history.map(() => null), ...fcstVals];

      // CI band per metric (lower + band height stacked).
      const lowerKey = metric === 'sales' ? 'sales_lower' : metric === 'purchases_ordered' ? 'purchases_ordered_lower' : metric === 'purchases_received' ? 'purchases_received_lower' : 'demand_lower';
      const upperKey = metric === 'sales' ? 'sales_upper' : metric === 'purchases_ordered' ? 'purchases_ordered_upper' : metric === 'purchases_received' ? 'purchases_received_upper' : 'demand_upper';
      const ciLower: (number | null)[] = [
        ...Array(nHistory).fill(null),
        ...sku.forecast.map((f) => f[lowerKey as keyof typeof f] as number | null),
      ];
      const ciBand: (number | null)[] = [
        ...Array(nHistory).fill(null),
        ...sku.forecast.map((f) => {
          const lo = f[lowerKey as keyof typeof f] as number | null;
          const hi = f[upperKey as keyof typeof f] as number | null;
          return lo !== null && hi !== null ? hi - lo : null;
        }),
      ];

      const stackId = `c_ci_${metric}`;
      return [
        // 1. Historic — solid, full opacity.
        {
          name: `${METRIC_LABEL[metric]} (histórico)`,
          type: 'line',
          data: histData,
          itemStyle: { color },
          lineStyle: { color, width: 2 },
          symbol: 'circle',
          symbolSize: 5,
        },
        // 2. CI lower bound — invisible stack base.
        {
          name: `_ci_lo_c_${metric}`,
          type: 'line',
          data: ciLower,
          lineStyle: { width: 0, opacity: 0 },
          itemStyle: { opacity: 0 },
          symbol: 'none',
          stack: stackId,
          areaStyle: { opacity: 0 },
          silent: true,
        },
        // 3. CI band — stacked fill.
        {
          name: `_ci_band_c_${metric}`,
          type: 'line',
          data: ciBand,
          lineStyle: { width: 0, opacity: 0 },
          itemStyle: { opacity: 0 },
          symbol: 'none',
          stack: stackId,
          areaStyle: { color, opacity: 0.15 },
          silent: true,
        },
        // 4. Forecast — dashed, reduced opacity so it's visually distinct from historic.
        {
          name: `${METRIC_LABEL[metric]} (forecast)`,
          type: 'line',
          data: fcstData,
          itemStyle: { color: isError ? '#ef4444' : color, opacity: 0.65 },
          lineStyle: { color: isError ? '#ef4444' : color, width: 2, type: 'dashed', opacity: 0.65 },
          symbol: isError ? 'triangle' : 'diamond',
          symbolSize: isError ? 12 : 7,
        },
        // 5. In-sample model fit (sales only) — dotted amber, training period.
        ...(metric === 'sales' ? [{
          name: 'Ventas (ajuste modelo)',
          type: 'line',
          data: [
            ...sku.in_sample_fit.map((s) => s.sales_fit > 0 ? s.sales_fit : null),
            ...sku.forecast.map(() => null),
          ],
          itemStyle: { color: '#f59e0b' },
          lineStyle: { color: '#f59e0b', width: 1.5, type: 'dotted' },
          symbol: 'none',
        }] : []),
      ];
    };

    const allSeries: Record<string, unknown>[] = [
      ...buildSeries('sales'),
      ...buildSeries('purchases_ordered'),
      ...buildSeries('purchases_received'),
      ...buildSeries('demand'),
    ];

    const trainingMonthLabel = trainingEnd ? trainingEnd.slice(0, 7) : null;
    if (trainingMonthLabel && months.includes(trainingMonthLabel)) {
      allSeries[0].markLine = {
        silent: true,
        symbol: 'none',
        label: { formatter: 'Fin entren.', position: 'insideEndTop', fontSize: 10, color: '#6b7280' },
        lineStyle: { color: '#9ca3af', type: 'dashed' },
        data: [{ xAxis: trainingMonthLabel }],
      };
    }

    return {
      title: {
        text: `Panel C — Drilldown ${sku.sku}`,
        subtext: `${sku.representative_name} · ${sku.supplier_class} · UoM ${sku.uom}`,
        left: 0,
        textStyle: { fontSize: 13, fontWeight: 600 },
        subtextStyle: { fontSize: 11 },
      },
      tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
      legend: {
        top: 50,
        type: 'scroll',
        data: [
          ...(['sales', 'purchases_ordered', 'purchases_received', 'demand'] as Metric[]).flatMap((m) => [
            `${METRIC_LABEL[m]} (histórico)`,
            `${METRIC_LABEL[m]} (forecast)`,
          ]),
          'Ventas (ajuste modelo)',
        ],
      },
      grid: { left: 70, right: 30, top: 100, bottom: 50 },
      xAxis: { type: 'category', data: months, axisLabel: { fontSize: 10, rotate: 45 } },
      yAxis: { type: 'value', name: `cantidad (${sku.uom})`, nameLocation: 'middle', nameGap: 55 },
      series: allSeries,
      dataZoom: [{ type: 'slider', xAxisIndex: 0, height: 18, bottom: 5 }],
    };
  }, [data, drilldownSku]);

  // ─── render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Target className="w-6 h-6 text-emerald-600" />
          Forecast Diagnostic — Superusuario
        </h1>
        <p className="text-gray-500 mt-1">
          Tres paneles superpuestos para diagnosticar la causa de discrepancias en{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">/gerencia/forecast</code>:
          ratio forecast/historia (Panel A), serie temporal por bucket de UoM (Panel B),
          y drilldown por SKU (Panel C). Lee de <code className="text-xs bg-gray-100 px-1 rounded">revenue_daily</code> + <code className="text-xs bg-gray-100 px-1 rounded">forecast_results</code>;
          nunca suma a través de UoMs distintos.
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap items-center gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="filter-clase">Clase</label>
          <select
            id="filter-clase"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value as '' | 'REYMA' | 'CARVAJAL')}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Todas</option>
            <option value="REYMA">REYMA</option>
            <option value="CARVAJAL">CARVAJAL</option>
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">SKU para drilldown (Panel C)</label>
          <select
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm min-w-[280px]"
            value={drilldownSku}
            onChange={(e) => setDrilldownSku(e.target.value)}
            disabled={loading || !data}
          >
            {data?.per_sku.map((s) => (
              <option key={s.sku} value={s.sku}>
                {s.sku} — {s.representative_name.slice(0, 36)} ({s.uom})
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Recargar
        </button>

        {data && (
          <div className="ml-auto text-xs text-gray-500 flex flex-col">
            <span>{data.scope.sku_count} SKUs · {data.uom_groups.length} UoM bucket{data.uom_groups.length === 1 ? '' : 's'}</span>
            <span>training_end: {data.training_end_date ?? '—'}</span>
            <span>generado: {new Date(data.generated_at).toLocaleString('es-GT')}</span>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {data && Object.keys(data.status_counts).filter((s) => s !== 'ok').length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Forecast cells con model_status ≠ ok:</strong>{' '}
            {Object.entries(data.status_counts)
              .filter(([s]) => s !== 'ok')
              .map(([s, n]) => `${s}: ${n}`)
              .join(' · ')}
            . Estas celdas se renderizan como 0 en los paneles agregados — Panel C las marca con un triángulo rojo.
          </div>
        </div>
      )}

      {/* Panel A */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        {panelAOption ? (
          <ReactECharts option={panelAOption} style={{ height: 460 }} notMerge lazyUpdate />
        ) : (
          <div className="text-sm text-gray-400 py-12 text-center">{loading ? 'Cargando…' : 'Sin datos'}</div>
        )}
        <p className="text-xs text-gray-500 mt-2">
          Verde 0.5×–2.0× · Amarillo 0.1–0.5 ó 2.0–10× · Rojo &lt;0.1× ó &gt;10×. Eje Y en escala logarítmica.
          Una barra roja es un cell de forecast con miss de orden de magnitud — candidato a la consulta del insider.
        </p>
      </div>

      {/* Panel B — one chart per UoM bucket */}
      {panelBOptions.length > 0 && (
        <div className="space-y-4">
          {panelBOptions.map((p) => (
            <div key={p.uom} className="bg-white border border-gray-200 rounded-xl p-4">
              <ReactECharts option={p.option} style={{ height: 360 }} notMerge lazyUpdate />
              <p className="text-xs text-gray-500 mt-2">
                SKUs en este bucket: {p.skus.map((s) => <code key={s} className="bg-gray-100 px-1 rounded ml-1">{s}</code>)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Panel C — single-SKU drilldown */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        {panelCOption ? (
          <ReactECharts option={panelCOption} style={{ height: 420 }} notMerge lazyUpdate />
        ) : (
          <div className="text-sm text-gray-400 py-12 text-center">{loading ? 'Cargando…' : 'Sin datos'}</div>
        )}
        {data && drilldownSku && (() => {
          const s = data.per_sku.find((x) => x.sku === drilldownSku);
          if (!s) return null;
          return (
            <table className="text-xs text-gray-700 mt-2 w-full">
              <thead className="text-gray-500">
                <tr>
                  <th className="text-left py-1">métrica</th>
                  <th className="text-right py-1">historia 12m (prom.)</th>
                  <th className="text-right py-1">forecast (prom.)</th>
                  <th className="text-right py-1">ratio</th>
                  <th className="text-left py-1 pl-3">model_status</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {(['sales', 'purchases_ordered', 'purchases_received', 'demand'] as Metric[]).map((m) => {
                  const r = s.ratio[m];
                  const bucket = ratioBucket(r);
                  return (
                    <tr key={m}>
                      <td className="py-1" style={{ color: METRIC_COLOR[m] }}>{METRIC_LABEL[m]}</td>
                      <td className="py-1 text-right">{fmt(s.history_12m_mean[m])}</td>
                      <td className="py-1 text-right">{fmt(s.forecast_mean[m])}</td>
                      <td className="py-1 text-right" style={{ color: BUCKET_COLOR[bucket], fontWeight: 600 }}>{fmtRatio(r)}</td>
                      <td className="py-1 pl-3">
                        <span className={s.forecast_status[m] === 'ok' ? 'text-emerald-700' : 'text-red-700'}>
                          {s.forecast_status[m]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          );
        })()}
      </div>
    </div>
  );
}
