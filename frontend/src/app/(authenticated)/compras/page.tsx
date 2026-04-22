import Link from 'next/link';
import { BarChart3, Truck, LineChart, ClipboardList, ArrowRight } from 'lucide-react';

interface SiloCard {
  title: string;
  href: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

const cards: SiloCard[] = [
  {
    title: 'Forecast de Demanda',
    href: '/backtest',
    blurb: 'Tu Excel automatizado. 12 meses de horizonte, no 3.',
    icon: LineChart,
    accent: 'bg-blue-50 text-blue-600',
  },
  {
    title: 'Programación de Compras',
    href: '/poc/programacion',
    blurb: 'Lo que hay que comprarle a Carvajal y Reyma, semana por semana.',
    icon: Truck,
    accent: 'bg-emerald-50 text-emerald-600',
  },
  {
    title: 'Ahorro histórico',
    href: '/backtest',
    blurb: 'Cuánto habrías ahorrado si hubieras tenido AI Refill durante el último año.',
    icon: BarChart3,
    accent: 'bg-purple-50 text-purple-600',
  },
  {
    title: 'Órdenes Abiertas',
    href: '/oa/excepciones',
    blurb: 'Excepciones, proveedores, cumplimiento y plan maestro.',
    icon: ClipboardList,
    accent: 'bg-amber-50 text-amber-600',
  },
];

export default function ComprasHomePage() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-emerald-600 uppercase tracking-wide">Silo de Compras</p>
        <h1 className="text-3xl font-bold text-gray-900">Wilmer, empecemos acá.</h1>
        <p className="text-gray-500 text-lg">
          Todo lo que necesitás para decidir qué comprar, cuánto y cuándo.
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Link
              key={c.title + c.href}
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
        Los datos provienen del snapshot del 3 de marzo de 2026. La siguiente iteración conecta la sincronización diaria con Odoo.
      </p>
    </div>
  );
}
