export interface KPIData {
  value: number;
  target?: number;
  change?: number;
  trend?: string;
  sparkline?: number[];
  details?: Record<string, unknown>;
}

export interface KPICalculation {
  current: number;
  previous: number;
  changePercent: number;
  trend: string;
}

export interface WorkingCapitalData {
  current: number;
  changePercent: number;
  trend: string;
}

export interface FinancialAlert {
  alert_type: string;
  sku: string;
  product_name: string;
  value_at_risk: number;
}

export interface CostBreakdown {
  category: string;
  value: number;
}

export interface CashFlowData {
  date: string;
  inflow: number;
  outflow: number;
}

export interface POQueueData {
  count: number;
  totalValue: number;
  urgent: number;
}

export interface SupplierData {
  supplier: string;
  otifRate: number;
  qualityScore: number;
  priceCompetitiveness: number;
}

export interface AtRiskShipment {
  sku: string;
  product_name: string;
  quantity_on_hand: number;
  week_demand: number;
  shortage: number;
}

export interface PurchaseRecommendation {
  recommendation_id: number;  
  product_id: number;
  recommended_quantity: number;
  confidence: number;
  product_name: string;
  sku: string;
  cost: number;
  moq: number;
  order_value: number | null;
  current_stock: number | null;
  created_at: Date;
  status?: string;  
  reason?: string;  
}

export interface SavingsTracking {
  month: string;
  actual: number;
  target: number;
}

export interface SalesMetrics {
  revenue: number;
  target: number;
  unique_customers: number;
  total_orders: number;
}

export interface StockoutRisk {
  sku: string;
  product_name: string;
  current_stock: number;
  week_demand: number;
  days_of_stock: number;
}

export interface SalesVelocity {
  hour: number;
  dayOfWeek: number;
  sales: number;
}

export interface CategoryContribution {
  category: string;
  revenue: number;
  margin: number;
}

export interface InventoryHealth {
  zones: ZoneData[];
  zoneAccuracy: Record<string, number>;
}

export interface ZoneData {
  zone: string;
  items_counted: number;
  discrepancies: number;
  accuracy: number;
}

export interface ProcessTimer {
  average: number;
  target: number;
  unit: string;
}

export interface ProcessTimers {
  receiving: ProcessTimer;
  putaway: ProcessTimer;
  picking: ProcessTimer;
  shipping: ProcessTimer;
}

export interface AgeingAnalysis {
  category: string;
  "0-30": number;
  "31-60": number;
  "61-90": number;
  "90+": number;
}
