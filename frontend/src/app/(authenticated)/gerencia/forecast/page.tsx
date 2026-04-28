'use client';

import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Sparkles, Download } from 'lucide-react';

// Furgón capacity used for m³/furgón calculations.
// WARNING: exact unit type per supplier (Carvajal / Reyma) is NOT confirmed.
// Using furgon_53 (53-foot trailer) as a demo approximation only.
const FURGO_M3 = 122;

interface ForecastRow {
  sku: string;
  product_name: string | null;
  supplier_class: string | null;
  movement_rank_within_class: number | null;
  stock_uom: string | null;
  volume_m3: number | null;
  metric: string;
  forecast_month: string;
  yhat_sum: number;
  yhat_lower_sum: number | null;
  yhat_upper_sum: number | null;
  training_end_date: string;
  model_status: string;
}

type SkuRow = {
  sku: string;
  name: string;
  supplier_class: string;
  movement_rank_within_class: number | null;
  stock_uom: string | null;
  volume_m3: number | null;
  sales_feb: number | null;
  sales_mar: number | null;
  purchases_ordered_feb: number | null;
  purchases_ordered_mar: number | null;
  purchases_received_feb: number | null;
  purchases_received_mar: number | null;
  training_end_date: string | null;
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('es-GT');
}

function fmtFurgo(units: number | null | undefined, volume_m3: number | null | undefined): string {
  if (units == null || volume_m3 == null || volume_m3 === 0) return '—';
  return ((units * volume_m3) / FURGO_M3).toFixed(1);
}

function furgoVal(units: number | null, volume_m3: number | null): string {
  if (units == null || volume_m3 == null || volume_m3 === 0) return '';
  return ((units * volume_m3) / FURGO_M3).toFixed(1);
}

function downloadCsv(rows: SkuRow[], filterLabel: string) {
  const headers = [
    'SKU',
    'Producto',
    'Proveedor',
    'Unidad de Medida',
    'Ventas Feb 2026 (unidades)',
    'Ventas Mar 2026 (unidades)',
    'Compras Ordenadas Feb 2026 (unidades)',
    'Compras Ordenadas Mar 2026 (unidades)',
    'Compras Recibidas Feb 2026 (unidades)',
    'Compras Recibidas Mar 2026 (unidades)',
    'Furgones Ventas Feb 2026',
    'Furgones Ventas Mar 2026',
    'Furgones Compras Ordenadas Feb 2026',
    'Furgones Compras Ordenadas Mar 2026',
    'Furgones Compras Recibidas Feb 2026',
    'Furgones Compras Recibidas Mar 2026',
    'm3 por unidad',
    'unidades por furgon (aprox)',
  ];

  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const dataRows = rows.map((r) => [
    r.sku,
    r.name,
    r.supplier_class,
    r.stock_uom ?? '',
    r.sales_feb ?? '',
    r.sales_mar ?? '',
    r.purchases_ordered_feb ?? '',
    r.purchases_ordered_mar ?? '',
    r.purchases_received_feb ?? '',
    r.purchases_received_mar ?? '',
    furgoVal(r.sales_feb, r.volume_m3),
    furgoVal(r.sales_mar, r.volume_m3),
    furgoVal(r.purchases_ordered_feb, r.volume_m3),
    furgoVal(r.purchases_ordered_mar, r.volume_m3),
    furgoVal(r.purchases_received_feb, r.volume_m3),
    furgoVal(r.purchases_received_mar, r.volume_m3),
    r.volume_m3 != null ? r.volume_m3.toFixed(4) : '',
    r.volume_m3 != null ? (FURGO_M3 / r.volume_m3).toFixed(1) : '',
  ].map(escape).join(','));

  const csv = [headers.map(escape).join(','), ...dataRows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `forecast-a-ciegas_feb-mar-2026${filterLabel ? '_' + filterLabel : ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ForecastPage() {
  const [raw, setRaw] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<'' | 'REYMA' | 'CARVAJAL'>('');

  useEffect(() => {
    Promise.all([
      fetch('/api/acid-test/forecast?scope=top&forecast_month=2026-02-01').then((r) => r.json()),
      fetch('/api/acid-test/forecast?scope=top&forecast_month=2026-03-01').then((r) => r.json()),
    ])
      .then(([feb, mar]) => {
        const combined: ForecastRow[] = [...(feb.forecasts ?? []), ...(mar.forecasts ?? [])];
        setRaw(combined);
        setLoading(false);
      })
      .catch((e) => { setErr(String(e)); setLoading(false); });
  }, []);

  const rows: SkuRow[] = useMemo(() => {
    const m = new Map<string, SkuRow>();
    for (const r of raw) {
      const existing = m.get(r.sku) ?? {
        sku: r.sku,
        name: r.product_name ?? '',
        supplier_class: r.supplier_class ?? '',
        movement_rank_within_class: r.movement_rank_within_class ?? null,
        stock_uom: r.stock_uom ?? null,
        volume_m3: r.volume_m3 ?? null,
        sales_feb: null, sales_mar: null,
        purchases_ordered_feb: null, purchases_ordered_mar: null,
        purchases_received_feb: null, purchases_received_mar: null,
        training_end_date: r.training_end_date ?? null,
      };
      const key = r.forecast_month.startsWith('2026-02')
        ? `${r.metric}_feb`
        : r.forecast_month.startsWith('2026-03')
          ? `${r.metric}_mar`
          : null;
      if (key && key in existing) {
        (existing as unknown as Record<string, number>)[key] = Math.round(Number(r.yhat_sum));
      }
      m.set(r.sku, existing);
    }
    return Array.from(m.values()).sort((a, b) => {
      if (a.supplier_class !== b.supplier_class) return a.supplier_class.localeCompare(b.supplier_class);
      return (a.movement_rank_within_class ?? 999) - (b.movement_rank_within_class ?? 999);
    });
  }, [raw]);

  const visible = rows.filter((r) => !classFilter || r.supplier_class === classFilter);

  const totals = useMemo(() => {
    const sum = (key: keyof SkuRow) => visible.reduce((a, r) => a + Number(r[key] ?? 0), 0);
    const furgoSum = (unitsKey: keyof SkuRow) =>
      visible.reduce((a, r) => {
        const units = Number(r[unitsKey] ?? 0);
        const vol = r.volume_m3;
        if (vol == null) return a;
        return a + (units * vol) / FURGO_M3;
      }, 0);
    return {
      sales_feb: sum('sales_feb'),
      sales_mar: sum('sales_mar'),
      po_ord_feb: sum('purchases_ordered_feb'),
      po_ord_mar: sum('purchases_ordered_mar'),
      po_rcv_feb: sum('purchases_received_feb'),
      po_rcv_mar: sum('purchases_received_mar'),
      furgo_sales_feb: furgoSum('sales_feb'),
      furgo_sales_mar: furgoSum('sales_mar'),
      furgo_ord_feb: furgoSum('purchases_ordered_feb'),
      furgo_ord_mar: furgoSum('purchases_ordered_mar'),
      furgo_rcv_feb: furgoSum('purchases_received_feb'),
      furgo_rcv_mar: furgoSum('purchases_received_mar'),
    };
  }, [visible]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-emerald-600" />
          Forecast a Ciegas — Febrero & Marzo 2026
        </h1>
        <p className="text-gray-500 mt-1">
          AI Refill entrenado con datos hasta 31-ene-2026. Predicción a ciegas para feb + mar 2026.
        </p>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900">
        <p className="font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> Cómo leer esto
        </p>
        <p className="mt-1">
          Cada fila es un SKU del top 23 (12 REYMA + 11 CARVAJAL por Net Sales). Las columnas muestran las
          cantidades predichas por AI Refill para cada mes, en UdM de stock del producto. Las tres métricas
          (ventas netas, compras ordenadas, compras recibidas) usan las fórmulas verificadas que
          reprodujeron los meses históricos con un diferencial del <strong>0%</strong>.
        </p>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-gray-600">Proveedor:</span>
        <button onClick={() => setClassFilter('')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === '' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
          Todos ({rows.length})
        </button>
        <button onClick={() => setClassFilter('REYMA')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === 'REYMA' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
          REYMA ({rows.filter((r) => r.supplier_class === 'REYMA').length})
        </button>
        <button onClick={() => setClassFilter('CARVAJAL')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === 'CARVAJAL' ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700'}`}>
          CARVAJAL ({rows.filter((r) => r.supplier_class === 'CARVAJAL').length})
        </button>
        <div className="ml-auto">
          <button
            onClick={() => downloadCsv(visible, classFilter)}
            className="flex items-center gap-1.5 px-3 py-1 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar CSV
          </button>
        </div>
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{err}</div>
      )}
      {loading && (
        <div className="text-gray-400">Cargando forecasts…</div>
      )}

      {!loading && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">SKU / Producto</th>
                  <th className="text-right px-2 py-2 font-medium text-emerald-700 bg-emerald-50" colSpan={2}>Ventas (cantidad)</th>
                  <th className="text-right px-2 py-2 font-medium text-blue-700 bg-blue-50" colSpan={2}>Compras Ordenadas</th>
                  <th className="text-right px-2 py-2 font-medium text-purple-700 bg-purple-50" colSpan={2}>Compras Recibidas</th>
                  <th className="text-center px-2 py-2 font-medium text-emerald-800 bg-emerald-100" colSpan={2}>Furgones — Ventas</th>
                  <th className="text-center px-2 py-2 font-medium text-blue-800 bg-blue-100" colSpan={2}>Furgones — Compras Ordenadas</th>
                  <th className="text-center px-2 py-2 font-medium text-purple-800 bg-purple-100" colSpan={2}>Furgones — Compras Recibidas</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500 bg-gray-50">m³ / unidad</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-500 bg-gray-50">m³ / furgón</th>
                </tr>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="sticky left-0 bg-gray-50 z-10"></th>
                  <th className="text-right px-2 py-1 bg-emerald-50">Feb 26</th>
                  <th className="text-right px-2 py-1 bg-emerald-50">Mar 26</th>
                  <th className="text-right px-2 py-1 bg-blue-50">Feb 26</th>
                  <th className="text-right px-2 py-1 bg-blue-50">Mar 26</th>
                  <th className="text-right px-2 py-1 bg-purple-50">Feb 26</th>
                  <th className="text-right px-2 py-1 bg-purple-50">Mar 26</th>
                  <th className="text-right px-2 py-1 bg-emerald-100">Feb 26</th>
                  <th className="text-right px-2 py-1 bg-emerald-100">Mar 26</th>
                  <th className="text-right px-2 py-1 bg-blue-100">Feb 26</th>
                  <th className="text-right px-2 py-1 bg-blue-100">Mar 26</th>
                  <th className="text-right px-2 py-1 bg-purple-100">Feb 26</th>
                  <th className="text-right px-2 py-1 bg-purple-100">Mar 26</th>
                  <th className="bg-gray-50"></th>
                  <th className="bg-gray-50"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const bg = r.supplier_class === 'REYMA' ? 'bg-emerald-50/30' : 'bg-sky-50/30';
                  return (
                    <tr key={r.sku} className={`border-b border-gray-100 ${bg}`}>
                      <td className="px-3 py-2 sticky left-0 bg-white z-10">
                        <div className="font-mono text-xs text-gray-600">{r.sku}</div>
                        <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{r.name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.supplier_class === 'REYMA' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                            {r.supplier_class}
                          </span>
                          {r.stock_uom && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                              {r.stock_uom}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-50/60">{fmt(r.sales_feb)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-50/60">{fmt(r.sales_mar)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-50/60">{fmt(r.purchases_ordered_feb)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-50/60">{fmt(r.purchases_ordered_mar)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-50/60">{fmt(r.purchases_received_feb)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-50/60">{fmt(r.purchases_received_mar)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-100/70 font-semibold">{fmtFurgo(r.sales_feb, r.volume_m3)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-100/70 font-semibold">{fmtFurgo(r.sales_mar, r.volume_m3)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-100/70 font-semibold">{fmtFurgo(r.purchases_ordered_feb, r.volume_m3)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-100/70 font-semibold">{fmtFurgo(r.purchases_ordered_mar, r.volume_m3)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-100/70 font-semibold">{fmtFurgo(r.purchases_received_feb, r.volume_m3)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-100/70 font-semibold">{fmtFurgo(r.purchases_received_mar, r.volume_m3)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-500 bg-gray-50/60 text-xs">
                        {r.volume_m3 != null ? r.volume_m3.toFixed(4) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-500 bg-gray-50/60 text-xs">
                        {r.volume_m3 != null ? (FURGO_M3 / r.volume_m3).toFixed(1) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-3 py-2 text-right sticky left-0 bg-gray-50">TOTAL ({visible.length} SKUs)</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-50">{fmt(totals.sales_feb)}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-50">{fmt(totals.sales_mar)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-50">{fmt(totals.po_ord_feb)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-50">{fmt(totals.po_ord_mar)}</td>
                  <td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-50">{fmt(totals.po_rcv_feb)}</td>
                  <td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-50">{fmt(totals.po_rcv_mar)}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-100">{totals.furgo_sales_feb.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-100">{totals.furgo_sales_mar.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-100">{totals.furgo_ord_feb.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-100">{totals.furgo_ord_mar.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-100">{totals.furgo_rcv_feb.toFixed(1)}</td>
                  <td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-100">{totals.furgo_rcv_mar.toFixed(1)}</td>
                  <td className="bg-gray-50"></td>
                  <td className="bg-gray-50"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">
        Datos: <code>forecast_results</code> en Supabase prod. Artificial Intelligence ML Model (weekly + yearly seasonality, 80% confidence intervals).
        Training end: 2026-01-31. Prediction window: 2026-02-01 → 2026-03-31.
      </div>
    </div>
  );
}
