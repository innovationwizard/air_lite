'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect, useMemo } from 'react';
import { AlertOctagon, Warehouse } from 'lucide-react';

interface ExtraordinaryRow {
  sku: string;
  product_name: string;
  supplier_id: number;
  supplier_name: string;
  current_net_inventory: number;
  pending_oa_qty: number;
  projected_demand_to_eom: number;
  projected_eom_inventory: number;
  safety_buffer_qty: number;
  shortfall_qty: number;
  reason_detail: string;
  is_export: boolean;
}

const WAREHOUSES = [
  { id: '1', name: 'Bodega Central' },
  { id: '2', name: 'Zona 11' },
  { id: '3', name: 'Peten' },
  { id: '4', name: 'Zacapa' },
];

const fmt = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

function daysRemainingInMonth(): number {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return lastDay - now.getDate();
}

export default function ExtraordinariosPage() {
  const [data, setData] = useState<ExtraordinaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [warehouseFilter, setWarehouseFilter] = useState('1');
  const [supplierFilter, setSupplierFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ warehouse_id: warehouseFilter });
    fetch(`/api/oa/extraordinary?${params.toString()}`)
      .then((res) => res.json())
      .then((json) => {
        const rows: ExtraordinaryRow[] = Array.isArray(json) ? json : json.data ?? [];
        setData(rows);
        setLoading(false);
      })
      .catch(() => {
        setData([]);
        setLoading(false);
      });
  }, [warehouseFilter]);

  const suppliers = useMemo(() => {
    const map = new Map<number, string>();
    data.forEach((r) => map.set(r.supplier_id, r.supplier_name));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const filtered = useMemo(() => {
    if (!supplierFilter) return data;
    return data.filter((r) => String(r.supplier_id) === supplierFilter);
  }, [data, supplierFilter]);

  const totalCount = filtered.length;
  const totalDeficit = filtered.reduce((s, r) => s + r.shortfall_qty, 0);
  const exportCount = filtered.filter((r) => r.is_export).length;
  const daysLeft = daysRemainingInMonth();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <AlertOctagon className="w-6 h-6 text-emerald-600" />
            Pedidos Extraordinarios
          </h1>
          <p className="text-gray-500 mt-1">
            Detecci&oacute;n autom&aacute;tica de necesidad de ampliaci&oacute;n de OA
          </p>
        </div>
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2 text-sm font-medium text-emerald-700">
          {daysLeft} d&iacute;as restantes en el mes
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

        <select
          value={supplierFilter}
          onChange={(e) => setSupplierFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
        >
          <option value="">Todos los proveedores</option>
          {suppliers.map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Productos con necesidad extraordinaria</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(totalCount)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">D&eacute;ficit total</p>
          <p className="text-2xl font-bold text-red-600 mt-1">{fmt(totalDeficit)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Productos de exportaci&oacute;n afectados</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(exportCount)}</p>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          Cargando detecci&oacute;n de pedidos extraordinarios...
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-400">
          No se detectaron necesidades de pedido extraordinario
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Proveedor</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Inv. Neto Actual</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">OA Pendiente</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Demanda Proy. Cierre</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Inv. Proy. Cierre</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Buffer Seguridad</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">D&eacute;ficit</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">Raz&oacute;n</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500">Export</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((row, i) => (
                  <tr key={`${row.sku}-${i}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.sku}</td>
                    <td className="px-4 py-3 text-gray-700">{row.product_name}</td>
                    <td className="px-4 py-3 text-gray-500">{row.supplier_name}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{fmt(row.current_net_inventory)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{fmt(row.pending_oa_qty)}</td>
                    <td className="px-4 py-3 text-right text-gray-900">{fmt(row.projected_demand_to_eom)}</td>
                    <td className={`px-4 py-3 text-right font-medium ${row.projected_eom_inventory < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {fmt(row.projected_eom_inventory)}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-900">{fmt(row.safety_buffer_qty)}</td>
                    <td className="px-4 py-3 text-right font-bold text-red-600">{fmt(row.shortfall_qty)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                        {row.reason_detail}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.is_export && (
                        <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          Export
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
