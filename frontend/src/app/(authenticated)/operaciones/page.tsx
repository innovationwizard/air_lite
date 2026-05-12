'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Gauge, AlertTriangle, Snowflake, Warehouse, ArrowRight } from 'lucide-react';

interface StockoutRisk {
  product_id: number;
  product_name: string;
  sku: string;
  current_stock: number;
  avg_daily_demand: number;
  days_of_supply: number;
  lead_time_days: number;
  risk_level: string;
  unit_price: number;
  supplier_name: string | null;
}

interface AbcXyzItem {
  product_id: number;
  product_name: string;
  sku: string;
  current_stock: number;
  avg_daily_demand: number;
  lead_time_days: number;
  unit_cost: number;
}

function gtqEnRiesgo(r: StockoutRisk): number {
  const daysShort = Math.max(0, r.lead_time_days - r.days_of_supply);
  return daysShort * r.avg_daily_demand * r.unit_price;
}

function gtqInmovilizado(item: AbcXyzItem): number {
  const maxTarget = Math.max(0, item.lead_time_days * 3) * item.avg_daily_demand;
  return Math.max(0, item.current_stock - maxTarget) * item.unit_cost;
}

function gtqEnStock(item: AbcXyzItem): number {
  return item.current_stock * item.unit_cost;
}

function fmtGTQ(n: number): string {
  if (n === 0) return '—';
  return 'Q ' + n.toLocaleString('es-GT', { maximumFractionDigits: 0 });
}

const RISK_COLORS: Record<string, string> = {
  critico: 'bg-red-100 text-red-700',
  alto:    'bg-orange-100 text-orange-700',
  medio:   'bg-yellow-100 text-yellow-700',
  bajo:    'bg-green-100 text-green-700',
};

const RISK_LABELS: Record<string, string> = {
  critico: 'Crítico', alto: 'Alto', medio: 'Medio', bajo: 'Bajo',
};

export default function OperacionesHomePage() {
  const [risks, setRisks] = useState<StockoutRisk[]>([]);
  const [abcItems, setAbcItems] = useState<AbcXyzItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/kpis/stockout-risk').then((r) => r.json()),
      fetch('/api/kpis/abc-xyz').then((r) => r.json()),
    ])
      .then(([riskData, abcData]) => {
        setRisks(Array.isArray(riskData) ? riskData : []);
        setAbcItems(Array.isArray(abcData) ? abcData : []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const hotCount = risks.filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto').length;

  const totalGtqEnRiesgo = useMemo(
    () => risks.filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto').reduce((s, r) => s + gtqEnRiesgo(r), 0),
    [risks],
  );

  const holdItems = useMemo(
    () => abcItems.filter((item) => gtqInmovilizado(item) > 0),
    [abcItems],
  );
  const holdCount = holdItems.length;

  const totalGtqInmovilizado = useMemo(
    () => holdItems.reduce((s, item) => s + gtqInmovilizado(item), 0),
    [holdItems],
  );

  const totalInventarioGtq = useMemo(
    () => abcItems.reduce((s, item) => s + gtqEnStock(item), 0),
    [abcItems],
  );

  const coberturaPromedio = useMemo(() => {
    const finite = risks.filter((r) => r.days_of_supply < 9999);
    if (finite.length === 0) return null;
    return finite.reduce((s, r) => s + r.days_of_supply, 0) / finite.length;
  }, [risks]);

  const distrib = useMemo(() => {
    const counts = { critico: 0, alto: 0, medio: 0, bajo: 0 };
    for (const r of risks) {
      if (r.risk_level in counts) counts[r.risk_level as keyof typeof counts]++;
    }
    return counts;
  }, [risks]);

  const top5Criticos = useMemo(
    () => [...risks]
      .filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto')
      .sort((a, b) => gtqEnRiesgo(b) - gtqEnRiesgo(a))
      .slice(0, 5),
    [risks],
  );

  const top5Inmovilizado = useMemo(
    () => [...holdItems]
      .sort((a, b) => gtqInmovilizado(b) - gtqInmovilizado(a))
      .slice(0, 5),
    [holdItems],
  );

  const total = risks.length;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-1">
        <p className="text-sm font-semibold text-emerald-600 uppercase tracking-wide">Silo de Operaciones</p>
        <h1 className="text-3xl font-bold text-gray-900">Panel de Operaciones</h1>
        <p className="text-gray-500 text-lg">Qué tenés, cuánto dura, qué entra y qué está comiendo espacio.</p>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-xs text-red-700 font-medium">Items Hot</p>
          <p className="text-3xl font-bold text-red-700 mt-1">{loading ? '—' : hotCount}</p>
          <p className="text-xs text-red-500 mt-0.5">{loading ? '' : fmtGTQ(totalGtqEnRiesgo)}</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs text-blue-700 font-medium">Items Hold</p>
          <p className="text-3xl font-bold text-blue-700 mt-1">{loading ? '—' : holdCount}</p>
          <p className="text-xs text-blue-500 mt-0.5">{loading ? '' : fmtGTQ(totalGtqInmovilizado)}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium">Cobertura promedio</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {loading ? '—' : coberturaPromedio !== null ? `${coberturaPromedio.toFixed(0)}d` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Días de stock</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium">Total inventario</p>
          <p className="text-xl font-bold text-gray-900 mt-1 leading-tight">
            {loading ? '—' : fmtGTQ(totalInventarioGtq)}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">A precio de costo</p>
        </div>
      </div>

      {/* Status Distribution Bar */}
      {!loading && total > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-sm font-medium text-gray-700 mb-3">Distribución de inventario ({total} SKUs)</p>
          <div className="flex rounded-full overflow-hidden h-4 gap-px">
            {distrib.critico > 0 && (
              <div
                className="bg-red-500"
                style={{ width: `${(distrib.critico / total) * 100}%` }}
                title={`Crítico: ${distrib.critico}`}
              />
            )}
            {distrib.alto > 0 && (
              <div
                className="bg-orange-400"
                style={{ width: `${(distrib.alto / total) * 100}%` }}
                title={`Alto: ${distrib.alto}`}
              />
            )}
            {distrib.medio > 0 && (
              <div
                className="bg-yellow-400"
                style={{ width: `${(distrib.medio / total) * 100}%` }}
                title={`Medio: ${distrib.medio}`}
              />
            )}
            {distrib.bajo > 0 && (
              <div
                className="bg-green-400"
                style={{ width: `${(distrib.bajo / total) * 100}%` }}
                title={`Bajo: ${distrib.bajo}`}
              />
            )}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-gray-500">
            {(['critico', 'alto', 'medio', 'bajo'] as const).map((lvl) => (
              distrib[lvl] > 0 && (
                <span key={lvl} className="flex items-center gap-1">
                  <span className={`w-2 h-2 rounded-full inline-block ${
                    lvl === 'critico' ? 'bg-red-500' :
                    lvl === 'alto'    ? 'bg-orange-400' :
                    lvl === 'medio'   ? 'bg-yellow-400' : 'bg-green-400'
                  }`} />
                  {RISK_LABELS[lvl]} ({distrib[lvl]})
                </span>
              )
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top 5 Críticos */}
        {!loading && top5Criticos.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-500" />
                Top 5 — Por impacto financiero
              </h2>
              <Link href="/preocupaciones/desabastecimiento" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                Ver todos <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {top5Criticos.map((r) => (
                <div key={r.product_id} className="px-4 py-2.5 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">{r.sku}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${RISK_COLORS[r.risk_level] ?? 'bg-gray-100 text-gray-600'}`}>
                        {RISK_LABELS[r.risk_level] ?? r.risk_level}
                      </span>
                    </div>
                    <p className="text-sm text-gray-900 truncate mt-0.5">{r.product_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-red-700">
                      {r.days_of_supply >= 9999 ? '999+' : r.days_of_supply.toFixed(0)}d
                    </p>
                    <p className="text-xs text-gray-400">LT {r.lead_time_days}d</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Top 5 Capital Inmovilizado */}
        {!loading && top5Inmovilizado.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
                <Snowflake className="w-4 h-4 text-blue-500" />
                Top 5 Capital Inmovilizado
              </h2>
              <Link href="/preocupaciones/capital-congelado" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
                Ver todos <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="divide-y divide-gray-50">
              {top5Inmovilizado.map((item) => (
                <div key={item.product_id} className="px-4 py-2.5 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-gray-400">{item.sku}</span>
                    <p className="text-sm text-gray-900 truncate mt-0.5">{item.product_name}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold text-blue-700">{fmtGTQ(gtqInmovilizado(item))}</p>
                    <p className="text-xs text-gray-400">{item.current_stock.toLocaleString('es-GT', { maximumFractionDigits: 0 })} uds</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          {
            title: 'Días de Inventario',
            href: '/operaciones/dias-inventario',
            blurb: '¿Cuántos días tengo de cada producto? Con política y cobertura efectiva.',
            icon: Gauge,
            accent: 'bg-emerald-50 text-emerald-600',
          },
          {
            title: 'Hot List',
            href: '/preocupaciones/desabastecimiento',
            blurb: 'Los que están por agotarse — ordenados por impacto financiero.',
            icon: AlertTriangle,
            accent: 'bg-red-50 text-red-600',
          },
          {
            title: 'Hold List',
            href: '/preocupaciones/capital-congelado',
            blurb: 'Capital inmovilizado sobre la política máxima. No traer más de éstos.',
            icon: Snowflake,
            accent: 'bg-blue-50 text-blue-600',
          },
          {
            title: 'Órdenes Abiertas',
            href: '/oa/excepciones',
            blurb: 'Excepciones, recepción, espacio en bodega y plan de descarga.',
            icon: Warehouse,
            accent: 'bg-amber-50 text-amber-600',
          },
        ].map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.href}
              href={c.href}
              className="group bg-white rounded-xl border border-gray-200 p-5 hover:border-emerald-400 hover:shadow-sm transition-all"
            >
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${c.accent}`}>
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-gray-900">{c.title}</h2>
                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                  </div>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed">{c.blurb}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-gray-400">
        Datos: snapshot 3-mar-2026. KPIs calculados en tiempo real desde Supabase.
      </p>
    </div>
  );
}
