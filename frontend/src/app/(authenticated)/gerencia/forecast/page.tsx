'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { TrendingUp, Sparkles, Download, Info } from 'lucide-react';

const MONTH_NAMES_ES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

// Furgón 53 pies (53-foot trailer) = 122 m³. Confirmed with client 2026-05-11.
const FURGO_M3 = 122;

interface ForecastRow {
  sku: string;
  product_name: string | null;
  supplier_class: string | null;
  movement_rank_within_class: number | null;
  stock_uom: string | null;
  volume_m3: number | null;
  po_history_real_months: number | null;
  metric: string;
  forecast_month: string;
  yhat_sum: number;
  yhat_lower_sum: number | null;
  yhat_upper_sum: number | null;
  training_end_date: string;
  model_status: string;
}

type SkuRow = {
  sku: string;
  name: string;
  supplier_class: string;
  movement_rank_within_class: number | null;
  stock_uom: string | null;
  volume_m3: number | null;
  po_history_real_months: number | null;
  sales_feb: number | null;
  sales_mar: number | null;
  purchases_ordered_feb: number | null;
  purchases_ordered_mar: number | null;
  purchases_received_feb: number | null;
  purchases_received_mar: number | null;
  training_end_date: string | null;
};

type CompletenessTier = 'green' | 'amber' | 'red';

function getCompletenessTier(months: number | null): CompletenessTier {
  if (months === null) return 'red';
  if (months === 16) return 'green';
  if (months >= 3) return 'amber';
  return 'red';
}

const TIER_STYLES: Record<CompletenessTier, { skuBg: string; pill: string; pillText: string; label: string }> = {
  green: {
    skuBg: 'bg-green-50',
    pill: 'bg-green-100 text-green-700 border border-green-200',
    pillText: 'Datos completos',
    label: 'Datos completos',
  },
  amber: {
    skuBg: 'bg-amber-50',
    pill: 'bg-amber-100 text-amber-700 border border-amber-200',
    pillText: 'Datos parciales',
    label: 'Datos parciales',
  },
  red: {
    skuBg: 'bg-red-50',
    pill: 'bg-red-100 text-red-700 border border-red-200',
    pillText: 'Datos insuficientes',
    label: 'Datos insuficientes',
  },
};

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('es-GT');
}

function fmtFurgo(units: number | null | undefined, volume_m3: number | null | undefined): string {
  if (units == null || volume_m3 == null || volume_m3 === 0) return '—';
  return ((units * volume_m3) / FURGO_M3).toFixed(1);
}

function furgoVal(units: number | null, volume_m3: number | null): string {
  if (units == null || volume_m3 == null || volume_m3 === 0) return '';
  return ((units * volume_m3) / FURGO_M3).toFixed(1);
}

function downloadCsv(rows: SkuRow[], filterLabel: string) {
  const headers = [
    'SKU',
    'Producto',
    'Proveedor',
    'Unidad de Medida',
    'Ventas Feb 2026 (unidades)',
    'Ventas Mar 2026 (unidades)',
    'Compras Ordenadas Feb 2026 (unidades)',
    'Compras Ordenadas Mar 2026 (unidades)',
    'Compras Recibidas Feb 2026 (unidades)',
    'Compras Recibidas Mar 2026 (unidades)',
    'Furgones Ventas Feb 2026',
    'Furgones Ventas Mar 2026',
    'Furgones Compras Ordenadas Feb 2026',
    'Furgones Compras Ordenadas Mar 2026',
    'Furgones Compras Recibidas Feb 2026',
    'Furgones Compras Recibidas Mar 2026',
    'm3 por unidad',
    'unidades por furgon (aprox)',
  ];

  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const dataRows = rows.map((r) => [
    r.sku,
    r.name,
    r.supplier_class,
    r.stock_uom ?? '',
    r.sales_feb ?? '',
    r.sales_mar ?? '',
    r.purchases_ordered_feb ?? '',
    r.purchases_ordered_mar ?? '',
    r.purchases_received_feb ?? '',
    r.purchases_received_mar ?? '',
    furgoVal(r.sales_feb, r.volume_m3),
    furgoVal(r.sales_mar, r.volume_m3),
    furgoVal(r.purchases_ordered_feb, r.volume_m3),
    furgoVal(r.purchases_ordered_mar, r.volume_m3),
    furgoVal(r.purchases_received_feb, r.volume_m3),
    furgoVal(r.purchases_received_mar, r.volume_m3),
    r.volume_m3 != null ? r.volume_m3.toFixed(4) : '',
    r.volume_m3 != null ? (FURGO_M3 / r.volume_m3).toFixed(1) : '',
  ].map(escape).join(','));

  const csv = [headers.map(escape).join(','), ...dataRows].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `forecast_feb-mar-2026${filterLabel ? '_' + filterLabel : ''}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ForecastPage() {
  const [raw, setRaw] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState<'' | 'REYMA' | 'CARVAJAL'>('');
  const [tierFilter, setTierFilter] = useState<Set<CompletenessTier>>(new Set(['green', 'amber', 'red']));
  const [openTip, setOpenTip] = useState<CompletenessTier | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<Record<string, Record<string, number>>>({});
  const [openHistoryTip, setOpenHistoryTip] = useState<string | null>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  const historyTipRef = useRef<HTMLDivElement>(null);
  const [metricFilter, setMetricFilter] = useState<'' | 'ventas' | 'compras_ordenadas' | 'compras_recibidas'>('ventas');

  useEffect(() => {
    Promise.all([
      fetch('/api/forecast?scope=top&forecast_month=2026-02-01').then((r) => r.json()),
      fetch('/api/forecast?scope=top&forecast_month=2026-03-01').then((r) => r.json()),
      fetch('/api/forecast/purchase-history?scope=top').then((r) => r.json()),
    ])
      .then(([feb, mar, hist]) => {
        const combined: ForecastRow[] = [...(feb.forecasts ?? []), ...(mar.forecasts ?? [])];
        setRaw(combined);
        setPurchaseHistory(hist.history ?? {});
        setLoading(false);
      })
      .catch((e) => { setErr(String(e)); setLoading(false); });
  }, []);

  // Close history tooltip on outside click
  useEffect(() => {
    if (!openHistoryTip) return;
    function onDown(e: MouseEvent) {
      if (historyTipRef.current && !historyTipRef.current.contains(e.target as Node)) {
        setOpenHistoryTip(null);
        setTipPos(null);
      }
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openHistoryTip]);

  const handleHistoryTipClick = useCallback((sku: string, e: React.MouseEvent<HTMLButtonElement>) => {
    if (openHistoryTip === sku) {
      setOpenHistoryTip(null);
      setTipPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const tooltipWidth = 340;
    const tooltipHeight = 340; // 12 months × ~20px + header + padding
    const left = Math.min(rect.left, window.innerWidth - tooltipWidth - 8);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= tooltipHeight
      ? rect.bottom + 6
      : Math.max(8, rect.top - tooltipHeight - 6);
    setOpenHistoryTip(sku);
    setTipPos({ top, left });
  }, [openHistoryTip]);

  const rows: SkuRow[] = useMemo(() => {
    const m = new Map<string, SkuRow>();
    for (const r of raw) {
      const existing = m.get(r.sku) ?? {
        sku: r.sku,
        name: r.product_name ?? '',
        supplier_class: r.supplier_class ?? '',
        movement_rank_within_class: r.movement_rank_within_class ?? null,
        stock_uom: r.stock_uom ?? null,
        volume_m3: r.volume_m3 ?? null,
        po_history_real_months: r.po_history_real_months ?? null,
        sales_feb: null, sales_mar: null,
        purchases_ordered_feb: null, purchases_ordered_mar: null,
        purchases_received_feb: null, purchases_received_mar: null,
        training_end_date: r.training_end_date ?? null,
      };
      const key = r.forecast_month.startsWith('2026-02')
        ? `${r.metric}_feb`
        : r.forecast_month.startsWith('2026-03')
          ? `${r.metric}_mar`
          : null;
      if (key && key in existing) {
        (existing as unknown as Record<string, number>)[key] = Math.round(Number(r.yhat_sum));
      }
      m.set(r.sku, existing);
    }
    return Array.from(m.values()).sort((a, b) => {
      if (a.supplier_class !== b.supplier_class) return a.supplier_class.localeCompare(b.supplier_class);
      return (a.movement_rank_within_class ?? 999) - (b.movement_rank_within_class ?? 999);
    });
  }, [raw]);

  const visible = rows.filter((r) => {
    if (classFilter && r.supplier_class !== classFilter) return false;
    return tierFilter.has(getCompletenessTier(r.po_history_real_months));
  });

  const totals = useMemo(() => {
    const sum = (key: keyof SkuRow) => visible.reduce((a, r) => a + Number(r[key] ?? 0), 0);
    const furgoSum = (unitsKey: keyof SkuRow) =>
      visible.reduce((a, r) => {
        const units = Number(r[unitsKey] ?? 0);
        const vol = r.volume_m3;
        if (vol == null) return a;
        return a + (units * vol) / FURGO_M3;
      }, 0);
    return {
      sales_feb: sum('sales_feb'),
      sales_mar: sum('sales_mar'),
      po_ord_feb: sum('purchases_ordered_feb'),
      po_ord_mar: sum('purchases_ordered_mar'),
      po_rcv_feb: sum('purchases_received_feb'),
      po_rcv_mar: sum('purchases_received_mar'),
      furgo_sales_feb: furgoSum('sales_feb'),
      furgo_sales_mar: furgoSum('sales_mar'),
      furgo_ord_feb: furgoSum('purchases_ordered_feb'),
      furgo_ord_mar: furgoSum('purchases_ordered_mar'),
      furgo_rcv_feb: furgoSum('purchases_received_feb'),
      furgo_rcv_mar: furgoSum('purchases_received_mar'),
    };
  }, [visible]);

  const showVentas    = metricFilter === '' || metricFilter === 'ventas';
  const showOrdenadas = metricFilter === '' || metricFilter === 'compras_ordenadas';
  const showRecibidas = metricFilter === '' || metricFilter === 'compras_recibidas';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <TrendingUp className="w-6 h-6 text-emerald-600" />
          Forecast — Febrero & Marzo 2026
        </h1>
        <p className="text-gray-500 mt-1">
          AI Refill entrenado con datos hasta 31-ene-2026. Predicción para feb + mar 2026. Compare contra sus cifras reales.
        </p>
      </div>

      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-900">
        <p className="font-semibold flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> Cómo leer esto
        </p>
        <p className="mt-1">
          Cada fila es un SKU del top 23 (12 REYMA + 11 CARVAJAL por Net Sales). Las columnas muestran las
          cantidades predichas por AI Refill para cada mes, en UdM de stock del producto. Las tres métricas
          (ventas netas, compras ordenadas, compras recibidas) usan las fórmulas verificadas que
          reprodujeron los meses históricos con un diferencial del <strong>0%</strong>.
        </p>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-gray-600">Proveedor:</span>
        <button onClick={() => setClassFilter('')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === '' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}>
          Todos ({rows.length})
        </button>
        <button onClick={() => setClassFilter('REYMA')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === 'REYMA' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'}`}>
          REYMA ({rows.filter((r) => r.supplier_class === 'REYMA').length})
        </button>
        <button onClick={() => setClassFilter('CARVAJAL')}
          className={`px-3 py-1 text-sm rounded-lg ${classFilter === 'CARVAJAL' ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700'}`}>
          CARVAJAL ({rows.filter((r) => r.supplier_class === 'CARVAJAL').length})
        </button>
        <div className="ml-auto">
          <button
            onClick={() => downloadCsv(visible, classFilter)}
            className="flex items-center gap-1.5 px-3 py-1 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Descargar CSV
          </button>
        </div>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-gray-600">Forecast:</span>
        {([
          { key: '' as const,                    label: 'Todo' },
          { key: 'ventas' as const,              label: 'Ventas' },
          { key: 'compras_ordenadas' as const,   label: 'Compras Ordenadas' },
          { key: 'compras_recibidas' as const,   label: 'Compras Recibidas' },
        ]).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setMetricFilter(key)}
            className={`px-3 py-1 text-sm rounded-lg transition-colors ${
              metricFilter === key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-sm text-gray-600">Historial OC:</span>
        {(['green', 'amber', 'red'] as CompletenessTier[]).map((tier) => {
          const active = tierFilter.has(tier);
          const count = rows.filter((r) => getCompletenessTier(r.po_history_real_months) === tier).length;
          const toggleTier = () => {
            setTierFilter((prev) => {
              const next = new Set(prev);
              if (next.has(tier)) {
                if (next.size === 1) return next; // keep at least one active
                next.delete(tier);
              } else {
                next.add(tier);
              }
              return next;
            });
          };
          const baseStyles: Record<CompletenessTier, { on: string; off: string }> = {
            green: { on: 'bg-green-600 text-white', off: 'bg-green-50 text-green-700 border border-green-200' },
            amber: { on: 'bg-amber-500 text-white', off: 'bg-amber-50 text-amber-700 border border-amber-200' },
            red:   { on: 'bg-red-500 text-white',   off: 'bg-red-50 text-red-700 border border-red-200' },
          };
          const label: Record<CompletenessTier, string> = {
            green: 'Datos completos',
            amber: 'Datos parciales',
            red:   'Datos insuficientes',
          };
          const tipText: Record<CompletenessTier, string> = {
            green: '16/16 meses del período de entrenamiento (oct 2024 – ene 2026) tienen al menos una OC confirmada (estado: compra / bloqueado / hecho). Datos sintéticos no cuentan. Máxima calidad de datos para el forecast de compras.',
            amber: 'Entre 3 y 15 meses tienen OC confirmadas. Historial parcial; la precisión del forecast de compras está pendiente de validación empírica. El umbral de 3 meses es un proxy provisional.',
            red:   '0 a 2 meses con OC confirmadas. Historial real insuficiente — datos sintéticos no cuentan. El forecast de compras para estos SKUs no es confiable.',
          };

          return (
            <div key={tier} className="relative flex items-center gap-1">
              <button onClick={toggleTier}
                className={`px-3 py-1 text-sm rounded-lg transition-colors ${active ? baseStyles[tier].on : baseStyles[tier].off}`}>
                {label[tier]} ({count})
              </button>
              <button
                onClick={() => setOpenTip((prev) => (prev === tier ? null : tier))}
                className="text-gray-400 hover:text-gray-600 transition-colors"
                aria-label={`Definición técnica: ${label[tier]}`}
              >
                <Info className="w-3.5 h-3.5" />
              </button>
              {openTip === tier && (
                <div className="absolute left-0 top-full mt-2 z-50 w-72 rounded-lg border border-gray-200 bg-white shadow-lg p-3 text-xs text-gray-700 leading-relaxed">
                  <p className="font-semibold text-gray-900 mb-1">{label[tier]}</p>
                  <p>{tipText[tier]}</p>
                  <button
                    onClick={() => setOpenTip(null)}
                    className="mt-2 text-gray-400 hover:text-gray-600 text-xs underline"
                  >
                    Cerrar
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {err && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{err}</div>
      )}
      {loading && (
        <div className="text-gray-400">Cargando forecasts…</div>
      )}

      {!loading && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead className="bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-3 py-2 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">SKU / Producto</th>
                  {showVentas    && <th className="text-right px-2 py-2 font-medium text-emerald-700 bg-emerald-50" colSpan={2}>Ventas (cantidad)</th>}
                  {showOrdenadas && <th className="text-right px-2 py-2 font-medium text-blue-700 bg-blue-50" colSpan={2}>Compras Ordenadas</th>}
                  {showRecibidas && <th className="text-right px-2 py-2 font-medium text-purple-700 bg-purple-50" colSpan={2}>Compras Recibidas</th>}
                  {showVentas    && <th className="text-center px-2 py-2 font-medium text-emerald-800 bg-emerald-100" colSpan={2}>Furgones — Ventas</th>}
                  {showOrdenadas && <th className="text-center px-2 py-2 font-medium text-blue-800 bg-blue-100" colSpan={2}>Furgones — Compras Ordenadas</th>}
                  {showRecibidas && <th className="text-center px-2 py-2 font-medium text-purple-800 bg-purple-100" colSpan={2}>Furgones — Compras Recibidas</th>}
                  <th className="text-right px-2 py-2 font-medium text-gray-300 bg-gray-50">m³ / unidad</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-300 bg-gray-50">m³ furgón</th>
                  <th className="text-right px-2 py-2 font-medium text-gray-300 bg-gray-50">Unidades / furgón</th>
                </tr>
                <tr className="border-b border-gray-200 text-xs text-gray-500">
                  <th className="sticky left-0 bg-gray-50 z-10"></th>
                  {showVentas    && <><th className="text-right px-2 py-1 bg-emerald-50">Feb 26</th><th className="text-right px-2 py-1 bg-emerald-50">Mar 26</th></>}
                  {showOrdenadas && <><th className="text-right px-2 py-1 bg-blue-50">Feb 26</th><th className="text-right px-2 py-1 bg-blue-50">Mar 26</th></>}
                  {showRecibidas && <><th className="text-right px-2 py-1 bg-purple-50">Feb 26</th><th className="text-right px-2 py-1 bg-purple-50">Mar 26</th></>}
                  {showVentas    && <><th className="text-right px-2 py-1 bg-emerald-100">Feb 26</th><th className="text-right px-2 py-1 bg-emerald-100">Mar 26</th></>}
                  {showOrdenadas && <><th className="text-right px-2 py-1 bg-blue-100">Feb 26</th><th className="text-right px-2 py-1 bg-blue-100">Mar 26</th></>}
                  {showRecibidas && <><th className="text-right px-2 py-1 bg-purple-100">Feb 26</th><th className="text-right px-2 py-1 bg-purple-100">Mar 26</th></>}
                  <th className="bg-gray-50"></th>
                  <th className="bg-gray-50"></th>
                  <th className="bg-gray-50"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const rowBg = r.supplier_class === 'REYMA' ? 'bg-emerald-50/30' : 'bg-sky-50/30';
                  const tier = getCompletenessTier(r.po_history_real_months);
                  const tierStyle = TIER_STYLES[tier];
                  return (
                    <tr key={r.sku} className={`border-b border-gray-100 ${rowBg}`}>
                      <td className={`px-3 py-2 sticky left-0 z-10 ${tierStyle.skuBg}`}>
                        <div className="font-mono text-xs text-gray-600">{r.sku}</div>
                        <div className="text-sm font-medium text-gray-900 max-w-xs truncate">{r.name}</div>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.supplier_class === 'REYMA' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'}`}>
                            {r.supplier_class}
                          </span>
                          {r.stock_uom && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                              {r.stock_uom}
                            </span>
                          )}
                          <span className={`text-[10px] px-1.5 py-0.5 rounded ${tierStyle.pill}`}>
                            {tierStyle.pillText}
                            {r.po_history_real_months !== null && r.po_history_real_months < 16
                              ? ` (${r.po_history_real_months}/16)`
                              : ''}
                          </span>
                          <button
                            onClick={(e) => handleHistoryTipClick(r.sku, e)}
                            className="text-gray-400 hover:text-gray-600 transition-colors ml-0.5"
                            aria-label={`Ver historial real de compras: ${r.sku}`}
                          >
                            <Info className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                      {showVentas    && <><td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-50/60">{fmt(r.sales_feb)}</td><td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-50/60">{fmt(r.sales_mar)}</td></>}
                      {showOrdenadas && <><td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-50/60">{fmt(r.purchases_ordered_feb)}</td><td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-50/60">{fmt(r.purchases_ordered_mar)}</td></>}
                      {showRecibidas && <><td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-50/60">{fmt(r.purchases_received_feb)}</td><td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-50/60">{fmt(r.purchases_received_mar)}</td></>}
                      {showVentas    && <><td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-100/70 font-semibold">{fmtFurgo(r.sales_feb, r.volume_m3)}</td><td className="px-2 py-1.5 text-right font-mono text-emerald-900 bg-emerald-100/70 font-semibold">{fmtFurgo(r.sales_mar, r.volume_m3)}</td></>}
                      {showOrdenadas && <><td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-100/70 font-semibold">{fmtFurgo(r.purchases_ordered_feb, r.volume_m3)}</td><td className="px-2 py-1.5 text-right font-mono text-blue-900 bg-blue-100/70 font-semibold">{fmtFurgo(r.purchases_ordered_mar, r.volume_m3)}</td></>}
                      {showRecibidas && <><td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-100/70 font-semibold">{fmtFurgo(r.purchases_received_feb, r.volume_m3)}</td><td className="px-2 py-1.5 text-right font-mono text-purple-900 bg-purple-100/70 font-semibold">{fmtFurgo(r.purchases_received_mar, r.volume_m3)}</td></>}
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300 bg-gray-50/60 text-xs">{r.volume_m3 != null ? r.volume_m3.toFixed(4) : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300 bg-gray-50/60 text-xs">{r.volume_m3 != null ? FURGO_M3 : '—'}</td>
                      <td className="px-2 py-1.5 text-right font-mono text-gray-300 bg-gray-50/60 text-xs">{r.volume_m3 != null && r.volume_m3 > 0 ? Math.round(FURGO_M3 / r.volume_m3).toLocaleString('es-GT') : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-3 py-2 text-right sticky left-0 bg-gray-50">TOTAL ({visible.length} SKUs)</td>
                  {showVentas    && <><td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-50">{fmt(totals.sales_feb)}</td><td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-50">{fmt(totals.sales_mar)}</td></>}
                  {showOrdenadas && <><td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-50">{fmt(totals.po_ord_feb)}</td><td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-50">{fmt(totals.po_ord_mar)}</td></>}
                  {showRecibidas && <><td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-50">{fmt(totals.po_rcv_feb)}</td><td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-50">{fmt(totals.po_rcv_mar)}</td></>}
                  {showVentas    && <><td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-100">{totals.furgo_sales_feb.toFixed(1)}</td><td className="px-2 py-2 text-right font-mono text-emerald-900 bg-emerald-100">{totals.furgo_sales_mar.toFixed(1)}</td></>}
                  {showOrdenadas && <><td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-100">{totals.furgo_ord_feb.toFixed(1)}</td><td className="px-2 py-2 text-right font-mono text-blue-900 bg-blue-100">{totals.furgo_ord_mar.toFixed(1)}</td></>}
                  {showRecibidas && <><td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-100">{totals.furgo_rcv_feb.toFixed(1)}</td><td className="px-2 py-2 text-right font-mono text-purple-900 bg-purple-100">{totals.furgo_rcv_mar.toFixed(1)}</td></>}
                  <td className="bg-gray-50"></td>
                  <td className="bg-gray-50"></td>
                  <td className="bg-gray-50"></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">
        Datos: <code>forecast_results</code> en Supabase prod. Artificial Intelligence ML Model (weekly + yearly seasonality, 80% confidence intervals).
        Training end: 2026-01-31. Prediction window: 2026-02-01 → 2026-03-31.
      </div>

      {openHistoryTip && tipPos && (() => {
        const skuRow = rows.find((r) => r.sku === openHistoryTip);
        const history = purchaseHistory[openHistoryTip] ?? {};
        const fmtUnit = (n: number | undefined) =>
          n !== undefined ? Math.round(n).toLocaleString('es-GT') : '—';
        return (
          <div
            ref={historyTipRef}
            style={{ position: 'fixed', top: tipPos.top, left: tipPos.left, zIndex: 9999, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
            className="w-[360px] rounded-lg border border-gray-200 bg-white shadow-xl p-3 text-xs"
          >
            <div className="font-semibold text-gray-900 mb-0.5 font-mono">{openHistoryTip}</div>
            <div className="text-gray-500 mb-2 truncate">{skuRow?.name}</div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-gray-200 text-gray-600">
                  <th className="text-left py-1 pr-2 font-medium">Mes</th>
                  <th className="text-right py-1 px-1 font-medium">2024</th>
                  <th className="text-right py-1 px-1 font-medium">2025</th>
                  <th className="text-right py-1 px-1 font-medium">2026</th>
                </tr>
              </thead>
              <tbody>
                {MONTH_NAMES_ES.map((name, i) => {
                  const mm = String(i + 1).padStart(2, '0');
                  const v24 = history[`2024-${mm}`];
                  const v25 = history[`2025-${mm}`];
                  const v26 = history[`2026-${mm}`];
                  const hasAny = v24 !== undefined || v25 !== undefined || v26 !== undefined;
                  return (
                    <tr key={mm} className={`border-b border-gray-50 ${hasAny ? '' : 'text-gray-300'}`}>
                      <td className="text-left py-0.5 pr-2 text-gray-700">{name}</td>
                      <td className="text-right py-0.5 px-1 font-mono">{fmtUnit(v24)}</td>
                      <td className="text-right py-0.5 px-1 font-mono">{fmtUnit(v25)}</td>
                      <td className="text-right py-0.5 px-1 font-mono">{fmtUnit(v26)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-2 text-gray-400 leading-relaxed">
              Fuente: <code>revenue_daily</code> — OC confirmadas + recepciones de stock. Valores reales, no interpolados. UdM: cajas de 40 unidades.
            </p>
            <button
              onClick={() => { setOpenHistoryTip(null); setTipPos(null); }}
              className="mt-1.5 text-gray-400 hover:text-gray-600 underline"
            >
              Cerrar
            </button>
          </div>
        );
      })()}
    </div>
  );
}
