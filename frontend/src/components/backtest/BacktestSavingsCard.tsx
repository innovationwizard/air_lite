'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BacktestSavingsCardProps {
  title: string;
  savingsGtq: number;
  savingsPct: number;
  reasoning: string;
  icon: React.ReactNode;
  accentColor: string;
  /** Override the headline (e.g. for non-monetary metrics like turnover rate) */
  headlineOverride?: string;
}

export function BacktestSavingsCard({
  title,
  savingsGtq,
  savingsPct,
  reasoning,
  icon,
  accentColor,
  headlineOverride,
}: BacktestSavingsCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      'bg-white rounded-xl border border-gray-200 overflow-hidden',
      'hover:shadow-sm transition-shadow',
    )}>
      <div className="p-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', accentColor)}>
              {icon}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">{title}</p>
              <p className="text-2xl font-bold text-gray-900">
                {headlineOverride ?? `GTQ ${savingsGtq.toLocaleString('es-GT', { maximumFractionDigits: 0 })}`}
              </p>
            </div>
          </div>
          <span className={cn(
            'px-2.5 py-1 rounded-full text-sm font-semibold',
            savingsPct > 0
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-gray-50 text-gray-500',
          )}>
            {savingsPct > 0 ? '-' : ''}{savingsPct.toFixed(0)}%
          </span>
        </div>
      </div>

      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-3 bg-gray-50 border-t border-gray-100 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <span>Ver cálculos detallados</span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="px-5 py-4 bg-gray-50 border-t border-gray-100">
          <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-line">
            {reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
