'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const Plot = dynamic(() => import('react-plotly.js'), { 
  ssr: false 
}) as React.ComponentType<{
  data: PlotlyTrace[] | Array<Record<string, unknown>>;
  layout: Record<string, unknown>;
  config?: Record<string, unknown>;
  style?: React.CSSProperties;
  useResizeHandler?: boolean;
}>;

interface SalesForecastChartProps {
  data: {
    historical: Array<{ date: string; actual: number; target?: number }>;
    forecast: Array<{
      date: string;
      predicted: number;
      lower_bound_80: number;
      upper_bound_80: number;
      lower_bound_95: number;
      upper_bound_95: number;
    }>;
    today: string;
    accuracy?: {
      wmape?: number;
      mape?: number;
      last_30_days?: number;
      accuracy_percentage?: number;
    };
  };
  /**
   * Relative CI-width threshold that triggers the "Manual Review" flag.
   * A forecast point triggers the flag when:
   *   (P95_upper - P95_lower) / predicted  >  ciThresholdPct
   * Default: 0.5 (i.e. flag when the 95 % band is wider than 50 % of the forecast).
   */
  ciThresholdPct?: number;
}

interface PlotlyTrace extends Record<string, unknown> {
  x: string[];
  y: (number | undefined)[];
  name: string;
  type: string;
  mode?: string;
  line?: {
    color?: string;
    width?: number;
    dash?: string;
  };
  fill?: string;
  fillcolor?: string;
  hovertemplate?: string;
  hoverinfo?: string;
  showlegend?: boolean;
}

export function SalesForecastChart({ data, ciThresholdPct = 0.5 }: SalesForecastChartProps) {
  const forecast = data.forecast ?? [];
  const historical = data.historical ?? [];
  const accuracy = data.accuracy ?? {};

  // ── Manual Review flag (Phase 3 – Uncertainty Signal) ──────────────────────
  // Flag any forecast point whose 95 % CI width exceeds ciThresholdPct of the
  // predicted value.  Wide intervals mean the model is uncertain; a human should
  // verify before placing a purchase order.
  const highUncertaintyPoints = forecast.filter(d => {
    if (d.predicted <= 0) return false;
    const ciWidth = d.upper_bound_95 - d.lower_bound_95;
    return ciWidth / d.predicted > ciThresholdPct;
  });
  const needsManualReview = highUncertaintyPoints.length > 0;
  // ───────────────────────────────────────────────────────────────────────────

  // Prepare traces (series)
  const traces: PlotlyTrace[] = [
    // Historical actuals
    {
      x: historical.map(d => d.date),
      y: historical.map(d => d.actual),
      name: 'Ventas Reales',
      type: 'scatter',
      mode: 'lines',
      line: {
        color: '#10b981',
        width: 3
      },
      hovertemplate: '<b>%{x}</b><br>Ventas: %{y:,.0f}<extra></extra>'
    },
    // Target line
    {
      x: historical.map(d => d.date),
      y: historical.map(d => d.target),
      name: 'Meta',
      type: 'scatter',
      mode: 'lines',
      line: {
        color: '#f59e0b',
        width: 2,
        dash: 'dot'
      },
      hovertemplate: '<b>%{x}</b><br>Meta: %{y:,.0f}<extra></extra>'
    },
    // Forecast prediction
    {
      x: forecast.map(d => d.date),
      y: forecast.map(d => d.predicted),
      name: 'Pronóstico',
      type: 'scatter',
      mode: 'lines',
      line: {
        color: '#3b82f6',
        width: 3,
        dash: 'dash'
      },
      hovertemplate: '<b>%{x}</b><br>Pronóstico: %{y:,.0f}<extra></extra>'
    },
    // 95% confidence interval (outer band)
    {
      x: [...forecast.map(d => d.date), ...forecast.map(d => d.date).reverse()],
      y: [
        ...forecast.map(d => d.upper_bound_95),
        ...forecast.map(d => d.lower_bound_95).reverse()
      ],
      fill: 'toself',
      fillcolor: 'rgba(59, 130, 246, 0.1)',
      line: { color: 'transparent' },
      name: 'Intervalo 95%',
      type: 'scatter',
      mode: 'lines',
      hoverinfo: 'skip',
      showlegend: true
    },
    // 80% confidence interval (inner band)
    {
      x: [...forecast.map(d => d.date), ...forecast.map(d => d.date).reverse()],
      y: [
        ...forecast.map(d => d.upper_bound_80),
        ...forecast.map(d => d.lower_bound_80).reverse()
      ],
      fill: 'toself',
      fillcolor: 'rgba(59, 130, 246, 0.2)',
      line: { color: 'transparent' },
      name: 'Intervalo 80%',
      type: 'scatter',
      mode: 'lines',
      hoverinfo: 'skip',
      showlegend: true
    }
  ];

  // Layout configuration
  const layout = {
    autosize: true,
    height: 500,
    margin: { l: 60, r: 40, t: 40, b: 80 },
    hovermode: 'x unified',
    xaxis: {
      title: 'Fecha',
      type: 'date',
      tickformat: '%d %b',
      gridcolor: '#f3f4f6',
      showline: true,
      linecolor: '#e5e7eb'
    },
    yaxis: {
      title: 'Ingresos (GTQ)',
      tickformat: ',.0f',
      gridcolor: '#f3f4f6',
      showline: true,
      linecolor: '#e5e7eb',
      rangemode: 'tozero'
    },
    legend: {
      orientation: 'h',
      x: 0,
      y: -0.2,
      xanchor: 'left',
      yanchor: 'top'
    },
    shapes: [
      // "Today" vertical line
      {
        type: 'line',
        x0: data.today,
        x1: data.today,
        y0: 0,
        y1: 1,
        yref: 'paper',
        line: {
          color: '#6b7280',
          width: 2,
          dash: 'dash'
        }
      }
    ],
    annotations: [
      // "Today" label
      {
        x: data.today,
        y: 1,
        yref: 'paper',
        text: 'Hoy',
        showarrow: false,
        yshift: 10,
        font: {
          size: 12,
          color: '#6b7280'
        }
      }
    ],
    plot_bgcolor: '#ffffff',
    paper_bgcolor: '#ffffff'
  };

  const config = {
    displayModeBar: true,
    displaylogo: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    toImageButtonOptions: {
      format: 'png',
      filename: 'pronostico-ventas',
      height: 800,
      width: 1400,
      scale: 2
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Pronóstico de Ventas Interactivo</CardTitle>
            <CardDescription>
              Histórico, predicción e intervalos de confianza
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            {needsManualReview && (
              <Badge variant="destructive" title={`${highUncertaintyPoints.length} day(s) exceed the ${(ciThresholdPct * 100).toFixed(0)}% CI-width threshold`}>
                ⚠ Revisión Manual Requerida
              </Badge>
            )}
            <Badge variant="outline" className="bg-green-50">
              Precisión: {(accuracy.last_30_days ?? accuracy.accuracy_percentage ?? 0).toFixed(1)}%
            </Badge>
            <Badge variant="outline" className="bg-blue-50">
              WMAPE: {(accuracy.wmape ?? 0).toFixed(2)}%
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Plot
          data={traces}
          layout={layout}
          config={config}
          style={{ width: '100%' }}
          useResizeHandler
        />
        <div className="mt-4 text-sm text-gray-500 space-y-1">
          <p>• <strong>Línea verde sólida:</strong> Ventas históricas reales</p>
          <p>• <strong>Línea azul punteada:</strong> Pronóstico basado en IA</p>
          <p>• <strong>Bandas azules:</strong> Intervalos de confianza (80% y 95%)</p>
          <p>• <strong>Línea amarilla punteada:</strong> Meta de ventas</p>
          {needsManualReview && (
            <p className="text-amber-700 font-medium mt-2">
              ⚠ <strong>Revisión Manual:</strong> {highUncertaintyPoints.length} día(s) tienen un intervalo de confianza mayor al {(ciThresholdPct * 100).toFixed(0)}% del pronóstico. Se recomienda revisión humana antes de emitir la orden de compra.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}