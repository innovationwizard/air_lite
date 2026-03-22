import React, { useState } from 'react';
import { 
  Calendar, 
  CalendarDays, 
  TrendingUp, 
  Layers,
  ChevronDown 
} from 'lucide-react';
import { 
  EstadoNavegacionTemporal, 
  PresetRango,
  RANGOS_PREDEFINIDOS,
  TEXTOS_NAVEGACION_TEMPORAL
} from '@/types/navegacion-temporal';

interface TimeNavigationComponentProps {
  onEstadoCambio: (estado: EstadoNavegacionTemporal) => void;
  estadoInicial?: EstadoNavegacionTemporal;
  className?: string;
}

export const TimeNavigationComponent: React.FC<TimeNavigationComponentProps> = ({
  onEstadoCambio,
  estadoInicial,
  className = ''
}) => {
  // Estado inicial con valores por defecto
  const [estado, setEstado] = useState<EstadoNavegacionTemporal>(estadoInicial || {
    modo: 'individual',
    rangoActual: {
      fechaInicio: new Date(new Date().setDate(new Date().getDate() - 30)),
      fechaFin: new Date()
    },
    granularidad: 'mensual'
  });

  const [mostrarCalendario, setMostrarCalendario] = useState(false);
  const [mostrarGranularidad, setMostrarGranularidad] = useState(false);
  const [showCustomDatePicker, setShowCustomDatePicker] = useState(false);
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [preset, setPreset] = useState<string>('');

  // ✅ NEW: Function to apply year preset
  const aplicarAño = (año: number) => {
    const fechaInicio = new Date(año, 0, 1); // Jan 1
    const fechaFin = new Date(año, 11, 31); // Dec 31

    const nuevoEstado: EstadoNavegacionTemporal = {
      ...estado,
      rangoActual: { fechaInicio, fechaFin }
    };

    setEstado(nuevoEstado);
    onEstadoCambio(nuevoEstado);
    setPreset(`year-${año}`);
  };

  // Funciones helper para presets
  const aplicarPreset = (preset: PresetRango) => {
    const hoy = new Date();
    let fechaInicio: Date;
    let fechaFin: Date = new Date();

    switch (preset) {
      case 'ultimos7Dias':
        fechaInicio = new Date(hoy.setDate(hoy.getDate() - 7));
        break;
      case 'ultimos30Dias':
        fechaInicio = new Date(hoy.setDate(hoy.getDate() - 30));
        break;
      case 'mesActual':
        fechaInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
        break;
      case 'añoActual':
        fechaInicio = new Date(hoy.getFullYear(), 0, 1);
        break;
      case 'ultimos12Meses':
        fechaInicio = new Date(hoy.setMonth(hoy.getMonth() - 12));
        break;
      case 'ultimos24Meses':
        fechaInicio = new Date(hoy.setMonth(hoy.getMonth() - 24));
        break;
      default:
        return;
    }

    const nuevoEstado: EstadoNavegacionTemporal = {
      ...estado,
      rangoActual: { fechaInicio, fechaFin }
    };

    setEstado(nuevoEstado);
    onEstadoCambio(nuevoEstado);
  };

  const cambiarModo = (nuevoModo: 'individual' | 'comparar' | 'tendencia') => {
    const nuevoEstado: EstadoNavegacionTemporal = {
      ...estado,
      modo: nuevoModo
    };

    // Si cambia a comparar, inicializar rango de comparación
    if (nuevoModo === 'comparar' && !estado.rangoComparacion) {
      const hace60Dias = new Date();
      hace60Dias.setDate(hace60Dias.getDate() - 60);
      const hace30Dias = new Date();
      hace30Dias.setDate(hace30Dias.getDate() - 30);
      
      nuevoEstado.rangoComparacion = {
        fechaInicio: hace60Dias,
        fechaFin: hace30Dias
      };
    }

    setEstado(nuevoEstado);
    onEstadoCambio(nuevoEstado);
  };

  const cambiarGranularidad = (nuevaGranularidad: 'diario' | 'semanal' | 'mensual' | 'anual') => {
    const nuevoEstado = {
      ...estado,
      granularidad: nuevaGranularidad
    };
    setEstado(nuevoEstado);
    onEstadoCambio(nuevoEstado);
    setMostrarGranularidad(false);
  };

  const formatearFecha = (fecha: Date): string => {
    return fecha.toLocaleDateString('es-MX', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const onRangoChange = (startDate: string, endDate: string) => {
    const nuevoEstado: EstadoNavegacionTemporal = {
      ...estado,
      rangoActual: { 
        fechaInicio: new Date(startDate), 
        fechaFin: new Date(endDate) 
      }
    };
    setEstado(nuevoEstado);
    onEstadoCambio(nuevoEstado);
  };

  // ✅ NEW: Generate years array
  const años = Array.from({ length: 11 }, (_, i) => 2015 + i); // [2015, 2016, ..., 2025]

  return (
    <div className={`bg-white border-b border-gray-200 px-6 py-4 ${className}`}>
      {/* Línea 1: Selector de Modo */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex rounded-lg bg-gray-100 p-1">
          <button
            onClick={() => cambiarModo('individual')}
            className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              estado.modo === 'individual' 
                ? 'bg-white text-green-600 shadow-sm' 
                : 'text-gray-700 hover:text-gray-900'
            }`}
          >
            <Calendar className="w-4 h-4 mr-2" />
            {TEXTOS_NAVEGACION_TEMPORAL.modos.individual}
          </button>
          <button
            onClick={() => cambiarModo('comparar')}
            className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              estado.modo === 'comparar' 
                ? 'bg-white text-green-600 shadow-sm' 
                : 'text-gray-700 hover:text-gray-900'
            }`}
          >
            <Layers className="w-4 h-4 mr-2" />
            {TEXTOS_NAVEGACION_TEMPORAL.modos.comparar}
          </button>
          <button
            onClick={() => cambiarModo('tendencia')}
            className={`flex items-center px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              estado.modo === 'tendencia' 
                ? 'bg-white text-green-600 shadow-sm' 
                : 'text-gray-700 hover:text-gray-900'
            }`}
          >
            <TrendingUp className="w-4 h-4 mr-2" />
            {TEXTOS_NAVEGACION_TEMPORAL.modos.tendencia}
          </button>
        </div>

        {/* Selector de Granularidad */}
        <div className="relative">
          <button
            onClick={() => setMostrarGranularidad(!mostrarGranularidad)}
            className="flex items-center px-4 py-2 bg-gray-100 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            {TEXTOS_NAVEGACION_TEMPORAL.granularidad[estado.granularidad]}
            <ChevronDown className="w-4 h-4 ml-2" />
          </button>
          
          {mostrarGranularidad && (
            <div className="absolute right-0 mt-2 w-40 bg-white rounded-md shadow-lg z-10 border border-gray-200">
              {Object.entries(TEXTOS_NAVEGACION_TEMPORAL.granularidad).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => cambiarGranularidad(key as any)}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Línea 2: Selectores de Fecha y Presets */}
      <div className="flex items-center space-x-4 mb-3">
        {/* Presets rápidos */}
        <div className="flex space-x-2">
          {Object.entries(RANGOS_PREDEFINIDOS).map(([key, label]) => (
            <button
              key={key}
              onClick={() => {
                aplicarPreset(key as PresetRango);
                setPreset(key);
              }}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                preset === key
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
          
          {/* Custom date picker */}
          <div className="relative">
            <button
              onClick={() => setShowCustomDatePicker(!showCustomDatePicker)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                preset === 'custom'
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Personalizado
            </button>
            
            {showCustomDatePicker && (
              <div className="absolute right-0 top-full mt-2 flex items-center gap-2 p-2 bg-white border rounded-lg shadow-lg z-20 whitespace-nowrap">
                <input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="px-2 py-1 border rounded text-sm"
                  max={new Date().toISOString().split('T')[0]}
                />
                <span className="text-gray-500">a</span>
                <input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="px-2 py-1 border rounded text-sm"
                  max={new Date().toISOString().split('T')[0]}
                />
                <button
                  onClick={() => {
                    if (customStartDate && customEndDate) {
                      onRangoChange(customStartDate, customEndDate);
                      setPreset('custom');
                      setShowCustomDatePicker(false);
                    }
                  }}
                  disabled={!customStartDate || !customEndDate}
                  className="px-3 py-1 bg-green-600 text-white rounded text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-green-700"
                >
                  Aplicar
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Separador */}
        <div className="h-6 w-px bg-gray-300" />

        {/* Selector de fechas personalizado */}
        <div className="flex items-center space-x-2">
          {estado.modo === 'comparar' ? (
            <>
              <span className="text-sm text-gray-600">{TEXTOS_NAVEGACION_TEMPORAL.etiquetas.periodoA}:</span>
              <button
                onClick={() => setMostrarCalendario(!mostrarCalendario)}
                className="flex items-center px-3 py-1.5 bg-green-50 text-green-700 rounded-md hover:bg-green-100"
              >
                <CalendarDays className="w-4 h-4 mr-2" />
                {formatearFecha(estado.rangoActual.fechaInicio)} - {formatearFecha(estado.rangoActual.fechaFin)}
              </button>
              
              <span className="text-sm text-gray-600 ml-4">{TEXTOS_NAVEGACION_TEMPORAL.etiquetas.periodoB}:</span>
              <button
                onClick={() => setMostrarCalendario(!mostrarCalendario)}
                className="flex items-center px-3 py-1.5 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
              >
                <CalendarDays className="w-4 h-4 mr-2" />
                {estado.rangoComparacion 
                  ? `${formatearFecha(estado.rangoComparacion.fechaInicio)} - ${formatearFecha(estado.rangoComparacion.fechaFin)}`
                  : 'Seleccionar período'
                }
              </button>
            </>
          ) : (
            <button
              onClick={() => setMostrarCalendario(!mostrarCalendario)}
              className="flex items-center px-3 py-1.5 bg-green-50 text-green-700 rounded-md hover:bg-green-100"
            >
              <CalendarDays className="w-4 h-4 mr-2" />
              {preset === 'custom' && customStartDate && customEndDate
                ? `${new Date(customStartDate).toLocaleDateString('es-GT')} - ${new Date(customEndDate).toLocaleDateString('es-GT')}`
                : preset === 'custom'
                ? 'Rango personalizado'
                : `${formatearFecha(estado.rangoActual.fechaInicio)} - ${formatearFecha(estado.rangoActual.fechaFin)}`}
            </button>
          )}
        </div>
      </div>

      {/* ✅ NEW: Línea 3 - Year Presets (Temporary) */}
      <div className="flex items-center space-x-2 pt-2 border-t border-gray-200">
        <span className="text-xs font-medium text-gray-500 mr-2">Años completos:</span>
        <div className="flex space-x-1.5">
          {años.map((año) => (
            <button
              key={año}
              onClick={() => aplicarAño(año)}
              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                preset === `year-${año}`
                  ? 'bg-amber-500 text-white'
                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
              }`}
            >
              {año}
            </button>
          ))}
        </div>
      </div>

      {/* Calendario personalizado implementado arriba */}
      {mostrarCalendario && (
        <div className="absolute mt-2 p-4 bg-white rounded-lg shadow-lg border border-gray-200 z-20">
          <p className="text-sm text-gray-600">Calendario personalizado disponible en los presets</p>
        </div>
      )}
    </div>
  );
};

export default TimeNavigationComponent;