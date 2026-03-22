// frontend/src/services/ventasService.ts
import apiClient from './api-client';
import { ParametrosConsultaTemporal } from '@/types/navegacion-temporal';
import { anonymizeArray, isDemoMode } from '@/lib/anonymize';

export interface TopProduct {
  sku: string;
  product_name: string;
  category: string;
  total_quantity: number;
  total_revenue: number;
  unique_customers: number;
  avg_price: number;
  stock_level?: number;
  trend?: 'up' | 'down' | 'stable';
}

export interface TopCustomer {
  client_id: number;
  client_name?: string | null;
  total_orders: number;
  total_spent: number;
  avg_order_value: number;
  last_purchase?: string;
}

export interface SalesTrendEntry {
  date: string;
  revenue: number;
  orders: number;
  unique_customers: number;
}

export interface AlertItem {
  id?: string;
  type?: string;
  message?: string;
  severity?: 'info' | 'warning' | 'error';
  timestamp?: string;
}

export interface SalesKpi {
  id?: string;
  key?: string;
  metric?: string;
  value?: number;
  current?: number;
  target?: number;
}

export interface SalesForecastCharts {
  historical: Array<{
    date: string;
    actual: number;
    target?: number;
  }>;
  forecast: Array<{
    date: string;
    predicted: number;
    lower_bound_80: number;
    upper_bound_80: number;
    lower_bound_95: number;
    upper_bound_95: number;
  }>;
  today: string;
  accuracy: {
    wmape: number;
    mape: number;
    last_30_days: number;
  };
}

export interface SalesChartEntry {
  date: string;
  actual: number;
  target?: number;
  forecast?: number;
}

export interface VentasCharts {
  topProducts?: {
    type: string;
    data: TopProduct[];
    config?: Record<string, unknown>;
  };
  topCustomers?: {
    type: string;
    data: TopCustomer[];
    config?: Record<string, unknown>;
  };
  salesTrend?: {
    type: string;
    data: SalesTrendEntry[];
    config?: Record<string, unknown>;
  };
  sales?: SalesChartEntry[];
  velocity?: Record<string, unknown>;
  category?: Record<string, unknown>;
  salesForecast?: SalesForecastCharts;
  productPerformance?: Array<{
    product: string;
    sku: string;
    unitsSold: number;
    revenue: number;
    stockLevel: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  stockOutRisks?: Array<{
    product: string;
    sku: string;
    currentStock: number;
    daysUntilStockout: number;
    projectedLostSales: number;
    urgency: 'low' | 'medium' | 'high' | 'critical';
  }>;
  overstockOpportunities?: Array<{
    product: string;
    sku: string;
    excessStock: number;
    value: number;
    suggestedDiscount: number;
    daysOfSupply?: number;
  }>;
}

export interface VentasApiResponse {
  kpis?: SalesKpi[];
  charts?: VentasCharts;
  alerts?: AlertItem[];
  maxDataDate?: string;
}

export interface VentasCompareApiResponse {
  periodA: { data: VentasApiResponse };
  periodB: { data: VentasApiResponse };
}

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

export interface VentasDashboardData {
  salesMetrics: {
    totalRevenue: number;
    revenueTarget: number;
    percentageAchieved: number;
    totalOrders: number;
    avgOrderValue: number;
    growthRate: number;
  };
  salesChart: Array<{
    date: string;
    actual: number;
    target: number;
    forecast: number;
  }>;
  productPerformance: Array<{
    product: string;
    sku: string;
    unitsSold: number;
    revenue: number;
    stockLevel: number;
    trend: 'up' | 'down' | 'stable';
  }>;
  stockOutRisks: Array<{
    product: string;
    sku: string;
    currentStock: number;
    daysUntilStockout: number;
    projectedLostSales: number;
    urgency: 'low' | 'medium' | 'high' | 'critical';
  }>;
  overstockOpportunities: Array<{
    product: string;
    sku: string;
    excessStock: number;
    value: number;
    suggestedDiscount: number;
    daysOfSupply: number;
  }>;
  customerInsights: {
    topCustomers: TopCustomer[];
    newCustomers: number;
    repeatRate: number;
    avgCustomerValue: number;
  };
  alerts: AlertItem[];
  maxDataDate?: string;
  charts?: VentasCharts;
}
export interface ProductForecastMethodology {
  description: string;
  formula: string;
  confidence_calculation: string;
}

export interface ProductForecastSummary {
  total_products: number;
  products_at_risk: number;
  avg_confidence: number;
}

export interface ProductForecastAccuracy {
  wmape: number;
  mape: number;
  last_30_days: number;
}

export type ProductForecastTrendDirection = 'increasing' | 'decreasing' | 'stable';

export interface ProductForecastRow {
  sku: string;
  product_name: string;
  current_stock: number;
  forecast_30d: number;
  days_until_stockout: number;
  confidence_score: number;
  trend_direction: ProductForecastTrendDirection;
  trend_change_pct: number;
}

export interface ProductForecastResponse {
  methodology: ProductForecastMethodology;
  summary: ProductForecastSummary;
  accuracy: ProductForecastAccuracy;
  narrative: string;
  forecasts: ProductForecastRow[];
}

export interface RFMMethodology {
  description: string;
  scoring: string;
  date_range: string;
}

export interface RFMCustomerSegment {
  segment: string;
  count: number;
  revenue: number;
  percentage: number;
}

export interface RFMSummary {
  total_customers: number;
  champions_count: number;
  at_risk_count: number;
  value_at_risk: number;
  segments: RFMCustomerSegment[];
}

export interface RFMCustomer {
  client_id: string;
  client_name?: string | null;
  segment: string;
  monetary_value: number;
  frequency: number;
  recency_days: number;
  r_score: number;
  f_score: number;
  m_score: number;
  recommended_action: string;
}

export interface RFMResponse {
  methodology: RFMMethodology;
  summary: RFMSummary;
  narrative: string;
  customers: RFMCustomer[];
}

export interface CrossSellMethodology {
  description: string;
  metrics: {
    lift: number;
    confidence: number;
  };
}

export interface CrossSellSummary {
  total_opportunities: number;
  strong_opportunities: number;
  total_estimated_uplift: number;
  avg_lift: number;
}

export interface CrossSellOpportunity {
  product_a_name: string;
  product_a_sku: string;
  product_b_name: string;
  product_b_sku: string;
  lift: number;
  confidence_a_to_b: number;
  co_purchase_count: number;
  suggested_bundle_price: number;
  estimated_bundle_uplift: number;
  recommendation_strength: 'Muy Fuerte' | 'Fuerte' | string;
  recommended_action: string;
}

export interface CrossSellResponse {
  methodology: CrossSellMethodology;
  summary: CrossSellSummary;
  narrative: string;
  opportunities: CrossSellOpportunity[];
}

class VentasService {
  async getDashboardData(params?: ParametrosConsultaTemporal): Promise<VentasDashboardData> {
    try {
      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.append('role', 'Ventas');
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);

      const response = await apiClient.request('GET', `/api/v1/bi/dashboards?${queryParams}`);
      const { data } = response;

      // Handle compare mode
      if (params?.modo === 'comparar' && data.periodA && data.periodB) {
        return this.transformCompareData(data);
      }

      // Transform backend response to match frontend expectations
      return this.transformData(data);
    } catch (error: unknown) {
      const message = getErrorMessage(error, 'Error al cargar el panel de ventas');
      console.error('Failed to fetch ventas dashboard:', message);
      throw new Error(message);
    }
  }

  async getSalesOrders(params?: ParametrosConsultaTemporal & {
    status?: string;
    customerId?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.customerId) queryParams.append('customerId', params.customerId);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/ventas/orders?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener órdenes de venta'));
    }
  }

  async getSalesForecast(params?: ParametrosConsultaTemporal & {
    period?: string;
    productId?: string;
    confidence?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.period) queryParams.append('period', params.period);
      if (params?.productId) queryParams.append('productId', params.productId);
      if (params?.confidence) queryParams.append('confidence', params.confidence.toString());
      
      const response = await apiClient.request('GET', `/api/v1/ventas/forecast?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener pronóstico de ventas'));
    }
  }

  async getProductAnalytics(productId: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);
      
      const response = await apiClient.request('GET', `/api/v1/ventas/products/${productId}/analytics?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener análisis del producto'));
    }
  }

  async getCustomerAnalytics(customerId?: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      
      const endpoint = customerId 
        ? `/api/v1/ventas/customers/${customerId}/analytics?${queryParams}`
        : `/api/v1/ventas/customers/analytics?${queryParams}`;
      
      const response = await apiClient.request('GET', endpoint);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener análisis de clientes'));
    }
  }

  async getStockAlerts(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/ventas/stock-alerts?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener alertas de stock'));
    }
  }

  async createPromotionalCampaign(campaignData: {
    products: string[];
    discountPercentage: number;
    startDate: string;
    endDate: string;
    targetCustomers?: string[];
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/ventas/campaigns', campaignData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al crear campaña promocional'));
    }
  }

  async getSalesReport(params: ParametrosConsultaTemporal & {
    groupBy?: 'day' | 'week' | 'month';
    includeForecasts?: boolean;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.groupBy) queryParams.append('groupBy', params.groupBy);
      if (params?.includeForecasts !== undefined) queryParams.append('includeForecasts', params.includeForecasts.toString());
      
      const response = await apiClient.request('GET', `/api/v1/ventas/reports?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al generar reporte de ventas'));
    }
  }

  async exportSalesData(format: 'csv' | 'excel' | 'pdf', params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/ventas/export?${queryParams}`, null, {
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `datos-ventas.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      return { success: true };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al exportar datos de ventas'));
    }
  }

  async getProductForecasts(params?: ParametrosConsultaTemporal & {
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/bi/ventas/product-forecasts?${queryParams}`);
      return response.data as ProductForecastResponse;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener pronósticos de productos'));
    }
  }

  async getRFMAnalysis(params?: ParametrosConsultaTemporal & {
    lookbackDays?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.lookbackDays) queryParams.append('lookbackDays', params.lookbackDays.toString());
      
      const response = await apiClient.request('GET', `/api/v1/bi/ventas/rfm-analysis?${queryParams}`);
      return response.data as RFMResponse;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener análisis RFM'));
    }
  }

  async getCrossSellOpportunities(params?: ParametrosConsultaTemporal & {
    minSupport?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.minSupport) queryParams.append('minSupport', params.minSupport.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/bi/ventas/cross-sell?${queryParams}`);
      return response.data as CrossSellResponse;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener oportunidades de venta cruzada'));
    }
  }

  // Helper methods
  private transformData(data: VentasApiResponse): VentasDashboardData {
    const demoMode = isDemoMode();
    
    // Extract sales metrics from KPIs - use correct KPI IDs
    const monthlyRevenueKpi = data.kpis?.find((k: SalesKpi) => k.id === 'monthly-revenue');
    const totalRevenue = monthlyRevenueKpi?.value || 0;
    const revenueTarget = monthlyRevenueKpi?.target || 0;
    
    const totalOrders = this.extractKpiValue(data.kpis, 'total-orders', 0);
    const avgOrderValue = this.extractKpiValue(data.kpis, 'avg-order-value', 0);
    const uniqueCustomers = this.extractKpiValue(data.kpis, 'unique-customers', 0);
    const repeatCustomers = this.extractKpiValue(data.kpis, 'repeat-customers', 0);
    
    const salesMetrics = {
      totalRevenue,
      revenueTarget,
      percentageAchieved: revenueTarget > 0 ? (totalRevenue / revenueTarget) * 100 : 0,
      totalOrders,
      avgOrderValue,
      growthRate: this.extractKpiValue(data.kpis, 'revenue-growth', 0),
    };
  
    // Transform and anonymize top customers
    const rawTopCustomers = (data.charts?.topCustomers?.data || []).map((c: TopCustomer) => ({
      client_id: typeof c.client_id === 'number' ? c.client_id : Number(c.client_id) || 0,
      client_name: c.client_name || null,
      total_spent: Number(c.total_spent) || 0,
      avg_order_value: Number(c.avg_order_value) || 0,
      total_orders: Number(c.total_orders) || 0,
      last_purchase: c.last_purchase
    }));
    
    // Note: client_name anonymization is handled in the UI layer
    const customerInsights = {
      topCustomers: rawTopCustomers,
      newCustomers: uniqueCustomers || 0,
      repeatRate: uniqueCustomers > 0 ? (repeatCustomers / uniqueCustomers) * 100 : 0,
      avgCustomerValue: (totalRevenue && uniqueCustomers) ? totalRevenue / uniqueCustomers : 0,
    };

    console.log('=== DEBUG topCustomers ===');
    console.log('data.charts?.topCustomers:', data.charts?.topCustomers);
    console.log('data.charts?.topCustomers?.data:', data.charts?.topCustomers?.data);
    console.log('customerInsights.topCustomers:', customerInsights.topCustomers);
    console.log('Is array?', Array.isArray(customerInsights.topCustomers));
    
    // Extract charts data and apply anonymization for products
    const salesChart = (data.charts?.sales || []).map((entry: SalesChartEntry) => ({
      date: entry.date,
      actual: entry.actual || 0,
      target: entry.target || 0,
      forecast: entry.forecast || 0
    }));
    const productPerformance = data.charts?.productPerformance || [];
    const stockOutRisks = data.charts?.stockOutRisks || [];
    const overstockOpportunities = (data.charts?.overstockOpportunities || []).map((item) => ({
      product: item.product || 'Unknown',
      sku: item.sku || 'Unknown',
      excessStock: item.excessStock || 0,
      value: item.value || 0,
      suggestedDiscount: item.suggestedDiscount || 0,
      daysOfSupply: item.daysOfSupply || 0
    }));
    
    // Apply anonymization to top products
    const anonymizedTopProducts = data.charts?.topProducts 
      ? {
          ...data.charts.topProducts,
          data: anonymizeArray(data.charts.topProducts.data || [], demoMode)
        }
      : undefined;

    // Transform alerts
    const alerts = (data.alerts || []).map((alert: AlertItem) => ({
      id: alert.id || String(Date.now() + Math.random()),
      type: alert.type || 'sales',
      message: alert.message || 'Alerta',
      severity: this.mapAlertSeverity(alert.severity || 'warning'),
      timestamp: alert.timestamp || new Date().toISOString(),
    }));

    return {
      salesMetrics,
      salesChart,
      productPerformance,
      stockOutRisks,
      overstockOpportunities,
      customerInsights,
      alerts,
      maxDataDate: data.maxDataDate,
      charts: {
        ...data.charts,
        topProducts: anonymizedTopProducts,
      },
    };
  }

  private transformCompareData(data: VentasCompareApiResponse): VentasDashboardData {
    const demoMode = isDemoMode();
    
    // For compare mode, show period A as current with comparison data
    const periodA = data.periodA.data;
    const periodB = data.periodB.data;
    
    const totalRevenueA = this.extractKpiValue(periodA.kpis, 'total_revenue', 0);
    const totalRevenueB = this.extractKpiValue(periodB.kpis, 'total_revenue', 0);
    const revenueTarget = this.extractKpiValue(periodA.kpis, 'revenue_target', 0);
    
    const salesMetrics = {
      totalRevenue: totalRevenueA,
      revenueTarget,
      percentageAchieved: revenueTarget > 0 ? (totalRevenueA / revenueTarget) * 100 : 0,
      totalOrders: this.extractKpiValue(periodA.kpis, 'total_orders', 0),
      avgOrderValue: this.extractKpiValue(periodA.kpis, 'avg_order_value', 0),
      growthRate: totalRevenueB > 0 ? ((totalRevenueA - totalRevenueB) / totalRevenueB) * 100 : 0,
    };

    // Merge sales chart data
    const mergedSalesChart = this.mergeSalesChart(
      periodA.charts?.sales || [],
      periodB.charts?.sales || []
    );
    const salesChart = mergedSalesChart.map((entry: SalesChartEntry) => ({
      date: entry.date,
      actual: entry.actual || 0,
      target: entry.target || 0,
      forecast: entry.forecast || 0
    }));

    // Apply anonymization to top products
    const anonymizedTopProducts = periodA.charts?.topProducts 
      ? {
          ...periodA.charts.topProducts,
          data: anonymizeArray(periodA.charts.topProducts.data || [], demoMode)
        }
      : undefined;

    // Transform top customers to include client_name
    const topCustomers = (periodA.charts?.topCustomers?.data || []).map((c: TopCustomer) => ({
      client_id: typeof c.client_id === 'number' ? c.client_id : Number(c.client_id) || 0,
      client_name: c.client_name || null,
      total_spent: Number(c.total_spent) || 0,
      avg_order_value: Number(c.avg_order_value) || 0,
      total_orders: Number(c.total_orders) || 0,
      last_purchase: c.last_purchase
    }));

    return {
      salesMetrics,
      salesChart,
      productPerformance: periodA.charts?.productPerformance || [],
      stockOutRisks: periodA.charts?.stockOutRisks || [],
      overstockOpportunities: (periodA.charts?.overstockOpportunities || []).map((item) => ({
        product: item.product || 'Unknown',
        sku: item.sku || 'Unknown',
        excessStock: item.excessStock || 0,
        value: item.value || 0,
        suggestedDiscount: item.suggestedDiscount || 0,
        daysOfSupply: item.daysOfSupply || 0
      })),
      customerInsights: {
        topCustomers,
        newCustomers: this.extractKpiValue(periodA.kpis, 'new_customers', 0),
        repeatRate: this.extractKpiValue(periodA.kpis, 'repeat_rate', 0),
        avgCustomerValue: this.extractKpiValue(periodA.kpis, 'avg_customer_value', 0),
      },
      alerts: periodA.alerts || [],
      charts: {
        ...periodA.charts,
        topProducts: anonymizedTopProducts,
        topCustomers: {
          type: periodA.charts?.topCustomers?.type || 'bar',
          data: topCustomers,
          config: periodA.charts?.topCustomers?.config
        }
      },
    };
  }

  private mergeSalesChart(dataA: SalesChartEntry[], dataB: SalesChartEntry[]): SalesChartEntry[] {
    // Create a map for easier comparison
    const chartMap = new Map();
    
    dataA.forEach(item => {
      chartMap.set(item.date, {
        ...item,
        periodA: item.actual
      });
    });
    
    dataB.forEach(item => {
      if (chartMap.has(item.date)) {
        chartMap.get(item.date).periodB = item.actual;
      }
    });
    
    return Array.from(chartMap.values());
  }

  private extractKpiValue(kpis: SalesKpi[] = [], key: string, defaultValue: number): number {
    // Normalize the key: convert underscores to dashes and lowercase
    const normalizedKey = key.toLowerCase().replace(/_/g, '-');
    
    const kpi = kpis?.find(k => {
      const kpiId = (k.id || k.key || k.metric || '').toLowerCase().replace(/_/g, '-');
      return kpiId === normalizedKey;
    });
    
    return kpi?.value ?? kpi?.current ?? defaultValue;
  }

  private mapAlertSeverity(severity: string): 'info' | 'warning' | 'error' {
    const severityMap: { [key: string]: 'info' | 'warning' | 'error' } = {
      'low': 'info',
      'medium': 'warning',
      'high': 'error',
      'critical': 'error',
      'info': 'info',
      'warning': 'warning',
      'error': 'error',
    };
    return severityMap[severity] || 'warning';
  }
}

export const ventasService = new VentasService();
export default ventasService;