'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Warehouse,
  ShoppingCart,
  AlertTriangle,
  RefreshCw,
  Users,
} from 'lucide-react';
import { BacktestSavingsCard } from '@/components/backtest/BacktestSavingsCard';
import { PredictNextButton } from '@/components/backtest/PredictNextButton';
import { HoldingCostInput } from '@/components/backtest/HoldingCostInput';

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatMonth(dateStr: string): string {
  const d = new Date(dateStr);
  return `${SPANISH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

interface BacktestRun {
  id: number;
  run_id: number;
  status: string;
  prediction_month: string;
  products_modeled: number;
  training_duration_ms: number;
  savings?: {
    total_savings_gtq: number;
    summary_text: string;
    storage_savings_gtq: number;
    storage_savings_pct: number;
    storage_reasoning: string;
    holding_cost_rate_used: number;
    purchase_savings_gtq: number;
    purchase_savings_pct: number;
    purchase_reasoning: string;
    stockout_savings_gtq: number;
    stockout_savings_pct: number;
    stockout_reasoning: string;
    rotation_improvement_pct: number;
    rotation_reasoning: string;
    actual_turnover_rate: number;
    optimized_turnover_rate: number;
  };
}

export default function BacktestPage() {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [currentRun, setCurrentRun] = useState<BacktestRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [trainingMonths, setTrainingMonths] = useState(3);
  const [holdingCostRate, setHoldingCostRate] = useState(0.25);
  const [pollingRunId, setPollingRunId] = useState<number | null>(null);

  // Load existing completed runs on mount
  useEffect(() => {
    fetchRuns();
  }, []);

  // Poll for in-progress run
  useEffect(() => {
    if (!pollingRunId) return;

    const interval = setInterval(async () => {
      const res = await fetch(`/api/backtest/${pollingRunId}`);
      const data = await res.json();

      if (data.status === 'completed') {
        setCurrentRun(data);
        setLoading(false);
        setPollingRunId(null);
        setTrainingMonths((prev) => prev + 1);
        fetchRuns();
      } else if (data.status === 'failed') {
        setLoading(false);
        setPollingRunId(null);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [pollingRunId]);

  const fetchRuns = async () => {
    try {
      const res = await fetch('/api/backtest/runs');
      const data = await res.json();
      setRuns(data || []);

      // If we have completed runs, show the latest
      if (data && data.length > 0) {
        const latest = data[data.length - 1];
        const detailRes = await fetch(`/api/backtest/${latest.id}`);
        const detailData = await detailRes.json();
        setCurrentRun(detailData);
        setTrainingMonths(data.length + 3); // Next training months
      }
    } catch (error) {
      console.error('Error fetching runs:', error);
    } finally {
      setInitialLoading(false);
    }
  };

  const triggerBacktest = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          training_months: trainingMonths,
          holding_cost_rate: holdingCostRate,
        }),
      });

      const data = await res.json();
      if (data.run_id) {
        setPollingRunId(data.run_id);
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }, [trainingMonths, holdingCostRate]);

  // Auto-trigger first backtest on initial load if no runs exist
  useEffect(() => {
    if (!initialLoading && runs.length === 0 && !loading) {
      triggerBacktest();
    }
  }, [initialLoading, runs.length, loading, triggerBacktest]);

  const nextMonthName = (() => {
    const d = new Date(2024, 9 + trainingMonths, 1); // Oct 2024 + training_months
    return `${SPANISH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  })();

  const savings = currentRun?.savings;

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto" />
          <p className="text-gray-500">Cargando datos...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">
          Demostración de Valor
        </h1>
        <p className="text-gray-500 text-lg">
          Vea cuánto dinero habría ahorrado con AI Refill, mes a mes
        </p>
      </div>

      {/* Headline Savings */}
      {savings && (
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-8 text-white text-center shadow-xl">
          <p className="text-emerald-100 text-sm uppercase tracking-wider mb-2">
            {currentRun?.prediction_month && formatMonth(currentRun.prediction_month)}
          </p>
          <p className="text-lg text-emerald-100 mb-1">
            Si hubiera contado con AI Refill, habría ahorrado aproximadamente
          </p>
          <p className="text-5xl font-bold mb-4">
            GTQ {savings.total_savings_gtq.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
          </p>

          {/* Coverage metrics */}
          <div className="flex items-center justify-center gap-2 text-emerald-200 text-sm">
            <Users className="w-4 h-4" />
            <span>
              Modelando {currentRun?.products_modeled ?? 0} productos
            </span>
          </div>
        </div>
      )}

      {/* Loading state for first run */}
      {loading && !savings && (
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-200">
          <div className="w-16 h-16 border-4 border-emerald-200 border-t-emerald-600 rounded-full animate-spin mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            Entrenando modelos de predicción...
          </h2>
          <p className="text-gray-500">
            Esto puede tomar varios minutos. Estamos analizando los datos históricos
            para predecir {nextMonthName}.
          </p>
        </div>
      )}

      {/* 4 Savings Cards */}
      {savings && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <BacktestSavingsCard
            title="Costos de Almacenamiento"
            savingsGtq={savings.storage_savings_gtq}
            savingsPct={savings.storage_savings_pct}
            reasoning={savings.storage_reasoning}
            icon={<Warehouse className="w-5 h-5 text-blue-600" />}
            accentColor="bg-blue-50"
          />
          <BacktestSavingsCard
            title="Compras Innecesarias"
            savingsGtq={savings.purchase_savings_gtq}
            savingsPct={savings.purchase_savings_pct}
            reasoning={savings.purchase_reasoning}
            icon={<ShoppingCart className="w-5 h-5 text-purple-600" />}
            accentColor="bg-purple-50"
          />
          <BacktestSavingsCard
            title="Ventas Perdidas por Desabastecimiento"
            savingsGtq={savings.stockout_savings_gtq}
            savingsPct={savings.stockout_savings_pct}
            reasoning={savings.stockout_reasoning}
            icon={<AlertTriangle className="w-5 h-5 text-amber-600" />}
            accentColor="bg-amber-50"
          />
          <BacktestSavingsCard
            title="Rotación de Inventario"
            savingsGtq={0}
            savingsPct={savings.rotation_improvement_pct}
            reasoning={savings.rotation_reasoning}
            icon={<RefreshCw className="w-5 h-5 text-emerald-600" />}
            accentColor="bg-emerald-50"
          />
        </div>
      )}

      {/* Holding Cost Rate Input */}
      {savings && (
        <HoldingCostInput
          currentRate={savings.holding_cost_rate_used}
          onRateChange={(rate) => {
            setHoldingCostRate(rate);
            // Recalculate would re-trigger backtest with new rate
          }}
        />
      )}

      {/* Predict Next Month Button */}
      {savings && (
        <div className="flex justify-center pt-4">
          <PredictNextButton
            onClick={triggerBacktest}
            loading={loading}
            nextMonth={nextMonthName}
          />
        </div>
      )}

      {/* Timeline of completed runs */}
      {runs.length > 1 && (
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">
            Ciclos completados
          </h3>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {runs.map((run) => (
              <button
                key={run.id}
                onClick={async () => {
                  const res = await fetch(`/api/backtest/${run.id}`);
                  const data = await res.json();
                  setCurrentRun(data);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  currentRun?.run_id === run.id
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {formatMonth(run.prediction_month)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
