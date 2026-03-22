'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';

interface HoldingCostInputProps {
  currentRate: number;
  onRateChange: (rate: number) => void;
}

export function HoldingCostInput({ currentRate, onRateChange }: HoldingCostInputProps) {
  const [rate, setRate] = useState((currentRate * 100).toString());
  const [showInfo, setShowInfo] = useState(false);

  const handleSubmit = () => {
    const parsed = parseFloat(rate);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 100) {
      onRateChange(parsed / 100);
    }
  };

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <Info className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
        <div className="flex-1 space-y-2">
          <p className="text-sm text-amber-800">
            Estoy usando una tasa de costo de almacenamiento del{' '}
            <strong>{(currentRate * 100).toFixed(0)}% anual</strong> porque es el estándar
            conservador de la industria para productos plásticos y desechables en climas tropicales.
          </p>

          <button
            onClick={() => setShowInfo(!showInfo)}
            className="text-xs text-amber-600 hover:text-amber-800 underline"
          >
            {showInfo ? 'Ocultar' : 'Ingrese su tasa real para recalcular'}
          </button>

          {showInfo && (
            <div className="flex items-center gap-2 pt-1">
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                min="1"
                max="100"
                step="0.5"
                className="w-20 px-2 py-1 text-sm border border-amber-300 rounded focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <span className="text-sm text-amber-700">% anual</span>
              <button
                onClick={handleSubmit}
                className="px-3 py-1 text-sm bg-amber-600 text-white rounded hover:bg-amber-700 transition-colors"
              >
                Recalcular
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
