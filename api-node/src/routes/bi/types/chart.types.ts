export interface ChartConfig {
  type: string;
  data: unknown[];
  config: Record<string, unknown>;
}

export interface ChartData {
  [key: string]: ChartConfig;
}

export interface HeatmapData {
  hour: number;
  dayOfWeek: number;
  sales: number;
}

export interface BarChartData {
  category: string;
  value: number;
  label?: string;
}

export interface LineChartData {
  date: string;
  value: number;
  label?: string;
}

export interface PieChartData {
  label: string;
  value: number;
  percentage?: number;
}
