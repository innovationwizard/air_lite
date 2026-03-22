'use client';

import { useState, useEffect } from 'react';
import { Warehouse } from 'lucide-react';

interface SlowMovingItem {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  current_stock: number;
  inventory_value: number;
  last_sale_date: string | null;
  days_since_last_sale: number;
  avg_monthly_demand: number;
  classification: string;
}

const CLASS_COLORS: Record<string, string> = {
  'Inventario muerto': 'bg-red-100 text-red-700',
  'Movimiento lento': 'bg-orange-100 text-orange-700',
  'Atención requerida': 'bg-yellow-100 text-yellow-700',
  'Normal': 'bg-green-100 text-green-700',
};

export default function CostosAlmacenamientoPage() {
  const [items, setItems] = useState<SlowMovingItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/kpis/slow-moving')
      .then((res) => res.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const totalValue = items.reduce((sum, i) => sum + i.inventory_value, 0);
  const deadValue = items
    .filter((i) => i.classification === 'Inventario muerto')
    .reduce((sum, i) => sum + i.inventory_value, 0);
  const slowValue = items
    .filter((i) => i.classification === 'Movimiento lento')
    .reduce((sum, i) => sum + i.inventory_value, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Warehouse className="w-6 h-6 text-blue-500" />
          Costos de Almacenamiento
        </h1>
        <p className="text-gray-500 mt-1">
          Inventario de movimiento lento y muerto que consume capital y espacio
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Valor total en inventario</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            GTQ {totalValue.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Inventario muerto (&gt;180 días)</p>
          <p className="text-3xl font-bold text-red-600 mt-1">
            GTQ {deadValue.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Movimiento lento (90-180 días)</p>
          <p className="text-3xl font-bold text-orange-600 mt-1">
            GTQ {slowValue.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
          </p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Categoría</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Stock</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Valor</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Días sin venta</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Clasificación</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">Cargando...</td>
                </tr>
              ) : (
                items.slice(0, 50).map((item) => (
                  <tr key={item.product_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{item.product_name}</td>
                    <td className="px-4 py-3 text-gray-500">{item.category}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {item.current_stock.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      GTQ {item.inventory_value.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {item.days_since_last_sale > 999 ? '999+' : item.days_since_last_sale}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${CLASS_COLORS[item.classification] || 'bg-gray-100 text-gray-600'}`}>
                        {item.classification}
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
