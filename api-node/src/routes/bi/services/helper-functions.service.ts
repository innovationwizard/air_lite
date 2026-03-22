import { QueryBuilder } from '../utils/query-builder';
import { DashboardAlert, AppWithPrisma } from '../types';

interface InsightAlertRow {
  id: string;
  type: string;
  message: string;
  impact_value: number | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  product_name: string | null;
  sku: string | null;
}

interface ModelAlertRow {
  type: string;
  severity: string;
  count: number | null;
  message: string;
}

interface AccuracyTimelineRow {
  date: string;
  forecastaccuracy: number | null;
  forecastcount: number | null;
}

interface BiasAnalysisRow {
  category: string;
  avg_predicted_demand: number | null;
  forecast_count: number | null;
}

interface HourlyFreshnessRow {
  dataSource: string;
  hour: number;
  recordCount: number;
}

interface ProfitabilityRow {
  date: string;
  revenue: number | null;
  profit: number | null;
  aisavings: number | null;
}

interface CategoryPerformanceRow {
  category: string;
  turnover: number | null;
  profitability: number | null;
  stockoutrisk: number | null;
}

export class HelperFunctionsService {
  static async getAlerts(app: AppWithPrisma, severities: string[], startDate?: Date, endDate?: Date): Promise<DashboardAlert[]> {
    const dateCondition = startDate && endDate
      ? `WHERE i.created_at >= $1 AND i.created_at < $2 + INTERVAL '1 day'`
      : `WHERE i.created_at >= CURRENT_DATE - INTERVAL '24 hours'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        i.insight_id as id,
        i.insight_type as type,
        i.description as message,
        (i.value->>'amount')::numeric as impact_value,
        CASE 
          WHEN i.insight_type IN ('stockout_prevention', 'critical_shortage') THEN 'CRITICAL'
          WHEN i.insight_type IN ('overstock_reduction', 'cost_savings') THEN 'HIGH'
          ELSE 'MEDIUM'
        END as severity,
        p.product_name,
        p.sku
      FROM insights i
      LEFT JOIN products p ON (i.value->>'product_id')::int = p.product_id
      ${dateCondition}
      ORDER BY 
        CASE 
          WHEN i.insight_type IN ('stockout_prevention', 'critical_shortage') THEN 1
          WHEN i.insight_type IN ('overstock_reduction', 'cost_savings') THEN 2
          ELSE 3
        END,
        i.created_at DESC
      LIMIT 10
    `;

    const result = await QueryBuilder.executeWithDebug<InsightAlertRow[]>(
      app.prisma,
      query,
      params,
      'HelperFunctionsService.getAlerts'
    );

    return result.map((r) => ({
      id: r.id,
      severity: r.severity,
      type: r.type,
      message: r.message,
      product: r.product_name || r.sku || undefined,
      actionRequired: r.severity === 'CRITICAL' || r.severity === 'HIGH',
      impact: Number(r.impact_value ?? 0)
    }));
  }

  static async getModelAlerts(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<DashboardAlert[]> {
    // For model alerts, we use specific monitoring windows but allow override for historical analysis
    const accuracyWindow = startDate && endDate
      ? `WHERE created_at >= $1 AND created_at < $2 + INTERVAL '1 day'`
      : `WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'`;

    const stalenessWindow = startDate && endDate
      ? `WHERE i.snapshot_timestamp >= $1 AND i.snapshot_timestamp < $2 + INTERVAL '1 day'`
      : `WHERE i.snapshot_timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'`;

    const driftWindow = startDate && endDate
      ? `WHERE created_at >= $1 AND created_at < $2 + INTERVAL '1 day'`
      : `WHERE created_at >= CURRENT_DATE - INTERVAL '4 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        'Low Accuracy' as type,
        'WARNING' as severity,
        COUNT(*) as count,
        'Forecasts with accuracy < 70%' as message
      FROM forecasts 
      ${accuracyWindow}
      AND accuracy_score < 0.7
      HAVING COUNT(*) > 0
      
      UNION ALL
      
      SELECT 
        'Data Staleness' as type,
        'CRITICAL' as severity,
        COUNT(*) as count,
        'No inventory snapshots in monitoring period' as message
      FROM products p
      WHERE NOT EXISTS (
        SELECT 1 FROM inventory_snapshots i 
        WHERE i.product_id = p.product_id 
        ${stalenessWindow}
      )
      HAVING COUNT(*) > 0
      
      UNION ALL
      
      SELECT 
        'Model Drift' as type,
        'HIGH' as severity,
        1 as count,
        'Accuracy declining for 3 consecutive days' as message
      WHERE EXISTS (
        SELECT 1 FROM (
          SELECT 
            DATE_TRUNC('day', created_at) as day,
            AVG(accuracy_score) as daily_accuracy,
            LAG(AVG(accuracy_score), 1) OVER (ORDER BY DATE_TRUNC('day', created_at)) as prev_accuracy
          FROM forecasts
          ${driftWindow}
          GROUP BY DATE_TRUNC('day', created_at)
        ) t
        WHERE daily_accuracy < prev_accuracy
        GROUP BY 1
        HAVING COUNT(*) >= 3
      )
    `;

    const result = await QueryBuilder.executeWithDebug<ModelAlertRow[]>(
      app.prisma,
      query,
      params,
      'HelperFunctionsService.getModelAlerts'
    );

    return result.map((row, index) => ({
      id: `model-alert-${index}`,
      severity: row.severity,
      type: row.type,
      message: row.message,
      actionRequired: row.severity === 'CRITICAL' || row.severity === 'HIGH',
      impact: row.count ?? 0
    }));
  }

  static async getAccuracyTimeline(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<AccuracyTimelineRow[]> {
    const dateCondition = startDate && endDate
      ? `WHERE created_at >= $1 AND created_at < $2 + INTERVAL '1 day'`
      : `WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        DATE_TRUNC('day', created_at) as date,
        AVG(accuracy_score) as forecastAccuracy,
        COUNT(*) as forecastCount
      FROM forecasts
      ${dateCondition}
      GROUP BY DATE_TRUNC('day', created_at)
      ORDER BY date
    `;

    const result = await QueryBuilder.executeWithDebug<AccuracyTimelineRow[]>(
      app.prisma,
      query,
      params,
      'HelperFunctionsService.getAccuracyTimeline'
    );

    return result.map((row) => ({
      date: row.date,
      forecastaccuracy: Number(row.forecastaccuracy ?? 0),
      forecastcount: Number(row.forecastcount ?? 0),
    }));
  }

  static async getBiasAnalysis(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<BiasAnalysisRow[]> {
    const dateCondition = startDate && endDate
      ? `WHERE f.created_at >= $1 AND f.created_at < $2 + INTERVAL '1 day'`
      : `WHERE f.created_at >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        p.category,
        AVG(f.predicted_demand) as avg_predicted_demand,
        COUNT(*) as forecast_count
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      ${dateCondition}
      GROUP BY p.category
    `;

    const result = await QueryBuilder.executeWithDebug<BiasAnalysisRow[]>(
      app.prisma,
      query,
      params,
      'HelperFunctionsService.getBiasAnalysis'
    );

    return result.map((row) => ({
      category: row.category,
      avg_predicted_demand: Number(row.avg_predicted_demand ?? 0),
      forecast_count: Number(row.forecast_count ?? 0)
    }));
  }

  static async getDataFreshnessMatrix(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<HourlyFreshnessRow[]> {
    const dateCondition = startDate && endDate
      ? `>= $1 AND sale_datetime < $2 + INTERVAL '1 day'`
      : `>= CURRENT_DATE`;

    const inventoryDateCondition = startDate && endDate
      ? `>= $1 AND snapshot_timestamp < $2 + INTERVAL '1 day'`
      : `>= CURRENT_DATE`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      WITH hourly_data AS (
        SELECT 
          'Sales' as dataSource,
          EXTRACT(HOUR FROM sale_datetime) as hour,
          COUNT(*) as recordCount
        FROM sales_partitioned
        WHERE sale_datetime ${dateCondition}
        GROUP BY EXTRACT(HOUR FROM sale_datetime)
        
        UNION ALL
        
        SELECT 
          'Inventory' as dataSource,
          EXTRACT(HOUR FROM snapshot_timestamp) as hour,
          COUNT(*) as recordCount
        FROM inventory_snapshots
        WHERE snapshot_timestamp ${inventoryDateCondition}
        GROUP BY EXTRACT(HOUR FROM snapshot_timestamp)
      )
      SELECT * FROM hourly_data
      ORDER BY dataSource, hour
    `;

    return await QueryBuilder.executeWithDebug<HourlyFreshnessRow[]>(
      app.prisma,
      query,
      params,
      'HelperFunctionsService.getDataFreshnessMatrix'
    );
  }

  static async getProfitabilityTrend(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<ProfitabilityRow[]> {
    const dateCondition = startDate && endDate
      ? `WHERE s.sale_datetime >= $1 AND s.sale_datetime < $2 + INTERVAL '1 day'`
      : `WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        DATE(s.sale_datetime) as date,
        SUM(s.total_price) as revenue,
        SUM(s.total_price - (s.quantity * p.cost)) as profit,
        SUM(CASE 
          WHEN r.reason LIKE '%AI%' 
          THEN s.total_price * 0.15 
          ELSE 0 
        END) as aiSavings
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      LEFT JOIN recommendations r ON s.product_id = r.product_id
      ${dateCondition}
      GROUP BY DATE(s.sale_datetime)
      ORDER BY date
    `;

    const result = await QueryBuilder.executeWithDebug<ProfitabilityRow[]>(
      app.prisma,
      query,
      params,
      'HelperFunctionsService.getProfitabilityTrend'
    );

    return result.map((row) => ({
      date: row.date,
      revenue: Number(row.revenue ?? 0),
      profit: Number(row.profit ?? 0),
      aisavings: Number(row.aisavings ?? 0)
    }));
  }

  static async getCategoryPerformance(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<CategoryPerformanceRow[]> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        p.category,
        AVG(CASE WHEN i.quantity_on_hand > 0 THEN 365.0 * s.daily_sales / i.quantity_on_hand ELSE 0 END) as turnover,
        AVG((s.avg_price - p.cost) / NULLIF(s.avg_price, 0)) as profitability,
        1 - (COUNT(CASE WHEN i.quantity_on_hand = 0 THEN 1 END)::float / NULLIF(COUNT(*), 0)) as stockoutRisk
      FROM products p
      LEFT JOIN inventory_snapshots i ON p.product_id = i.product_id
        AND i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      LEFT JOIN (
        SELECT product_id, 
          AVG(unit_price) as avg_price,
          SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned 
        ${dateCondition}
        GROUP BY product_id
      ) s ON p.product_id = s.product_id
      WHERE p.is_deleted = false
      GROUP BY p.category
    `;

    const result = await QueryBuilder.executeWithDebug<CategoryPerformanceRow[]>(
      app.prisma,
      query,
      params,
      'HelperFunctionsService.getCategoryPerformance'
    );

    return result.map((row) => ({
      category: row.category,
      turnover: Number(row.turnover ?? 0),
      profitability: Number(row.profitability ?? 0),
      stockoutrisk: Number(row.stockoutrisk ?? 0)
    }));
  }
}