'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Truck, Filter, Warehouse, Ship } from 'lucide-react';

interface SemaphoreItem {
  product_id: number;
  product_name: string;
  sku: string;
  supplier_id: number;
  supplier_name: string;
  net_inventory: number;
  avg_daily_demand: number;
  days_of_supply: number;
  semaphore: 'rojo' | 'amarillo' | 'verde' | 'hold';
  semaphore_reason: string;
  is_export?: boolean;
}

const WAREHOUSES = [
  { id: 'all', name: 'Todas las bodegas' },
  { id: '1', name: 'Bodega Central' },
  { id: '2', name: 'Zona 11' },
  { id: '3', name: 'Peten' },
  { id: '4', name: 'Zacapa' },
];

const SEMAPHORE_CONFIG: Record<string, { bg: string; dot: string; label: string }> = {
  rojo: { bg: 'bg-red-50', dot: 'bg-red-500', label: 'Rojo' },
  amarillo: { bg: 'bg-amber-50', dot: 'bg-amber-500', label: 'Amarillo' },
  verde: { bg: 'bg-green-50', dot: 'bg-green-500', label: 'Verde' },
  hold: { bg: 'bg-gray-50', dot: 'bg-gray-400', label: 'Hold' },
};

const fmt = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDec = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function DashboardProveedorPage() {
  const [items, setItems] = useState<SemaphoreItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (warehouseFilter !== 'all') params.set('warehouse_id', warehouseFilter);
    const qs = params.toString();
    fetch(`/api/oa/supplier-semaphore${qs ? `?${qs}` : ''}`)
      .then((res) => res.json())
      .then((d) => {
        setItems(Array.isArray(d) ? d : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [warehouseFilter]);

  const suppliers = Array.from(new Set(items.map((i) => i.supplier_name).filter(Boolean))).sort();
  const filtered =
    supplierFilter === 'all' ? items : items.filter((i) => i.supplier_name === supplierFilter);

  const countByStatus = (status: string) => filtered.filter((i) => i.semaphore === status).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Truck className="w-6 h-6 text-emerald-600" />
          Dashboard Proveedor
        </h1>
        <p className="text-gray-500 mt-1">Sem&aacute;foro de estado por producto</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Rojo</p>
          <p className="text-3xl font-bold text-red-600 mt-1">
            {loading ? '\u2014' : countByStatus('rojo')}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Amarillo</p>
          <p className="text-3xl font-bold text-amber-600 mt-1">
            {loading ? '\u2014' : countByStatus('amarillo')}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Verde</p>
          <p className="text-3xl font-bold text-green-600 mt-1">
            {loading ? '\u2014' : countByStatus('verde')}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Hold</p>
          <p className="text-3xl font-bold text-gray-600 mt-1">
            {loading ? '\u2014' : countByStatus('hold')}
          </p>
        </div>
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

        <Filter className="w-4 h-4 text-gray-400 ml-2" />
        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        >
          <option value="all">Todos los proveedores</option>
          {suppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Sem&aacute;foro</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">SKU</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Proveedor</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Exp.</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Inventario Neto</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Demanda Diaria</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">D&iacute;as Suministro</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Acci&oacute;n Sugerida</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    Cargando datos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    No hay datos disponibles
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const cfg = SEMAPHORE_CONFIG[item.semaphore] ?? SEMAPHORE_CONFIG.hold;
                  const isHoldExport = item.semaphore === 'hold' && item.is_export;
                  const actionText = isHoldExport
                    ? `Exportaci\u00f3n \u2014 no cancelable. ${item.semaphore_reason}`
                    : item.semaphore_reason;

                  return (
                    <tr key={item.product_id} className={`${cfg.bg} hover:opacity-90`}>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block w-3 h-3 rounded-full ${cfg.dot}`}
                          title={cfg.label}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-900">{item.sku}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{item.product_name}</td>
                      <td className="px-4 py-3 text-gray-500">{item.supplier_name}</td>
                      <td className="px-4 py-3 text-center">
                        {item.is_export && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                            <Ship className="w-3 h-3" />
                            Exp
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmt(item.net_inventory)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmtDec(item.avg_daily_demand)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmtDec(item.days_of_supply)}</td>
                      <td className="px-4 py-3 text-gray-700 text-xs max-w-xs">
                        {isHoldExport && (
                          <span className="inline-flex px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 mr-1">
                            No cancelable
                          </span>
                        )}
                        {actionText}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
