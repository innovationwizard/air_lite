'use client';

/**
 * ForecastDecompositionChart
 *
 * Phase 3 – "Why" Decomposition  (Checklist item)
 *
 * Renders three stacked sub-panels that let the user see exactly WHY the
 * engine produces a recommendation:
 *
 *   1. Baseline (Trend)   – 14-day centered MA; the long-run growth or
 *                           decline of product popularity.
 *   2. Season (Cycles)    – Weekly recurring pattern (day-of-week effect).
 *                           Positive = above-trend day; negative = below.
 *   3. Events (Regressors)– What the trend + season don't explain:
 *                           promotions, anomalies, external drivers.
 *
 * Historical data is shown as solid fills; forecast days as semi-transparent
 * dashed fills with a vertical "Today" separator.
 */

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

// Lazy-load Plotly (heavy – SSR is disabled)
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false }) as React.ComponentType<{
  data: PlotlyTrace[];
  layout: Record<string, unknown>;
  config?: Record<string, unknown>;
  style?: React.CSSProperties;
  useResizeHandler?: boolean;
}>;

// ── Types ──────────────────────────────────────────────────────────────────

interface DecompositionPoint {
  date: string;
  trend: number;
  season: number;
  events: number;
  total: number;
  is_forecast: boolean;
}

export interface DecompositionMetadata {
  trend_slope_per_day: number;   // GTQ/day — positive = growth
  peak_dow: string;              // e.g. "Viernes"
  seasonal_amplitude_pct: number;// max swing as % of trend
  data_completeness: number;     // % of days with sales data
}

export interface ForecastDecompositionChartProps {
  series: DecompositionPoint[];
  metadata: DecompositionMetadata;
  today?: string; // ISO date string; defaults to last non-forecast date
}

interface PlotlyTrace extends Record<string, unknown> {
  x: string[];
  y: number[];
  name: string;
  type: string;
  mode?: string;
  line?: Record<string, unknown>;
  fill?: string;
  fillcolor?: string;
  hovertemplate?: string;
  hoverinfo?: string;
  showlegend?: boolean;
  xaxis?: string;
  yaxis?: string;
  opacity?: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat('es-GT', { maximumFractionDigits: 0 }).format(v);
}

function slopeLabel(slope: number): string {
  if (Math.abs(slope) < 10) return 'Estable';
  return slope > 0
    ? `+GTQ ${fmt(slope)}/día`
    : `−GTQ ${fmt(Math.abs(slope))}/día`;
}

// ── Component ──────────────────────────────────────────────────────────────

export function ForecastDecompositionChart({
  series,
  metadata,
  today,
}: ForecastDecompositionChartProps) {
  const todayStr = today ?? series.findLast(p => !p.is_forecast)?.date ?? new Date().toISOString().slice(0, 10);

  const hist = useMemo(() => series.filter(p => !p.is_forecast), [series]);
  const fore = useMemo(() => series.filter(p =>  p.is_forecast), [series]);

  // ── Shared axis config ────────────────────────────────────────────────────
  const axisBase = {
    type: 'date',
    tickformat: '%d %b',
    gridcolor: '#f3f4f6',
    showline: true,
    linecolor: '#e5e7eb',
    zeroline: false,
  };

  // ── Trend traces ──────────────────────────────────────────────────────────
  const trendTraces: PlotlyTrace[] = [
    {
      x: hist.map(p => p.date),
      y: hist.map(p => p.trend),
      name: 'Tendencia (hist.)',
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      fillcolor: 'rgba(59,130,246,0.15)',
      line: { color: '#3b82f6', width: 2 },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: '<b>%{x}</b><br>Tendencia: GTQ %{y:,.0f}<extra></extra>',
    },
    {
      x: fore.map(p => p.date),
      y: fore.map(p => p.trend),
      name: 'Tendencia (pron.)',
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      fillcolor: 'rgba(59,130,246,0.07)',
      line: { color: '#3b82f6', width: 2, dash: 'dash' },
      xaxis: 'x',
      yaxis: 'y',
      hovertemplate: '<b>%{x}</b><br>Tendencia: GTQ %{y:,.0f}<extra></extra>',
    },
  ];

  // ── Season traces ─────────────────────────────────────────────────────────
  const seasonTraces: PlotlyTrace[] = [
    {
      x: hist.map(p => p.date),
      y: hist.map(p => p.season),
      name: 'Estacionalidad (hist.)',
      type: 'bar',
      fillcolor: 'rgba(16,185,129,0.7)',
      line: { width: 0 },
      xaxis: 'x',
      yaxis: 'y2',
      hovertemplate: '<b>%{x}</b><br>Ciclo semanal: GTQ %{y:,.0f}<extra></extra>',
      marker: { color: hist.map(p => p.season >= 0 ? 'rgba(16,185,129,0.7)' : 'rgba(239,68,68,0.6)') },
    } as unknown as PlotlyTrace,
    {
      x: fore.map(p => p.date),
      y: fore.map(p => p.season),
      name: 'Estacionalidad (pron.)',
      type: 'bar',
      xaxis: 'x',
      yaxis: 'y2',
      opacity: 0.45,
      hovertemplate: '<b>%{x}</b><br>Ciclo semanal: GTQ %{y:,.0f}<extra></extra>',
      marker: { color: fore.map(p => p.season >= 0 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.3)') },
    } as unknown as PlotlyTrace,
  ];

  // ── Events traces ─────────────────────────────────────────────────────────
  const eventsTraces: PlotlyTrace[] = [
    {
      x: hist.map(p => p.date),
      y: hist.map(p => p.events),
      name: 'Eventos / Residual',
      type: 'scatter',
      mode: 'lines',
      fill: 'tozeroy',
      fillcolor: 'rgba(168,85,247,0.15)',
      line: { color: '#a855f7', width: 1.5 },
      xaxis: 'x',
      yaxis: 'y3',
      hovertemplate: '<b>%{x}</b><br>Eventos: GTQ %{y:,.0f}<extra></extra>',
    },
  ];

  const allTraces = [...trendTraces, ...seasonTraces, ...eventsTraces];

  // ── Today line (shared shape across all subplots) ─────────────────────────
  const todayShape = (yref: string) => ({
    type: 'line',
    x0: todayStr, x1: todayStr,
    y0: 0, y1: 1,
    xref: 'x', yref,
    line: { color: '#9ca3af', width: 1.5, dash: 'dot' },
  });

  const layout = {
    autosize: true,
    height: 560,
    margin: { l: 70, r: 20, t: 30, b: 60 },
    grid: { rows: 3, columns: 1, pattern: 'independent', roworder: 'top to bottom' },
    hovermode: 'x unified',

    // Row 1 – Trend
    xaxis:  { ...axisBase, showticklabels: false, domain: [0, 1] },
    yaxis:  { title: 'Tendencia (GTQ)', tickformat: ',.0f', gridcolor: '#f3f4f6', domain: [0.70, 1.00] },

    // Row 2 – Season
    xaxis2: { ...axisBase, showticklabels: false, domain: [0, 1], anchor: 'y2' },
    yaxis2: { title: 'Ciclo semanal', tickformat: ',.0f', gridcolor: '#f3f4f6', domain: [0.36, 0.64], zeroline: true, zerolinecolor: '#d1d5db' },

    // Row 3 – Events
    xaxis3: { ...axisBase, title: 'Fecha', domain: [0, 1], anchor: 'y3' },
    yaxis3: { title: 'Eventos', tickformat: ',.0f', gridcolor: '#f3f4f6', domain: [0.00, 0.30], zeroline: true, zerolinecolor: '#d1d5db' },

    shapes: [
      todayShape('y domain'),
      todayShape('y2 domain'),
      todayShape('y3 domain'),
    ],
    annotations: [{
      x: todayStr, y: 1, xref: 'x', yref: 'y domain',
      text: 'Hoy', showarrow: false, yshift: 10,
      font: { size: 11, color: '#6b7280' },
    }],
    legend: { orientation: 'h', x: 0, y: -0.12, xanchor: 'left' },
    plot_bgcolor: '#ffffff',
    paper_bgcolor: '#ffffff',
  };

  const config = {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    toImageButtonOptions: { format: 'png', filename: 'descomposicion-pronostico', height: 900, width: 1400, scale: 2 },
  };

  // ── Trend direction badge ─────────────────────────────────────────────────
  const slope = metadata.trend_slope_per_day;
  const trendBadgeClass =
    slope > 10  ? 'bg-green-50 text-green-700' :
    slope < -10 ? 'bg-red-50 text-red-700'     : 'bg-gray-50 text-gray-600';

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start flex-wrap gap-2">
          <div>
            <CardTitle>Descomposición del Motor de Pronóstico</CardTitle>
            <CardDescription>
              Tendencia · Ciclo Semanal · Eventos — visualiza <em>por qué</em> el motor recomienda lo que recomienda
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline" className={trendBadgeClass}>
              Tendencia: {slopeLabel(slope)}
            </Badge>
            <Badge variant="outline" className="bg-emerald-50 text-emerald-700">
              Pico: {metadata.peak_dow}
            </Badge>
            <Badge variant="outline" className="bg-purple-50 text-purple-700">
              Amplitud estacional: ±{(metadata.seasonal_amplitude_pct ?? 0).toFixed(1)}%
            </Badge>
            <Badge variant="outline" className="bg-blue-50 text-blue-700">
              Datos: {metadata.data_completeness}%
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <Plot
          data={allTraces}
          layout={layout}
          config={config}
          style={{ width: '100%' }}
          useResizeHandler
        />

        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <p className="font-semibold text-blue-700 mb-1">Tendencia (Baseline)</p>
            <p className="text-blue-600 text-xs">
              Suavizado de 14 días. Captura el crecimiento o declive estructural
              del producto, independiente de patrones cíclicos.
            </p>
          </div>
          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
            <p className="font-semibold text-emerald-700 mb-1">Ciclo Semanal (Season)</p>
            <p className="text-emerald-600 text-xs">
              Efecto del día de la semana sobre la tendencia.
              Barras verdes = días sobre la media; rojas = días bajo la media.
              Pico natural: <strong>{metadata.peak_dow}</strong>.
            </p>
          </div>
          <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
            <p className="font-semibold text-purple-700 mb-1">Eventos (Regressors)</p>
            <p className="text-purple-600 text-xs">
              Residual no explicado por tendencia ni ciclo.
              Incluye promociones, feriados y anomalías de datos.
              En el pronóstico = 0 (sin eventos conocidos).
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
