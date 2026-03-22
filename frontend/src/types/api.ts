/**
 * TypeScript types for AI Refill API
 * Generated from OpenAPI specification
 */

// ============================================================================
// USER & AUTH TYPES
// ============================================================================

export interface User {
  user_id: number;
  username: string;
  email: string;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  roles: RoleBasic[];
}

export interface UserProfile {
  user_id: number;
  username: string;
  email: string;
  is_active: boolean;
  roles: string[];
  permissions: string[];
  created_at: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token_type: string;
  expires_in: number;
  user: UserProfile;
}

export interface RefreshTokenRequest {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  token_type: string;
  expires_in: number;
}

// ============================================================================
// ROLE & PERMISSION TYPES
// ============================================================================

export interface RoleBasic {
  role_id: number;
  role_name: string;
}

export interface Role extends RoleBasic {
  is_deleted: boolean;
  permissions: Permission[];
}

export interface Permission {
  permission_id: number;
  permission_name: string;
  description: string;
}

export interface RoleCreate {
  role_name: string;
  permission_ids: number[];
}

export interface RoleUpdate {
  role_name?: string;
  permission_ids?: number[];
}

// ============================================================================
// PRODUCT TYPES
// ============================================================================

export interface Product {
  product_id: number;
  sku: string;
  product_name: string;
  category: string | null;
  supply_type: 'local' | 'import' | null;
  cost: number | null;
  price_min: number | null;
  shelf_life_days: number | null;
  moq: number | null;
  is_deleted: boolean;
}

export interface ProductDetail extends Product {
  product_description_long: string | null;
  current_stock: number;
  average_monthly_demand: number;
  primary_supplier: {
    supplier_id: number;
    supplier_name: string;
    average_lead_time_days: number;
  } | null;
}

// ============================================================================
// RECOMMENDATION TYPES
// ============================================================================

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface Recommendation {
  recommendation_id: number;
  sku: string;
  product_name: string;
  current_stock: number;
  recommended_order_quantity: number;
  reorder_point: number;
  safety_stock: number;
  priority: Priority;
  estimated_stockout_date: string | null;
  confidence_score: number;
  supplier_id: number;
  supplier_name: string;
  estimated_lead_time_days: number;
  cost_per_unit: number;
  total_cost: number;
  generated_at: string;
}

// ============================================================================
// FORECAST TYPES
// ============================================================================

export type ForecastType = 'demand' | 'lead_time';

export interface Forecast {
  forecast_id: number;
  sku: string;
  product_name: string;
  forecast_date: string;
  forecast_type: ForecastType;
  predicted_value: number;
  confidence_interval_lower: number;
  confidence_interval_upper: number;
  model_name: string;
  generated_at: string;
}

// ============================================================================
// INSIGHT TYPES
// ============================================================================

export type InsightType = 'stockout_risk' | 'overstock_warning' | 'supplier_delay' | 'demand_spike';
export type Severity = 'critical' | 'warning' | 'info';

export interface Insight {
  insight_id: number;
  insight_type: InsightType;
  severity: Severity;
  title: string;
  description: string;
  affected_products: string[];
  recommended_action: string;
  generated_at: string;
  expires_at: string | null;
}

// ============================================================================
// FINANCIAL KPI TYPES
// ============================================================================

export interface FinancialKPIs {
  period_start: string;
  period_end: string;
  inventory_turnover: number;
  gross_margin_percentage: number;
  carrying_cost: number;
  stockout_incidents: number;
  overstock_cost: number;
  perfect_order_rate: number;
  average_lead_time_days: number;
  generated_at: string;
}

// ============================================================================
// INVENTORY TYPES
// ============================================================================

export type StockLevelStatus = 'critical' | 'low' | 'adequate' | 'overstock';

export interface InventoryLevel {
  product_id: number;
  sku: string;
  product_name: string;
  quantity_on_hand: number;
  safety_stock: number;
  reorder_point: number;
  stock_level_status: StockLevelStatus;
  last_updated: string;
}

// ============================================================================
// PAGINATION TYPES
// ============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
  };
}

// ============================================================================
// ERROR TYPES
// ============================================================================

export interface APIError {
  type: string;
  title: string;
  status: number;
  detail: string;
  traceId: string;
  errors?: Array<{
    field: string;
    message: string;
  }>;
}

// ============================================================================
// API RESPONSE WRAPPER
// ============================================================================

export interface APIResponse<T> {
  data: T;
}

// ============================================================================
// QUERY PARAMETERS
// ============================================================================

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface SortParams {
  sort?: string;
}

export interface ProductFilters extends PaginationParams, SortParams {
  sku?: string;
  category?: string;
  supply_type?: 'local' | 'import';
  search?: string;
  include_deleted?: boolean;
}

export interface RecommendationFilters extends PaginationParams, SortParams {
  sku?: string;
  category?: string;
  priority?: Priority;
  supplier_id?: number;
  format?: 'json' | 'csv' | 'excel' | 'pdf';
}

export interface ForecastFilters extends PaginationParams, SortParams {
  sku?: string;
  forecast_date_gte?: string;
  forecast_date_lte?: string;
  format?: 'json' | 'csv' | 'excel' | 'pdf';
}

export interface InventoryFilters extends PaginationParams, SortParams {
  sku?: string;
  category?: string;
  stock_level?: StockLevelStatus;
  format?: 'json' | 'csv' | 'excel' | 'pdf';
}

