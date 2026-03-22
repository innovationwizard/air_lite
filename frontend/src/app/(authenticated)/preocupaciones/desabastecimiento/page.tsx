'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

interface StockoutRisk {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  current_stock: number;
  avg_daily_demand: number;
  days_of_supply: number;
  lead_time_days: number;
  risk_level: string;
}

const RISK_COLORS: Record<string, string> = {
  critico: 'bg-red-100 text-red-700',
  alto: 'bg-orange-100 text-orange-700',
  medio: 'bg-yellow-100 text-yellow-700',
  bajo: 'bg-green-100 text-green-700',
};

const RISK_LABELS: Record<string, string> = {
  critico: 'Crítico',
  alto: 'Alto',
  medio: 'Medio',
  bajo: 'Bajo',
};

export default function DesabastecimientoPage() {
  const [risks, setRisks] = useState<StockoutRisk[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/kpis/stockout-risk')
      .then((res) => res.json())
      .then((data) => {
        setRisks(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const critical = risks.filter((r) => r.risk_level === 'critico').length;
  const high = risks.filter((r) => r.risk_level === 'alto').length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
          Desabastecimiento
        </h1>
        <p className="text-gray-500 mt-1">Productos en riesgo de quedarse sin inventario</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Productos en riesgo crítico</p>
          <p className="text-3xl font-bold text-red-600 mt-1">{critical}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Productos en riesgo alto</p>
          <p className="text-3xl font-bold text-orange-600 mt-1">{high}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total productos monitoreados</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{risks.length}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">SKU</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Categoría</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Stock actual</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Demanda diaria</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Días de inventario</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Riesgo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    Cargando datos...
                  </td>
                </tr>
              ) : risks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                    No hay datos disponibles
                  </td>
                </tr>
              ) : (
                risks.slice(0, 50).map((risk) => (
                  <tr key={risk.product_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">
                      {risk.product_name}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{risk.sku}</td>
                    <td className="px-4 py-3 text-gray-500">{risk.category}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {risk.current_stock.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {risk.avg_daily_demand.toLocaleString('es-GT', { maximumFractionDigits: 1 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {risk.days_of_supply > 999
                        ? '999+'
                        : risk.days_of_supply.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[risk.risk_level] || 'bg-gray-100 text-gray-600'}`}>
                        {RISK_LABELS[risk.risk_level] || risk.risk_level}
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
