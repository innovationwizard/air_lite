'use client';

import { useState, useEffect, useMemo } from 'react';
import { Warehouse, Download } from 'lucide-react';

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

type ClassFilter = 'Inventario muerto' | 'Movimiento lento' | 'Atención requerida' | null;

const HOLDING_COST_RATE = 0.18;

const CLASS_COLORS: Record<string, string> = {
  'Inventario muerto':   'bg-red-100 text-red-700',
  'Movimiento lento':    'bg-orange-100 text-orange-700',
  'Atención requerida':  'bg-yellow-100 text-yellow-700',
  'Normal':              'bg-green-100 text-green-700',
};

const CLASS_ACTION: Record<string, string> = {
  'Inventario muerto':  '→ Evaluar devolución o liquidación',
  'Movimiento lento':   '→ Promocionar o reubicar',
  'Atención requerida': '→ Revisar política',
  'Normal':             '—',
};

function costoPorDia(item: SlowMovingItem): number {
  return (item.inventory_value * HOLDING_COST_RATE) / 365;
}

function fmtGTQ(n: number): string {
  if (n === 0) return '—';
  return 'Q ' + n.toLocaleString('es-GT', { maximumFractionDigits: 0 });
}

function exportCSV(rows: SlowMovingItem[]) {
  const headers = [
    'Producto', 'SKU', 'Categoría', 'Stock', 'Valor GTQ',
    'Días sin venta', 'Costo por día', 'Clasificación', 'Acción',
  ];
  const lines = rows.map((item) => [
    `"${item.product_name.replace(/"/g, '""')}"`,
    item.sku,
    `"${item.category}"`,
    item.current_stock.toFixed(0),
    item.inventory_value.toFixed(0),
    item.days_since_last_sale > 999 ? '999+' : item.days_since_last_sale,
    costoPorDia(item).toFixed(2),
    item.classification,
    CLASS_ACTION[item.classification] ?? '—',
  ].join(','));
  const csv = '﻿' + [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `costos-almacenamiento-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CostosAlmacenamientoPage() {
  const [items, setItems] = useState<SlowMovingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [classFilter, setClassFilter] = useState<ClassFilter>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  useEffect(() => {
    fetch('/api/kpis/slow-moving')
      .then((res) => res.json())
      .then((data) => {
        setItems(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const categories = useMemo(() => {
    const cats = new Set(items.map((i) => i.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (classFilter && i.classification !== classFilter) return false;
      if (categoryFilter !== 'all' && i.category !== categoryFilter) return false;
      if (q && !i.product_name.toLowerCase().includes(q) && !i.sku.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, classFilter, categoryFilter, search]);

  const deadValue = useMemo(
    () => filtered.filter((i) => i.classification === 'Inventario muerto').reduce((s, i) => s + i.inventory_value, 0),
    [filtered],
  );
  const slowValue = useMemo(
    () => filtered.filter((i) => i.classification === 'Movimiento lento').reduce((s, i) => s + i.inventory_value, 0),
    [filtered],
  );
  const totalCostoPorDia = useMemo(
    () => filtered
      .filter((i) => i.classification === 'Inventario muerto' || i.classification === 'Movimiento lento' || i.classification === 'Atención requerida')
      .reduce((s, i) => s + costoPorDia(i), 0),
    [filtered],
  );

  const hasFilters = classFilter !== null || categoryFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Warehouse className="w-6 h-6 text-blue-500" />
            Costos de Almacenamiento
          </h1>
          <p className="text-gray-500 mt-1">
            Inventario de movimiento lento y muerto — capital inmovilizado con costo diario
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
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Inventario muerto (&gt;180 días)</p>
          <p className="text-3xl font-bold text-red-600 mt-1">
            {loading ? '—' : fmtGTQ(deadValue)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Sin movimiento en más de 6 meses</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Movimiento lento (90–180 días)</p>
          <p className="text-3xl font-bold text-orange-600 mt-1">
            {loading ? '—' : fmtGTQ(slowValue)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Rotación inferior a 2 veces por año</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-5">
          <p className="text-sm text-orange-700 font-medium">Costo por día (18% anual)</p>
          <p className="text-2xl font-bold text-orange-700 mt-1">
            {loading ? '—' : fmtGTQ(totalCostoPorDia)}
          </p>
          <p className="text-xs text-orange-500 mt-0.5">Costo de mantener inventario problemático</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Classification chips */}
        <div className="flex gap-2">
          {(['Inventario muerto', 'Movimiento lento', 'Atención requerida'] as const).map((cls) => (
            <button
              key={cls}
              onClick={() => setClassFilter(classFilter === cls ? null : cls)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                classFilter === cls
                  ? CLASS_COLORS[cls] + ' border-current'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {cls}
            </button>
          ))}
        </div>

        {/* Category filter */}
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">Todas las categorías</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        )}

        {/* Search */}
        <input
          type="search"
          placeholder="Buscar por SKU o nombre…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white flex-1 min-w-[200px]"
        />

        {hasFilters && (
          <button
            onClick={() => { setClassFilter(null); setCategoryFilter('all'); setSearch(''); }}
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
                <th className="text-left px-4 py-3 font-medium text-gray-500">Categoría</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Stock</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Valor</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Costo/día</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Días sin venta</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Clasificación</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">Cargando...</td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    {items.length === 0
                      ? 'No hay datos disponibles.'
                      : 'No hay resultados para los filtros seleccionados.'}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 100).map((item) => {
                  const cpd = costoPorDia(item);
                  const action = CLASS_ACTION[item.classification] ?? '—';
                  return (
                    <tr key={item.product_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 max-w-xs">
                        <p className="font-medium text-gray-900 truncate" title={item.product_name}>
                          {item.product_name}
                        </p>
                        <p className="text-xs text-gray-400 font-mono mt-0.5">{item.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{item.category}</td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {item.current_stock.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {fmtGTQ(item.inventory_value)}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600 text-xs font-medium">
                        {cpd > 0 ? fmtGTQ(cpd) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {item.days_since_last_sale > 999 ? '999+' : item.days_since_last_sale}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${CLASS_COLORS[item.classification] || 'bg-gray-100 text-gray-600'}`}>
                          {item.classification}
                        </span>
                      </td>
                      <td className={`px-4 py-3 text-xs font-medium ${
                        item.classification === 'Inventario muerto' ? 'text-red-700' :
                        item.classification === 'Movimiento lento' ? 'text-orange-700' :
                        item.classification === 'Atención requerida' ? 'text-yellow-700' :
                        'text-gray-400'
                      }`}>
                        {action}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > 100 && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 bg-gray-50">
            Mostrando 100 de {filtered.length} resultados. Refiná con los filtros.
          </div>
        )}
      </div>
    </div>
  );
}
