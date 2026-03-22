'use client';

import { ShoppingCart } from 'lucide-react';

export default function ComprasInnecesariasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShoppingCart className="w-6 h-6 text-purple-500" />
          Compras Innecesarias
        </h1>
        <p className="text-gray-500 mt-1">
          Análisis de compras: necesarias vs excesivas
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <p className="text-gray-400">
          Los datos de compras innecesarias se generan como parte del análisis de backtest.
          Visite la página de Demostración de Valor para ver los resultados detallados.
        </p>
      </div>
    </div>
  );
}
