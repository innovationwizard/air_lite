'use client';

import { useState, useEffect } from 'react';
import {
  Play,
  ChevronRight,
  Warehouse,
  ShoppingCart,
  AlertTriangle,
  RefreshCw,
  Users,
} from 'lucide-react';
import { BacktestSavingsCard } from '@/components/backtest/BacktestSavingsCard';
import { HoldingCostInput } from '@/components/backtest/HoldingCostInput';

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function formatMonth(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return `${SPANISH_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatMonthUpper(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return `${SPANISH_MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}

interface BacktestRun {
  id: number;
  status: string;
  prediction_month: string;
  products_modeled: number;
  training_duration_ms: number;
}

interface BacktestSavings {
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
}

interface RunDetail extends BacktestRun {
  savings?: BacktestSavings;
}

export default function BacktestPage() {
  const [allRuns, setAllRuns] = useState<BacktestRun[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = start screen
  const [currentDetail, setCurrentDetail] = useState<RunDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Load all completed runs on mount
  useEffect(() => {
    fetch('/api/backtest/runs')
      .then((r) => r.json())
      .then((data) => {
        setAllRuns(data || []);
        setInitialLoading(false);
      })
      .catch(() => setInitialLoading(false));
  }, []);

  const loadRunDetail = async (index: number) => {
    if (index < 0 || index >= allRuns.length) return;

    setLoadingDetail(true);
    setCurrentIndex(index);

    try {
      const run = allRuns[index];
      const res = await fetch(`/api/backtest/${run.id}`);
      const data = await res.json();
      setCurrentDetail(data);

      // Calculate cumulative savings up to this point
      let cumulative = 0;
      for (let i = 0; i <= index; i++) {
        // We need savings for each run — fetch them or estimate
        if (i === index && data.savings) {
          cumulative += data.savings.total_savings_gtq || 0;
        } else {
          // For previous runs, we'll accumulate as user clicks through
          cumulative += 0; // Will be tracked via state
        }
      }
    } catch {
      // ignore
    }
    setLoadingDetail(false);
  };

  const handleStart = () => {
    loadRunDetail(0);
  };

  const handleNext = () => {
    if (currentIndex < allRuns.length - 1) {
      loadRunDetail(currentIndex + 1);
    }
  };

  const handleGoToRun = (index: number) => {
    loadRunDetail(index);
  };

  const savings = currentDetail?.savings;
  const isLastRun = currentIndex === allRuns.length - 1;
  const hasStarted = currentIndex >= 0;

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

  // ═══════════════════════════════════════════════
  // START SCREEN — Play button
  // ═══════════════════════════════════════════════
  if (!hasStarted) {
    return (
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">
            Demostración de Valor
          </h1>
          <p className="text-gray-500 text-lg">
            Vea cuánto dinero habría ahorrado con AI Refill, mes a mes
          </p>
        </div>

        <button
          onClick={handleStart}
          className="w-full bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-12 text-white text-center shadow-xl hover:from-emerald-500 hover:to-emerald-600 transition-all cursor-pointer group"
        >
          <div className="flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
              <Play className="w-10 h-10 text-white ml-1" />
            </div>
            <div>
              <p className="text-2xl font-bold mb-2">
                Iniciar Prueba de Concepto
              </p>
              <p className="text-emerald-100 text-lg">
                Muestra de 100 productos, ciclos mensuales
              </p>
            </div>
          </div>
        </button>

        {allRuns.length > 0 && (
          <p className="text-center text-sm text-gray-400">
            {allRuns.length} meses de datos listos para analizar — Oct 2024 a Feb 2026
          </p>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // PLAYBACK — Current cycle view
  // ═══════════════════════════════════════════════
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Demostración de Valor
          </h1>
          <p className="text-gray-500">
            Ciclo {currentIndex + 1} de {allRuns.length}
          </p>
        </div>
        <button
          onClick={() => {
            setCurrentIndex(-1);
            setCurrentDetail(null);
          }}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Reiniciar
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-emerald-600 h-2 rounded-full transition-all duration-500"
          style={{ width: `${((currentIndex + 1) / allRuns.length) * 100}%` }}
        />
      </div>

      {/* Loading state */}
      {loadingDetail && (
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-12 text-white text-center shadow-xl">
          <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="text-lg text-emerald-100">
            Analizando {currentDetail?.prediction_month ? formatMonth(currentDetail.prediction_month) : ''}...
          </p>
        </div>
      )}

      {/* Headline Savings Card */}
      {!loadingDetail && savings && (
        <>
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 rounded-2xl p-8 text-white text-center shadow-xl">
            <p className="text-emerald-100 text-sm uppercase tracking-wider mb-2">
              {currentDetail?.prediction_month && formatMonthUpper(currentDetail.prediction_month)}
            </p>
            <p className="text-lg text-emerald-100 mb-1">
              Si hubiera contado con AI Refill, habría ahorrado aproximadamente
            </p>
            <p className="text-5xl font-bold mb-4">
              GTQ {savings.total_savings_gtq.toLocaleString('es-GT', { maximumFractionDigits: 0 })}
            </p>
            <div className="flex items-center justify-center gap-2 text-emerald-200 text-sm">
              <Users className="w-4 h-4" />
              <span>Modelando {currentDetail?.products_modeled ?? 0} productos</span>
            </div>
          </div>

          {/* 4 Savings Cards */}
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

          {/* Holding Cost Input */}
          <HoldingCostInput
            currentRate={savings.holding_cost_rate_used}
            onRateChange={() => {}}
          />

          {/* NEXT BUTTON — the CTA */}
          <div className="flex justify-center pt-4">
            {!isLastRun ? (
              <button
                onClick={handleNext}
                className="flex items-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-xl text-lg font-semibold hover:bg-emerald-500 transition-colors shadow-lg"
              >
                Siguiente mes: {allRuns[currentIndex + 1] && formatMonth(allRuns[currentIndex + 1].prediction_month)}
                <ChevronRight className="w-6 h-6" />
              </button>
            ) : (
              <div className="text-center space-y-4 py-4">
                <p className="text-2xl font-bold text-gray-900">
                  Prueba de concepto finalizada
                </p>
                <p className="text-gray-500">
                  {allRuns.length} meses analizados con datos reales de PLASTICENTRO
                </p>
                <button
                  onClick={() => {
                    setCurrentIndex(-1);
                    setCurrentDetail(null);
                    setCumulativeSavings(0);
                  }}
                  className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Volver al inicio
                </button>
              </div>
            )}
          </div>

          {/* Timeline breadcrumbs */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-1 overflow-x-auto pb-1">
              {allRuns.map((run, i) => (
                <button
                  key={run.id}
                  onClick={() => handleGoToRun(i)}
                  className={`px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                    i === currentIndex
                      ? 'bg-emerald-600 text-white'
                      : i < currentIndex
                      ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                      : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  {formatMonth(run.prediction_month)}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
