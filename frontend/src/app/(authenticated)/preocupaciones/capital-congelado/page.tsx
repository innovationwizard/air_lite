'use client';

import { useState, useEffect, useMemo } from 'react';
import { Snowflake, Download } from 'lucide-react';

interface AbcXyzItem {
  product_id: number;
  product_name: string;
  sku: string;
  category: string;
  total_revenue: number;
  cumulative_revenue_pct: number;
  abc_class: string;
  demand_cv: number;
  xyz_class: string;
  observation_days: number;
  statistical_confidence: string;
  // new fields
  current_stock: number;
  avg_daily_demand: number;
  lead_time_days: number;
  unit_cost: number;
  supplier_name: string | null;
}

interface SlowMovingItem {
  sku: string;
  classification: string;
}

interface WarehouseRiskItem {
  sku: string;
  risk_level: string;
  warehouse_name: string;
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

// Policy parameters per ABC×XYZ cell
const CELL_POLICY: Record<string, { serviceLevel: string; safetyStock: string; reviewFreq: string }> = {
  AX: { serviceLevel: '99%', safetyStock: '3 días', reviewFreq: 'Semanal' },
  AY: { serviceLevel: '97%', safetyStock: '7 días', reviewFreq: 'Semanal' },
  AZ: { serviceLevel: '95%', safetyStock: '14 días', reviewFreq: 'Bisemanal' },
  BX: { serviceLevel: '97%', safetyStock: '5 días', reviewFreq: 'Quincenal' },
  BY: { serviceLevel: '95%', safetyStock: '10 días', reviewFreq: 'Quincenal' },
  BZ: { serviceLevel: '90%', safetyStock: '14 días', reviewFreq: 'Mensual' },
  CX: { serviceLevel: '95%', safetyStock: '7 días', reviewFreq: 'Mensual' },
  CY: { serviceLevel: '90%', safetyStock: '10 días', reviewFreq: 'Mensual' },
  CZ: { serviceLevel: '85%', safetyStock: '14 días', reviewFreq: 'Mensual' },
};

const HOLDING_COST_RATE = 0.18; // 18% annual — matches backtest

function gtqInmovilizado(item: AbcXyzItem): number {
  const maxTarget = Math.max(0, item.lead_time_days * 3) * item.avg_daily_demand;
  return Math.max(0, item.current_stock - maxTarget) * item.unit_cost;
}

function costoPorDia(item: AbcXyzItem): number {
  return (gtqInmovilizado(item) * HOLDING_COST_RATE) / 365;
}

function fmtGTQ(n: number): string {
  if (n === 0) return '—';
  return 'Q ' + n.toLocaleString('es-GT', { maximumFractionDigits: 0 });
}

function dispositionAction(
  sku: string,
  deadSkus: Set<string>,
  hotWarehouseMap: Map<string, string>,
): string {
  const hotWh = hotWarehouseMap.get(sku);
  if (hotWh) return `→ Trasladar a ${hotWh}`;
  if (deadSkus.has(sku)) return '→ Evaluar devolución o liquidación';
  return '→ No reordenar';
}

function exportCSV(rows: AbcXyzItem[], deadSkus: Set<string>, hotWarehouseMap: Map<string, string>) {
  const headers = [
    'Producto', 'SKU', 'Categoría', 'Proveedor', 'Ingresos', 'ABC', 'XYZ',
    'CV demanda', 'Confianza', 'Stock actual', 'GTQ inmovilizado', 'Costo por día',
    'Nivel de servicio', 'Stock de seguridad', 'Frecuencia revisión', 'Acción sugerida',
  ];
  const lines = rows.map((item) => {
    const cell = item.abc_class + item.xyz_class;
    const policy = CELL_POLICY[cell] ?? { serviceLevel: '—', safetyStock: '—', reviewFreq: '—' };
    return [
      `"${item.product_name}"`,
      item.sku,
      item.category,
      item.supplier_name ?? '',
      item.total_revenue.toFixed(0),
      item.abc_class,
      item.xyz_class,
      item.demand_cv.toFixed(2),
      item.statistical_confidence,
      item.current_stock.toFixed(0),
      gtqInmovilizado(item).toFixed(0),
      costoPorDia(item).toFixed(0),
      policy.serviceLevel,
      policy.safetyStock,
      policy.reviewFreq,
      `"${dispositionAction(item.sku, deadSkus, hotWarehouseMap)}"`,
    ].join(',');
  });
  const csv = '﻿' + [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hold-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CapitalCongeladoPage() {
  const [items, setItems] = useState<AbcXyzItem[]>([]);
  const [slowMoving, setSlowMoving] = useState<SlowMovingItem[]>([]);
  const [warehouseRisks, setWarehouseRisks] = useState<WarehouseRiskItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [abcFilter, setAbcFilter] = useState<string | null>(null);
  const [xyzFilter, setXyzFilter] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'gtq' | 'abc' | 'cv'>('gtq');

  useEffect(() => {
    Promise.all([
      fetch('/api/kpis/abc-xyz').then((r) => r.json()),
      fetch('/api/kpis/slow-moving').then((r) => r.json()),
      fetch('/api/kpis/stockout-risk-by-warehouse').then((r) => r.json()),
    ])
      .then(([abcData, slowData, warehouseData]) => {
        setItems(Array.isArray(abcData) ? abcData : []);
        setSlowMoving(Array.isArray(slowData) ? slowData : []);
        setWarehouseRisks(Array.isArray(warehouseData) ? warehouseData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const suppliers = useMemo(() => {
    const names = new Set(items.map((i) => i.supplier_name).filter(Boolean) as string[]);
    return Array.from(names).sort();
  }, [items]);

  const deadSkus = useMemo(() => {
    const s = new Set<string>();
    for (const sm of slowMoving) {
      if (sm.classification === 'Inventario muerto') s.add(sm.sku);
    }
    return s;
  }, [slowMoving]);

  const hotWarehouseMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const wr of warehouseRisks) {
      if ((wr.risk_level === 'critico' || wr.risk_level === 'alto') && !m.has(wr.sku)) {
        m.set(wr.sku, wr.warehouse_name);
      }
    }
    return m;
  }, [warehouseRisks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = items.filter((i) => {
      if (abcFilter && i.abc_class !== abcFilter) return false;
      if (xyzFilter && i.xyz_class !== xyzFilter) return false;
      if (supplierFilter !== 'all' && i.supplier_name !== supplierFilter) return false;
      if (q && !i.product_name.toLowerCase().includes(q) && !i.sku.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortBy === 'gtq') pool.sort((a, b) => gtqInmovilizado(b) - gtqInmovilizado(a));
    else if (sortBy === 'abc') pool.sort((a, b) => a.abc_class.localeCompare(b.abc_class) || a.xyz_class.localeCompare(b.xyz_class));
    else if (sortBy === 'cv') pool.sort((a, b) => b.demand_cv - a.demand_cv);
    return pool;
  }, [items, abcFilter, xyzFilter, supplierFilter, search, sortBy]);

  const totalGtqInmovilizado = useMemo(() => items.reduce((s, i) => s + gtqInmovilizado(i), 0), [items]);
  const totalCostoPorDia = useMemo(() => items.reduce((s, i) => s + costoPorDia(i), 0), [items]);
  const classACount = items.filter((i) => i.abc_class === 'A').length;
  const hasFilters = abcFilter !== null || xyzFilter !== null || supplierFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Snowflake className="w-6 h-6 text-blue-500" />
            Hold List — Capital Congelado
          </h1>
          <p className="text-gray-500 mt-1">
            Clasificación ABC/XYZ — inventario que no genera valor, ordenado por capital inmovilizado
          </p>
        </div>
        <button
          onClick={() => exportCSV(filtered, deadSkus, hotWarehouseMap)}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
          <p className="text-sm text-blue-700 font-medium">GTQ inmovilizado total</p>
          <p className="text-2xl font-bold text-blue-700 mt-1">{fmtGTQ(totalGtqInmovilizado)}</p>
          <p className="text-xs text-blue-600 mt-0.5">Capital sobre el nivel máximo de política</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-5">
          <p className="text-sm text-orange-700 font-medium">Costo por día</p>
          <p className="text-2xl font-bold text-orange-700 mt-1">{fmtGTQ(totalCostoPorDia)}</p>
          <p className="text-xs text-orange-600 mt-0.5">Tasa anual 18% — mismo criterio que backtest</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">Productos clase A (80% ingresos)</p>
          <p className="text-3xl font-bold text-emerald-600 mt-1">{classACount}</p>
        </div>
      </div>

      {/* Policy legend */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Política aplicada por celda ABC × XYZ</p>
        <div className="grid grid-cols-3 md:grid-cols-9 gap-2 text-xs">
          {Object.entries(CELL_POLICY).map(([cell, p]) => (
            <div key={cell} className="bg-white border border-gray-200 rounded-lg p-2 text-center">
              <p className="font-bold text-gray-800">{cell}</p>
              <p className="text-gray-500 mt-0.5">{p.serviceLevel}</p>
              <p className="text-gray-400">{p.safetyStock}</p>
              <p className="text-gray-400">{p.reviewFreq}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {(['A', 'B', 'C'] as const).map((cls) => (
            <button
              key={cls}
              onClick={() => setAbcFilter(abcFilter === cls ? null : cls)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                abcFilter === cls ? ABC_COLORS[cls] + ' border-current' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {cls}
            </button>
          ))}
          <span className="text-gray-300 self-center">×</span>
          {(['X', 'Y', 'Z'] as const).map((cls) => (
            <button
              key={cls}
              onClick={() => setXyzFilter(xyzFilter === cls ? null : cls)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                xyzFilter === cls ? XYZ_COLORS[cls] + ' border-current' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {cls}
            </button>
          ))}
        </div>
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
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'gtq' | 'abc' | 'cv')}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="gtq">Ordenar: GTQ inmovilizado</option>
          <option value="abc">Ordenar: Clase ABC/XYZ</option>
          <option value="cv">Ordenar: CV demanda</option>
        </select>
        <input
          type="search"
          placeholder="Buscar por SKU o nombre…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white flex-1 min-w-[200px]"
        />
        {hasFilters && (
          <button
            onClick={() => { setAbcFilter(null); setXyzFilter(null); setSupplierFilter('all'); setSearch(''); }}
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
                <th className="text-right px-4 py-3 font-medium text-gray-500">Ingresos</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">ABC</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">XYZ</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">CV demanda</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">GTQ inmovilizado</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Costo/día</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Política</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Acción sugerida</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-gray-400">Cargando clasificación...</td>
                </tr>
              ) : (
                filtered.slice(0, 100).map((item) => {
                  const cell = item.abc_class + item.xyz_class;
                  const policy = CELL_POLICY[cell] ?? null;
                  const gtq = gtqInmovilizado(item);
                  const cpd = costoPorDia(item);
                  return (
                    <tr key={item.product_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 max-w-xs">
                        <p className="font-medium text-gray-900 truncate" title={item.product_name}>{item.product_name}</p>
                        <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{item.supplier_name ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        Q {item.total_revenue.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
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
                      <td className="px-4 py-3 text-right text-gray-900">{item.demand_cv.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-blue-700">
                        {fmtGTQ(gtq)}
                      </td>
                      <td className="px-4 py-3 text-right text-orange-600 text-xs">
                        {cpd > 0 ? fmtGTQ(cpd) : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {policy && (
                          <div className="relative inline-block group">
                            <button className="text-xs bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded font-mono transition-colors">
                              {cell}
                            </button>
                            <div className="absolute z-10 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg">
                              <p className="font-semibold mb-1">Política {cell}</p>
                              <p>Servicio: {policy.serviceLevel}</p>
                              <p>Stock seg.: {policy.safetyStock}</p>
                              <p>Revisión: {policy.reviewFreq}</p>
                            </div>
                          </div>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-xs font-medium ${
                        hotWarehouseMap.has(item.sku) ? 'text-teal-700' :
                        deadSkus.has(item.sku) ? 'text-red-700' :
                        'text-purple-700'
                      }`}>
                        {dispositionAction(item.sku, deadSkus, hotWarehouseMap)}
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
