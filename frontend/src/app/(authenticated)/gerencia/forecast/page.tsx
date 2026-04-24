'use client';

import { useState, useEffect, useMemo } from 'react';
import { TrendingUp, Sparkles } from 'lucide-react';

interface ForecastRow {
  sku: string;
  product_name: string | null;
  supplier_class: string | null;
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
      return a.sku.localeCompare(b.sku);
    });
  }, [raw]);

  const visible = rows.filter((r) => !classFilter || r.supplier_class === classFilter);

  const totals = useMemo(() => {
    const sum = (key: keyof SkuRow) => visible.reduce((a, r) => a + Number(r[key] ?? 0), 0);
    return {
      sales_feb: sum('sales_feb'),
      sales_mar: sum('sales_mar'),
      po_ord_feb: sum('purchases_ordered_feb'),
      po_ord_mar: sum('purchases_ordered_mar'),
      po_rcv_feb: sum('purchases_received_feb'),
      po_rcv_mar: sum('purchases_received_mar'),
    };
  }, [visible]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-emerald-600" />
          Forecast Ciego — Febrero & Marzo 2026
        </h1>
        <p className="text-gray-500 mt-1">
          Prophet entrenado con datos hasta 31-ene-2026. Predicción a ciegas para feb + mar 2026.
          Fórmula SSOT: <code className="text-xs bg-gray-100 px-1 rounded">aml.income.posted.invoice±refund.invoice_date</code>.
        </p>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900">
        <p className="font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> Acid Test 2 — cómo leer esto
        </p>
        <p className="mt-1">
          Cada fila es un SKU del top 23 (12 REYMA + 11 CARVAJAL por Net Sales). Las columnas muestran las
          cantidades predichas por Prophet para cada mes, en UdM de stock del producto. Las tres métricas
          (ventas netas, compras ordenadas, compras recibidas) usan las tres fórmulas SSOT que ya
          reprodujeron los anclajes del CEO para los meses históricos.
        </p>
      </div>

      <div className="flex gap-2 items-center">
        <span className="text-sm text-gray-600">Clase:</span>
        <button onClick={() => setClassFilter('')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === '' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
          Todas ({rows.length})
        </button>
        <button onClick={() => setClassFilter('REYMA')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === 'REYMA' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
          REYMA ({rows.filter((r) => r.supplier_class === 'REYMA').length})
        </button>
        <button onClick={() => setClassFilter('CARVAJAL')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === 'CARVAJAL' ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700'}`}>
          CARVAJAL ({rows.filter((r) => r.supplier_class === 'CARVAJAL').length})
        </button>
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
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">SKU / Producto</th>
                  <th className="text-right px-2 py-2 font-medium text-emerald-700" colSpan={2}>Ventas (cant)</th>
                  <th className="text-right px-2 py-2 font-medium text-blue-700" colSpan={2}>Compras Ord</th>
                  <th className="text-right px-2 py-2 font-medium text-purple-700" colSpan={2}>Compras Rec</th>
                </tr>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="sticky left-0 bg-gray-50 z-10"></th>
                  <th className="text-right px-2 py-1">Feb 26</th>
                  <th className="text-right px-2 py-1">Mar 26</th>
                  <th className="text-right px-2 py-1">Feb 26</th>
                  <th className="text-right px-2 py-1">Mar 26</th>
                  <th className="text-right px-2 py-1">Feb 26</th>
                  <th className="text-right px-2 py-1">Mar 26</th>
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
                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.supplier_class === 'REYMA' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                          {r.supplier_class}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-900">{fmt(r.sales_feb)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-emerald-900">{fmt(r.sales_mar)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-900">{fmt(r.purchases_ordered_feb)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-blue-900">{fmt(r.purchases_ordered_mar)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-900">{fmt(r.purchases_received_feb)}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-purple-900">{fmt(r.purchases_received_mar)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-3 py-2 text-right sticky left-0 bg-gray-50">TOTAL ({visible.length} SKUs)</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-900">{fmt(totals.sales_feb)}</td>
                  <td className="px-2 py-2 text-right font-mono text-emerald-900">{fmt(totals.sales_mar)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-900">{fmt(totals.po_ord_feb)}</td>
                  <td className="px-2 py-2 text-right font-mono text-blue-900">{fmt(totals.po_ord_mar)}</td>
                  <td className="px-2 py-2 text-right font-mono text-purple-900">{fmt(totals.po_rcv_feb)}</td>
                  <td className="px-2 py-2 text-right font-mono text-purple-900">{fmt(totals.po_rcv_mar)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">
        Datos: <code>forecast_results</code> en Supabase prod. Modelo: Prophet (weekly + yearly seasonality, 80% confidence intervals).
        Training end: 2026-01-31. Prediction window: 2026-02-01 → 2026-03-31.
      </div>
    </div>
  );
}
