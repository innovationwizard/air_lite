'use client';

import { useState, useEffect } from 'react';
import { ScanEye } from 'lucide-react';

interface Run {
  run_id: number;
  training_end_date: string;
  prediction_month: string;
  products_modeled: number;
}

interface ValidationRow {
  run_id: number;
  product_id: number;
  sku: string;
  product_name: string;
  supplier_label: string | null;
  comprador_purchase_qty: number | null;
  comprador_purchase_cost_gtq: number | null;
  actual_sales_qty: number | null;
  actual_revenue_gtq: number | null;
}

const MONTH_LABELS_ES: Record<string, string> = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
  '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
  '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
};

function fmtNum(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('es-GT', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtGtq(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `Q ${(n / 1_000_000).toLocaleString('es-GT', { maximumFractionDigits: 2 })} M`;
  if (abs >= 1_000) return `Q ${(n / 1_000).toLocaleString('es-GT', { maximumFractionDigits: 1 })} k`;
  return `Q ${n.toLocaleString('es-GT', { maximumFractionDigits: 0 })}`;
}

function fmtDateEs(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function predictionMonthLabel(iso: string): string {
  const [year, month] = iso.split('-');
  return `${MONTH_LABELS_ES[month]} ${year}`;
}

export default function GerenciaValidacionPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [rows, setRows] = useState<ValidationRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/gerencia/validacion')
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then((data) => {
        const list: Run[] = data.runs ?? [];
        setRuns(list);
        const run58 = list.find((r) => r.run_id === 58);
        setSelectedRunId(run58 ? 58 : list[0]?.run_id ?? null);
        setLoadingRuns(false);
      })
      .catch((err) => { setError(String(err)); setLoadingRuns(false); });
  }, []);

  useEffect(() => {
    if (selectedRunId === null) return;
    setLoadingRows(true);
    setError(null);
    fetch(`/api/gerencia/validacion?run_id=${selectedRunId}`)
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then((data) => { setRows(data.rows ?? []); setLoadingRows(false); })
      .catch((err) => { setError(String(err)); setLoadingRows(false); });
  }, [selectedRunId]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ScanEye className="w-6 h-6 text-emerald-600" />
          Validación Histórica
        </h1>
      </div>

      {/* Month navigation */}
      {!loadingRuns && (() => {
        const runByMonth = new Map(runs.map((r) => [r.prediction_month, r]));
        const byYear = runs.reduce<Record<string, true>>((acc, r) => {
          acc[r.prediction_month.split('-')[0]] = true;
          return acc;
        }, {});
        const years2025plus = Object.keys(byYear).filter((y) => y !== '2024').sort();
        const ALL_2024 = ['01','02','03','04','05','06','07','08','09','10','11','12'];

        return (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-400 w-8 shrink-0">2024</span>
              {ALL_2024.map((mm) => {
                const ym = `2024-${mm}`;
                const run = runByMonth.get(ym) ?? null;
                const isActive = run !== null && run.run_id === selectedRunId;
                return run ? (
                  <button
                    key={ym}
                    onClick={() => setSelectedRunId(run.run_id)}
                    title={`${predictionMonthLabel(ym)} — datos hasta ${fmtDateEs(run.training_end_date)}`}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {MONTH_LABELS_ES[mm]}
                  </button>
                ) : (
                  <span key={ym} className="px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-100 text-gray-300 cursor-default">
                    {MONTH_LABELS_ES[mm]}
                  </span>
                );
              })}
            </div>
            {years2025plus.map((year) => {
              const yearRuns = runs.filter((r) => r.prediction_month.startsWith(year));
              return (
                <div key={year} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-400 w-8 shrink-0">{year}</span>
                  {yearRuns.map((r) => {
                    const [, mm] = r.prediction_month.split('-');
                    const isActive = r.run_id === selectedRunId;
                    return (
                      <button
                        key={r.run_id}
                        onClick={() => setSelectedRunId(r.run_id)}
                        title={`${predictionMonthLabel(r.prediction_month)} — datos hasta ${fmtDateEs(r.training_end_date)}`}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                          isActive
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        {MONTH_LABELS_ES[mm]}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })()}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-gray-500 sticky left-0 bg-gray-50">Producto</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Proveedor</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Ventas (unid)</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Ventas GTQ</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Compras (unid)</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Compras GTQ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingRows || loadingRuns ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando datos…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-red-500">No se pudieron cargar los datos.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin datos para el mes seleccionado.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={`${r.run_id}-${r.product_id}`} className="hover:bg-gray-50">
                    <td className="px-3 py-3 sticky left-0 bg-white hover:bg-gray-50">
                      <div className="font-medium text-gray-900 max-w-[220px] truncate" title={r.product_name}>
                        {r.product_name}
                      </div>
                      <div className="text-xs text-gray-400 font-mono">{r.sku}</div>
                    </td>
                    <td className="px-3 py-3 text-gray-600 text-xs">{r.supplier_label ?? '—'}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{fmtNum(r.actual_sales_qty)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{fmtGtq(r.actual_revenue_gtq)}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{fmtNum(r.comprador_purchase_qty)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{fmtGtq(r.comprador_purchase_cost_gtq)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="font-semibold text-gray-700">Notas</p>
        <p>
          <strong>Crédito vs bruto:</strong> los montos GTQ se calculan sobre ventas registradas en Odoo.
          Pendiente verificar con David si son netos o brutos de notas de crédito (posible inflación de 3–10%).
        </p>
        <p>
          <strong>Reyma por nombre:</strong> la tabla de relaciones producto-proveedor no tiene a Reyma cargado.
          SKUs etiquetados &quot;Reyma (por nombre)&quot; se identifican por nombre del producto. Corregir post-demo.
        </p>
        <p>
          <strong>Órdenes de compra:</strong> &quot;Compras&quot; cuenta solo OC en estado <code>purchase</code> o <code>done</code>. Borradores y canceladas no cuentan.
        </p>
      </div>
    </div>
  );
}
