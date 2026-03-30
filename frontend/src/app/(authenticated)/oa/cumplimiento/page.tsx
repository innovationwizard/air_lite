'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { FileCheck } from 'lucide-react';

interface OpenOrder {
  id: number;
  supplier_id: number;
  month: string;
  total_forecast_qty: number;
  total_forecast_value: number;
  status: string;
  notes: string | null;
  created_at: string;
}

interface WeeklyRow {
  week_number: number;
  week_start: string;
  week_end: string;
  total_planned: number;
  total_dispatched: number;
  compliance_pct: number;
  alert_level: 'rojo' | 'amarillo' | 'verde' | 'sin_plan';
}

interface GlobalCompliance {
  total_oa_qty: number;
  total_dispatched_qty: number;
  global_compliance_pct: number;
  weeks_completed: number;
  weeks_total: number;
}

interface ComplianceResponse {
  weekly: WeeklyRow[];
  global: GlobalCompliance;
}

const fmt = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtPct = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';

const ALERT_BADGES: Record<string, { bg: string; text: string; label: string }> = {
  rojo: { bg: 'bg-red-100', text: 'text-red-700', label: 'Retraso' },
  amarillo: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Exceso' },
  verde: { bg: 'bg-green-100', text: 'text-green-700', label: 'OK' },
  sin_plan: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Sin plan' },
};

export default function CumplimientoPage() {
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [selectedOA, setSelectedOA] = useState<number | null>(null);
  const [compliance, setCompliance] = useState<ComplianceResponse | null>(null);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingCompliance, setLoadingCompliance] = useState(false);

  useEffect(() => {
    fetch('/api/oa/open-orders')
      .then((res) => res.json())
      .then((d) => {
        const orders: OpenOrder[] = Array.isArray(d) ? d : d.orders ?? [];
        setOpenOrders(orders);
        setLoadingOrders(false);
      })
      .catch(() => setLoadingOrders(false));
  }, []);

  useEffect(() => {
    if (!selectedOA) {
      setCompliance(null);
      return;
    }
    setLoadingCompliance(true);
    fetch(`/api/oa/compliance?open_order_id=${selectedOA}`)
      .then((res) => res.json())
      .then((d: ComplianceResponse) => {
        setCompliance(d);
        setLoadingCompliance(false);
      })
      .catch(() => setLoadingCompliance(false));
  }, [selectedOA]);

  const g = compliance?.global;
  const weeks = compliance?.weekly ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <FileCheck className="w-6 h-6 text-emerald-600" />
          Cumplimiento de Orden Abierta
        </h1>
        <p className="text-gray-500 mt-1">
          Seguimiento semanal de despachos vs. planificación
        </p>
      </div>

      {/* Order selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Seleccionar Orden Abierta
        </label>
        {loadingOrders ? (
          <p className="text-sm text-gray-400">Cargando órdenes...</p>
        ) : openOrders.length === 0 ? (
          <p className="text-sm text-gray-400">
            No hay órdenes abiertas registradas
          </p>
        ) : (
          <select
            value={selectedOA ?? ''}
            onChange={(e) => setSelectedOA(e.target.value ? Number(e.target.value) : null)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white w-full max-w-md focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="">-- Seleccione una orden --</option>
            {openOrders.map((o) => (
              <option key={o.id} value={o.id}>
                OA #{o.id} — Proveedor #{o.supplier_id} — {o.month} ({o.status})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Compliance content */}
      {selectedOA && (
        <>
          {loadingCompliance ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              Cargando datos de cumplimiento...
            </div>
          ) : g ? (
            <>
              {/* KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">OA Total</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">
                    {fmt(g.total_oa_qty)}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">Total Despachado</p>
                  <p className="text-3xl font-bold text-emerald-600 mt-1">
                    {fmt(g.total_dispatched_qty)}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">% Cumplimiento</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">
                    {fmtPct(g.global_compliance_pct)}
                  </p>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">Semanas Completadas</p>
                  <p className="text-3xl font-bold text-gray-900 mt-1">
                    {g.weeks_completed} / {g.weeks_total}
                  </p>
                </div>
              </div>

              {/* Weekly breakdown */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Semana</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Inicio</th>
                        <th className="text-left px-4 py-3 font-medium text-gray-500">Fin</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-500">Planificado</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-500">Despachado</th>
                        <th className="text-right px-4 py-3 font-medium text-gray-500">% Cumplimiento</th>
                        <th className="text-center px-4 py-3 font-medium text-gray-500">Alerta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {weeks.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                            No hay datos semanales disponibles
                          </td>
                        </tr>
                      ) : (
                        weeks.map((w) => {
                          const badge = ALERT_BADGES[w.alert_level] ?? ALERT_BADGES.verde;
                          return (
                            <tr key={w.week_number} className="hover:bg-gray-50">
                              <td className="px-4 py-3 font-medium text-gray-900">
                                Semana {w.week_number}
                              </td>
                              <td className="px-4 py-3 text-gray-500">{w.week_start}</td>
                              <td className="px-4 py-3 text-gray-500">{w.week_end}</td>
                              <td className="px-4 py-3 text-right text-gray-900">
                                {fmt(w.total_planned)}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-900">
                                {fmt(w.total_dispatched)}
                              </td>
                              <td className="px-4 py-3 text-right text-gray-900">
                                {fmtPct(w.compliance_pct)}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span
                                  className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${badge.bg} ${badge.text}`}
                                >
                                  {badge.label}
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
            </>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
              No se pudieron cargar los datos de cumplimiento
            </div>
          )}
        </>
      )}
    </div>
  );
}
