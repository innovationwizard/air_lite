import Link from 'next/link';
import { Gauge, AlertTriangle, Snowflake, Warehouse, ArrowRight } from 'lucide-react';

interface SiloCard {
  title: string;
  href: string;
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

const cards: SiloCard[] = [
  {
    title: 'Días de Inventario',
    href: '/operaciones/dias-inventario',
    blurb: '¿Cuántos días tengo de cada producto en cada bodega? Ahora sí hay respuesta.',
    icon: Gauge,
    accent: 'bg-emerald-50 text-emerald-600',
  },
  {
    title: 'Hot List',
    href: '/preocupaciones/desabastecimiento',
    blurb: 'Los que están por agotarse. Aseguralos primero — éstos son tu prioridad.',
    icon: AlertTriangle,
    accent: 'bg-red-50 text-red-600',
  },
  {
    title: 'Hold List',
    href: '/preocupaciones/capital-congelado',
    blurb: 'Los que están comiendo espacio en tu bodega. Decile a Carvajal que no mande más de esto.',
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
];

export default function OperacionesHomePage() {
  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <p className="text-sm font-semibold text-emerald-600 uppercase tracking-wide">Silo de Operaciones</p>
        <h1 className="text-3xl font-bold text-gray-900">Mario, empecemos acá.</h1>
        <p className="text-gray-500 text-lg">
          Qué tenés, cuánto dura, qué entra y qué está comiendo espacio.
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
        Los datos provienen del snapshot del 3 de marzo de 2026. La siguiente iteración conecta la sincronización diaria con Odoo y el cálculo de m³ por bodega.
      </p>
    </div>
  );
}
