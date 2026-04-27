'use client';

import { useState, useEffect } from 'react';
import { ScanEye } from 'lucide-react';

interface GapRow {
  sku: string;
  product_name: string;
  supplier_class: string;
  sales_qty: number;
  sales_revenue_gtq: number;
  purchases_ordered_qty: number;
  purchases_received_qty: number;
}

const MONTH_LABELS_ES: Record<string, string> = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
  '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
  '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
};

// Data is intentionally capped at Jan 2026 — Feb/Mar/Apr are blind-test months.
const MAX_MONTH = '2026-01';

const MONTH_NAV: Record<string, string[]> = {
  '2024': ['2024-01','2024-02','2024-03','2024-04','2024-05','2024-06','2024-07','2024-08','2024-09','2024-10','2024-11','2024-12'],
  '2025': ['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12'],
  '2026': ['2026-01'],
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

export default function GerenciaValidacionPage() {
  const [selectedMonth, setSelectedMonth] = useState<string>('2025-02');
  const [rows, setRows] = useState<GapRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/acid-test/gap-report?action=report&scope=top&from=${selectedMonth}&to=${selectedMonth}`)
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then((data) => { setRows(data.rows ?? []); setLoading(false); })
      .catch((err) => { setError(String(err)); setLoading(false); });
  }, [selectedMonth]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ScanEye className="w-6 h-6 text-emerald-600" />
          Validación Histórica
        </h1>
      </div>

      {/* Month navigation */}
      <div className="space-y-2">
        {Object.entries(MONTH_NAV).map(([year, months]) => (
          <div key={year} className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-400 w-8 shrink-0">{year}</span>
            {months.map((ym) => {
              const [, mm] = ym.split('-');
              const isActive = selectedMonth === ym;
              return (
                <button
                  key={ym}
                  onClick={() => setSelectedMonth(ym)}
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
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-3 font-medium text-gray-500 sticky left-0 bg-gray-50">Producto</th>
                <th className="text-left px-3 py-3 font-medium text-gray-500">Proveedor</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Ventas (unidades)</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Ventas (GTQ)</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Compras (unidades)</th>
                <th className="text-right px-3 py-3 font-medium text-gray-500">Recibido (unidades)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando datos…</td></tr>
              ) : error ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-red-500">No se pudieron cargar los datos.</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Sin datos para el mes seleccionado.</td></tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.sku} className="hover:bg-gray-50">
                    <td className="px-3 py-3 sticky left-0 bg-white hover:bg-gray-50">
                      <div className="font-medium text-gray-900 max-w-[220px] truncate" title={r.product_name}>
                        {r.product_name}
                      </div>
                      <div className="text-xs text-gray-400 font-mono">{r.sku}</div>
                    </td>
                    <td className="px-3 py-3 text-gray-600 text-xs">{r.supplier_class ?? '—'}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{fmtNum(r.sales_qty)}</td>
                    <td className="px-3 py-3 text-right text-gray-700">{fmtGtq(r.sales_revenue_gtq)}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{fmtNum(r.purchases_ordered_qty)}</td>
                    <td className="px-3 py-3 text-right text-gray-900">{fmtNum(r.purchases_received_qty)}</td>
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
