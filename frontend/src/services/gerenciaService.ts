// frontend/src/services/gerenciaService.ts
import apiClient from './api-client';

// Helper function to extract error message safely
function getErrorMessage(error: unknown, defaultMessage: string): string {
  if (error instanceof Error) {
    if ('response' in error && error.response && typeof error.response === 'object' && 'data' in error.response) {
      const responseData = (error.response as { data?: { message?: string } }).data;
      if (responseData && typeof responseData.message === 'string') {
        return responseData.message;
      }
    }
    return error.message || defaultMessage;
  }
  return defaultMessage;
}
import { ParametrosConsultaTemporal } from '@/types/navegacion-temporal';

export interface GerenciaDashboardData {
  executiveMetrics: {
    perfectOrderRate: number;
    cashConversionCycle: number;
    inventoryVsSales: number;
    aiValueAdd: number;
    totalRevenue: number;
    customerSatisfaction: number;
  };
  performanceIndicators: {
    salesGrowth: number;
    inventoryTurnover: number;
    stockoutRate: number;
    overstockRate: number;
    supplierPerformance: number;
    orderFulfillment: number;
  };
  businessHealth: Array<{
    area: string;
    status: 'optimal' | 'warning' | 'critical';
    score: number;
    trend: 'up' | 'down' | 'stable';
    action?: string;
  }>;
  aiInsights: Array<{
    id: string;
    insight: string;
    impact: string;
    recommendation: string;
    confidence: number;
    category: string;
  }>;
  departmentPerformance: Array<{
    department: string;
    kpi: string;
    actual: number;
    target: number;
    variance: number;
  }>;
  strategicAlerts: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
    timestamp: string;
  }>;
  charts?: any;
}

export interface StrategicReportResponse {
  reportDate: string;
  period: {
    start: string;
    end: string;
  };
  level0Widgets: Array<{
    name: string;
    value: string | number;
    trend: string;
    delta: string;
    drilldownPath?: string;
    available: boolean;
    reason?: string;
  }>;
  aiNarrative: string;
  criticalAlerts: Array<{
    severity: 'high' | 'medium' | 'low';
    title: string;
    message: string;
  }>;
}

export interface WhatIfRequest {
  variable_type: 'DEMAND_CHANGE' | 'LEAD_TIME_CHANGE' | 'COST_CHANGE' | 'PRICE_CHANGE';
  change_value: number;
  scope: {
    time_horizon: string;
    product_category_id?: string[];
    product_id?: number[];
    supplier_id?: string[];
  };
}

export interface WhatIfResponse {
  scenario_name: string;
  variable_changed: string;
  change_description: string;
  projected_impacts: Array<{
    kpi_name: string;
    base_value: string;
    projected_value: string;
    delta: string;
    impact_severity: 'positive' | 'negative' | 'neutral';
  }>;
  ai_narrative: string;
  constraints_violated: string[];
  recommendations: string[];
}

export interface ScenarioParameter {
  variable_type: 'DEMAND_CHANGE' | 'LEAD_TIME_CHANGE' | 'COST_CHANGE' | 'PRICE_CHANGE';
  change_value: number;
  scope: {
    time_horizon: string;
    product_category_id?: string[];
    product_id?: number[];
    supplier_id?: string[];
  };
}

export interface ScenarioRequest {
  scenario_id?: number;
  scenario_name?: string;
  description?: string;
  parameters: ScenarioParameter[];
  save_scenario?: boolean;
}

export interface ScenarioResponse {
  scenario_id?: number;
  scenario_name: string;
  description: string;
  execution_timestamp: string;
  projected_impacts: Array<{
    kpi_name: string;
    base_value: string;
    projected_value: string;
    delta: string;
    impact_severity: 'positive' | 'negative' | 'neutral';
  }>;
  combined_effects: {
    revenue_impact: string;
    operational_impact: string;
    financial_impact: string;
  };
  ai_narrative: string;
  risk_assessment: {
    overall_risk: 'low' | 'medium' | 'high';
    key_risks: string[];
  };
  strategic_recommendations: string[];
}

export interface PredefinedScenario {
  id: string;
  name: string;
  description: string;
  parameter_count: number;
}

class GerenciaService {
  async getDashboardData(params?: ParametrosConsultaTemporal): Promise<GerenciaDashboardData> {
    console.log('Getting dashboard data...');
    try {
      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.append('role', 'Gerencia');
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);

      const response = await apiClient.request('GET', `/api/v1/bi/dashboards?${queryParams}`);
      console.log('API response:', response);
      const { data } = response;

      // Handle compare mode
      if (params?.modo === 'comparar' && data.periodA && data.periodB) {
        return this.transformCompareData(data);
      }

      // Transform backend response to match frontend expectations
      return this.transformData(data);
    } catch (error: any) {
      console.error('Failed to fetch gerencia dashboard:', error);
      throw new Error(error.response?.data?.message || 'Error al cargar el panel ejecutivo');
    }
  }

  /**
   * Generate strategic report using new handler
   * POST /api/v1/bi/gerencia/strategic-reports
   */
  async generateStrategicReport(params?: {
    startDate?: string;
    endDate?: string;
    includeNarrative?: boolean;
  }): Promise<StrategicReportResponse> {
    try {
      const response = await apiClient.request(
        'POST', 
        '/api/v1/bi/gerencia/strategic-reports',
        {
          startDate: params?.startDate,
          endDate: params?.endDate,
          includeNarrative: params?.includeNarrative ?? true
        }
      );
      
      return response.data || response;
    } catch (error: any) {
      console.error('Failed to generate strategic report:', error);
      throw new Error(error.response?.data?.message || 'Error al generar reporte estratégico');
    }
  }

  /**
   * Run What-If analysis using new handler
   * POST /api/v1/bi/gerencia/what-if-analyses
   */
  async runWhatIfAnalysis(request: WhatIfRequest): Promise<WhatIfResponse> {
    try {
      // Validate request
      if (!request.variable_type || request.change_value === undefined) {
        throw new Error('Se requieren variable_type y change_value');
      }

      if (!request.scope?.time_horizon) {
        throw new Error('Se requiere time_horizon en scope');
      }

      const response = await apiClient.request(
        'POST',
        '/api/v1/bi/gerencia/what-if-analyses',
        request
      );

      return response.data || response;
    } catch (error: any) {
      console.error('Failed to run what-if analysis:', error);
      throw new Error(error.response?.data?.message || 'Error al ejecutar análisis simplificado');
    }
  }

  /**
   * Simulate complex scenario using new handler
   * POST /api/v1/bi/gerencia/scenarios
   */
  async simulateScenario(request: ScenarioRequest): Promise<ScenarioResponse> {
    try {
      // Validate request
      if (!request.scenario_id && !request.scenario_name && (!request.parameters || request.parameters.length === 0)) {
        throw new Error('Se requiere scenario_id, scenario_name, o parameters');
      }

      const response = await apiClient.request(
        'POST',
        '/api/v1/bi/gerencia/scenarios',
        request
      );

      return response.data || response;
    } catch (error: any) {
      console.error('Failed to simulate scenario:', error);
      throw new Error(error.response?.data?.message || 'Error al simular escenario');
    }
  }

  /**
   * List predefined scenarios
   * GET /api/v1/bi/gerencia/scenarios/predefined
   */
  async listPredefinedScenarios(): Promise<{ scenarios: PredefinedScenario[] }> {
    try {
      const response = await apiClient.request(
        'GET',
        '/api/v1/bi/gerencia/scenarios/predefined'
      );

      return response.data || response;
    } catch (error: any) {
      console.error('Failed to list predefined scenarios:', error);
      throw new Error(error.response?.data?.message || 'Error al listar escenarios predefinidos');
    }
  }

  /**
   * Quick access: Run predefined scenario by name
   */
  async runPredefinedScenario(
    scenarioName: 'RECESSION' | 'SUPPLY_SHOCK' | 'DEMAND_BOOM',
    saveScenario: boolean = false
  ): Promise<ScenarioResponse> {
    return this.simulateScenario({
      scenario_name: scenarioName,
      parameters: [], // Predefined scenarios don't need parameters
      save_scenario: saveScenario
    });
  }

  /**
   * Quick Simplificado: Demand change
   */
  async whatIfDemandChange(
    changePercent: number,
    timeHorizon: string,
    categoryIds?: string[]
  ): Promise<WhatIfResponse> {
    return this.runWhatIfAnalysis({
      variable_type: 'DEMAND_CHANGE',
      change_value: changePercent / 100, // Convert percentage to decimal
      scope: {
        time_horizon: timeHorizon,
        product_category_id: categoryIds
      }
    });
  }

  /**
   * Quick Simplificado: Price change
   */
  async whatIfPriceChange(
    changePercent: number,
    timeHorizon: string,
    productIds?: number[]
  ): Promise<WhatIfResponse> {
    return this.runWhatIfAnalysis({
      variable_type: 'PRICE_CHANGE',
      change_value: changePercent / 100,
      scope: {
        time_horizon: timeHorizon,
        product_id: productIds
      }
    });
  }

  /**
   * Quick Simplificado: Lead time change
   */
  async whatIfLeadTimeChange(
    additionalDays: number,
    timeHorizon: string,
    supplierIds?: string[]
  ): Promise<WhatIfResponse> {
    return this.runWhatIfAnalysis({
      variable_type: 'LEAD_TIME_CHANGE',
      change_value: additionalDays,
      scope: {
        time_horizon: timeHorizon,
        supplier_id: supplierIds
      }
    });
  }

  /**
   * Quick Simplificado: Cost change
   */
  async whatIfCostChange(
    changePercent: number,
    timeHorizon: string,
    productIds?: number[]
  ): Promise<WhatIfResponse> {
    return this.runWhatIfAnalysis({
      variable_type: 'COST_CHANGE',
      change_value: changePercent / 100,
      scope: {
        time_horizon: timeHorizon,
        product_id: productIds
      }
    });
  }

  // ===== LEGACY METHODS (kept for backward compatibility) =====

  async getStrategicReport(period: string = 'monthly', params?: ParametrosConsultaTemporal) {
    console.warn('getStrategicReport is deprecated. Use generateStrategicReport instead.');
    
    // Convert old params to new format
    const startDate = params?.fechaInicio;
    const endDate = params?.fechaFin;
    
    return this.generateStrategicReport({ startDate, endDate });
  }

  async getDrillDown(metric: string, params?: ParametrosConsultaTemporal & { [key: string]: any }) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('metric', metric);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);
      
      // Add any additional params
      Object.entries(params || {}).forEach(([key, value]) => {
        if (!['fechaInicio', 'fechaFin', 'granularidad', 'modo', 'fechaInicioComparacion', 'fechaFinComparacion'].includes(key)) {
          queryParams.append(key, String(value));
        }
      });
      
      const response = await apiClient.request('GET', `/api/v1/gerencia/drill-down?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener datos detallados'));
    }
  }

  async getWhatIfAnalysis(scenario: any & { params?: ParametrosConsultaTemporal }) {
    console.warn('getWhatIfAnalysis is deprecated. Use runWhatIfAnalysis instead.');
    
    const { params, ...scenarioData } = scenario;
    
    // Try to convert old format to new format
    // This is best-effort conversion
    return this.runWhatIfAnalysis({
      variable_type: scenarioData.variable_type || 'DEMAND_CHANGE',
      change_value: scenarioData.change_value || 0,
      scope: {
        time_horizon: scenarioData.time_horizon || params?.fechaInicio || 'Q1-2024',
        product_category_id: scenarioData.product_category_id,
        product_id: scenarioData.product_id,
        supplier_id: scenarioData.supplier_id
      }
    });
  }

  async exportExecutiveReport(format: 'pdf' | 'pptx', params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/gerencia/export?${queryParams}`, null, {});
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reporte-ejecutivo.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      return { success: true };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al exportar reporte ejecutivo'));
    }
  }

  // ===== HELPER METHODS =====

  private transformData(data: any): GerenciaDashboardData {
    const executiveMetrics = {
      perfectOrderRate: 0,
      cashConversionCycle: this.extractKpiValue(data.kpis, 'working-capital', 0),
      inventoryVsSales: 0,
      aiValueAdd: this.extractKpiValue(data.kpis, 'ai-value-add', 0),
      totalRevenue: this.extractKpiValue(data.kpis, 'monthly-revenue', 0),
      customerSatisfaction: 0,
    };

    const performanceIndicators = {
      salesGrowth: 0,
      inventoryTurnover: 0,
      stockoutRate: 0,
      overstockRate: 0,
      supplierPerformance: 0,
      orderFulfillment: 0,
    };

    const businessHealth = data.charts?.businessHealth || [];
    const departmentPerformance = data.charts?.departmentPerformance || [];
    const aiInsights = data.charts?.aiInsights || [];

    const strategicAlerts = (data.alerts || []).map((alert: any) => ({
      id: alert.id || String(Date.now() + Math.random()),
      type: alert.type || 'strategic',
      title: alert.title || 'Alerta Estratégica',
      description: alert.message || alert.text,
      priority: this.mapPriority(alert.severity),
      timestamp: alert.timestamp || new Date().toISOString(),
    }));

    console.log('=== TRANSFORMED DATA ===');
    console.log('executiveMetrics:', executiveMetrics);
    console.log('businessHealth:', businessHealth);
    console.log('aiInsights:', aiInsights);
    console.log('departmentPerformance:', departmentPerformance);

    return {
      executiveMetrics,
      performanceIndicators,
      businessHealth,
      aiInsights,
      departmentPerformance,
      strategicAlerts,
      charts: data.charts,
    };
  }

  private transformCompareData(data: any): GerenciaDashboardData {
    const periodA = data.periodA.data;
    const periodB = data.periodB.data;
    
    const executiveMetrics = {
      perfectOrderRate: 0,
      cashConversionCycle: this.extractKpiValue(periodA.kpis, 'working-capital', 0),
      inventoryVsSales: 0,
      aiValueAdd: this.extractKpiValue(periodA.kpis, 'ai-value-add', 0),
      totalRevenue: this.extractKpiValue(periodA.kpis, 'monthly-revenue', 0),
      customerSatisfaction: 0,
    };

    const totalRevenueA = this.extractKpiValue(periodA.kpis, 'monthly-revenue', 0);
    const totalRevenueB = this.extractKpiValue(periodB.kpis, 'monthly-revenue', 0);
    
    const performanceIndicators = {
      salesGrowth: totalRevenueB > 0 ? ((totalRevenueA - totalRevenueB) / totalRevenueB) * 100 : 0,
      inventoryTurnover: 0,
      stockoutRate: 0,
      overstockRate: 0,
      supplierPerformance: 0,
      orderFulfillment: 0,
    };

    const businessHealth = this.mergeBusinessHealth(
      periodA.charts?.businessHealth || [],
      periodB.charts?.businessHealth || []
    );

    return {
      executiveMetrics,
      performanceIndicators,
      businessHealth,
      aiInsights: periodA.charts?.aiInsights || [],
      departmentPerformance: periodA.charts?.departmentPerformance || [],
      strategicAlerts: periodA.alerts || [],
      charts: periodA.charts,
    };
  }

  private mergeBusinessHealth(dataA: any[], dataB: any[]): any[] {
    const healthMap = new Map();
    
    dataA.forEach(item => {
      healthMap.set(item.area, {
        ...item,
        previousScore: null,
        previousStatus: null
      });
    });
    
    dataB.forEach(item => {
      if (healthMap.has(item.area)) {
        const existing = healthMap.get(item.area);
        existing.previousScore = item.score;
        existing.previousStatus = item.status;
        existing.trend = existing.score > item.score ? 'up' : 
                        existing.score < item.score ? 'down' : 'stable';
      }
    });
    
    return Array.from(healthMap.values());
  }

  private extractKpiValue(kpis: any[], key: string, defaultValue: any): any {
    const normalizedKey = key.toLowerCase().replace(/_/g, '-');
    
    const kpi = kpis?.find(k => {
      const kpiId = (k.id || k.key || k.metric || k.name || '').toLowerCase().replace(/_/g, '-');
      return kpiId === normalizedKey;
    });
    
    return kpi?.value ?? kpi?.current ?? defaultValue;
  }

  private mapPriority(severity: string): 'high' | 'medium' | 'low' {
    const priorityMap: { [key: string]: 'high' | 'medium' | 'low' } = {
      'critical': 'high',
      'high': 'high',
      'medium': 'medium',
      'low': 'low',
      'info': 'low',
    };
    return priorityMap[severity] || 'medium';
  }
}

export const gerenciaService = new GerenciaService();
export default gerenciaService;
