export type { AppWithPrisma } from '../../../types/app';

// Dashboard types
export * from './dashboard.types';

// KPI types
export * from './kpi.types';

// Chart types
export * from './chart.types';

// Additional types for drill-down and deep-dive
export interface DeepDiveOptions {
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: string;
  filters: Record<string, string>;
}

export interface DrillDownOptions {
  timeRange?: string;
  metric: string;
}

export interface AIExplanation {
  id: number;
  product_id: number;
  product_name: string;
  moq: number;
  shelf_life_days: number;
  ai_reasoning: {
    methodology: string;
    inputs: Record<string, unknown>;
    calculations: Record<string, unknown>;
    confidence_factors: string[];
    risk_factors: string[];
  };
  model_performance: {
    historical_accuracy: number;
    similar_products_accuracy: number;
    last_updated: Date;
  };
}

export interface FeedbackData {
  entityType: string;
  entityId: number;
  feedbackType: string;
  value: unknown;
  reason: string;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export interface CacheOptions {
  key: string;
  ttl?: number;
  data: unknown;
}

export interface QueryDebugInfo {
  query: string;
  params: unknown[];
  executionTime: number;
  rowCount: number;
  error?: string;
}
