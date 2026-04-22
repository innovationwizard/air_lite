'use client';

import { useState, useEffect, useMemo } from 'react';
import { ScanEye, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface Run {
  run_id: number;
  training_start_date: string;
  training_end_date: string;
  prediction_month: string;
  products_modeled: number;
}

interface ValidationRow {
  run_id: number;
  training_start_date: string;
  training_end_date: string;
  prediction_month: string;
  product_id: number;
  sku: string;
  product_name: string;
  supplier_label: string | null;
  predicted_demand: number | null;
  comprador_purchase_qty: number | null;
  actual_sales_qty: number | null;
  predicted_reorder_point: number | null;
  predicted_safety_stock: number | null;
  acierto_system_pct: number | null;
  acierto_comprador_pct: number | null;
  unit_cost_gtq: number | null;
  unit_price_gtq: number | null;
  predicted_purchase_cost_gtq: number | null;
  predicted_revenue_gtq: number | null;
  predicted_margin_gtq: number | null;
  comprador_purchase_cost_gtq: number | null;
  actual_revenue_gtq: number | null;
  actual_margin_gtq: number | null;
  margin_uplift_gtq: number | null;
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

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(0)}%`;
}

function fmtDateEs(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function predictionMonthLabel(iso: string): string {
  const [year, month] = iso.split('-');
  return `${MONTH_LABELS_ES[month]} ${year}`;
}

function aciertoClass(pct: number | null): string {
  if (pct === null) return 'bg-gray-100 text-gray-500';
  if (pct >= 0.75) return 'bg-green-100 text-green-700';
  if (pct >= 0.5) return 'bg-yellow-100 text-yellow-800';
  return 'bg-red-100 text-red-700';
}

export default function GerenciaValidacionPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [rows, setRows] = useState<ValidationRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [scope, setScope] = useState<'carvajal_reyma' | 'all'>('carvajal_reyma');
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
    const scopeParam = scope === 'all' ? '&scope=all' : '';
    fetch(`/api/gerencia/validacion?run_id=${selectedRunId}${scopeParam}`)
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then((data) => { setRows(data.rows ?? []); setLoadingRows(false); })
      .catch((err) => { setError(String(err)); setLoadingRows(false); });
  }, [selectedRunId, scope]);

  const selectedRun = runs.find((r) => r.run_id === selectedRunId) ?? null;

  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    const systemAciertos = rows.map((r) => r.acierto_system_pct).filter((v): v is number => v !== null);
    const comprAciertos = rows.map((r) => r.acierto_comprador_pct).filter((v): v is number => v !== null);
    const marginUplift = rows.reduce((acc, r) => acc + (r.margin_uplift_gtq ?? 0), 0);
    const predRev = rows.reduce((acc, r) => acc + (r.predicted_revenue_gtq ?? 0), 0);
    const actualRev = rows.reduce((acc, r) => acc + (r.actual_revenue_gtq ?? 0), 0);
    const avg = (arr: number[]) => arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      skuCount: rows.length,
      systemAcierto: avg(systemAciertos),
      comprAcierto: avg(comprAciertos),
      comprAciertoN: comprAciertos.length,
      marginUplift,
      predRev,
      actualRev,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ScanEye className="w-6 h-6 text-emerald-600" />
          Validación Histórica — Gerencia
        </h1>
        <p className="text-gray-500 mt-1">
          Por SKU, mes por mes: qué predijo la App, qué compraron los Humanos, qué se vendió realmente.
        </p>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
        <p className="font-semibold mb-1">Metodología — holdout honesto</p>
        {selectedRun ? (
          <p>
            El modelo fue entrenado con datos del <strong>{fmtDateEs(selectedRun.training_start_date)}</strong> al{' '}
            <strong>{fmtDateEs(selectedRun.training_end_date)}</strong>. A partir de ahí, proyectó la demanda para{' '}
            <strong>{predictionMonthLabel(selectedRun.prediction_month)}</strong> sin haber visto lo que ocurrió
            después. Las cifras reales de esta tabla provienen de Odoo (ventas y órdenes de compra).
            {' '}El ciclo priorizó <strong>{selectedRun.products_modeled}</strong> SKUs de alto movimiento.
          </p>
        ) : (
          <p>Seleccioná un ciclo para ver su ventana de entrenamiento.</p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-500">Ciclo:</label>
        <select
          value={selectedRunId ?? ''}
          onChange={(e) => setSelectedRunId(Number(e.target.value))}
          disabled={loadingRuns}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white min-w-[260px]"
        >
          {runs.map((r) => (
            <option key={r.run_id} value={r.run_id}>
              Predicción para {predictionMonthLabel(r.prediction_month)} (entrenado hasta {fmtDateEs(r.training_end_date)})
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-2 text-sm">
          <button
            onClick={() => setScope('carvajal_reyma')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              scope === 'carvajal_reyma'
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Carvajal + Reyma
          </button>
          <button
            onClick={() => setScope('all')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              scope === 'all'
                ? 'bg-emerald-600 text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Todos los SKUs modelados
          </button>
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="SKUs en comparación"
            value={fmtNum(summary.skuCount)}
            subtitle={scope === 'carvajal_reyma' ? 'Carvajal + Reyma' : `de ${selectedRun?.products_modeled ?? '—'} modelados`}
          />
          <KpiCard
            label="Acierto App (promedio)"
            value={fmtPct(summary.systemAcierto)}
            subtitle="1 − error relativo por SKU"
            color="text-emerald-700"
          />
          <KpiCard
            label="Acierto Humanos"
            value={fmtPct(summary.comprAcierto)}
            subtitle={summary.comprAciertoN > 0 ? `${summary.comprAciertoN} SKUs con OC en el mes` : 'Sin OC en el mes'}
            color="text-blue-700"
          />
          <KpiCard
            label="Margen proyectado vs real"
            value={fmtGtq(summary.marginUplift)}
            subtitle={summary.marginUplift >= 0 ? 'App habría superado' : 'App habría quedado corto'}
            color={summary.marginUplift >= 0 ? 'text-emerald-700' : 'text-red-700'}
          />
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-gray-500 sticky left-0 bg-gray-50">Producto</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Proveedor</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">App predijo</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Humanos compraron</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Se vendió</th>
                <th className="text-center px-3 py-3 font-medium text-gray-500">Acierto App</th>
                <th className="text-center px-3 py-3 font-medium text-gray-500">Acierto Humanos</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Margen proyectado</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Margen real</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Delta (Q)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingRows || loadingRuns ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Cargando datos…</td></tr>
              ) : error ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-red-500">No se pudieron cargar los datos.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Este ciclo no tiene SKUs en el alcance seleccionado.</td></tr>
              ) : (
                rows.map((r) => {
                  const upliftIcon = r.margin_uplift_gtq === null
                    ? Minus
                    : r.margin_uplift_gtq > 0 ? TrendingUp : r.margin_uplift_gtq < 0 ? TrendingDown : Minus;
                  const UpliftIcon = upliftIcon;
                  const upliftColor = r.margin_uplift_gtq === null
                    ? 'text-gray-500'
                    : r.margin_uplift_gtq > 0 ? 'text-emerald-700' : r.margin_uplift_gtq < 0 ? 'text-red-700' : 'text-gray-500';
                  return (
                    <tr key={`${r.run_id}-${r.product_id}`} className="hover:bg-gray-50">
                      <td className="px-3 py-3 sticky left-0 bg-white hover:bg-gray-50">
                        <div className="font-medium text-gray-900 max-w-[220px] truncate" title={r.product_name}>
                          {r.product_name}
                        </div>
                        <div className="text-xs text-gray-400 font-mono">{r.sku}</div>
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs">
                        {r.supplier_label ?? '—'}
                      </td>
                      <td className="px-3 py-3 text-right text-gray-900">{fmtNum(r.predicted_demand)}</td>
                      <td className="px-3 py-3 text-right text-gray-900">{fmtNum(r.comprador_purchase_qty)}</td>
                      <td className="px-3 py-3 text-right text-gray-900 font-medium">{fmtNum(r.actual_sales_qty)}</td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aciertoClass(r.acierto_system_pct)}`}>
                          {fmtPct(r.acierto_system_pct)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${aciertoClass(r.acierto_comprador_pct)}`}>
                          {fmtPct(r.acierto_comprador_pct)}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right text-gray-700">{fmtGtq(r.predicted_margin_gtq)}</td>
                      <td className="px-3 py-3 text-right text-gray-700">{fmtGtq(r.actual_margin_gtq)}</td>
                      <td className={`px-3 py-3 text-right font-medium ${upliftColor}`}>
                        <span className="inline-flex items-center gap-1 justify-end">
                          <UpliftIcon className="w-3.5 h-3.5" />
                          {fmtGtq(r.margin_uplift_gtq)}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="font-semibold text-gray-700">Notas de transparencia</p>
        <p>
          <strong>Crédito vs bruto:</strong> los montos en GTQ se calculan sobre las ventas registradas en la base
          de datos. Está <em>pendiente de verificar con David</em> si esta cifra es neta o bruta de notas de crédito.
          El número puede estar inflado entre 3–10% si incluye devoluciones. Pregunta a levantar en la reunión.
        </p>
        <p>
          <strong>Reyma por nombre:</strong> el catálogo de Odoo tiene un proveedor &quot;REYMA DEL SURESTE&quot; registrado,
          pero la tabla de relaciones producto-proveedor no tiene a Reyma cargado. Los SKUs con etiqueta
          &quot;Reyma (por nombre)&quot; se identifican por el nombre del producto. Corregir post-demo.
        </p>
        <p>
          <strong>Margen proyectado:</strong> asume que la demanda pronosticada se habría vendido al precio de
          lista. Es un techo teórico. En SKUs con acierto bajo, el margen real alcanzable habría sido menor.
        </p>
        <p>
          <strong>Órdenes de compra:</strong> &quot;Humanos compraron&quot; cuenta solo OC en estado <code>purchase</code>
          o <code>done</code>. Borradores y canceladas no cuentan.
        </p>
      </div>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  subtitle: string;
  color?: string;
}

function KpiCard({ label, value, subtitle, color = 'text-gray-900' }: KpiCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      <p className="text-xs text-gray-400 mt-1">{subtitle}</p>
    </div>
  );
}
