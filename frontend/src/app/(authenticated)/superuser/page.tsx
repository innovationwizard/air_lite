'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import {
  Activity,
  Database,
  Clock,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';

interface DataStatus {
  tables: {
    name: string;
    row_count: number;
    min_date: string | null;
    max_date: string | null;
  }[];
}

interface BacktestStat {
  id: number;
  prediction_month: string;
  status: string;
  products_modeled: number;
  training_duration_ms: number;
  created_at: string;
}

interface MlHealth {
  status: string;
  service: string;
}

export default function SuperuserPage() {
  const [dataStatus, setDataStatus] = useState<DataStatus | null>(null);
  const [backtestStats, setBacktestStats] = useState<BacktestStat[]>([]);
  const [mlHealth, setMlHealth] = useState<MlHealth | null>(null);
  const [mlError, setMlError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function loadData() {
    try {
      const [dataRes, backtestRes] = await Promise.all([
        fetch('/api/admin/data-status'),
        fetch('/api/backtest/runs'),
      ]);

      if (dataRes.ok) {
        setDataStatus(await dataRes.json());
      }
      if (backtestRes.ok) {
        const runs = await backtestRes.json();
        setBacktestStats(Array.isArray(runs) ? runs : []);
      }

      // ML health check — goes through our API to avoid CORS
      try {
        const mlRes = await fetch('/api/admin/ml-health');
        if (mlRes.ok) {
          setMlHealth(await mlRes.json());
          setMlError(null);
        } else {
          setMlError(`HTTP ${mlRes.status}`);
        }
      } catch {
        setMlError('No se pudo conectar al servicio ML');
      }
    } catch (err) {
      console.error('Error loading superuser data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  const completedRuns = backtestStats.filter((r) => r.status === 'completed');
  const failedRuns = backtestStats.filter((r) => r.status === 'error');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Panel de Control</h1>
          <p className="text-sm text-gray-500 mt-1">
            Salud del sistema, datos y modelos ML
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Actualizar
        </button>
      </div>

      {/* ML Service Health */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Servicio ML (Railway)</h2>
        </div>
        <div className="flex items-center gap-3">
          {mlHealth?.status === 'ok' ? (
            <>
              <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              <div>
                <p className="font-medium text-emerald-700">En línea</p>
                <p className="text-sm text-gray-500">Servicio: {mlHealth.service}</p>
              </div>
            </>
          ) : (
            <>
              <XCircle className="w-6 h-6 text-red-500" />
              <div>
                <p className="font-medium text-red-700">Error</p>
                <p className="text-sm text-gray-500">{mlError ?? 'Estado desconocido'}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Backtest Stats */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Historial de Backtests</h2>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-2xl font-bold text-gray-900">{backtestStats.length}</p>
            <p className="text-sm text-gray-500">Total ejecutados</p>
          </div>
          <div className="bg-emerald-50 rounded-lg p-4">
            <p className="text-2xl font-bold text-emerald-700">{completedRuns.length}</p>
            <p className="text-sm text-emerald-600">Completados</p>
          </div>
          <div className={`rounded-lg p-4 ${failedRuns.length > 0 ? 'bg-red-50' : 'bg-gray-50'}`}>
            <p className={`text-2xl font-bold ${failedRuns.length > 0 ? 'text-red-700' : 'text-gray-900'}`}>
              {failedRuns.length}
            </p>
            <p className={`text-sm ${failedRuns.length > 0 ? 'text-red-600' : 'text-gray-500'}`}>Con errores</p>
          </div>
        </div>

        {backtestStats.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Mes predicho</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Estado</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">Productos</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">Duración</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {backtestStats.map((run) => (
                  <tr key={run.id} className="border-b border-gray-100">
                    <td className="py-2 px-3">{run.prediction_month}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        run.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : run.status === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-yellow-100 text-yellow-700'
                      }`}>
                        {run.status === 'completed' ? 'Completado' : run.status === 'error' ? 'Error' : 'Ejecutando'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">{run.products_modeled ?? '—'}</td>
                    <td className="py-2 px-3 text-right">
                      {run.training_duration_ms
                        ? `${(run.training_duration_ms / 1000).toFixed(1)}s`
                        : '—'}
                    </td>
                    <td className="py-2 px-3 text-gray-500">
                      {new Date(run.created_at).toLocaleString('es-GT')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No se han ejecutado backtests aún.</p>
        )}
      </div>

      {/* Data Freshness */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-5 h-5 text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900">Frescura de Datos</h2>
        </div>

        {dataStatus?.tables && dataStatus.tables.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Tabla</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-500">Registros</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Desde</th>
                  <th className="text-left py-2 px-3 font-medium text-gray-500">Hasta</th>
                </tr>
              </thead>
              <tbody>
                {dataStatus.tables.map((t) => (
                  <tr key={t.name} className="border-b border-gray-100">
                    <td className="py-2 px-3 font-mono text-xs">{t.name}</td>
                    <td className="py-2 px-3 text-right">{t.row_count.toLocaleString('es-GT')}</td>
                    <td className="py-2 px-3 text-gray-500">{t.min_date ?? '—'}</td>
                    <td className="py-2 px-3 text-gray-500">{t.max_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-amber-600">
            <AlertCircle className="w-4 h-4" />
            <span>No se pudieron cargar los datos de las tablas.</span>
          </div>
        )}
      </div>
    </div>
  );
}
