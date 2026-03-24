'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { Play, ChevronRight } from 'lucide-react';

interface ScheduleRun {
  id: number;
  schedule_week_start: string;
  schedule_week_end: string;
  training_start_date: string;
  training_end_date: string;
  products_scheduled: number;
  total_units_recommended: number;
  total_value_recommended: number;
  max_inventory_days: number;
  training_duration_ms: number;
}

interface ScheduleLine {
  id: number;
  product_id: number;
  supplier_name: string;
  recommended_date: string;
  recommended_qty: number;
  recommended_value: number;
  uom: string;
  forecasted_weekly_demand: number;
  current_inventory: number;
  days_of_supply_before: number;
  days_of_supply_after: number;
  max_inventory_qty: number;
  reasoning: string;
  products?: {
    name: string;
    sku: string;
    stock_uom: string;
    cost: number;
  };
}

const formatGTQ = (n: number) =>
  `Q${n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

const formatNumber = (n: number) =>
  n.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const formatDate = (d: string) => {
  const date = new Date(d + 'T12:00:00');
  return date.toLocaleDateString('es-GT', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const formatWeek = (start: string, end: string) => {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const sStr = s.toLocaleDateString('es-GT', { day: 'numeric', month: 'short' });
  const eStr = e.toLocaleDateString('es-GT', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${sStr} – ${eStr}`;
};


export default function ProgramacionPage() {
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = start screen
  const [selectedRun, setSelectedRun] = useState<ScheduleRun | null>(null);
  const [lines, setLines] = useState<ScheduleLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/poc/purchase-schedule')
      .then((r) => r.json())
      .then((data) => {
        setRuns(data.runs || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const loadRunByIndex = async (index: number) => {
    if (index < 0 || index >= runs.length) return;
    setCurrentIndex(index);
    const run = runs[index];
    setSelectedRun(run);
    setDetailLoading(true);
    setExpandedProduct(null);
    try {
      const res = await fetch(`/api/poc/purchase-schedule?runId=${run.id}`);
      const data = await res.json();
      setLines(data.lines || []);
    } catch {
      setLines([]);
    }
    setDetailLoading(false);
  };

  const handleStart = () => loadRunByIndex(0);
  const handleNext = () => loadRunByIndex(currentIndex + 1);
  const hasStarted = currentIndex >= 0;
  const isLastRun = currentIndex === runs.length - 1;

  // Group lines by date for the selected run
  const linesByDate = lines.reduce((acc, line) => {
    const d = line.recommended_date;
    if (!acc[d]) acc[d] = [];
    acc[d].push(line);
    return acc;
  }, {} as Record<string, ScheduleLine[]>);

  // Group lines by supplier
  const linesBySupplier = lines.reduce((acc, line) => {
    const s = line.supplier_name || 'Sin proveedor';
    if (!acc[s]) acc[s] = { lines: [], totalUnits: 0, totalValue: 0 };
    acc[s].lines.push(line);
    acc[s].totalUnits += line.recommended_qty;
    acc[s].totalValue += line.recommended_value;
    return acc;
  }, {} as Record<string, { lines: ScheduleLine[]; totalUnits: number; totalValue: number }>);


  if (loading) {
    return (
      <div className="p-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // START SCREEN
  // ═══════════════════════════════════════════════
  if (!hasStarted) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">
            Programación de Compras Semanal
          </h1>
          <p className="text-gray-500 text-lg">
            Proveedores Carvajal y Reyma — Política de inventario máximo: 2 semanas
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
                Productos de Carvajal y Reyma, ciclos semanales
              </p>
            </div>
          </div>
        </button>

        {runs.length > 0 && (
          <p className="text-center text-sm text-gray-400">
            {runs.length} semanas de datos listos para analizar
          </p>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════
  // PLAYBACK
  // ═══════════════════════════════════════════════
  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header with progress */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Programación de Compras Semanal
          </h1>
          <p className="text-gray-500">
            Semana {currentIndex + 1} de {runs.length} — Carvajal y Reyma
          </p>
        </div>
        <button
          onClick={() => { setCurrentIndex(-1); setSelectedRun(null); setLines([]); }}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Reiniciar
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-emerald-600 h-2 rounded-full transition-all duration-500"
          style={{ width: `${((currentIndex + 1) / runs.length) * 100}%` }}
        />
      </div>

      {/* Selected Week Detail */}
      {selectedRun && (
        <div className="space-y-4">
          {/* Week Summary */}
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-5">
            <h2 className="text-lg font-bold text-emerald-900">
              Semana: {formatWeek(selectedRun.schedule_week_start, selectedRun.schedule_week_end)}
            </h2>
            <p className="text-sm text-emerald-700 mt-1">
              Entrenado con datos del {formatDate(selectedRun.training_start_date)} al{' '}
              {formatDate(selectedRun.training_end_date)}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
              <div>
                <p className="text-xs text-emerald-600">Productos con pedido</p>
                <p className="text-xl font-bold text-emerald-900">{selectedRun.products_scheduled}</p>
              </div>
              <div>
                <p className="text-xs text-emerald-600">Unidades recomendadas</p>
                <p className="text-xl font-bold text-emerald-900">
                  {formatNumber(selectedRun.total_units_recommended)}
                </p>
              </div>
              <div>
                <p className="text-xs text-emerald-600">Valor estimado</p>
                <p className="text-xl font-bold text-emerald-900">
                  {formatGTQ(selectedRun.total_value_recommended)}
                </p>
              </div>
              <div>
                <p className="text-xs text-emerald-600">Inventario máximo</p>
                <p className="text-xl font-bold text-emerald-900">{selectedRun.max_inventory_days} días</p>
              </div>
            </div>
          </div>

          {detailLoading ? (
            <div className="animate-pulse h-64 bg-gray-100 rounded-lg" />
          ) : lines.length === 0 ? (
            <div className="bg-white border rounded-lg p-8 text-center">
              <p className="text-gray-500">
                No se requieren compras esta semana. Los niveles de inventario son suficientes
                para cubrir la demanda proyectada dentro del límite de 14 días.
              </p>
            </div>
          ) : (
            <>
              {/* By Supplier */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {Object.entries(linesBySupplier).map(([supplier, data]) => (
                  <div key={supplier} className="bg-white border rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900">{supplier}</h3>
                    <div className="flex gap-6 mt-2">
                      <div>
                        <p className="text-xs text-gray-500">Líneas de pedido</p>
                        <p className="text-lg font-bold">{data.lines.length}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Unidades</p>
                        <p className="text-lg font-bold">{formatNumber(data.totalUnits)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Valor</p>
                        <p className="text-lg font-bold text-emerald-700">{formatGTQ(data.totalValue)}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Daily Breakdown */}
              {Object.entries(linesByDate)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([dateStr, dayLines]) => (
                  <div key={dateStr} className="bg-white border rounded-lg overflow-hidden">
                    <div className="bg-gray-50 px-4 py-3 border-b">
                      <h3 className="font-semibold text-gray-900">
                        {formatDate(dateStr)}
                      </h3>
                      <p className="text-xs text-gray-500">
                        {dayLines.length} productos — {formatNumber(dayLines.reduce((s, l) => s + l.recommended_qty, 0))} unidades — {formatGTQ(dayLines.reduce((s, l) => s + l.recommended_value, 0))}
                      </p>
                    </div>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500 border-b">
                          <th className="px-4 py-2">Producto</th>
                          <th className="px-4 py-2">Proveedor</th>
                          <th className="px-4 py-2 text-right">Cantidad</th>
                          <th className="px-4 py-2">UOM</th>
                          <th className="px-4 py-2 text-right">Valor</th>
                          <th className="px-4 py-2 text-right">Días abasto (antes)</th>
                          <th className="px-4 py-2 text-right">Días abasto (después)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dayLines
                          .sort((a, b) => b.recommended_value - a.recommended_value)
                          .map((line) => (
                            <tr
                              key={line.id}
                              className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                              onClick={() =>
                                setExpandedProduct(
                                  expandedProduct === line.id ? null : line.id
                                )
                              }
                            >
                              <td className="px-4 py-2">
                                <div className="font-medium text-gray-900">
                                  {line.products?.name || `Producto ${line.product_id}`}
                                </div>
                                <div className="text-xs text-gray-400">
                                  {line.products?.sku}
                                </div>
                              </td>
                              <td className="px-4 py-2">
                                <span
                                  className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${
                                    line.supplier_name === 'Carvajal'
                                      ? 'bg-blue-50 text-blue-700'
                                      : 'bg-purple-50 text-purple-700'
                                  }`}
                                >
                                  {line.supplier_name}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right font-mono font-bold">
                                {formatNumber(line.recommended_qty)}
                              </td>
                              <td className="px-4 py-2 text-gray-500">{line.uom}</td>
                              <td className="px-4 py-2 text-right font-mono">
                                {formatGTQ(line.recommended_value)}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <span
                                  className={`font-mono ${
                                    line.days_of_supply_before < 3
                                      ? 'text-red-600 font-bold'
                                      : line.days_of_supply_before < 7
                                      ? 'text-amber-600'
                                      : 'text-gray-600'
                                  }`}
                                >
                                  {line.days_of_supply_before.toFixed(1)}d
                                </span>
                              </td>
                              <td className="px-4 py-2 text-right">
                                <span className="font-mono text-emerald-600">
                                  {line.days_of_supply_after.toFixed(1)}d
                                </span>
                              </td>
                            </tr>
                          ))}
                        {/* Expanded reasoning */}
                        {dayLines.map(
                          (line) =>
                            expandedProduct === line.id && (
                              <tr key={`${line.id}-detail`}>
                                <td colSpan={7} className="px-4 py-3 bg-gray-50">
                                  <div className="text-sm space-y-1">
                                    <p className="text-gray-700">{line.reasoning}</p>
                                    <div className="flex gap-6 text-xs text-gray-500 mt-2">
                                      <span>
                                        Demanda semanal proyectada:{' '}
                                        <strong>{formatNumber(line.forecasted_weekly_demand)}</strong>
                                      </span>
                                      <span>
                                        Inventario actual:{' '}
                                        <strong>{formatNumber(line.current_inventory)}</strong>
                                      </span>
                                      <span>
                                        Inventario máximo permitido:{' '}
                                        <strong>{formatNumber(line.max_inventory_qty)}</strong>
                                      </span>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )
                        )}
                      </tbody>
                    </table>
                  </div>
                ))}
            </>
          )}
        </div>
      )}

      {/* NEXT BUTTON */}
      <div className="flex justify-center pt-4">
        {!isLastRun ? (
          <button
            onClick={handleNext}
            className="flex items-center gap-3 px-8 py-4 bg-emerald-600 text-white rounded-xl text-lg font-semibold hover:bg-emerald-500 transition-colors shadow-lg"
          >
            Siguiente semana: {runs[currentIndex + 1] && formatWeek(runs[currentIndex + 1].schedule_week_start, runs[currentIndex + 1].schedule_week_end)}
            <ChevronRight className="w-6 h-6" />
          </button>
        ) : (
          <div className="text-center space-y-4 py-4">
            <p className="text-2xl font-bold text-gray-900">
              Prueba de concepto finalizada
            </p>
            <p className="text-gray-500">
              {runs.length} semanas analizadas — Carvajal y Reyma
            </p>
            <button
              onClick={() => { setCurrentIndex(-1); setSelectedRun(null); setLines([]); }}
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
          {runs.map((run, i) => (
            <button
              key={run.id}
              onClick={() => loadRunByIndex(i)}
              className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-colors ${
                i === currentIndex
                  ? 'bg-emerald-600 text-white'
                  : i < currentIndex
                  ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              S{i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Methodology */}
      <div className="bg-gray-50 border rounded-lg p-5 text-sm text-gray-600">
        <h3 className="font-semibold text-gray-800 mb-2">Metodología</h3>
        <ol className="list-decimal list-inside space-y-1">
          <li>
            Se entrena un modelo Prophet por cada producto de Carvajal y Reyma con los datos
            históricos de demanda disponibles hasta la semana objetivo.
          </li>
          <li>
            Se proyecta la demanda diaria para los 7 días de la semana seleccionada.
          </li>
          <li>
            Se consulta el inventario real al inicio de la semana.
          </li>
          <li>
            Se calcula la cantidad óptima de compra para cada día, asegurando que el inventario
            nunca exceda <strong>14 días de demanda proyectada</strong> (política de 2 semanas máximo).
          </li>
          <li>
            Se genera un pedido cuando el inventario proyectado cae por debajo de 7 días de abasto
            (punto de reorden = 1 semana).
          </li>
        </ol>
        <p className="mt-3 text-xs text-gray-400">
          Datos reales de PLASTICENTRO, S.A. — Proveedores: Carvajal Empaques y Reyma del Sureste.
          Sin datos ficticios ni simulaciones.
        </p>
      </div>
    </div>
  );
}
