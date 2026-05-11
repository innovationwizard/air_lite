'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { ShoppingCart, AlertTriangle, Snowflake, TrendingUp, Truck, ArrowRight, Package, Info } from 'lucide-react';

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

interface SupplierOrderSummary {
  supplier_class: string;
  sku_count_total: number;
  sku_count_with_order: number;
  total_gtq: number;
  total_furgones: number;
  skus_with_zero_lead_time: number;
}

function gtqEnRiesgo(r: StockoutRisk): number {
  const daysShort = Math.max(0, r.lead_time_days - r.days_of_supply);
  return daysShort * r.avg_daily_demand * r.unit_price;
}

function gtqInmovilizado(item: AbcXyzItem): number {
  const maxTarget = Math.max(0, item.lead_time_days * 3) * item.avg_daily_demand;
  return Math.max(0, item.current_stock - maxTarget) * item.unit_cost;
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

export default function ComprasHomePage() {
  const [risks, setRisks] = useState<StockoutRisk[]>([]);
  const [abcItems, setAbcItems] = useState<AbcXyzItem[]>([]);
  const [orderPlan, setOrderPlan] = useState<SupplierOrderSummary[]>([]);
  const [orderPlanGaps, setOrderPlanGaps] = useState(0);
  const [ropAlerts, setRopAlerts] = useState<{ order_today: number; order_this_week: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/kpis/stockout-risk').then((r) => r.json()),
      fetch('/api/kpis/abc-xyz').then((r) => r.json()),
      fetch('/api/kpis/order-plan').then((r) => r.json()),
    ])
      .then(([riskData, abcData, planData]) => {
        setRisks(Array.isArray(riskData) ? riskData : []);
        setAbcItems(Array.isArray(abcData) ? abcData : []);
        setOrderPlan(planData?.suppliers ?? []);
        setOrderPlanGaps(
          (planData?.suppliers ?? []).reduce(
            (s: number, x: SupplierOrderSummary) => s + (x.skus_with_zero_lead_time ?? 0),
            0,
          ),
        );
        setRopAlerts(planData?.rop_alerts ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const excepcionesCount = risks.filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto').length;
  const totalGtqEnRiesgo = useMemo(
    () => risks.filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto').reduce((s, r) => s + gtqEnRiesgo(r), 0),
    [risks],
  );
  const totalGtqInmovilizado = useMemo(
    () => abcItems.reduce((s, item) => s + gtqInmovilizado(item), 0),
    [abcItems],
  );
  const coberturaPromedio = useMemo(() => {
    const finite = risks.filter((r) => r.days_of_supply < 9999);
    if (finite.length === 0) return null;
    return finite.reduce((s, r) => s + r.days_of_supply, 0) / finite.length;
  }, [risks]);

  const top5 = useMemo(() => {
    return [...risks]
      .filter((r) => r.risk_level === 'critico' || r.risk_level === 'alto')
      .sort((a, b) => gtqEnRiesgo(b) - gtqEnRiesgo(a))
      .slice(0, 5);
  }, [risks]);

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-1">
        <p className="text-sm font-semibold text-emerald-600 uppercase tracking-wide">Silo de Compras</p>
        <h1 className="text-3xl font-bold text-gray-900">Panel de Compras</h1>
        <p className="text-gray-500 text-lg">Todo lo que necesitás para decidir qué comprar, cuánto y cuándo.</p>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-red-50 border border-red-100 rounded-xl p-4">
          <p className="text-xs text-red-700 font-medium">Excepciones activas</p>
          <p className="text-3xl font-bold text-red-700 mt-1">
            {loading ? '—' : excepcionesCount}
          </p>
          <p className="text-xs text-red-500 mt-0.5">Crítico + Alto</p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
          <p className="text-xs text-amber-700 font-medium">GTQ en riesgo</p>
          <p className="text-xl font-bold text-amber-700 mt-1 leading-tight">
            {loading ? '—' : fmtGTQ(totalGtqEnRiesgo)}
          </p>
          <p className="text-xs text-amber-500 mt-0.5">Si no se actúa</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-xs text-blue-700 font-medium">GTQ inmovilizado</p>
          <p className="text-xl font-bold text-blue-700 mt-1 leading-tight">
            {loading ? '—' : fmtGTQ(totalGtqInmovilizado)}
          </p>
          <p className="text-xs text-blue-500 mt-0.5">Sobre política máxima</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-500 font-medium">Cobertura promedio</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">
            {loading ? '—' : coberturaPromedio !== null ? `${coberturaPromedio.toFixed(0)}d` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">Días de stock</p>
        </div>
      </div>

      {/* ROP Alert Cards */}
      {!loading && ropAlerts !== null && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-red-700 font-medium">Pedir HOY</p>
              <div className="relative group inline-block">
                <Info className="w-3 h-3 text-red-400 cursor-help" />
                <div className="absolute z-10 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg pointer-events-none">
                  SKUs donde el stock actual ya está por debajo del punto de reorden. El pedido debería haberse emitido ya.
                </div>
              </div>
            </div>
            <p className="text-3xl font-bold text-red-700 mt-1">{ropAlerts.order_today}</p>
            <p className="text-xs text-red-500 mt-0.5">Stock ≤ punto de reorden</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <div className="flex items-center gap-1.5">
              <p className="text-xs text-amber-700 font-medium">Pedir esta semana</p>
              <div className="relative group inline-block">
                <Info className="w-3 h-3 text-amber-400 cursor-help" />
                <div className="absolute z-10 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 w-60 bg-gray-900 text-white text-xs rounded-lg p-3 shadow-lg pointer-events-none">
                  SKUs que romperán su punto de reorden en los próximos 7 días calendario, basado en la demanda promedio diaria.
                </div>
              </div>
            </div>
            <p className="text-3xl font-bold text-amber-700 mt-1">{ropAlerts.order_this_week}</p>
            <p className="text-xs text-amber-500 mt-0.5">Rompen ROP en ≤ 7 días</p>
          </div>
        </div>
      )}

      {/* Order Plan Panel */}
      {!loading && orderPlan.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-500" />
              Plan de compras — esta semana
            </h2>
            <Link href="/compras/forecast" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
              Ver detalle <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {orderPlan.map((s) => (
              <div key={s.supplier_class} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                    s.supplier_class === 'REYMA'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-sky-100 text-sky-800'
                  }`}>
                    {s.supplier_class}
                  </span>
                  <span className="text-sm text-gray-600">
                    {s.sku_count_with_order} de {s.sku_count_total} SKUs
                  </span>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{fmtGTQ(s.total_gtq)}</p>
                    <p className="text-xs text-gray-400">valor pedido</p>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-700">{s.total_furgones.toFixed(1)}</p>
                    <p className="text-xs text-gray-400">furgones</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-[10px] text-gray-400">
              Stock: snapshot 3-mar-2026 · Política ABC/XYZ
            </span>
            <span className="text-[10px] text-amber-600">
              ⚠ Furgones: furgón 53 pies (122 m³) — pendiente confirmación con proveedor
            </span>
            {orderPlanGaps > 0 && (
              <span className="text-[10px] text-red-500">
                · {orderPlanGaps} SKU{orderPlanGaps > 1 ? 's' : ''} excluidos (lead time = 0 en Odoo)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Top 5 Excepciones */}
      {!loading && top5.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              Top 5 Excepciones — Por impacto financiero
            </h2>
            <Link href="/preocupaciones/desabastecimiento" className="text-xs text-emerald-600 hover:underline flex items-center gap-1">
              Ver todas <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50">
            {top5.map((r) => (
              <div key={r.product_id} className="px-4 py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-gray-400">{r.sku}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${RISK_COLORS[r.risk_level] ?? 'bg-gray-100 text-gray-600'}`}>
                      {RISK_LABELS[r.risk_level] ?? r.risk_level}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 font-medium truncate mt-0.5">{r.product_name}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-amber-700">{fmtGTQ(gtqEnRiesgo(r))}</p>
                  <p className="text-xs text-gray-400">{r.days_of_supply >= 9999 ? '999+' : r.days_of_supply.toFixed(0)}d / LT {r.lead_time_days}d</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          {
            title: 'Forecast de Compras',
            href: '/compras/forecast',
            blurb: 'Qué comprar, cuánto y cuándo — Feb & Mar 2026.',
            icon: TrendingUp,
            accent: 'bg-blue-50 text-blue-600',
          },
          {
            title: 'Hot List',
            href: '/preocupaciones/desabastecimiento',
            blurb: 'Productos en riesgo de agotarse — ordenados por impacto financiero.',
            icon: AlertTriangle,
            accent: 'bg-red-50 text-red-600',
          },
          {
            title: 'Hold List',
            href: '/preocupaciones/capital-congelado',
            blurb: 'Capital inmovilizado por encima de la política máxima.',
            icon: Snowflake,
            accent: 'bg-blue-50 text-blue-600',
          },
          {
            title: 'Programación de Compras',
            href: '/poc/programacion',
            blurb: 'Lo que hay que comprarle a Carvajal y Reyma, semana por semana.',
            icon: Truck,
            accent: 'bg-emerald-50 text-emerald-600',
            disabled: true,
          },
          {
            title: 'Demostración de Valor',
            href: '/backtest',
            blurb: 'Cuánto habrías ahorrado si hubieras tenido AI Refill el último año.',
            icon: ShoppingCart,
            accent: 'bg-purple-50 text-purple-600',
          },
        ].map((c) => {
          const Icon = c.icon;
          const inner = (
            <div className="flex items-start gap-4">
              <div className={`w-11 h-11 rounded-lg flex items-center justify-center flex-shrink-0 ${c.accent}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold text-gray-900">{c.title}</h2>
                  {!('disabled' in c && c.disabled) && (
                    <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                  )}
                </div>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed">{c.blurb}</p>
              </div>
            </div>
          );
          if ('disabled' in c && c.disabled) {
            return (
              <div key={c.href} className="bg-white rounded-xl border border-gray-100 p-5 opacity-40 cursor-not-allowed select-none">
                {inner}
              </div>
            );
          }
          return (
            <Link
              key={c.href}
              href={c.href}
              className="group bg-white rounded-xl border border-gray-200 p-5 hover:border-emerald-400 hover:shadow-sm transition-all"
            >
              {inner}
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
