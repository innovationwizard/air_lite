'use client';

import { useState, useEffect } from 'react';
import { Snowflake } from 'lucide-react';

interface AbcXyzItem {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  total_revenue: number;
  abc_class: string;
  demand_cv: number;
  xyz_class: string;
  observation_days: number;
  statistical_confidence: string;
}

const ABC_COLORS: Record<string, string> = {
  A: 'bg-emerald-100 text-emerald-700',
  B: 'bg-blue-100 text-blue-700',
  C: 'bg-gray-100 text-gray-600',
};

const XYZ_COLORS: Record<string, string> = {
  X: 'bg-emerald-100 text-emerald-700',
  Y: 'bg-yellow-100 text-yellow-700',
  Z: 'bg-red-100 text-red-700',
};

const CONFIDENCE_COLORS: Record<string, string> = {
  'Alta confianza': 'text-emerald-600',
  'Confianza media': 'text-yellow-600',
  'Datos insuficientes': 'text-gray-400',
};

export default function CapitalCongeladoPage() {
  const [items, setItems] = useState<AbcXyzItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/kpis/abc-xyz')
      .then((res) => res.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const classACount = items.filter((i) => i.abc_class === 'A').length;
  const classCCount = items.filter((i) => i.abc_class === 'C').length;
  const classCRevenue = items
    .filter((i) => i.abc_class === 'C')
    .reduce((sum, i) => sum + i.total_revenue, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Snowflake className="w-6 h-6 text-blue-500" />
          Capital Congelado
        </h1>
        <p className="text-gray-500 mt-1">
          Clasificación ABC/XYZ — identifique inventario que no genera valor
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Productos clase A (80% ingresos)</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{classACount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Productos clase C (cola larga)</p>
          <p className="text-3xl font-bold text-gray-600 mt-1">{classCCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Ingresos clase C</p>
          <p className="text-3xl font-bold text-gray-600 mt-1">
            GTQ {classCRevenue.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Categoría</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Ingresos</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">ABC</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">XYZ</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">CV demanda</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Confianza</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Cargando clasificación...
                  </td>
                </tr>
              ) : (
                items.slice(0, 100).map((item) => (
                  <tr key={item.product_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      {item.product_name}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{item.category}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      GTQ {item.total_revenue.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${ABC_COLORS[item.abc_class] || ''}`}>
                        {item.abc_class}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${XYZ_COLORS[item.xyz_class] || ''}`}>
                        {item.xyz_class}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {item.demand_cv.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs ${CONFIDENCE_COLORS[item.statistical_confidence] || 'text-gray-400'}`}>
                        {item.statistical_confidence}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
