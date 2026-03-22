'use client';

import { ArrowRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PredictNextButtonProps {
  onClick: () => void;
  loading: boolean;
  nextMonth: string;
  disabled?: boolean;
}

export function PredictNextButton({
  onClick,
  loading,
  nextMonth,
  disabled = false,
}: PredictNextButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={cn(
        'flex items-center gap-3 px-8 py-4 rounded-xl text-lg font-semibold',
        'transition-all duration-200 shadow-lg',
        loading || disabled
          ? 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
          : 'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-xl active:scale-[0.98]',
      )}
    >
      {loading ? (
        <>
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Prediciendo {nextMonth}...</span>
        </>
      ) : (
        <>
          <span>¿Predecir {nextMonth}?</span>
          <ArrowRight className="w-5 h-5" />
        </>
      )}
    </button>
  );
}
