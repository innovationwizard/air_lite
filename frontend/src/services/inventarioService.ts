// frontend/src/services/inventarioService.ts
import apiClient from './api-client';
import { ParametrosConsultaTemporal } from '@/types/navegacion-temporal';

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

export interface InventoryByZone {
  zone: string;
  total_units: number;
  available_units: number;
  damaged_units: number;
  quarantine_units: number;
  value: number;
  sku_count: number;
}

export interface InventoryByCategory {
  category: string;
  items: number;
  quantity: number;
  value: number;
  turnover: number;
  stockout_risk: 'low' | 'medium' | 'high';
  days_on_hand: number;
}

export interface InventoryMovement {
  date: string;
  product: string;
  sku: string;
  type: string;
  quantity: number;
  from_location: string;
  to_location: string;
  value: number;
  user: string;
  reason: string;
}

export interface CycleCountDiscrepancy {
  sku: string;
  product: string;
  zone: string;
  bin_location: string;
  system_qty: number;
  counted_qty: number;
  variance: number;
  variance_value: number;
  count_date: string;
  status: string;
  counted_by: string;
}

export interface StockAlert {
  type: 'stockout' | 'low_stock' | 'overstock' | 'expiring' | 'damaged';
  sku: string;
  product_name: string;
  current_stock: number;
  min_quantity: number;
  reorder_point: number;
  days_of_stock: number;
  expiry_date: string | null;
}

export interface SlowMovingItem {
  sku: string;
  product_name: string;
  quantity_on_hand: number;
  value: number;
  days_since_movement: number;
  last_movement_date: string;
  location_zone: string;
}

export interface InventarioDashboardData {
  inventoryMetrics: {
    totalSKUs: number;
    totalValue: number;
    availableValue: number;
    damagedValue: number;
    quarantineValue: number;
    accuracy: number;
    fillRate: number;
    turnoverRate: number;
    stockoutRate: number;
    overstockRate: number;
    daysOnHand: number;
  };
  warehouseMetrics: {
    receivingEfficiency: number;
    pickingAccuracy: number;
    cycleCountAccuracy: number;
    backorderRate: number;
    shrinkageRate: number;
  };
  inventoryByZone: InventoryByZone[];
  inventoryByCategory: InventoryByCategory[];
  recentMovements: InventoryMovement[];
  cycleCountDiscrepancies: CycleCountDiscrepancy[];
  stockAlerts: StockAlert[];
  slowMovingItems: SlowMovingItem[];
  alerts: Array<{
    id: string;
    type: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'info';
    timestamp: string;
    action?: string;
    details?: any;
  }>;
}

class InventarioService {
  async getDashboardData(params?: ParametrosConsultaTemporal): Promise<InventarioDashboardData> {
    try {
      // Build query parameters
      const queryParams = new URLSearchParams();
      queryParams.append('role', 'Inventario'); // ← CRITICAL: Always specify role
      
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.modo) queryParams.append('modo', params.modo);
      if (params?.fechaInicioComparacion) queryParams.append('fechaInicioComparacion', params.fechaInicioComparacion);
      if (params?.fechaFinComparacion) queryParams.append('fechaFinComparacion', params.fechaFinComparacion);

      const response = await apiClient.request('GET', `/api/v1/bi/dashboards?${queryParams}`);
      const { data } = response;

      console.log('[INVENTARIO SERVICE] Raw backend response:', data);

      // Handle compare mode
      if (params?.modo === 'comparar' && data.periodA && data.periodB) {
        return this.transformCompareData(data);
      }

      // Transform backend response to match frontend expectations
      return this.transformData(data);
    } catch (error: any) {
      console.error('Failed to fetch inventario dashboard:', error);
      throw new Error(error.response?.data?.message || 'Error al cargar el panel de inventario');
    }
  }

  async getInventoryItems(params?: ParametrosConsultaTemporal & {
    search?: string;
    category?: string;
    location?: string;
    status?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.search) queryParams.append('search', params.search);
      if (params?.category) queryParams.append('category', params.category);
      if (params?.location) queryParams.append('location', params.location);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/inventario/items?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener artículos del inventario'));
    }
  }

  async getItemDetails(sku: string, params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/inventario/items/${sku}?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener detalles del artículo'));
    }
  }

  async updateInventoryCount(sku: string, data: {
    physicalCount: number;
    location: string;
    notes?: string;
  }) {
    try {
      const response = await apiClient.request('POST', `/api/v1/inventario/items/${sku}/count`, data);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al actualizar conteo de inventario'));
    }
  }

  async getMovementHistory(params?: ParametrosConsultaTemporal & {
    sku?: string;
    location?: string;
    type?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.granularidad) queryParams.append('granularidad', params.granularidad);
      if (params?.sku) queryParams.append('sku', params.sku);
      if (params?.location) queryParams.append('location', params.location);
      if (params?.type) queryParams.append('type', params.type);
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/inventario/movements?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener historial de movimientos'));
    }
  }

  async recordMovement(data: {
    sku: string;
    type: 'in' | 'out' | 'transfer' | 'adjustment';
    quantity: number;
    fromLocation?: string;
    toLocation?: string;
    reason?: string;
    reference?: string;
  }) {
    try {
      const response = await apiClient.request('POST', '/api/v1/inventario/movements', data);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al registrar movimiento de inventario'));
    }
  }

  async getDiscrepancies(params?: ParametrosConsultaTemporal & {
    status?: string;
    minVariance?: number;
    page?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.status) queryParams.append('status', params.status);
      if (params?.minVariance) queryParams.append('minVariance', params.minVariance.toString());
      if (params?.page) queryParams.append('page', params.page.toString());
      if (params?.limit) queryParams.append('limit', params.limit.toString());
      
      const response = await apiClient.request('GET', `/api/v1/inventario/discrepancies?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener discrepancias'));
    }
  }

  async resolveDiscrepancy(discrepancyId: string, resolution: {
    action: 'adjust' | 'investigate' | 'ignore';
    notes: string;
    adjustedQuantity?: number;
  }) {
    try {
      const response = await apiClient.request('POST', `/api/v1/inventario/discrepancies/${discrepancyId}/resolve`, resolution);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al resolver discrepancia'));
    }
  }

  async getAIDiscrepancies(params?: ParametrosConsultaTemporal & {
    minConfidence?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.minConfidence !== undefined) queryParams.append('minConfidence', params.minConfidence.toString());
      if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());

      const response = await apiClient.request('GET', `/api/v1/bi/inventario/ai-discrepancies?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al analizar discrepancias con IA'));
    }
  }

  async getReorderRecommendations(params?: ParametrosConsultaTemporal & {
    minConfidence?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.minConfidence !== undefined) queryParams.append('minConfidence', params.minConfidence.toString());
      if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());

      const response = await apiClient.request('GET', `/api/v1/bi/inventario/reorder-recommendations?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener recomendaciones de reabastecimiento'));
    }
  }

  async getStockOptimization(params?: ParametrosConsultaTemporal & {
    minValue?: number;
    limit?: number;
  }) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      if (params?.minValue !== undefined) queryParams.append('minValue', params.minValue.toString());
      if (params?.limit !== undefined) queryParams.append('limit', params.limit.toString());

      const response = await apiClient.request('GET', `/api/v1/bi/inventario/stock-optimization?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al analizar optimización de stock'));
    }
  }

  async getCycleCountSchedule(params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/inventario/cycle-counts/schedule?${queryParams}`);
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener calendario de conteo cíclico'));
    }
  }

  async getWarehouseMap() {
    try {
      const response = await apiClient.request('GET', '/api/v1/inventario/warehouse/map');
      return response.data;
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al obtener mapa del almacén'));
    }
  }

  async exportInventoryReport(format: 'csv' | 'excel' | 'pdf', params?: ParametrosConsultaTemporal) {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('format', format);
      if (params?.fechaInicio) queryParams.append('fechaInicio', params.fechaInicio);
      if (params?.fechaFin) queryParams.append('fechaFin', params.fechaFin);
      
      const response = await apiClient.request('GET', `/api/v1/inventario/export?${queryParams}`, null, {
      });
      
      // Create download link
      const url = window.URL.createObjectURL(new Blob([response]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `reporte-inventario.${format}`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      
      return { success: true };
    } catch (error: unknown) {
      throw new Error(getErrorMessage(error, 'Error al exportar reporte de inventario'));
    }
  }

  // Helper methods
  private transformData(data: any): InventarioDashboardData {
    console.log('[INVENTARIO SERVICE] Transforming data:', data);

    // Extract inventory metrics from KPIs with safe defaults
    const inventoryMetrics = {
      totalSKUs: this.extractKpiValue(data.kpis, 'total-skus', 0),
      totalValue: this.extractKpiValue(data.kpis, 'inventory-value', 0),
      availableValue: this.extractKpiValue(data.kpis, 'available-value', 0),
      damagedValue: this.extractKpiValue(data.kpis, 'damaged-value', 0),
      quarantineValue: this.extractKpiValue(data.kpis, 'quarantine-value', 0),
      accuracy: this.extractKpiValue(data.kpis, 'inventory-accuracy', 95),
      fillRate: this.extractKpiValue(data.kpis, 'fill-rate', 100),
      turnoverRate: this.extractKpiValue(data.kpis, 'turnover-rate', 0),
      stockoutRate: this.extractKpiValue(data.kpis, 'stockout-rate', 0),
      overstockRate: this.extractKpiValue(data.kpis, 'overstock-rate', 0),
      daysOnHand: this.extractKpiValue(data.kpis, 'days-on-hand', 0),
    };

    // Extract warehouse metrics from KPIs
    const warehouseMetrics = {
      receivingEfficiency: this.extractKpiValue(data.kpis, 'receiving-efficiency', 90),
      pickingAccuracy: this.extractKpiValue(data.kpis, 'picking-accuracy', 98),
      cycleCountAccuracy: this.extractKpiValue(data.kpis, 'cycle-count-accuracy', 95),
      backorderRate: this.extractKpiValue(data.kpis, 'backorder-rate', 0),
      shrinkageRate: this.extractKpiValue(data.kpis, 'shrinkage-rate', 0),
    };

    // Extract charts data with safe mapping
    const inventoryByZone = (data.charts?.inventoryByZone?.data || []).map((z: any) => ({
      zone: z.zone || 'MAIN',
      total_units: z.total_units || 0,
      available_units: z.available_units || 0,
      damaged_units: z.damaged_units || 0,
      quarantine_units: z.quarantine_units || 0,
      value: z.value || 0,
      sku_count: z.sku_count || 0
    }));

    const inventoryByCategory = (data.charts?.inventoryByCategory?.data || []).map((c: any) => ({
      category: c.category || 'Sin Categoría',
      items: c.items || 0,
      quantity: c.quantity || 0,
      value: c.value || 0,
      turnover: c.turnover || 0,
      stockout_risk: (c.stockout_risk || 'low') as 'low' | 'medium' | 'high',
      days_on_hand: c.days_on_hand || 0
    }));

    const recentMovements = (data.charts?.recentMovements?.data || []).map((m: any) => ({
      date: m.date || new Date().toISOString(),
      product: m.product || 'Unknown',
      sku: m.sku || 'N/A',
      type: m.type || 'adjustment',
      quantity: m.quantity || 0,
      from_location: m.from_location || '-',
      to_location: m.to_location || '-',
      value: m.value || 0,
      user: m.user || 'System',
      reason: m.reason || ''
    }));

    const cycleCountDiscrepancies = (data.charts?.cycleCountDiscrepancies?.data || []).map((d: any) => ({
      sku: d.sku || 'N/A',
      product: d.product || 'Unknown',
      zone: d.zone || 'MAIN',
      bin_location: d.bin_location || '-',
      system_qty: d.system_qty || 0,
      counted_qty: d.counted_qty || 0,
      variance: d.variance || 0,
      variance_value: d.variance_value || 0,
      count_date: d.count_date || new Date().toISOString(),
      status: d.status || 'pending',
      counted_by: d.counted_by || 'Unknown'
    }));

    const stockAlerts = (data.charts?.stockAlerts?.data || []).map((a: any) => ({
      type: (a.type || 'low_stock') as 'stockout' | 'low_stock' | 'overstock' | 'expiring' | 'damaged',
      sku: a.sku || 'N/A',
      product_name: a.product_name || 'Unknown',
      current_stock: a.current_stock || 0,
      min_quantity: a.min_quantity || 0,
      reorder_point: a.reorder_point || 0,
      days_of_stock: a.days_of_stock || 0,
      expiry_date: a.expiry_date || null
    }));

    const slowMovingItems = (data.charts?.slowMovingItems?.data || []).map((s: any) => ({
      sku: s.sku || 'N/A',
      product_name: s.product_name || 'Unknown',
      quantity_on_hand: s.quantity_on_hand || 0,
      value: s.value || 0,
      days_since_movement: s.days_since_movement || 0,
      last_movement_date: s.last_movement_date || new Date().toISOString(),
      location_zone: s.location_zone || 'MAIN'
    }));

    // Transform alerts with enhanced type mapping
    const alerts = (data.alerts || []).map((alert: any) => ({
      id: alert.id || String(Date.now() + Math.random()),
      type: alert.type || 'inventory',
      message: alert.message || alert.text || 'Alerta',
      severity: this.mapAlertSeverity(alert.severity),
      timestamp: alert.timestamp || new Date().toISOString(),
      action: alert.action,
      details: alert.details
    }));

    const result = {
      inventoryMetrics,
      warehouseMetrics,
      inventoryByZone,
      inventoryByCategory,
      recentMovements,
      cycleCountDiscrepancies,
      stockAlerts,
      slowMovingItems,
      alerts
    };

    console.log('[INVENTARIO SERVICE] Transformed result:', result);
    return result;
  }

  private transformCompareData(data: any): InventarioDashboardData {
    // For compare mode, show period A as current with comparison data
    const periodA = data.periodA;
    const periodB = data.periodB;
    
    console.log('[INVENTARIO SERVICE] Transform compare mode:', { periodA, periodB });

    const inventoryMetrics = {
      totalSKUs: this.extractKpiValue(periodA.kpis, 'total-skus', 0),
      totalValue: this.extractKpiValue(periodA.kpis, 'inventory-value', 0),
      availableValue: this.extractKpiValue(periodA.kpis, 'available-value', 0),
      damagedValue: this.extractKpiValue(periodA.kpis, 'damaged-value', 0),
      quarantineValue: this.extractKpiValue(periodA.kpis, 'quarantine-value', 0),
      accuracy: this.extractKpiValue(periodA.kpis, 'inventory-accuracy', 95),
      fillRate: this.extractKpiValue(periodA.kpis, 'fill-rate', 100),
      turnoverRate: this.extractKpiValue(periodA.kpis, 'turnover-rate', 0),
      stockoutRate: this.extractKpiValue(periodA.kpis, 'stockout-rate', 0),
      overstockRate: this.extractKpiValue(periodA.kpis, 'overstock-rate', 0),
      daysOnHand: this.extractKpiValue(periodA.kpis, 'days-on-hand', 0),
    };

    const warehouseMetrics = {
      receivingEfficiency: this.extractKpiValue(periodA.kpis, 'receiving-efficiency', 90),
      pickingAccuracy: this.extractKpiValue(periodA.kpis, 'picking-accuracy', 98),
      cycleCountAccuracy: this.extractKpiValue(periodA.kpis, 'cycle-count-accuracy', 95),
      backorderRate: this.extractKpiValue(periodA.kpis, 'backorder-rate', 0),
      shrinkageRate: this.extractKpiValue(periodA.kpis, 'shrinkage-rate', 0),
    };

    return {
      inventoryMetrics,
      warehouseMetrics,
      inventoryByZone: periodA.charts?.inventoryByZone?.data || [],
      inventoryByCategory: periodA.charts?.inventoryByCategory?.data || [],
      recentMovements: periodA.charts?.recentMovements?.data || [],
      cycleCountDiscrepancies: periodA.charts?.cycleCountDiscrepancies?.data || [],
      stockAlerts: periodA.charts?.stockAlerts?.data || [],
      slowMovingItems: periodA.charts?.slowMovingItems?.data || [],
      alerts: periodA.alerts || []
    };
  }

  private extractKpiValue(kpis: any[], key: string, defaultValue: any): any {
    if (!kpis || !Array.isArray(kpis)) {
      console.warn('[INVENTARIO SERVICE] KPIs is not an array:', kpis);
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
    console.log(`[INVENTARIO SERVICE] Extract KPI ${key} (normalized: ${normalizedKey}):`, value);
    return value;
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

export const inventarioService = new InventarioService();
export default inventarioService;