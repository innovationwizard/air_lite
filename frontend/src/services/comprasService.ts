// frontend/src/services/comprasService.ts
import apiClient from './api-client';
import { ParametrosConsultaTemporal } from '@/types/navegacion-temporal';

const resolveErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const errWithResponse = error as { response?: { data?: { message?: string } } };
    const message = errWithResponse.response?.data?.message;
    if (typeof message === 'string' && message.length > 0) {
      return message;
    }
  }
  return fallback;
};

type JsonObject = Record<string, unknown>;

export interface SalesKpi {
  id?: string;
  key?: string;
  metric?: string;
  name?: string;
  value?: number;
  current?: number;
}

export type AlertType =
  | 'delivery'
  | 'price'
  | 'stock'
  | 'quality'
  | 'purchase_approval'
  | 'urgent_delivery'
  | 'supplier_risk'
  | 'cost_optimization';

export type AlertSeverity = 'low' | 'medium' | 'high' | 'info';

interface AlertRaw {
  id?: string;
  type?: string;
  message?: string;
  text?: string;
  severity?: string;
  timestamp?: string;
  action?: string;
  details?: Record<string, unknown>;
}

export interface AiHighlightRaw {
  id: number;
  type: string;
  title: string;
  message: string;
  confidence: number;
  details?: {
    sku?: string;
    currentStock?: number;
  };
}

interface PendingOrderRaw {
  id?: string;
  order_number?: string;
  purchase_id?: number;
  supplier?: string;
  supplier_name?: string;
  items?: number;
  product_count?: number;
  total?: number;
  total_cost?: number;
  dueDate?: string;
  expected_delivery_date?: string;
  urgency?: 'low' | 'medium' | 'high';
  status?: string;
}

interface SupplierPerformanceRaw {
  supplier?: string;
  supplier_name?: string;
  onTimeDelivery?: number;
  on_time_delivery_rate?: number;
  qualityScore?: number;
  quality_score?: number;
  avgLeadTime?: number;
  avg_lead_time?: number;
  totalOrders?: number;
  total_orders?: number;
  totalValue?: number;
  total_value?: number;
  rating?: number;
}

interface PurchaseTrendRaw {
  date?: string;
  value?: number;
  purchase_value?: number;
  orders?: number;
  order_count?: number;
  suppliers?: number;
  unique_suppliers?: number;
}

interface CostByCategoryRaw {
  category?: string;
  value?: number;
  total_cost?: number;
  orders?: number;
  order_count?: number;
  percentage?: number;
  percentage_of_total?: number;
}

interface PurchaseForecastRaw {
  sku?: string;
  product?: string;
  product_name?: string;
  category?: string;
  predictedDemand?: number;
  predicted_next_month?: number;
  recommendedQty?: number;
  recommended_order_quantity?: number;
  estimatedCost?: number;
  estimated_cost?: number;
  confidence?: number;
}

interface SavingsOpportunityRaw {
  sku?: string;
  product?: string;
  product_name?: string;
  supplier?: string;
  supplier_name?: string;
  currentCost?: number;
  recent_avg_cost?: number;
  historicalCost?: number;
  historical_avg_cost?: number;
  increase?: number;
  cost_increase_percentage?: number;
  potentialSavings?: number;
  potential_savings?: number;
}

interface TopProductRaw {
  sku?: string;
  product?: string;
  product_name?: string;
  category?: string;
  quantity?: number;
  total_quantity?: number;
  cost?: number;
  total_cost?: number;
  avgCost?: number;
  avg_unit_cost?: number;
  purchases?: number;
  purchase_count?: number;
}

interface SupplierRiskRaw {
  supplier?: string;
  supplier_name?: string;
  riskLevel?: 'low_risk' | 'medium_risk' | 'high_risk';
  risk_level?: 'low_risk' | 'medium_risk' | 'high_risk';
  lateDeliveries?: number;
  late_deliveries?: number;
  totalOrders?: number;
  total_orders?: number;
  avgLateDays?: number;
  avg_late_days?: number;
  qualityScore?: number;
  avg_quality_score?: number;
  lastOrder?: string;
  last_order_date?: string;
}

export interface SupplierAnalysisResponse {
  supplierPerformance: SupplierPerformanceRaw[];
  supplierRisks: SupplierRisk[];
  [key: string]: unknown;
}

export type AlertResponse = {
  id: string;
  type: AlertType;
  message: string;
  severity: AlertSeverity;
  timestamp: string;
  action?: string;
  details?: Record<string, unknown>;
};

interface ComprasApiCharts {
  pendingOrders?: { data?: PendingOrderRaw[] };
  supplierPerformance?: { data?: SupplierPerformanceRaw[] };
  purchaseTrend?: { data?: PurchaseTrendRaw[] };
  costByCategory?: { data?: CostByCategoryRaw[] };
  purchaseForecast?: { data?: PurchaseForecastRaw[] };
  savingsOpportunities?: { data?: SavingsOpportunityRaw[] };
  topProducts?: { data?: TopProductRaw[] };
  supplierRisks?: { data?: SupplierRiskRaw[] };
}

export interface ComprasApiResponse {
  kpis?: SalesKpi[];
  charts?: ComprasApiCharts;
  alerts?: AlertRaw[];
  aiHighlight?: AiHighlightRaw;
}

export interface ComprasCompareApiResponse {
  periodA: { data: ComprasApiResponse };
  periodB: { data: ComprasApiResponse };
}

export interface PurchaseForecast {
  sku: string;
  product: string;
  category: string;
  predictedDemand: number;
  recommendedQty: number;
  estimatedCost: number;
  confidence: number;
}

export interface SavingsOpportunity {
  sku: string;
  product: string;
  supplier: string;
  currentCost: number;
  historicalCost: number;
  increase: number;
  potentialSavings: number;
}

export interface TopPurchasedProduct {
  sku: string;
  product: string;
  category: string;
  quantity: number;
  cost: number;
  avgCost: number;
  purchases: number;
}

export interface SupplierRisk {
  supplier: string;
  riskLevel: 'low_risk' | 'medium_risk' | 'high_risk';
  lateDeliveries: number;
  totalOrders: number;
  avgLateDays: number;
  qualityScore: number;
  lastOrder: string;
}

export interface PurchaseTrendData {
  date: string;
  value: number;
  orders: number;
  suppliers: number;
}

export interface CostByCategoryData {
  category: string;
  value: number;
  orders: number;
  percentage: number;
}

export interface ComprasDashboardData {
  pendingOrders: Array<{
    id: string;
    supplier: string;
    items: number;
    total: number;
    urgency: 'low' | 'medium' | 'high';
    dueDate: string;
    status?: string;
  }>;
  supplierPerformance: Array<{
    supplier: string;
    onTimeDelivery: number;
    qualityScore: number;
    avgLeadTime: number;
    totalOrders: number;
    totalValue?: number;
    rating?: number;
  }>;
  purchaseMetrics: {
    totalSpend: number;
    avgOrderValue: number;
    ordersThisMonth: number;
    savingsYTD: number;
    pendingApprovals: number;
    onTimeDeliveryRate?: number;
    avgLeadTime?: number;
    activeSuppliers?: number;
  };
  purchaseTrend: PurchaseTrendData[];
  costByCategory: CostByCategoryData[];
  purchaseForecast: PurchaseForecast[];
  savingsOpportunities: SavingsOpportunity[];
  topProducts: TopPurchasedProduct[];
  supplierRisks: SupplierRisk[];
  alerts: AlertResponse[];
  aiHighlight?: {
    id: number;
    type: string;
    title: string;
    message: string;
    confidence: number;
    details?: AiHighlightRaw['details'];
  };
}

export interface SupplierScorecardTrend {
  supplier_id: number;
  supplier_name: string;
  month: string;
  otif_rate: number;
  avg_lead_time: number;
  lead_time_variance: number;
  defect_rate_ppm: number;
  avg_cost_per_unit: number;
  total_spend: number;
  order_count: number;
  avg_quality_score: number;
}

export interface SupplierScorecardRanking {
  supplier_id: number;
  supplier_name: string;
  total_spend: number;
  total_orders: number;
  overall_otif: number;
  overall_quality: number;
  cost_trend_pct: number;
}

export interface SupplierScorecardResponse {
  monthlyTrends: SupplierScorecardTrend[];
  rankings: SupplierScorecardRanking[];
  dateRange: {
    start: string;
    end: string;
  };
}

export interface AtRiskShipment {
  purchase_id: number;
  purchase_date: string;
  expected_delivery: string;
  predicted_delivery: string;
  supplier_id: number;
  supplier_name: string;
  product_id: number;
  product_name: string;
  sku: string;
  quantity: number;
  order_value: number;
  risk_score: number;
  predicted_delay_days: number;
  days_until_due: number;
  current_stock: number;
  risk_level: 'high' | 'medium' | 'low';
  recommended_action: string;
}

export interface AtRiskShipmentsSummary {
  total_at_risk: number;
  high_risk_count: number;
  medium_risk_count: number;
  total_value_at_risk: number;
}

export interface AtRiskShipmentsAiAccuracy {
  total_predictions_last_30d: number;
  correct_predictions: number;
  accuracy_rate: string;
  avg_prediction_error_days: string;
}

export interface AtRiskShipmentsResponse {
  atRiskShipments: AtRiskShipment[];
  summary: AtRiskShipmentsSummary;
  aiAccuracy: AtRiskShipmentsAiAccuracy;
  dateRange: {
    start: string;
    end: string;
  };
}

class ComprasService {
  async getDashboardData(params?: ParametrosConsultaTemporal): Promise<ComprasDashboardData> {
    try {
      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.append('role', 'Compras'); // ← CRITICAL: Always specify role
      
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);

      const response = await apiClient.request('GET', `/api/v1/bi/dashboards?${queryParams}`);
      const { data } = response;

      console.log('[COMPRAS SERVICE] Raw backend response:', data);

      // Handle compare mode
      if (params?.modo === 'comparar' && data.periodA && data.periodB) {
        return this.transformCompareData(data);
      }

      // Transform backend response to match frontend expectations
      return this.transformData(data);
    } catch (error: unknown) {
      console.error('Failed to fetch compras dashboard:', error);
      throw new Error(resolveErrorMessage(error, 'Error al cargar el panel de compras'));
    }
  }

  async getPurchaseOrders(params?: ParametrosConsultaTemporal & { 
    status?: string; 
    supplier?: string; 
    page?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.supplier) queryParams.append('supplier', params.supplier);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/compras/orders?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener órdenes de compra'));
    }
  }

  async createPurchaseOrder(orderData: JsonObject) {
    try {
      const response = await apiClient.request('POST', '/api/v1/bi/compras/orders', orderData);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al crear orden de compra'));
    }
  }

  

  async updatePurchaseOrder(orderId: string, updates: JsonObject) {
    try {
      const response = await apiClient.request('PUT', `/api/v1/compras/orders/${orderId}`, updates);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al actualizar orden de compra'));
    }
  }

  async approvePurchaseOrder(orderId: string) {
    try {
      const response = await apiClient.request('POST', `/api/v1/compras/orders/${orderId}/approve`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al aprobar orden de compra'));
    }
  }

  async getSuppliers(params?: ParametrosConsultaTemporal & { 
    search?: string; 
    page?: number; 
    limit?: number 
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.search) queryParams.append('search', params.search);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/compras/suppliers?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener proveedores'));
    }
  }

  async getSupplierDetails(supplierId: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/compras/suppliers/${supplierId}?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener detalles del proveedor'));
    }
  }

  async getReorderRecommendations(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      
      const response = await apiClient.request('GET', `/api/v1/compras/recommendations?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener recomendaciones de reorden'));
    }
  }

  async getPriceAnalysis(productId?: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);
      if (productId) queryParams.append('productId', productId);
      
      const response = await apiClient.request('GET', `/api/v1/compras/price-analysis?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener análisis de precios'));
    }
  }

  async getSupplierScorecard(params?: ParametrosConsultaTemporal & { supplierId?: number }): Promise<SupplierScorecardResponse> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.supplierId) queryParams.append('supplierId', params.supplierId.toString());

      const response = await apiClient.request('GET', `/api/v1/bi/compras/supplier-scorecard?${queryParams}`);
      return response.data as SupplierScorecardResponse;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener tablero de proveedores'));
    }
  }

  async getAtRiskShipments(params?: ParametrosConsultaTemporal & { threshold?: number }): Promise<AtRiskShipmentsResponse> {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.threshold) queryParams.append('threshold', params.threshold.toString());

      const response = await apiClient.request('GET', `/api/v1/bi/compras/at-risk-shipments?${queryParams}`);
      return response.data as AtRiskShipmentsResponse;
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener envíos en riesgo'));
    }
  }

  async exportPurchaseData(format: 'csv' | 'excel' | 'pdf', params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/compras/export?${queryParams}`, null, {
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `datos-compras.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      return { success: true };
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al exportar datos de compras'));
    }
  }

  async getSupplierAnalysis(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);

      const response = await apiClient.request('GET', `/api/v1/bi/compras/supplier-analysis?${queryParams}`);
      const payload = response as { data?: SupplierAnalysisResponse | { data?: SupplierAnalysisResponse } };
      const dataWrapper = payload.data;
      if (!dataWrapper) {
        return { supplierPerformance: [], supplierRisks: [] };
      }
      if ('supplierPerformance' in dataWrapper && 'supplierRisks' in dataWrapper) {
        return dataWrapper;
      }
      return dataWrapper.data || { supplierPerformance: [], supplierRisks: [] };
    } catch (error: unknown) {
      throw new Error(resolveErrorMessage(error, 'Error al obtener análisis de proveedores'));
    }
  }

  // Helper methods
  private transformData(data: ComprasApiResponse): ComprasDashboardData {
    console.log('[COMPRAS SERVICE] Transforming data:', data);

    // Extract purchase metrics from KPIs
    const purchaseMetrics = {
      totalSpend: this.extractKpiValue(data.kpis, 'total-spend', 0),
      avgOrderValue: this.extractKpiValue(data.kpis, 'avg-order-value', 0),
      ordersThisMonth: this.extractKpiValue(data.kpis, 'orders-this-month', 0),
      savingsYTD: this.extractKpiValue(data.kpis, 'savings-ytd', 0),
      pendingApprovals: this.extractKpiValue(data.kpis, 'pending-approvals', 0),
      onTimeDeliveryRate: this.extractKpiValue(data.kpis, 'on-time-delivery', 0),
      avgLeadTime: this.extractKpiValue(data.kpis, 'avg-lead-time', 0),
      activeSuppliers: this.extractKpiValue(data.kpis, 'active-suppliers', 0),
    };

    // Extract data from charts with proper mapping
    const pendingOrders = (data.charts?.pendingOrders?.data || []).map((po: PendingOrderRaw) => ({
      id: po.id || po.order_number || String(po.purchase_id || Date.now()),
      supplier: po.supplier || po.supplier_name || 'N/A',
      items: po.items || po.product_count || 0,
      total: po.total || po.total_cost || 0,
      dueDate: po.dueDate || po.expected_delivery_date || new Date().toISOString(),
      urgency: po.urgency || 'low',
      status: po.status || 'pending'
    }));

    const supplierPerformance = (data.charts?.supplierPerformance?.data || []).map((sp: SupplierPerformanceRaw) => ({
      supplier: sp.supplier || sp.supplier_name || 'Unknown',
      onTimeDelivery: sp.onTimeDelivery || sp.on_time_delivery_rate || 0,
      qualityScore: sp.qualityScore || sp.quality_score || 0,
      avgLeadTime: sp.avgLeadTime || sp.avg_lead_time || 0,
      totalOrders: sp.totalOrders || sp.total_orders || 0,
      totalValue: sp.totalValue || sp.total_value || 0,
      rating: sp.rating || 0
    }));

    const purchaseTrend = (data.charts?.purchaseTrend?.data || []).map((pt: PurchaseTrendRaw) => ({
      date: pt.date || new Date().toISOString().split('T')[0],
      value: pt.value || pt.purchase_value || 0,
      orders: pt.orders || pt.order_count || 0,
      suppliers: pt.suppliers || pt.unique_suppliers || 0
    }));

    const costByCategory = (data.charts?.costByCategory?.data || []).map((cc: CostByCategoryRaw) => ({
      category: cc.category || 'Unknown',
      value: cc.value || cc.total_cost || 0,
      orders: cc.orders || cc.order_count || 0,
      percentage: cc.percentage || cc.percentage_of_total || 0
    }));

    const purchaseForecast = (data.charts?.purchaseForecast?.data || []).map((pf: PurchaseForecastRaw) => ({
      sku: pf.sku || 'Unknown',
      product: pf.product || pf.product_name || 'Unknown',
      category: pf.category || 'Unknown',
      predictedDemand: pf.predictedDemand || pf.predicted_next_month || 0,
      recommendedQty: pf.recommendedQty || pf.recommended_order_quantity || 0,
      estimatedCost: pf.estimatedCost || pf.estimated_cost || 0,
      confidence: pf.confidence || 0
    }));

    const savingsOpportunities = (data.charts?.savingsOpportunities?.data || []).map((so: SavingsOpportunityRaw) => ({
      sku: so.sku || 'Unknown',
      product: so.product || so.product_name || 'Unknown',
      supplier: so.supplier || so.supplier_name || 'Unknown',
      currentCost: so.currentCost || so.recent_avg_cost || 0,
      historicalCost: so.historicalCost || so.historical_avg_cost || 0,
      increase: so.increase || so.cost_increase_percentage || 0,
      potentialSavings: so.potentialSavings || so.potential_savings || 0
    }));

    const topProducts = (data.charts?.topProducts?.data || []).map((tp: TopProductRaw) => ({
      sku: tp.sku || 'Unknown',
      product: tp.product || tp.product_name || 'Unknown',
      category: tp.category || 'Unknown',
      quantity: tp.quantity || tp.total_quantity || 0,
      cost: tp.cost || tp.total_cost || 0,
      avgCost: tp.avgCost || tp.avg_unit_cost || 0,
      purchases: tp.purchases || tp.purchase_count || 0
    }));

    const supplierRisks = (data.charts?.supplierRisks?.data || []).map((sr: SupplierRiskRaw) => ({
      supplier: sr.supplier || sr.supplier_name || 'Unknown',
      riskLevel: sr.riskLevel || sr.risk_level || 'low_risk',
      lateDeliveries: sr.lateDeliveries || sr.late_deliveries || 0,
      totalOrders: sr.totalOrders || sr.total_orders || 0,
      avgLateDays: sr.avgLateDays || sr.avg_late_days || 0,
      qualityScore: sr.qualityScore || sr.avg_quality_score || 0,
      lastOrder: sr.lastOrder || sr.last_order_date || new Date().toISOString()
    }));

    // Transform alerts with enhanced type mapping
    const alerts = (data.alerts || []).map((alert: AlertRaw) => ({
      id: alert.id || String(Date.now() + Math.random()),
      type: this.mapAlertType(alert.type || 'delivery'),
      message: alert.message || alert.text || 'Alerta',
      severity: this.mapAlertSeverity(alert.severity || 'warning'),
      timestamp: alert.timestamp || new Date().toISOString(),
      action: alert.action,
      details: alert.details
    }));

    const result = {
      pendingOrders,
      supplierPerformance,
      purchaseMetrics,
      purchaseTrend,
      costByCategory,
      purchaseForecast,
      savingsOpportunities,
      topProducts,
      supplierRisks,
      alerts,
      aiHighlight: data.aiHighlight || undefined
    };

    console.log('[COMPRAS SERVICE] Transformed result:', result);
    return result;
  }

  private transformCompareData(data: ComprasCompareApiResponse): ComprasDashboardData {
    // For compare mode, show period A as current with comparison data
    const periodA = data.periodA.data;
    const periodB = data.periodB.data;
    
    console.log('[COMPRAS SERVICE] Transform compare mode:', { periodA, periodB });

    const purchaseMetrics = {
      totalSpend: this.extractKpiValue(periodA.kpis, 'total-spend', 0),
      avgOrderValue: this.extractKpiValue(periodA.kpis, 'avg-order-value', 0),
      ordersThisMonth: this.extractKpiValue(periodA.kpis, 'orders-this-month', 0),
      savingsYTD: this.extractKpiValue(periodA.kpis, 'savings-ytd', 0),
      pendingApprovals: this.extractKpiValue(periodA.kpis, 'pending-approvals', 0),
      onTimeDeliveryRate: this.extractKpiValue(periodA.kpis, 'on-time-delivery', 0),
      avgLeadTime: this.extractKpiValue(periodA.kpis, 'avg-lead-time', 0),
      activeSuppliers: this.extractKpiValue(periodA.kpis, 'active-suppliers', 0),
    };

    // Transform pending orders
    const pendingOrders = (periodA.charts?.pendingOrders?.data || []).map((po: PendingOrderRaw) => ({
      id: po.id || po.order_number || String(po.purchase_id || Date.now()),
      supplier: po.supplier || po.supplier_name || 'N/A',
      items: po.items || po.product_count || 0,
      total: po.total || po.total_cost || 0,
      dueDate: po.dueDate || po.expected_delivery_date || new Date().toISOString(),
      urgency: po.urgency || 'low',
      status: po.status || 'pending'
    }));

    // Transform supplier performance (merged data will be transformed separately if needed)
    const mergedSupplierData = this.mergeSupplierData(
      periodA.charts?.supplierPerformance?.data || [],
      periodB.charts?.supplierPerformance?.data || []
    );
    const supplierPerformance = mergedSupplierData.map((sp: SupplierPerformanceRaw) => ({
      supplier: sp.supplier || sp.supplier_name || 'Unknown',
      onTimeDelivery: sp.onTimeDelivery || sp.on_time_delivery_rate || 0,
      qualityScore: sp.qualityScore || sp.quality_score || 0,
      avgLeadTime: sp.avgLeadTime || sp.avg_lead_time || 0,
      totalOrders: sp.totalOrders || sp.total_orders || 0,
      totalValue: sp.totalValue || sp.total_value || 0,
      rating: sp.rating || 0
    }));

    // Transform purchase trend
    const purchaseTrend = (periodA.charts?.purchaseTrend?.data || []).map((pt: PurchaseTrendRaw) => ({
      date: pt.date || new Date().toISOString().split('T')[0],
      value: pt.value || pt.purchase_value || 0,
      orders: pt.orders || pt.order_count || 0,
      suppliers: pt.suppliers || pt.unique_suppliers || 0
    }));

    // Transform cost by category
    const costByCategory = (periodA.charts?.costByCategory?.data || []).map((cc: CostByCategoryRaw) => ({
      category: cc.category || 'Unknown',
      value: cc.value || cc.total_cost || 0,
      orders: cc.orders || cc.order_count || 0,
      percentage: cc.percentage || cc.percentage_of_total || 0
    }));

    // Transform purchase forecast
    const purchaseForecast = (periodA.charts?.purchaseForecast?.data || []).map((pf: PurchaseForecastRaw) => ({
      sku: pf.sku || 'Unknown',
      product: pf.product || pf.product_name || 'Unknown',
      category: pf.category || 'Unknown',
      predictedDemand: pf.predictedDemand || pf.predicted_next_month || 0,
      recommendedQty: pf.recommendedQty || pf.recommended_order_quantity || 0,
      estimatedCost: pf.estimatedCost || pf.estimated_cost || 0,
      confidence: pf.confidence || 0
    }));

    // Transform savings opportunities
    const savingsOpportunities = (periodA.charts?.savingsOpportunities?.data || []).map((so: SavingsOpportunityRaw) => ({
      sku: so.sku || 'Unknown',
      product: so.product || so.product_name || 'Unknown',
      supplier: so.supplier || so.supplier_name || 'Unknown',
      currentCost: so.currentCost || so.recent_avg_cost || 0,
      historicalCost: so.historicalCost || so.historical_avg_cost || 0,
      increase: so.increase || so.cost_increase_percentage || 0,
      potentialSavings: so.potentialSavings || so.potential_savings || 0
    }));

    // Transform top products
    const topProducts = (periodA.charts?.topProducts?.data || []).map((tp: TopProductRaw) => ({
      sku: tp.sku || 'Unknown',
      product: tp.product || tp.product_name || 'Unknown',
      category: tp.category || 'Unknown',
      quantity: tp.quantity || tp.total_quantity || 0,
      cost: tp.cost || tp.total_cost || 0,
      avgCost: tp.avgCost || tp.avg_unit_cost || 0,
      purchases: tp.purchases || tp.purchase_count || 0
    }));

    // Transform supplier risks
    const supplierRisks = (periodA.charts?.supplierRisks?.data || []).map((sr: SupplierRiskRaw) => ({
      supplier: sr.supplier || sr.supplier_name || 'Unknown',
      riskLevel: sr.riskLevel || sr.risk_level || 'low_risk',
      lateDeliveries: sr.lateDeliveries || sr.late_deliveries || 0,
      totalOrders: sr.totalOrders || sr.total_orders || 0,
      avgLateDays: sr.avgLateDays || sr.avg_late_days || 0,
      qualityScore: sr.qualityScore || sr.avg_quality_score || 0,
      lastOrder: sr.lastOrder || sr.last_order_date || new Date().toISOString()
    }));

    // Transform alerts
    const alerts = (periodA.alerts || []).map((alert: AlertRaw) => ({
      id: alert.id || String(Date.now() + Math.random()),
      type: this.mapAlertType(alert.type || 'delivery'),
      message: alert.message || alert.text || 'Alerta',
      severity: this.mapAlertSeverity(alert.severity || 'warning'),
      timestamp: alert.timestamp || new Date().toISOString(),
      action: alert.action,
      details: alert.details
    }));

    return {
      pendingOrders,
      supplierPerformance,
      purchaseMetrics,
      purchaseTrend,
      costByCategory,
      purchaseForecast,
      savingsOpportunities,
      topProducts,
      supplierRisks,
      alerts,
      aiHighlight: periodA.aiHighlight || undefined
    };
  }

  private mergeSupplierData(dataA: SupplierPerformanceRaw[], dataB: SupplierPerformanceRaw[]): SupplierPerformanceRaw[] {
    const supplierMap = new Map();
    
    dataA.forEach(supplier => {
      supplierMap.set(supplier.supplier || supplier.supplier_name, { 
        ...supplier, 
        periodA: true 
      });
    });
    
    dataB.forEach(supplier => {
      const key = supplier.supplier || supplier.supplier_name;
      if (supplierMap.has(key)) {
        supplierMap.get(key).previousData = supplier;
      }
    });
    
    return Array.from(supplierMap.values());
  }

  private extractKpiValue(kpis: SalesKpi[] = [], key: string, defaultValue: number): number {
    if (!kpis || !Array.isArray(kpis)) {
      console.warn('[COMPRAS SERVICE] KPIs is not an array:', kpis);
      return defaultValue;
    }

    // Normalize key: convert to lowercase and replace underscores with dashes
    const normalizedKey = key.toLowerCase().replace(/_/g, '-');
    
    const kpi = kpis.find(k => {
      // Check all possible property names and normalize them
      const kpiId = (k.id || k.key || k.metric || k.name || '').toLowerCase().replace(/_/g, '-');
      return kpiId === normalizedKey;
    });
    
    const value = kpi?.value ?? kpi?.current ?? defaultValue;
    console.log(`[COMPRAS SERVICE] Extract KPI ${key} (normalized: ${normalizedKey}):`, value);
    return value;
  }

  private mapAlertType(type: string): 'delivery' | 'price' | 'stock' | 'quality' | 'purchase_approval' | 'urgent_delivery' | 'supplier_risk' | 'cost_optimization' {
    const typeMap: Record<string, AlertType> = {
      'delivery': 'delivery',
      'delivery_performance': 'delivery',
      'price': 'price',
      'stock': 'stock',
      'quality': 'quality',
      'shipment': 'delivery',
      'cost': 'price',
      'inventory': 'stock',
      'purchase_approval': 'purchase_approval',
      'urgent_delivery': 'urgent_delivery',
      'supplier_risk': 'supplier_risk',
      'cost_optimization': 'cost_optimization',
      'lead_time': 'delivery'
    };
    return typeMap[type] || 'stock';
  }

  private mapAlertSeverity(severity: string): 'low' | 'medium' | 'high' | 'info' {
    const severityMap: { [key: string]: 'low' | 'medium' | 'high' | 'info' } = {
      'low': 'low',
      'medium': 'medium',
      'high': 'high',
      'critical': 'high',
      'info': 'info',
      'warning': 'medium'
    };
    return severityMap[severity] || 'medium';
  }
}

export const comprasService = new ComprasService();
export default comprasService;