'use client';

import { useState, useEffect, useMemo } from 'react';
import { ShoppingCart, Download } from 'lucide-react';

interface UnnecessaryPurchase {
  sku: string;
  product_name: string;
  supplier_name: string;
  units_received: number;
  gtq_paid: number;
  current_days: number | null;
  max_policy_days: number;
  gtq_inmovilizado: number;
  days_until_policy: number | null;
  received_since: string;
}

const HOLDING_COST_RATE = 0.18;

function fmtGTQ(n: number): string {
  if (n === 0) return '—';
  return 'Q ' + n.toLocaleString('es-GT', { maximumFractionDigits: 0 });
}

function exportCSV(rows: UnnecessaryPurchase[]) {
  const headers = [
    'Producto', 'SKU', 'Proveedor', 'Unidades recibidas', 'GTQ pagado',
    'Días actuales', 'Política máxima (días)', 'GTQ inmovilizado',
    'Días para bajar a política', 'Acción',
  ];
  const lines = rows.map((item) => [
    `"${item.product_name.replace(/"/g, '""')}"`,
    item.sku,
    item.supplier_name,
    item.units_received,
    item.gtq_paid.toFixed(0),
    item.current_days !== null ? item.current_days : '',
    item.max_policy_days,
    item.gtq_inmovilizado.toFixed(0),
    item.days_until_policy !== null ? item.days_until_policy : '',
    item.days_until_policy !== null
      ? `No reordenar — esperar ${item.days_until_policy} días`
      : 'No reordenar',
  ].join(','));
  const csv = '﻿' + [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `compras-innecesarias-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ComprasInnecesariasPage() {
  const [items, setItems] = useState<UnnecessaryPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/kpis/unnecessary-purchases')
      .then((r) => r.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const suppliers = useMemo(() => {
    const names = new Set(items.map((i) => i.supplier_name).filter(Boolean));
    return Array.from(names).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (supplierFilter !== 'all' && i.supplier_name !== supplierFilter) return false;
      if (q && !i.product_name.toLowerCase().includes(q) && !i.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, supplierFilter, search]);

  const totalGtqPaid = useMemo(() => filtered.reduce((s, i) => s + i.gtq_paid, 0), [filtered]);
  const totalGtqInmovilizado = useMemo(() => filtered.reduce((s, i) => s + i.gtq_inmovilizado, 0), [filtered]);
  const costoPorDia = (totalGtqInmovilizado * HOLDING_COST_RATE) / 365;
  const hasFilters = supplierFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-purple-500" />
            Compras Innecesarias
          </h1>
          <p className="text-gray-500 mt-1">
            SKUs recibidos en los últimos 90 días que ya superaban la política máxima de inventario
          </p>
        </div>
        <button
          onClick={() => exportCSV(filtered)}
          disabled={loading || filtered.length === 0}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-purple-50 border border-purple-100 rounded-xl p-5">
          <p className="text-sm text-purple-700 font-medium">SKUs comprados en exceso</p>
          <p className="text-3xl font-bold text-purple-700 mt-1">
            {loading ? '—' : filtered.length}
          </p>
          <p className="text-xs text-purple-500 mt-0.5">Recibidos sobre política máxima</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-5">
          <p className="text-sm text-red-700 font-medium">GTQ comprado innecesariamente</p>
          <p className="text-2xl font-bold text-red-700 mt-1">
            {loading ? '—' : fmtGTQ(totalGtqPaid)}
          </p>
          <p className="text-xs text-red-500 mt-0.5">Costo de las unidades recibidas sobre política</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-5">
          <p className="text-sm text-orange-700 font-medium">Costo de mantener eso (por día)</p>
          <p className="text-2xl font-bold text-orange-700 mt-1">
            {loading ? '—' : fmtGTQ(costoPorDia)}
          </p>
          <p className="text-xs text-orange-500 mt-0.5">18% anual sobre GTQ inmovilizado</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {suppliers.length > 0 && (
          <select
            value={supplierFilter}
            onChange={(e) => setSupplierFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">Todos los proveedores</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <input
          type="search"
          placeholder="Buscar por SKU o nombre…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white flex-1 min-w-[200px]"
        />
        {hasFilters && (
          <button
            onClick={() => { setSupplierFilter('all'); setSearch(''); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Proveedor</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Uds. recibidas</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">GTQ pagado</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Días actuales</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Política máx.</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">GTQ inmovilizado</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    Cargando datos...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    {items.length === 0
                      ? 'No se detectaron compras innecesarias en los últimos 90 días para los 23 SKUs demo.'
                      : 'No hay resultados para los filtros seleccionados.'}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.sku} className="hover:bg-gray-50">
                    <td className="px-4 py-3 max-w-xs">
                      <p className="font-medium text-gray-900 truncate" title={item.product_name}>
                        {item.product_name}
                      </p>
                      <p className="text-xs text-gray-400 font-mono mt-0.5">{item.sku}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{item.supplier_name}</td>
                    <td className="px-4 py-3 text-right text-gray-900">
                      {item.units_received.toLocaleString('es-GT')}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-red-700">
                      {fmtGTQ(item.gtq_paid)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-medium text-gray-900">
                        {item.current_days !== null ? `${item.current_days}d` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">
                      {item.max_policy_days}d
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-blue-700">
                      {fmtGTQ(item.gtq_inmovilizado)}
                    </td>
                    <td className="px-4 py-3 text-xs text-purple-700 font-medium">
                      {item.days_until_policy !== null
                        ? `→ No reordenar — esperar ${item.days_until_policy}d`
                        : '→ No reordenar'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Datos: snapshot 3-mar-2026. Ventana de compras: dic 2025 – mar 2026. Política máxima: lead time × 3 días de demanda.
      </p>
    </div>
  );
}
