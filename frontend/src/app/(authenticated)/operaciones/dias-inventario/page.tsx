'use client';

import { useState, useEffect, useMemo } from 'react';
import { Gauge, Flame, Snowflake, Minus, CheckCircle, Download } from 'lucide-react';

interface DaysOfInventoryRow {
  snapshot_date: string;
  product_id: number;
  sku: string;
  product_name: string;
  category: string | null;
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  current_stock: number;
  inventory_value_gtq: number;
  avg_daily_demand: number;
  days_of_supply: number | null;
  lead_time_days: number | null;
  status: 'hot' | 'ok' | 'hold' | 'no_demand';
}

type StatusFilter = 'all' | 'hot' | 'ok' | 'hold' | 'no_demand';

const STATUS_STYLE: Record<DaysOfInventoryRow['status'], { pill: string; label: string; icon: React.ComponentType<{ className?: string }> }> = {
  hot:       { pill: 'bg-red-100 text-red-700',       label: 'Hot',         icon: Flame },
  ok:        { pill: 'bg-green-100 text-green-700',   label: 'OK',          icon: CheckCircle },
  hold:      { pill: 'bg-blue-100 text-blue-700',     label: 'Hold',        icon: Snowflake },
  no_demand: { pill: 'bg-gray-100 text-gray-600',     label: 'Sin demanda', icon: Minus },
};

const POLICY_BADGE: Record<string, { label: string; cls: string }> = {
  under: { label: 'BAJO mínimo',   cls: 'bg-red-100 text-red-700' },
  ok:    { label: 'DENTRO rango',  cls: 'bg-green-100 text-green-700' },
  over:  { label: 'SOBRE máximo',  cls: 'bg-blue-100 text-blue-700' },
  nd:    { label: 'Sin referencia', cls: 'bg-gray-100 text-gray-500' },
};

const PAGE_SIZE = 100;

function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('es-GT', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function formatDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('es-GT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function formatGTQ(n: number | null): string {
  if (!n) return '—';
  return 'Q ' + n.toLocaleString('es-GT', { maximumFractionDigits: 0 });
}

// Policy bounds derived from lead_time_days (same logic as the RPC)
// hot = days < 1× lead_time   (min policy = lead_time_days)
// ok  = between 1× and 3×
// hold = days > 3× lead_time  (max policy = lead_time_days × 3)
function policyStatus(r: DaysOfInventoryRow): 'under' | 'ok' | 'over' | 'nd' {
  if (r.days_of_supply === null || r.lead_time_days === null || r.lead_time_days === 0) return 'nd';
  const min = r.lead_time_days;
  const max = r.lead_time_days * 3;
  if (r.days_of_supply < min) return 'under';
  if (r.days_of_supply > max) return 'over';
  return 'ok';
}

// Effective coverage: days of supply minus lead time
// Negative means the reorder point was already breached
function coberturaEfectiva(r: DaysOfInventoryRow): { value: number | null; label: string; cls: string } {
  if (r.days_of_supply === null) return { value: null, label: '—', cls: 'text-gray-400' };
  if (r.lead_time_days === null || r.lead_time_days === 0) return { value: null, label: '—', cls: 'text-gray-400' };
  const eff = r.days_of_supply - r.lead_time_days;
  if (eff < 0) return { value: eff, label: 'OC atrasada', cls: 'text-red-700 font-semibold' };
  if (eff <= 3) return { value: eff, label: `${eff.toFixed(0)}d — Pedir ya`, cls: 'text-amber-700 font-semibold' };
  return { value: eff, label: `${eff.toFixed(0)}d`, cls: 'text-gray-700' };
}

function exportCSV(rows: DaysOfInventoryRow[]) {
  const headers = [
    'Producto', 'SKU', 'Bodega', 'Stock', 'Demanda/día', 'Días',
    'Lead time', 'Cobertura efectiva', 'GTQ en stock', 'vs. Política', 'Estado',
  ];
  const lines = rows.map((r) => {
    const ps = policyStatus(r);
    const ce = coberturaEfectiva(r);
    return [
      `"${r.product_name}"`,
      r.sku,
      `"${r.warehouse_name}"`,
      r.current_stock.toFixed(0),
      r.avg_daily_demand.toFixed(1),
      r.days_of_supply === null ? '—' : r.days_of_supply > 999 ? '999+' : r.days_of_supply.toFixed(0),
      r.lead_time_days === null || r.lead_time_days === 0 ? 'N/D' : r.lead_time_days,
      ce.value === null ? '—' : ce.value.toFixed(0),
      r.inventory_value_gtq.toFixed(0),
      POLICY_BADGE[ps].label,
      STATUS_STYLE[r.status].label,
    ].join(',');
  });
  const csv = '﻿' + [headers.join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `dias-inventario-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function DiasInventarioPage() {
  const [rows, setRows] = useState<DaysOfInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<number | 'all'>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch('/api/kpis/days-of-inventory')
      .then((res) => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then((data) => {
        setRows(Array.isArray(data) ? data : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const counts = useMemo(() => ({
    hot:       rows.filter((r) => r.status === 'hot').length,
    ok:        rows.filter((r) => r.status === 'ok').length,
    hold:      rows.filter((r) => r.status === 'hold').length,
    no_demand: rows.filter((r) => r.status === 'no_demand').length,
  }), [rows]);

  const gtqByStatus = useMemo(() => ({
    hot:       rows.filter((r) => r.status === 'hot').reduce((s, r) => s + (r.inventory_value_gtq || 0), 0),
    ok:        rows.filter((r) => r.status === 'ok').reduce((s, r) => s + (r.inventory_value_gtq || 0), 0),
    hold:      rows.filter((r) => r.status === 'hold').reduce((s, r) => s + (r.inventory_value_gtq || 0), 0),
    no_demand: rows.filter((r) => r.status === 'no_demand').reduce((s, r) => s + (r.inventory_value_gtq || 0), 0),
  }), [rows]);

  const warehouses = useMemo(() => {
    const seen = new Map<number, { id: number; code: string; name: string; count: number }>();
    rows.forEach((r) => {
      const existing = seen.get(r.warehouse_id);
      if (existing) { existing.count++; }
      else { seen.set(r.warehouse_id, { id: r.warehouse_id, code: r.warehouse_code, name: r.warehouse_name, count: 1 }); }
    });
    return Array.from(seen.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const pool = rows.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (warehouseFilter !== 'all' && r.warehouse_id !== warehouseFilter) return false;
      if (q && !r.product_name.toLowerCase().includes(q) && !r.sku.toLowerCase().includes(q)) return false;
      return true;
    });
    const statusOrder: Record<DaysOfInventoryRow['status'], number> = { hot: 0, ok: 1, hold: 2, no_demand: 3 };
    pool.sort((a, b) => {
      const s = statusOrder[a.status] - statusOrder[b.status];
      if (s !== 0) return s;
      const ad = a.days_of_supply ?? Number.POSITIVE_INFINITY;
      const bd = b.days_of_supply ?? Number.POSITIVE_INFINITY;
      return ad - bd;
    });
    return pool;
  }, [rows, statusFilter, warehouseFilter, search]);

  const snapshotLabel = rows.length > 0 ? formatDate(rows[0].snapshot_date) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Gauge className="w-6 h-6 text-emerald-600" />
            Días de Inventario
          </h1>
          <p className="text-gray-500 mt-1">
            Stock por producto y bodega vs. política de inventario, según demanda de los últimos 30 días.
          </p>
          {snapshotLabel && (
            <p className="text-xs text-gray-400 mt-1">Snapshot al {snapshotLabel}.</p>
          )}
        </div>
        <button
          onClick={() => exportCSV(filtered)}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Exportar CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatusCard
          label="Hot (urgente)" count={counts.hot} gtq={gtqByStatus.hot}
          color="text-red-600" active={statusFilter === 'hot'}
          onClick={() => setStatusFilter(statusFilter === 'hot' ? 'all' : 'hot')}
        />
        <StatusCard
          label="OK" count={counts.ok} gtq={gtqByStatus.ok}
          color="text-green-600" active={statusFilter === 'ok'}
          onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')}
        />
        <StatusCard
          label="Hold (sobrante)" count={counts.hold} gtq={gtqByStatus.hold}
          color="text-blue-600" active={statusFilter === 'hold'}
          onClick={() => setStatusFilter(statusFilter === 'hold' ? 'all' : 'hold')}
        />
        <StatusCard
          label="Sin demanda" count={counts.no_demand} gtq={gtqByStatus.no_demand}
          color="text-gray-600" active={statusFilter === 'no_demand'}
          onClick={() => setStatusFilter(statusFilter === 'no_demand' ? 'all' : 'no_demand')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={warehouseFilter}
          onChange={(e) => setWarehouseFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="all">Todas las bodegas ({rows.length})</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name} ({w.count})</option>
          ))}
        </select>
        <input
          type="search"
          placeholder="Buscar por SKU o nombre…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white flex-1 min-w-[220px]"
        />
        {(statusFilter !== 'all' || warehouseFilter !== 'all' || search) && (
          <button
            onClick={() => { setStatusFilter('all'); setWarehouseFilter('all'); setSearch(''); }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Producto</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">SKU</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Bodega</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Stock</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Dem./día</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">Días</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">LT</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Cob. efectiva</th>
                <th className="text-right px-4 py-3 font-medium text-gray-500">GTQ en stock</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">vs. Política</th>
                <th className="text-center px-4 py-3 font-medium text-gray-500">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">Cargando datos…</td></tr>
              ) : error ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-red-500">No se pudieron cargar los datos.</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No hay resultados para los filtros seleccionados.</td></tr>
              ) : (
                filtered.slice(0, PAGE_SIZE).map((r) => {
                  const s = STATUS_STYLE[r.status];
                  const Icon = s.icon;
                  const ps = policyStatus(r);
                  const pb = POLICY_BADGE[ps];
                  const ce = coberturaEfectiva(r);
                  return (
                    <tr key={`${r.product_id}-${r.warehouse_id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900 max-w-[180px] truncate" title={r.product_name}>
                        {r.product_name}
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.sku}</td>
                      <td className="px-4 py-3 text-gray-500">{r.warehouse_name}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatNumber(r.current_stock, r.current_stock < 10 ? 2 : 0)}</td>
                      <td className="px-4 py-3 text-right text-gray-900">{formatNumber(r.avg_daily_demand, 1)}</td>
                      <td className="px-4 py-3 text-right text-gray-900 font-medium">
                        {r.days_of_supply === null ? '—' : r.days_of_supply > 999 ? '999+' : formatNumber(r.days_of_supply, 0)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500">
                        {r.lead_time_days === null || r.lead_time_days === 0 ? 'N/D' : `${r.lead_time_days}d`}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <span className={ce.cls}>{ce.label}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700 text-xs">
                        {formatGTQ(r.inventory_value_gtq)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${pb.cls}`}>
                          {pb.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${s.pill}`}>
                          <Icon className="w-3 h-3" />
                          {s.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {!loading && filtered.length > PAGE_SIZE && (
          <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-500 bg-gray-50">
            Mostrando {PAGE_SIZE} de {filtered.length} resultados. Refiná con los filtros.
          </div>
        )}
      </div>
    </div>
  );
}

interface StatusCardProps {
  label: string;
  count: number;
  gtq: number;
  color: string;
  active: boolean;
  onClick: () => void;
}

function StatusCard({ label, count, gtq, color, active, onClick }: StatusCardProps) {
  return (
    <button
      onClick={onClick}
      className={`text-left bg-white rounded-xl border p-4 transition-colors ${active ? 'border-emerald-500 ring-2 ring-emerald-100' : 'border-gray-200 hover:border-gray-300'}`}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${color}`}>{count.toLocaleString('es-GT')}</p>
      {gtq > 0 && (
        <p className="text-xs text-gray-400 mt-0.5">
          Q {gtq.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
        </p>
      )}
    </button>
  );
}
