import { ChartConfig } from './chart.types';
import { ProcessTimers } from './kpi.types';

export interface DashboardKPI {
  id: string;
  name: string;
  value: number;
  target?: number;
  unit: string;
  trend?: string;
  sparkline?: number[];
  subValue?: number;
  urgency?: number;
  progress?: number;
  items?: Array<Record<string, unknown>>;
  severity?: string;
  breakdown?: Record<string, number>;
  zones?: Record<string, number>;
  potentialRevenue?: number;
  investigated?: number;
  resolved?: number;
  change?: number;
  details?: Record<string, unknown>;
}

export interface DashboardAlert {
  id: string;
  severity: string;
  type: string;
  message: string;
  product?: string;
  actionRequired?: boolean;
  impact?: number;
  timestamp?: string;
  action?: string;
  details?: unknown[];
}

export interface Dashboard {
  role: string;
  title: string;
  lastUpdated: string;
  kpis: DashboardKPI[];
  alerts?: DashboardAlert[];
  charts?: Record<string, ChartConfig | Record<string, unknown>>;
  tables?: Record<string, Array<Record<string, unknown>>>;
  aiHighlight?: Record<string, unknown> | null;
  processTimers?: ProcessTimers;
  error?: string;
  maxDataDate?: string;
}

export interface DashboardOptions {
  startDate?: Date;
  endDate?: Date;
  granularidad?: string;
  modo?: string;
}

export interface DashboardRoleMap {
  [key: string]: string;
}
