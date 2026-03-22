/**
 * Tipos para el componente de navegación temporal
 * Todos los textos de cara al usuario deben estar en español
 */

export interface RangoFechas {
  fechaInicio: Date;
  fechaFin: Date;
}

export interface EstadoNavegacionTemporal {
  modo: 'individual' | 'comparar' | 'tendencia';
  rangoActual: RangoFechas;
  rangoComparacion?: RangoFechas; // Solo para modo 'comparar'
  granularidad: 'diario' | 'semanal' | 'mensual' | 'anual';
}

export interface ParametrosConsultaTemporal {
  fechaInicio: string; // ISO date string
  fechaFin: string;
  granularidad: 'diario' | 'semanal' | 'mensual' | 'anual';
  modo?: 'individual' | 'comparar' | 'tendencia';
  fechaInicioComparacion?: string; // Para modo comparar
  fechaFinComparacion?: string;
}

// Preset de rangos comunes con nombres en español
export const RANGOS_PREDEFINIDOS = {
  ultimos7Dias: 'Últimos 7 días',
  ultimos30Dias: 'Últimos 30 días', 
  mesActual: 'Mes actual',
  añoActual: 'Año actual',
  ultimos12Meses: 'Últimos 12 meses',
  ultimos24Meses: 'Últimos 24 meses'
} as const;

export type PresetRango = keyof typeof RANGOS_PREDEFINIDOS;

// Textos para la UI en español
export const TEXTOS_NAVEGACION_TEMPORAL = {
  modos: {
    individual: 'Período único',
    comparar: 'Comparar',
    tendencia: 'Tendencia'
  },
  granularidad: {
    diario: 'Diario',
    semanal: 'Semanal',
    mensual: 'Mensual',
    anual: 'Anual'
  },
  etiquetas: {
    fechaInicio: 'Fecha inicio',
    fechaFin: 'Fecha fin',
    periodoA: 'Período A',
    periodoB: 'Período B',
    rangoPersonalizado: 'Rango personalizado'
  }
};

// Corregir nomenclatura de roles
export type TipoRol = 
  | 'gerencia' 
  | 'finanzas' // CORREGIDO de 'finance'
  | 'compras' 
  | 'ventas' 
  | 'inventario' 
  | 'superuser' 
  | 'admin';