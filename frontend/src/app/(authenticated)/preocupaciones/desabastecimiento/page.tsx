'use client';

import { useState, useEffect, useMemo } from 'react';
import { AlertTriangle, Download } from 'lucide-react';

// Product-level row (from /api/kpis/stockout-risk)
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
  unit_price: number;
  supplier_name: string | null;
  abc_class?: string | null;
  xyz_class?: string | null;
}

// Per-warehouse row (from /api/kpis/stockout-risk-by-warehouse)
interface WarehouseRisk extends StockoutRisk {
  warehouse_id: number;
  warehouse_name: string;
  warehouse_code: string;
}

const RISK_COLORS: Record<string, string> = {
  critico: 'bg-red-100 text-red-700',
  alto:    'bg-orange-100 text-orange-700',
  medio:   'bg-yellow-100 text-yellow-700',
  bajo:    'bg-green-100 text-green-700',
};

const RISK_LABELS: Record<string, string> = {
  critico: 'Crítico',
  alto:    'Alto',
  medio:   'Medio',
  bajo:    'Bajo',
};

const HOLDING_COST_RATE = 0.18;

const SAFETY_STOCK_DAYS: Record<string, number> = {
  AX: 3, AY: 7,  AZ: 14,
  BX: 5, BY: 10, BZ: 14,
  CX: 7, CY: 10, CZ: 14,
};

function emergencyQty(r: StockoutRisk): number {
  if (r.avg_daily_demand <= 0 || r.lead_time_days <= 0) return 0;
  const cell = (r.abc_class ?? '') + (r.xyz_class ?? '');
  const ss = SAFETY_STOCK_DAYS[cell] ?? 7;
  const rop = r.avg_daily_demand * (r.lead_time_days + ss);
  return Math.max(0, Math.ceil(rop - r.current_stock));
}

function gtqEnRiesgo(r: StockoutRisk): number {
  const daysShort = Math.max(0, r.lead_time_days - r.days_of_supply);
  return daysShort * r.avg_daily_demand * r.unit_price;
}

function fechaAgotamiento(r: StockoutRisk): string {
  if (r.days_of_supply >= 9999) return '—';
  const d = new Date();
  d.setDate(d.getDate() + Math.floor(r.days_of_supply));
  return d.toLocaleDateString('es-GT', { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtGTQ(n: number): string {
  if (n === 0) return '—';
  return 'Q ' + n.toLocaleString('es-GT', { maximumFractionDigits: 0 });
}

function exportCSV(rows: (StockoutRisk | WarehouseRisk)[], hasWarehouse: boolean) {
  const headers = [
    'Producto', 'SKU', 'Categoría', 'Proveedor',
    ...(hasWarehouse ? ['Bodega'] : []),
    'Stock actual', 'Demanda diaria', 'Días de inventario', 'Lead time',
    'GTQ en riesgo', 'Pedido urgente (unidades)', 'Se agota', 'Nivel de riesgo',
  ];
  const lines = rows.map((r) => {
    const base = [
      `"${r.product_name}"`,
      r.sku,
      r.category,
      r.supplier_name ?? '',
      ...(hasWarehouse ? [((r as WarehouseRisk).warehouse_name ?? '')] : []),
      r.current_stock.toFixed(0),
      r.avg_daily_demand.toFixed(1),
      r.days_of_supply >= 9999 ? '999+' : r.days_of_supply.toFixed(0),
      r.lead_time_days,
      gtqEnRiesgo(r).toFixed(0),
      emergencyQty(r) > 0 ? emergencyQty(r).toFixed(0) : '',
      fechaAgotamiento(r),
      RISK_LABELS[r.risk_level] ?? r.risk_level,
    ];
    return base.join(',');
  });
  const csv = '﻿' + [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hot-list-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DesabastecimientoPage() {
  // Product-level data — used for KPI totals (company-wide, no double-counting)
  const [risks, setRisks] = useState<StockoutRisk[]>([]);
  // Per-warehouse data — used when a specific warehouse is selected
  const [warehouseRisks, setWarehouseRisks] = useState<WarehouseRisk[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [riskFilter, setRiskFilter] = useState<string | null>(null);
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/kpis/stockout-risk').then((r) => r.json()),
      fetch('/api/kpis/stockout-risk-by-warehouse').then((r) => r.json()),
    ])
      .then(([productData, warehouseData]) => {
        setRisks(Array.isArray(productData) ? productData : []);
        setWarehouseRisks(Array.isArray(warehouseData) ? warehouseData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Warehouse options derived from per-warehouse data
  const warehouses = useMemo(() => {
    const seen = new Map<string, string>(); // name → code
    for (const r of warehouseRisks) {
      if (!seen.has(r.warehouse_name)) seen.set(r.warehouse_name, r.warehouse_code);
    }
    return Array.from(seen.entries())
      .map(([name, code]) => ({ name, code }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [warehouseRisks]);

  // Supplier options from the active base pool
  const suppliers = useMemo(() => {
    const base = warehouseFilter === 'all' ? risks : warehouseRisks;
    const names = new Set(base.map((r) => r.supplier_name).filter(Boolean) as string[]);
    return Array.from(names).sort();
  }, [risks, warehouseRisks, warehouseFilter]);

  // Base pool: product-level OR per-warehouse rows for selected bodega
  const basePool: (StockoutRisk | WarehouseRisk)[] = useMemo(() => {
    if (warehouseFilter === 'all') return risks;
    return warehouseRisks.filter((r) => r.warehouse_name === warehouseFilter);
  }, [warehouseFilter, risks, warehouseRisks]);

  const isPerWarehouse = warehouseFilter !== 'all';

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = basePool.filter((r) => {
      if (riskFilter && r.risk_level !== riskFilter) return false;
      if (supplierFilter !== 'all' && r.supplier_name !== supplierFilter) return false;
      if (q && !r.product_name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false;
      return true;
    });
    pool.sort((a, b) => {
      const diff = gtqEnRiesgo(b) - gtqEnRiesgo(a);
      if (diff !== 0) return diff;
      return a.days_of_supply - b.days_of_supply;
    });
    return pool;
  }, [basePool, riskFilter, supplierFilter, search]);

  // KPI totals always from product-level data — never per-warehouse (avoids double-counting)
  const totalGtq = useMemo(
    () => risks
      .filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto')
      .reduce((s, r) => s + gtqEnRiesgo(r), 0),
    [risks],
  );
  const critical = risks.filter((r) => r.risk_level === 'critico').length;
  const filteredGtq = useMemo(() => filtered.reduce((s, r) => s + gtqEnRiesgo(r), 0), [filtered]);

  // Build surplus map: sku → warehouse with most surplus (days > lead_time × 3)
  const surplusMap = useMemo(() => {
    const map = new Map<string, { warehouse_name: string; days_of_supply: number }>();
    for (const wr of warehouseRisks) {
      if (wr.lead_time_days > 0 && wr.days_of_supply > wr.lead_time_days * 3) {
        const existing = map.get(wr.sku);
        if (!existing || wr.days_of_supply > existing.days_of_supply) {
          map.set(wr.sku, { warehouse_name: wr.warehouse_name, days_of_supply: wr.days_of_supply });
        }
      }
    }
    return map;
  }, [warehouseRisks]);

  const hasFilters = riskFilter !== null || supplierFilter !== 'all' || warehouseFilter !== 'all' || search.trim() !== '';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
            Hot List — Desabastecimiento
          </h1>
          <p className="text-gray-500 mt-1">
            Productos en riesgo de quedarse sin inventario, ordenados por impacto financiero
          </p>
        </div>
        <button
          onClick={() => exportCSV(filtered, isPerWarehouse)}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      {/* KPI Cards — always company-wide, never per-warehouse */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-5">
          <p className="text-sm text-red-700 font-medium">Items Críticos</p>
          <p className="text-3xl font-bold text-red-700 mt-1">{critical}</p>
          <p className="text-xs text-red-500 mt-0.5">Stock en cero — toda la empresa</p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-5">
          <p className="text-sm text-amber-700 font-medium">GTQ en riesgo (Crítico + Alto)</p>
          <p className="text-2xl font-bold text-amber-700 mt-1">{fmtGTQ(totalGtq)}</p>
          <p className="text-xs text-amber-600 mt-0.5">Si no se actúa antes del lead time</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <p className="text-sm text-gray-500">Total monitoreados</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{risks.length}</p>
          <p className="text-xs text-gray-400 mt-0.5">SKUs con demanda activa</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Risk chips */}
        <div className="flex gap-2">
          {(['critico', 'alto', 'medio', 'bajo'] as const).map((level) => (
            <button
              key={level}
              onClick={() => setRiskFilter(riskFilter === level ? null : level)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                riskFilter === level
                  ? RISK_COLORS[level] + ' border-current'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
              }`}
            >
              {RISK_LABELS[level]}
            </button>
          ))}
        </div>

        {/* Warehouse */}
        {warehouses.length > 0 && (
          <select
            value={warehouseFilter}
            onChange={(e) => setWarehouseFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">Todas las bodegas</option>
            {warehouses.map((w) => (
              <option key={w.name} value={w.name}>{w.name}</option>
            ))}
          </select>
        )}

        {/* Supplier */}
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
            onClick={() => {
              setRiskFilter(null);
              setSupplierFilter('all');
              setWarehouseFilter('all');
              setSearch('');
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Per-warehouse notice */}
      {isPerWarehouse && (
        <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
          Vista por bodega — días de inventario calculados con stock de <strong>{warehouseFilter}</strong> y demanda total del producto (empresa). Los KPIs de arriba muestran el riesgo consolidado de toda la empresa.
        </p>
      )}

      {hasFilters && filtered.length > 0 && (
        <p className="text-xs text-gray-500">
          {filtered.length} resultado{filtered.length !== 1 ? 's' : ''} — GTQ en riesgo filtrado:{' '}
          <span className="font-semibold text-amber-700">{fmtGTQ(filteredGtq)}</span>
        </p>
      )}

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">SKU</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Proveedor</th>
                {isPerWarehouse && (
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Bodega</th>
                )}
                <th className="text-right px-4 py-3 font-medium text-gray-500">Lead time</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">GTQ en riesgo</th>
                {!isPerWarehouse && (
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Pedido urgente</th>
                )}
                <th className="text-right px-4 py-3 font-medium text-gray-500">Se agota</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Riesgo</th>
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
                    {risks.length === 0
                      ? 'No hay datos disponibles'
                      : 'No hay resultados para los filtros seleccionados.'}
                  </td>
                </tr>
              ) : (
                filtered.map((risk, idx) => {
                  const gtq = gtqEnRiesgo(risk);
                  const warehouseRow = risk as WarehouseRisk;
                  const rowKey = isPerWarehouse
                    ? `${risk.product_id}-${warehouseRow.warehouse_id}`
                    : String(risk.product_id);
                  return (
                    <tr key={rowKey + idx} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-xs truncate" title={risk.product_name}>
                        {risk.product_name}
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{risk.sku}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{risk.supplier_name ?? '—'}</td>
                      {isPerWarehouse && (
                        <td className="px-4 py-3 text-xs">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-mono">
                            {warehouseRow.warehouse_code}
                          </span>
                          <span className="ml-1.5 text-gray-500">{warehouseRow.warehouse_name}</span>
                        </td>
                      )}
                      <td className="px-4 py-3 text-right text-gray-500">{risk.lead_time_days}d</td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-700">
                        {fmtGTQ(gtq)}
                      </td>
                      {!isPerWarehouse && (() => {
                        const eQty = emergencyQty(risk);
                        const surplus = surplusMap.get(risk.sku);
                        return (
                          <td className="px-4 py-3 text-right">
                            {eQty > 0
                              ? <span className="font-semibold text-red-700">{eQty.toLocaleString('es-GT')}</span>
                              : <span className="text-gray-300">—</span>
                            }
                            {eQty > 0 && surplus && (
                              <div className="text-[10px] text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5 mt-1 text-left leading-tight whitespace-nowrap">
                                ↑ Excedente en {surplus.warehouse_name} — trasladar primero
                              </div>
                            )}
                          </td>
                        );
                      })()}
                      <td className="px-4 py-3 text-right">
                        <div className="font-semibold text-gray-900 tabular-nums">
                          {risk.days_of_supply >= 9999 ? '999+ d' : `${Math.round(risk.days_of_supply)}d`}
                        </div>
                        <div className="text-xs text-gray-400">{fechaAgotamiento(risk)}</div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[risk.risk_level] || 'bg-gray-100 text-gray-600'}`}>
                          {RISK_LABELS[risk.risk_level] || risk.risk_level}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isPerWarehouse && !loading && (
        <p className="text-xs text-gray-400">
          Mostrando stock de <strong>{warehouseFilter}</strong> — un mismo SKU puede aparecer con nivel de riesgo diferente en cada bodega.
        </p>
      )}
    </div>
  );
}
