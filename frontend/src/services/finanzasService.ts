// frontend/src/services/finanzasService.ts
import apiClient from './api-client';
import { ParametrosConsultaTemporal } from '@/types/navegacion-temporal';

const resolveErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const errWithResponse = error as { response?: { data?: { message?: string } } };
    const message = errWithResponse.response?.data?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return fallback;
};

export interface RevenueChartEntry {
  date: string;
  revenue: number;
  costs: number;
  profit: number;
}

export interface ExpenseBreakdownEntry {
  category: string;
  amount: number;
  percentage: number;
}

export interface CashFlowEntry {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

export interface FinancialAlert {
  id: string;
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface SalesKpi {
  id?: string;
  key?: string;
  metric?: string;
  name?: string;
  value?: number;
  current?: number;
}

export interface TopProductCategory {
  category_name: string;
  gmroi: number;
  inventory_turnover: number;
  margin_pct: number;
  avg_inventory_value: number;
  strategic_category: 'star' | 'cash_cow' | 'question_mark' | 'dog';
}

export interface GmroiRecommendation {
  category: string;
  action: string;
  rationale: string;
  estimated_impact: number;
  priority: 'high' | 'medium' | 'low';
}

export interface GmroiMethodology {
  gmroi_formula: string;
  narrative?: string;
}

export interface GmroiSummary {
  overall_gmroi: number;
  stars_count: number;
  question_marks_count: number;
  dogs_count: number;
}

export interface GmroiResponse {
  summary: GmroiSummary;
  categories: TopProductCategory[];
  recommendations: GmroiRecommendation[];
  methodology: GmroiMethodology;
  narrative: string;
}

export interface CashFlowProjection {
  date: string;
  cumulative: number;
  cash_in: number;
  cash_out: number;
}

export interface CashFlowCriticalDate {
  date: string;
  days_from_today: number;
  shortage: number;
}

export interface CashFlowMethodology {
  incoming_cash: string;
  outgoing_cash: string;
  safety_margin: string;
  confidence_level: string;
}

export interface CashFlowRecommendation {
  priority: 'urgent' | 'high' | 'medium' | 'low';
  action: string;
  rationale: string;
  estimated_impact: number;
}

export interface CashFlowSummary {
  total_cash_in: number;
  total_cash_out: number;
  net_cash_flow: number;
  final_position: number;
  horizon_days: number;
  avg_confidence: number;
  forecast_method: string;
}

export interface CashFlowForecastResponse {
  summary: CashFlowSummary;
  daily_projections: CashFlowProjection[];
  critical_dates: CashFlowCriticalDate[];
  recommendations: CashFlowRecommendation[];
  narrative: string;
  methodology: CashFlowMethodology;
}

export interface ScenarioImpact {
  new_ccc: number;
  ccc_improvement: number;
  cash_freed: number;
}

export interface WorkingCapitalScenario {
  name: string;
  description: string;
  impact: ScenarioImpact;
  risk_level: 'low' | 'medium' | 'high';
  implementation_difficulty: 'easy' | 'moderate' | 'hard';
  parameters: {
    new_dio: number;
    new_dso: number;
    new_dpo: number;
  };
  risk_factors: string[];
  implementation_steps: string[];
}

export interface WorkingCapitalRecommendation {
  priority: 'high' | 'medium' | 'low';
  area: 'inventory' | 'receivables' | 'payables' | 'general';
  action: string;
  rationale: string;
  estimated_impact: number;
  timeframe: string;
}

export interface WorkingCapitalMethodology {
  dio_formula: string;
  dso_formula: string;
  dpo_formula: string;
  ccc_formula: string;
  interpretation: string;
  note?: string;
}

export interface WorkingCapitalCurrentState {
  dio: number;
  dso: number;
  dpo: number;
  ccc: number;
  avg_inventory_value: number;
  cash_tied_up: number;
  data_quality?: 'estimated' | 'actual' | 'projected';
}

export interface WorkingCapitalResponse {
  current_state: WorkingCapitalCurrentState;
  scenarios: WorkingCapitalScenario[];
  recommendations: WorkingCapitalRecommendation[];
  narrative: string;
  methodology: WorkingCapitalMethodology;
}

export interface MonthlyReportRisk {
  type: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  recommendation: string;
}

export interface MonthlyReportOpportunity {
  description: string;
  potentialImpact: number;
  recommendation: string;
}

export interface MonthlyReportData {
  reportPeriod: {
    start: string;
    end: string;
  };
  executiveSummary: {
    totalRevenue: number;
    grossProfit: number;
    profitMargin: number;
  };
  narrative: string;
  risks: MonthlyReportRisk[];
  opportunities: MonthlyReportOpportunity[];
}

export interface MonthlyReportResponse {
  data: MonthlyReportData;
}

export interface BudgetOverview {
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  status: 'under' | 'over';
}

export interface BudgetCategoryRow {
  category: string;
  status: 'favorable' | 'unfavorable';
  budget: number;
  actual: number;
  variancePercent: number;
}

export interface BudgetRecommendation {
  priority: 'high' | 'medium' | 'low';
  category: string;
  action: string;
  issue: string;
  rationale: string;
  estimatedImpact: number;
}

export interface BudgetAnalysisResponse {
  data: {
    period: { start: string; end: string };
    overview: BudgetOverview;
    byCategory: BudgetCategoryRow[];
    recommendations: BudgetRecommendation[];
    narrative: string;
  };
}

export interface FinanzasApiResponse {
  kpis?: SalesKpi[];
  charts?: {
    revenueTrend?: { data: RevenueChartEntry[]; config?: Record<string, unknown> };
    costBreakdown?: { data: ExpenseBreakdownEntry[]; config?: Record<string, unknown> };
    cashFlow?: { data: CashFlowEntry[]; config?: Record<string, unknown> };
  };
  alerts?: FinancialAlert[];
  maxDataDate?: string;
}

export interface FinanzasCompareApiResponse {
  periodA: { data: FinanzasApiResponse };
  periodB: { data: FinanzasApiResponse };
}

export interface FinanzasDashboardData {
  metrics: {
    totalRevenue: number;
    totalCosts: number;
    grossProfit: number;
    inventoryValue: number;
    cashFlow: number;
    workingCapital: number;
  };
  revenueChart: RevenueChartEntry[];
  expenseBreakdown: ExpenseBreakdownEntry[];
  cashFlowChart: CashFlowEntry[];
  inventoryTurnover: {
    current: number;
    previous: number;
    trend: 'up' | 'down' | 'stable';
  };
  financialAlerts: Array<{
    id: string;
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

class FinanzasService {
  async getDashboardData(params?: ParametrosConsultaTemporal): Promise<FinanzasDashboardData> {
    try {
      // âœ… FIXED: Use the unified dashboard endpoint
      const queryParams = new URLSearchParams();
      queryParams.append('role', 'Financiero'); // Use the role from the dashboard
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);

      const response = await apiClient.request('GET', `/api/v1/bi/dashboards?${queryParams}`);
      
      console.log('=== FINANZAS API RESPONSE ===');
      console.log(JSON.stringify(response, null, 2));
      
      const { data } = response;

      // Handle compare mode
      if (params?.modo === 'comparar' && data.periodA && data.periodB) {
        return this.transformCompareData(data);
      }

      // Transform backend response to match frontend expectations
      return this.transformData(data);
    } catch (error: unknown) {
      console.error('Failed to fetch finanzas dashboard:', error);
      throw new Error(resolveErrorMessage(error, 'Error al cargar el panel de finanzas'));
    }
  }

  async generateMonthlyReport(startDate?: string, endDate?: string): Promise<MonthlyReportResponse> {
    try {
      const response = await apiClient.request('POST', '/api/v1/bi/finanzas/monthly-report', {
        startDate: startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0],
        endDate: endDate || new Date().toISOString().split('T')[0]
      });
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al generar reporte mensual'));
    }
  }

  async getBudgetAnalysis(params?: ParametrosConsultaTemporal): Promise<BudgetAnalysisResponse> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('startDate', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('endDate', params.fechaFin);

      const response = await apiClient.request('GET', `/api/v1/bi/finanzas/budget-analysis?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener análisis de presupuesto'));
    }
  }

  async getCostBreakdown(params?: ParametrosConsultaTemporal & { category?: string }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.category) queryParams.append('category', params.category);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      
      const response = await apiClient.request('GET', `/api/v1/finanzas/costs?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener desglose de costos'));
    }
  }

  async getInventoryValuation(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/finanzas/inventory-valuation?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener valuación de inventario'));
    }
  }

  async getKPIs(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);
      
      const response = await apiClient.request('GET', `/api/v1/finanzas/kpis?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener KPIs financieros'));
    }
  }

  async exportFinancialData(format: 'csv' | 'excel' | 'pdf', params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/finanzas/export?${queryParams}`, null, {
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `datos-financieros.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      return { success: true };
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al exportar datos financieros'));
    }
  }

  async getGMROIMatrix(startDate?: Date, endDate?: Date): Promise<GmroiResponse> {
    try {
      const params = new URLSearchParams();
      
      if (startDate) {
        params.append('fechaInicio', startDate.toISOString());
      }
      if (endDate) {
        params.append('fechaFin', endDate.toISOString());
      }

      const response = await apiClient.request(
        'GET',
        `/api/v1/bi/finanzas/gmroi-matrix?${params.toString()}`,
        null
      );

      return response.data;
    } catch (error: unknown) {
      console.error('[FinanzasService] getGMROIMatrix error:', error);
      throw new Error(
        resolveErrorMessage(error, 'Error al obtener matriz GMROI')
      );
    }
  }

  async getCashFlowForecast(
    startDate?: Date, 
    endDate?: Date,
    horizonDays: number = 90,
    startingCash: number = 0
  ): Promise<CashFlowForecastResponse> {
    try {
      const params = new URLSearchParams();
      
      if (startDate) {
        params.append('fechaInicio', startDate.toISOString());
      }
      if (endDate) {
        params.append('fechaFin', endDate.toISOString());
      }
      params.append('horizonDays', horizonDays.toString());
      params.append('startingCash', startingCash.toString());

      const response = await apiClient.request(
        'GET',
        `/api/v1/bi/finanzas/cash-flow-forecast?${params.toString()}`,
        null
      );

      return response.data;
    } catch (error: unknown) {
      console.error('[FinanzasService] getCashFlowForecast error:', error);
      throw new Error(
        resolveErrorMessage(error, 'Error al obtener pronóstico de flujo de efectivo')
      );
    }
  }

  async getWorkingCapitalOptimization(startDate?: Date, endDate?: Date): Promise<WorkingCapitalResponse> {
    try {
      const params = new URLSearchParams();
      
      if (startDate) {
        params.append('fechaInicio', startDate.toISOString());
      }
      if (endDate) {
        params.append('fechaFin', endDate.toISOString());
      }

      const response = await apiClient.request(
        'GET',
        `/api/v1/bi/finanzas/working-capital-optimization?${params.toString()}`,
        null
      );

      return response.data;
    } catch (error: unknown) {
      console.error('[FinanzasService] getWorkingCapitalOptimization error:', error);
      throw new Error(
        resolveErrorMessage(error, 'Error al obtener optimización de capital de trabajo')
      );
    }
  }

  // Helper methods
  private transformData(data: FinanzasApiResponse): FinanzasDashboardData {
    // âœ… FIXED: Extract from unified dashboard API (like Ventas/Gerencia)
    console.log('=== TRANSFORMING DATA ===');
    console.log('data.kpis:', data.kpis);
    console.log('data.charts:', data.charts);

    // Extract metrics from KPIs using the unified dashboard structure
    const metrics = {
      totalRevenue: this.extractKpiValue(data.kpis, 'monthly-revenue', 0),
      totalCosts: 0,
      grossProfit: 0,
      inventoryValue: this.extractKpiValue(data.kpis, 'inventory-value', 0),
      cashFlow: 0,
      workingCapital: this.extractKpiValue(data.kpis, 'working-capital', 0),
    };

    // Calculate derived metrics
    const grossMarginPercent = this.extractKpiValue(data.kpis, 'gross-margin', 0);
    if (metrics.totalRevenue > 0 && grossMarginPercent > 0) {
      metrics.grossProfit = metrics.totalRevenue * (grossMarginPercent / 100);
      metrics.totalCosts = metrics.totalRevenue - metrics.grossProfit;
    }

    console.log('=== CALCULATED METRICS ===');
    console.log('metrics:', metrics);

    // Extract charts data from the dashboard response
    const revenueChart = data.charts?.revenueTrend?.data || [];
    const expenseBreakdown = data.charts?.costBreakdown?.data || [];
    const cashFlowChart = data.charts?.cashFlow?.data || [];

    // Extract inventory turnover
    const inventoryTurnoverValue = this.extractKpiValue(data.kpis, 'inventory-turnover', 0);
    const inventoryTurnover = {
      current: inventoryTurnoverValue,
      previous: 0, // Would need historical data
      trend: 'stable' as const,
    };

    // Transform alerts
    const financialAlerts = (data.alerts || []).map((alert: FinancialAlert) => ({
      id: alert.id,
      type: alert.type,
      message: alert.message,
      severity: this.mapSeverity(alert.severity),
    }));

    return {
      metrics,
      revenueChart,
      expenseBreakdown,
      cashFlowChart,
      inventoryTurnover,
      financialAlerts,
    };
  }

  private transformCompareData(data: FinanzasCompareApiResponse): FinanzasDashboardData {
    const periodA = data.periodA.data;
    const periodB = data.periodB.data;
    
    const metrics = {
      totalRevenue: this.extractKpiValue(periodA.kpis, 'monthly-revenue', 0),
      totalCosts: 0,
      grossProfit: 0,
      inventoryValue: this.extractKpiValue(periodA.kpis, 'inventory-value', 0),
      cashFlow: 0,
      workingCapital: this.extractKpiValue(periodA.kpis, 'working-capital', 0),
    };

    const grossMarginPercent = this.extractKpiValue(periodA.kpis, 'gross-margin', 0);
    if (metrics.totalRevenue > 0 && grossMarginPercent > 0) {
      metrics.grossProfit = metrics.totalRevenue * (grossMarginPercent / 100);
      metrics.totalCosts = metrics.totalRevenue - metrics.grossProfit;
    }

    return {
      metrics,
      revenueChart: periodA.charts?.revenueTrend?.data || [],
      expenseBreakdown: periodA.charts?.costBreakdown?.data || [],
      cashFlowChart: periodA.charts?.cashFlow?.data || [],
      inventoryTurnover: {
        current: this.extractKpiValue(periodA.kpis, 'inventory-turnover', 0),
        previous: this.extractKpiValue(periodB.kpis, 'inventory-turnover', 0),
        trend: this.calculateTrend(
          this.extractKpiValue(periodA.kpis, 'inventory-turnover', 0),
          this.extractKpiValue(periodB.kpis, 'inventory-turnover', 0)
        ),
      },
      financialAlerts: periodA.alerts || [],
    };
  }

  private extractKpiValue(kpis: SalesKpi[] = [], key: string, defaultValue: number): number {
    // Normalize key: convert to lowercase and replace underscores/dashes
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    
    const kpi = kpis?.find(k => {
      const kpiKey = (k.id || k.key || k.metric || k.name || '').toLowerCase().replace(/[-_]/g, '');
      return kpiKey === normalizedKey;
    });
    
    return kpi?.value ?? kpi?.current ?? defaultValue;
  }

  private calculateTrend(current: number, previous: number): 'up' | 'down' | 'stable' {
    if (current > previous * 1.05) return 'up';
    if (current < previous * 0.95) return 'down';
    return 'stable';
  }

  private mapSeverity(severity: string): 'low' | 'medium' | 'high' {
    const map: { [key: string]: 'low' | 'medium' | 'high' } = {
      'info': 'low',
      'warning': 'medium',
      'critical': 'high',
      'error': 'high',
    };
    return map[severity] || 'medium';
  }
}

export const finanzasService = new FinanzasService();
export default finanzasService;