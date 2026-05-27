'use client';

import { useState, useEffect, useMemo } from 'react';
import { Target, Filter, ExternalLink, Info, ChevronDown } from 'lucide-react';

interface SkuMeta {
  sku: string;
  product_name: string;
  supplier_class: string;
  source_indicator: string;
  movement_rank_within_class: number;
  is_top_10_in_class: boolean;
  net_sales_quantity: number;
}

interface GapRow {
  sku: string;
  product_name: string;
  supplier_class: string;
  source_indicator: string;
  movement_rank_within_class: number;
  is_top_10_in_class: boolean;
  observation_month: string;
  sales_qty: number;
  sales_revenue_gtq: number;
  sales_doc_count: number;
  purchases_ordered_qty: number;
  purchases_received_qty: number;
}

const MONTH_LABELS_ES: Record<string, string> = {
  '01': 'Enero', '02': 'Febrero', '03': 'Marzo', '04': 'Abril',
  '05': 'Mayo', '06': 'Junio', '07': 'Julio', '08': 'Agosto',
  '09': 'Septiembre', '10': 'Octubre', '11': 'Noviembre', '12': 'Diciembre',
};

function fmtMonth(yyyymm: string): string {
  const [year, month] = yyyymm.split('-');
  return `${MONTH_LABELS_ES[month]} ${year.slice(2)}`;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '—';
  return n.toLocaleString('es-GT', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtGtq(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `Q ${(n / 1_000_000).toLocaleString('es-GT', { maximumFractionDigits: 2 })} M`;
  if (abs >= 1_000) return `Q ${(n / 1_000).toLocaleString('es-GT', { maximumFractionDigits: 1 })} k`;
  return `Q ${n.toLocaleString('es-GT', { maximumFractionDigits: 0 })}`;
}

// Scope is locked to the same 23 SKUs used by /gerencia/forecast.
const SCOPE = 'top';

// Data is intentionally capped at Jan 2026 — Feb/Mar/Apr are blind-test months.
const MAX_MONTH = '2026-01';

const MONTH_NAV: Record<string, string[]> = {
  '2024': ['2024-01','2024-02','2024-03','2024-04','2024-05','2024-06','2024-07','2024-08','2024-09','2024-10','2024-11','2024-12'],
  '2025': ['2025-01','2025-02','2025-03','2025-04','2025-05','2025-06','2025-07','2025-08','2025-09','2025-10','2025-11','2025-12'],
  '2026': ['2026-01'],
};

export default function GapReportPage() {
  const [skus, setSkus] = useState<SkuMeta[]>([]);
  const [rows, setRows] = useState<GapRow[]>([]);
  const [loadingSkus, setLoadingSkus] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comoUsarOpen, setComoUsarOpen] = useState(false);

  // Filters
  const [supplierClass, setSupplierClass] = useState<'' | 'REYMA' | 'CARVAJAL'>('');
  const [skuFilter, setSkuFilter] = useState<string>('');
  // null = show all months; a YYYY-MM string = single-month view
  const [selectedMonth, setSelectedMonth] = useState<string | null>('2025-01');

  // User's "expected" overlay — keyed by `${sku}|${month}|${metric}`
  const [expected, setExpected] = useState<Record<string, string>>({});

  useEffect(() => {
    setLoadingSkus(true);
    fetch(`/api/gerencia/gap-report?action=skus&scope=${SCOPE}`)
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then((data) => { setSkus(data.skus ?? []); setLoadingSkus(false); })
      .catch((err) => { setError(String(err)); setLoadingSkus(false); });
  }, []);

  useEffect(() => {
    setLoadingRows(true);
    setError(null);
    const params = new URLSearchParams({ action: 'report', scope: SCOPE });
    if (skuFilter) params.set('sku', skuFilter);
    if (supplierClass) params.set('class', supplierClass);
    if (selectedMonth) {
      params.set('from', selectedMonth);
      params.set('to', selectedMonth);
    } else {
      params.set('from', '2024-09');
    }

    fetch(`/api/gerencia/gap-report?${params.toString()}`)
      .then((res) => { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then((data) => { setRows(data.rows ?? []); setLoadingRows(false); })
      .catch((err) => { setError(String(err)); setLoadingRows(false); });
  }, [skuFilter, supplierClass, selectedMonth]);

  // Group rows by SKU for the table
  const grouped = useMemo(() => {
    const m = new Map<string, GapRow[]>();
    for (const r of rows) {
      const arr = m.get(r.sku) ?? [];
      arr.push(r);
      m.set(r.sku, arr);
    }
    return Array.from(m.entries()).map(([sku, items]) => ({
      sku,
      meta: items[0],
      months: items.sort((a, b) => a.observation_month.localeCompare(b.observation_month)),
    })).sort((a, b) => {
      // Sort by class then rank
      if (a.meta.supplier_class !== b.meta.supplier_class) return a.meta.supplier_class.localeCompare(b.meta.supplier_class);
      return (a.meta.movement_rank_within_class || 999) - (b.meta.movement_rank_within_class || 999);
    });
  }, [rows]);

  const filteredSkus = useMemo(() =>
    skus.filter((s) => !supplierClass || s.supplier_class === supplierClass),
  [skus, supplierClass]);

  function deltaCell(actualValue: number, key: string) {
    const exp = expected[key];
    if (!exp) return null;
    const expNum = Number(exp);
    if (Number.isNaN(expNum)) return null;
    const diff = actualValue - expNum;
    const pct = expNum === 0 ? 0 : (diff / expNum) * 100;
    const colour = Math.abs(pct) < 1 ? 'text-emerald-600' : Math.abs(pct) < 5 ? 'text-yellow-600' : 'text-red-600';
    return <div className={`text-xs ${colour}`}>Δ {diff >= 0 ? '+' : ''}{fmtNum(diff, 2)} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%)</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Target className="w-6 h-6 text-emerald-600" />
          Auditoría de Discrepancias
        </h1>
        {/* <p className="text-gray-500 mt-1">
          Spot-check de los números de la app contra el dashboard del CEO.
          SKUs en alcance: 23 (top REYMA + CARVAJAL) — mismo universo que el Forecast.
        </p> */}
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900 overflow-hidden">
        <button
          onClick={() => setComoUsarOpen((o) => !o)}
          className="w-full flex items-center justify-between gap-2 px-4 py-3 font-semibold hover:bg-blue-100 transition-colors"
        >
          <span className="flex items-center gap-1.5"><Info className="w-4 h-4" /> Cómo usar</span>
          <ChevronDown className={`w-4 h-4 transition-transform ${comoUsarOpen ? 'rotate-180' : ''}`} />
        </button>
        {comoUsarOpen && (
          <div className="px-4 pb-4">
            <ol className="list-decimal ml-5 space-y-1">
              <li>Filtra por SKU y mes.</li>
              <li>En el dashboard de Odoo, busca el mismo SKU y mes.</li>
              <li>Pega los números esperados en las casillas <span className="font-mono bg-blue-100 px-1 rounded">esperado</span>; verás el Δ contra nuestros cálculos.</li>
              <li>Si Δ &lt; 1% → el cálculo es acertado. Si &gt; 5% → el cálculo necesita revisión.</li>
            </ol>
            <p className="mt-2 text-xs">
              <strong>Fórmulas:</strong> Ventas = <span className="font-mono">aml.income.posted.invoice±refund.invoice_date</span>;
              Compras Ord = <span className="font-mono">pol.all_states.date_planned.product_qty</span>;
              Compras Rec = <span className="font-mono">pol.purchase|done.date_planned.qty_received</span>.
              Todas normalizadas a UoM de stock del producto.
            </p>
          </div>
        )}
      </div>

      {/* Month navigation */}
      <div className="space-y-2">
        {Object.entries(MONTH_NAV).map(([year, months]) => (
          <div key={year} className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-gray-400 w-8 shrink-0">{year}</span>
            {months.map((ym) => {
              const [, mm] = ym.split('-');
              const isActive = selectedMonth === ym;
              return (
                <button
                  key={ym}
                  onClick={() => setSelectedMonth(isActive ? null : ym)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {MONTH_LABELS_ES[mm]}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* SKU + class filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <Filter className="w-4 h-4" /> Filtros
        </div>

        <div className="flex flex-wrap gap-6">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Proveedor</label>
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
              {([
                { v: '', label: 'Todos' },
                { v: 'REYMA', label: 'REYMA' },
                { v: 'CARVAJAL', label: 'CARVAJAL' },
              ] as const).map((opt, i) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => { setSupplierClass(opt.v); setSkuFilter(''); }}
                  className={`px-3 py-2 text-sm ${i > 0 ? 'border-l border-gray-300' : ''} ${
                    supplierClass === opt.v
                      ? 'bg-emerald-600 text-white font-medium'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 min-w-[12rem]">
            <label className="block text-xs font-medium text-gray-600 mb-1">SKU</label>
            <select className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    value={skuFilter} onChange={(e) => setSkuFilter(e.target.value)}
                    disabled={loadingSkus}>
              <option value="">Todos</option>
              {filteredSkus.map((s) => (
                <option key={s.sku} value={s.sku}>
                  {s.sku} — {s.product_name.slice(0, 40)}{s.is_top_10_in_class ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="text-xs text-gray-500">
          {loadingRows ? 'Cargando…' : `${rows.length} celdas (${grouped.length} SKUs × ${rows.length / Math.max(1, grouped.length)} meses prom).`}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="border-b border-gray-200">
                <th className="text-left px-3 py-2 font-medium text-gray-700 sticky left-0 bg-gray-50 z-20">SKU / Producto</th>
                <th className="text-left px-2 py-2 font-medium text-gray-700">Mes</th>
                <th className="text-right px-2 py-2 font-medium text-gray-700">Ventas (unidades)</th>
                <th className="text-right px-2 py-2 font-medium text-gray-700">Ventas (GTQ)</th>
                <th className="text-right px-2 py-2 font-medium text-gray-700">Compras (unidades)</th>
                <th className="text-right px-2 py-2 font-medium text-gray-700">Recibido (unidades)</th>
                <th className="text-left px-2 py-2 font-medium text-gray-700">Esperado (CEO)</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map(({ sku, meta, months }) => (
                <>
                  {months.map((row, idx) => {
                    const isFirst = idx === 0;
                    const colourBg = meta.supplier_class === 'REYMA' ? 'bg-emerald-50/30' : meta.supplier_class === 'CARVAJAL' ? 'bg-sky-50/30' : '';
                    return (
                      <tr key={`${sku}-${row.observation_month}`} className={`border-b border-gray-100 ${colourBg}`}>
                        {isFirst ? (
                          <td className="px-3 py-2 sticky left-0 bg-white z-10 align-top" rowSpan={months.length}>
                            <div className="font-mono text-xs text-gray-600">{sku}</div>
                            <div className="text-sm font-medium text-gray-900 max-w-xs">{meta.product_name}</div>
                            <div className="flex gap-1 mt-1">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.supplier_class === 'REYMA' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                                {meta.supplier_class}
                              </span>
                              {meta.source_indicator === 'SUPPLIER_LINK' && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-100 text-orange-800" title="Sin CARVAJAL en nombre — sub-marca">
                                  🚩 sub-marca
                                </span>
                              )}
                              {meta.is_top_10_in_class && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">
                                  ★ rank #{meta.movement_rank_within_class}
                                </span>
                              )}
                            </div>
                          </td>
                        ) : null}
                        <td className="px-2 py-1.5 text-gray-700 whitespace-nowrap">{fmtMonth(row.observation_month)}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-gray-900">
                          {fmtNum(row.sales_qty, 2)}
                          {deltaCell(Number(row.sales_qty), `${sku}|${row.observation_month}|sales_qty`)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-gray-700">
                          {fmtGtq(Number(row.sales_revenue_gtq))}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-gray-900">
                          {fmtNum(row.purchases_ordered_qty, 2)}
                          {deltaCell(Number(row.purchases_ordered_qty), `${sku}|${row.observation_month}|po_ord`)}
                        </td>
                        <td className="px-2 py-1.5 text-right font-mono text-gray-900">
                          {fmtNum(row.purchases_received_qty, 2)}
                          {deltaCell(Number(row.purchases_received_qty), `${sku}|${row.observation_month}|po_rcv`)}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <input type="number" step="0.01"
                                 className="w-24 border border-gray-200 rounded px-2 py-1 text-xs font-mono"
                                 placeholder="ventas"
                                 value={expected[`${sku}|${row.observation_month}|sales_qty`] ?? ''}
                                 onChange={(e) => setExpected({...expected, [`${sku}|${row.observation_month}|sales_qty`]: e.target.value})} />
                        </td>
                      </tr>
                    );
                  })}
                </>
              ))}
              {!loadingRows && grouped.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">Sin datos para los filtros seleccionados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Datos: <code>revenue_daily</code> en Supabase prod. Origen: Odoo live (
        <a href="https://suplicentro-2801-27990914.dev.odoo.com" target="_blank" rel="noopener" className="text-blue-600 hover:underline inline-flex items-center gap-0.5">
          test env <ExternalLink className="w-3 h-3" />
        </a>
        ). Última sincronización: ver columna <code>computed_at</code> en cada fila.
      </div>
    </div>
  );
}
