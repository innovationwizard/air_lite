import { DeepDiveOptions, DrillDownOptions, FeedbackData } from '../types';

type DeepDiveInput = {
  page?: number | string;
  limit?: number | string;
  sortBy?: string;
  sortOrder?: string;
  filters?: string | Record<string, unknown>;
};

type DrillDownInput = {
  timeRange?: '7d' | '30d' | '90d' | '1y';
  metric?: string;
};

type FeedbackInput = {
  entityType?: string;
  entityId?: number | string;
  feedbackType?: string;
  value?: string;
  reason?: string;
};

export function validateDateRange(startDate?: string, endDate?: string): { startDate: Date; endDate: Date } {

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const now = new Date();

  const start = startDate ? new Date(startDate) : thirtyDaysAgo;
  const end = endDate ? new Date(endDate) : now;


  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Invalid date format');
  }

  if (start > end) {
    throw new Error('Start date cannot be after end date');
  }

  return { startDate: start, endDate: end };
}

export function validateDeepDiveOptions(options: DeepDiveInput = {}): DeepDiveOptions {
  const {
    page = 1,
    limit = 100,
    sortBy = 'created_at',
    sortOrder = 'DESC',
    filters = {}
  } = options;

  const pageNum = Number(page);
  const limitNum = Number(limit);

  if (pageNum < 1) throw new Error('Page must be greater than 0');
  if (limitNum < 1 || limitNum > 1000) throw new Error('Limit must be between 1 and 1000');
  if (!['ASC', 'DESC'].includes(sortOrder.toUpperCase())) {
    throw new Error('Sort order must be ASC or DESC');
  }

  const normalizedFilters: Record<string, string> =
    typeof filters === 'string'
      ? (JSON.parse(filters) as Record<string, string>)
      : Object.fromEntries(
          Object.entries(filters).map(([k, v]) => [k, String(v)])
        );

  return {
    page: pageNum,
    limit: limitNum,
    sortBy: String(sortBy),
    sortOrder: String(sortOrder).toUpperCase(),
    filters: normalizedFilters
  };
}

export function validateDrillDownOptions(options: DrillDownInput = {}): DrillDownOptions {
  const { timeRange = '30d', metric } = options;

  if (!metric) throw new Error('Metric is required');
  if (!['7d', '30d', '90d', '1y'].includes(timeRange)) {
    throw new Error('Time range must be one of: 7d, 30d, 90d, 1y');
  }

  return { timeRange, metric };
}

export function validateFeedbackData(data: FeedbackInput = {}): FeedbackData {
  const { entityType, entityId, feedbackType, value, reason } = data;

  if (!entityType) throw new Error('Entity type is required');
  const entityIdNum = Number(entityId);
  if (!entityId || entityIdNum < 1) throw new Error('Valid entity ID is required');
  if (!feedbackType) throw new Error('Feedback type is required');
  if (!reason) throw new Error('Reason is required');

  return { entityType, entityId: entityIdNum, feedbackType, value, reason };
}

export function validateDashboardType(dashboardType: string): string {
  const validTypes = [
    'executive-summary',
    'financial-health',
    'purchasing-performance',
    'sales-forecast-accuracy',
    'warehouse-operations',
    'system-audit'
  ];

  if (!validTypes.includes(dashboardType)) {
    throw new Error(`Invalid dashboard type. Must be one of: ${validTypes.join(', ')}`);
  }

  return dashboardType;
}

export function validateUserId(userId: number | string): number {
  const id = Number(userId);
  if (!id || id < 1) {
    throw new Error('Valid user ID is required');
  }
  return id;
}
