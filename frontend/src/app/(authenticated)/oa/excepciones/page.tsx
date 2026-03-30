'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { ShieldAlert, Filter, Warehouse, Check, Ship } from 'lucide-react';

interface HotItem {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  supplier_id: number;
  supplier_name: string;
  net_inventory: number;
  avg_daily_demand: number;
  days_of_supply: number;
  urgency_qty: number;
  is_export: boolean;
}

interface HoldItem {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  supplier_id: number;
  supplier_name: string;
  net_inventory: number;
  avg_daily_demand: number;
  days_of_supply: number;
  excess_qty: number;
  excess_days: number;
  is_export: boolean;
  supplier_origin: string;
  cancellable: boolean;
}

const WAREHOUSES = [
  { id: 'all', name: 'Todas las bodegas' },
  { id: '1', name: 'Bodega Central' },
  { id: '2', name: 'Zona 11' },
  { id: '3', name: 'Peten' },
  { id: '4', name: 'Zacapa' },
];

const fmt = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const fmtDec = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export default function ExcepcionesPage() {
  const [hotRaw, setHotRaw] = useState<HotItem[]>([]);
  const [holdRaw, setHoldRaw] = useState<HoldItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [warehouseFilter, setWarehouseFilter] = useState('all');
  const [lastUpdated] = useState(new Date());

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (warehouseFilter !== 'all') params.set('warehouse_id', warehouseFilter);
    const qs = params.toString();
    fetch(`/api/oa/exceptions${qs ? `?${qs}` : ''}`)
      .then((res) => res.json())
      .then((d) => {
        setHotRaw(Array.isArray(d.hot) ? d.hot : []);
        setHoldRaw(Array.isArray(d.hold) ? d.hold : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [warehouseFilter]);

  const allSuppliers = Array.from(
    new Set([...hotRaw, ...holdRaw].map((i) => i.supplier_name).filter(Boolean))
  ).sort();

  const hotList = supplierFilter === 'all'
    ? hotRaw
    : hotRaw.filter((i) => i.supplier_name === supplierFilter);

  const holdList = supplierFilter === 'all'
    ? holdRaw
    : holdRaw.filter((i) => i.supplier_name === supplierFilter);

  const totalMonitored = new Set([
    ...hotRaw.map((i) => i.product_id),
    ...holdRaw.map((i) => i.product_id),
  ]).size;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldAlert className="w-6 h-6 text-red-500" />
          Reporte de Excepciones
        </h1>
        <p className="text-gray-500 mt-1">
          Hot List (quiebre inminente) y Hold List (detener despachos)
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Hot (Quiebre Inminente)</p>
          <p className="text-3xl font-bold text-red-600 mt-1">
            {loading ? '\u2014' : hotList.length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Hold (Detener Despachos)</p>
          <p className="text-3xl font-bold text-amber-600 mt-1">
            {loading ? '\u2014' : holdList.length}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Productos Monitoreados</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {loading ? '\u2014' : totalMonitored}
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
          {allSuppliers.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Hot List */}
      <div>
        <h2 className="text-lg font-semibold text-red-700 mb-3 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
          Hot List &mdash; Alerta de Quiebre (&lt; 3 d&iacute;as de inventario)
        </h2>
        <div className="bg-white rounded-xl border border-red-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-red-50 border-b border-red-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-red-700">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-red-700">Producto</th>
                  <th className="text-left px-4 py-3 font-medium text-red-700">Proveedor</th>
                  <th className="text-right px-4 py-3 font-medium text-red-700">Inventario Neto</th>
                  <th className="text-right px-4 py-3 font-medium text-red-700">Demanda Diaria</th>
                  <th className="text-right px-4 py-3 font-medium text-red-700">D&iacute;as Suministro</th>
                  <th className="text-right px-4 py-3 font-medium text-red-700">Cantidad Urgente</th>
                  <th className="text-center px-4 py-3 font-medium text-red-700">Exportaci&oacute;n</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-100">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      Cargando datos...
                    </td>
                  </tr>
                ) : hotList.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                      No hay productos en quiebre inminente
                    </td>
                  </tr>
                ) : (
                  hotList.map((item) => (
                    <tr key={item.product_id} className="hover:bg-red-50/50">
                      <td className="px-4 py-3 font-mono text-gray-900">{item.sku}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{item.product_name}</td>
                      <td className="px-4 py-3 text-gray-500">{item.supplier_name}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmt(item.net_inventory)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmtDec(item.avg_daily_demand)}</td>
                      <td className="px-4 py-3 text-right text-red-600 font-semibold">{fmtDec(item.days_of_supply)}</td>
                      <td className="px-4 py-3 text-right text-red-700 font-bold">{fmt(item.urgency_qty)}</td>
                      <td className="px-4 py-3 text-center">
                        {item.is_export && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            <Ship className="w-3 h-3" />
                            Exp
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Hold List */}
      <div>
        <h2 className="text-lg font-semibold text-amber-700 mb-3 flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500 inline-block" />
          Hold List &mdash; Detener Despachos (&gt; 1 semana de buffer)
        </h2>
        <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-amber-50 border-b border-amber-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-amber-700">SKU</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-700">Producto</th>
                  <th className="text-left px-4 py-3 font-medium text-amber-700">Proveedor</th>
                  <th className="text-right px-4 py-3 font-medium text-amber-700">Inventario Neto</th>
                  <th className="text-right px-4 py-3 font-medium text-amber-700">Demanda Diaria</th>
                  <th className="text-right px-4 py-3 font-medium text-amber-700">D&iacute;as Suministro</th>
                  <th className="text-right px-4 py-3 font-medium text-amber-700">Exceso (unidades)</th>
                  <th className="text-right px-4 py-3 font-medium text-amber-700">Exceso (d&iacute;as)</th>
                  <th className="text-center px-4 py-3 font-medium text-amber-700">Cancelable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                      Cargando datos...
                    </td>
                  </tr>
                ) : holdList.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                      No hay productos con exceso de inventario
                    </td>
                  </tr>
                ) : (
                  holdList.map((item) => (
                    <tr
                      key={item.product_id}
                      className={`hover:bg-amber-50/50 ${!item.cancellable ? 'border-l-4 border-l-red-400' : ''}`}
                    >
                      <td className="px-4 py-3 font-mono text-gray-900">{item.sku}</td>
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate">{item.product_name}</td>
                      <td className="px-4 py-3 text-gray-500">{item.supplier_name}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmt(item.net_inventory)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmtDec(item.avg_daily_demand)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{fmtDec(item.days_of_supply)}</td>
                      <td className="px-4 py-3 text-right text-amber-700 font-semibold">{fmt(item.excess_qty)}</td>
                      <td className="px-4 py-3 text-right text-amber-700 font-semibold">{fmtDec(item.excess_days)}</td>
                      <td className="px-4 py-3 text-center">
                        {item.cancellable ? (
                          <Check className="w-4 h-4 text-green-600 inline" />
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                            Exportaci&oacute;n
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Last updated */}
      <p className="text-xs text-gray-400 text-right">
        &Uacute;ltima actualizaci&oacute;n: {lastUpdated.toLocaleString('es-GT')}
      </p>
    </div>
  );
}
