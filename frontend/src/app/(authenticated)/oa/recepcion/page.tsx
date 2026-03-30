'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Container, Calendar, AlertTriangle, Warehouse } from 'lucide-react';

interface TruckRow {
  id: number;
  supplier_id: string;
  unit_type: string;
  scheduled_time: string;
  estimated_hours: number;
  status: string;
  priority: string;
  hot_list_products: number[] | null;
}

interface ReceptionRow {
  scheduled_date: string;
  total_trucks: number;
  total_unload_hours: number;
  available_dock_hours: number;
  saturation_pct: number;
  is_saturated: boolean;
  warehouse_name?: string;
  trucks: TruckRow[];
}

const WAREHOUSES = [
  { id: '1', name: 'Bodega Central' },
  { id: '2', name: 'Zona 11' },
  { id: '3', name: 'Peten' },
  { id: '4', name: 'Zacapa' },
];

const UNIT_TYPE_LABELS: Record<string, string> = {
  furgon_53: "Furg\u00f3n 53'",
  contenedor_40: "Contenedor 40'",
  contenedor_45: "Contenedor 45'",
  camion_local: 'Cami\u00f3n Local',
};

const fmtDec = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const fmtPct = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + '%';

const saturationColor = (pct: number) => {
  if (pct > 100) return { bg: 'bg-red-500', text: 'text-red-700', border: 'border-red-200', light: 'bg-red-50' };
  if (pct >= 80) return { bg: 'bg-amber-500', text: 'text-amber-700', border: 'border-amber-200', light: 'bg-amber-50' };
  return { bg: 'bg-green-500', text: 'text-green-700', border: 'border-green-200', light: 'bg-green-50' };
};

const STATUS_COLORS: Record<string, string> = {
  programado: 'bg-blue-100 text-blue-700',
  en_descarga: 'bg-amber-100 text-amber-700',
  completado: 'bg-green-100 text-green-700',
  cancelado: 'bg-gray-100 text-gray-600',
};

const PRIORITY_COLORS: Record<string, string> = {
  alta: 'bg-red-100 text-red-700',
  media: 'bg-amber-100 text-amber-700',
  baja: 'bg-green-100 text-green-700',
};

export default function RecepcionPage() {
  const [data, setData] = useState<ReceptionRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [empty, setEmpty] = useState(false);
  const [warehouseFilter, setWarehouseFilter] = useState('1');
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  });

  useEffect(() => {
    setLoading(true);
    setEmpty(false);
    setData(null);
    const params = new URLSearchParams({ date: selectedDate, warehouse_id: warehouseFilter });
    fetch(`/api/oa/reception?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        const rows: ReceptionRow[] = Array.isArray(json) ? json : json.data ?? [];
        if (rows.length > 0) {
          setData(rows[0]);
          setEmpty(false);
        } else {
          setData(null);
          setEmpty(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setData(null);
        setLoading(false);
      });
  }, [selectedDate, warehouseFilter]);

  const satColor = data ? saturationColor(data.saturation_pct) : saturationColor(0);
  const warehouseLabel = data?.warehouse_name
    ?? WAREHOUSES.find((w) => w.id === warehouseFilter)?.name
    ?? '';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Container className="w-6 h-6 text-emerald-600" />
          Gesti&oacute;n de Recepci&oacute;n
        </h1>
        <p className="text-gray-500 mt-1">Ventanas de descarga y saturaci&oacute;n de rampa</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Warehouse className="w-4 h-4 text-gray-400" />
        <select
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        >
          {WAREHOUSES.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        <Calendar className="w-4 h-4 text-gray-400 ml-2" />
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        />
      </div>

      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Cargando datos de recepci&oacute;n...
        </div>
      ) : empty || !data ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          No hay recepciones programadas para esta fecha
        </div>
      ) : (
        <>
          {/* Saturation Gauge */}
          <div className={`rounded-xl border ${satColor.border} ${satColor.light} p-5`}>
            <h2 className="text-sm font-medium text-gray-600 mb-3">
              Indicador de Saturaci&oacute;n{warehouseLabel ? ` \u2014 ${warehouseLabel}` : ''}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-sm text-gray-500">Total furgones</p>
                <p className="text-2xl font-bold text-gray-900">{data.total_trucks}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Horas descarga total</p>
                <p className="text-2xl font-bold text-gray-900">{fmtDec(data.total_unload_hours)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Horas disponibles (rampas)</p>
                <p className="text-2xl font-bold text-gray-900">{fmtDec(data.available_dock_hours)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">% Saturaci&oacute;n</p>
                <p className={`text-2xl font-bold ${satColor.text}`}>
                  {fmtPct(data.saturation_pct)}
                </p>
              </div>
            </div>

            {/* Saturation bar */}
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all ${satColor.bg}`}
                style={{ width: `${Math.min(data.saturation_pct, 100)}%` }}
              />
            </div>

            {/* Congestion alert */}
            {data.is_saturated && (
              <div className="mt-4 flex items-center gap-2 bg-red-100 border border-red-300 text-red-800 px-4 py-3 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span>
                  Alerta de Congesti&oacute;n &mdash; Las horas de descarga exceden la capacidad de rampa
                </span>
              </div>
            )}
          </div>

          {/* Truck table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">
                Furgones Programados &mdash;{' '}
                {new Date(selectedDate + 'T12:00:00').toLocaleDateString('es-GT', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Hora</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Proveedor ID</th>
                    <th className="text-left px-4 py-3 font-medium text-gray-500">Tipo Unidad</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500">Horas Est.</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Prioridad</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500">Estado</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500"># Hot List</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.trucks.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                        No hay recepciones programadas para esta fecha
                      </td>
                    </tr>
                  ) : (
                    data.trucks.map((truck) => {
                      const hotCount = truck.hot_list_products?.length ?? 0;
                      return (
                        <tr key={truck.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {truck.scheduled_time}
                          </td>
                          <td className="px-4 py-3 text-gray-900">{truck.supplier_id}</td>
                          <td className="px-4 py-3 text-gray-500">
                            {UNIT_TYPE_LABELS[truck.unit_type] ?? truck.unit_type}
                          </td>
                          <td className="px-4 py-3 text-right text-gray-900">
                            {fmtDec(truck.estimated_hours)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                PRIORITY_COLORS[truck.priority?.toLowerCase()] ?? 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {truck.priority}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                STATUS_COLORS[truck.status?.toLowerCase()] ?? 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {truck.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right">
                            {hotCount > 0 ? (
                              <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                {hotCount}
                              </span>
                            ) : (
                              <span className="text-gray-300">0</span>
                            )}
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
      )}
    </div>
  );
}
