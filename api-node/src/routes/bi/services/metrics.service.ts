import { QueryBuilder } from '../utils/query-builder';
import {
  WorkingCapitalData,
  CostBreakdown,
  CashFlowData,
  POQueueData,
  SupplierData,
  AtRiskShipment,
  PurchaseRecommendation,
  SavingsTracking,
  SalesMetrics,
  StockoutRisk,
  SalesVelocity,
  CategoryContribution,
  InventoryHealth,
  ProcessTimers,
  AgeingAnalysis,
  ZoneData,
  AppWithPrisma
} from '../types';

interface WorkingCapitalRow {
  current: number | null;
  previous: number | null;
  change_percent: number | null;
}

interface POQueueRow {
  count: number | null;
  totalvalue: number | null;
  urgent: number | null;
}

interface PurchaseRecommendationRow extends PurchaseRecommendation {
  order_value: number | null;
  current_stock: number | null;
}

interface SalesMetricsRow {
  revenue: number | null;
  unique_customers: number | null;
  total_orders: number | null;
}

interface InventoryZoneRow {
  zone: string;
  items_counted: number | null;
  discrepancies: number | null;
  accuracy: number | null;
}

interface ProcessTimerRow {
  process: keyof ProcessTimers;
  average: number | null;
  target: number | null;
  unit: string | null;
}

export class MetricsService {
  static async getWorkingCapital(app: AppWithPrisma): Promise<WorkingCapitalData> {
    const query = `
      WITH current_wc AS (
        SELECT
          SUM(GREATEST(i.quantity_on_hand, 0) * p.cost) as inventory_value,
          (SELECT SUM(total_price) FROM sales_partitioned
           WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days') as receivables
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ),
      previous_wc AS (
        SELECT
          SUM(GREATEST(i.quantity_on_hand, 0) * p.cost) as inventory_value,
          (SELECT SUM(total_price) FROM sales_partitioned 
           WHERE sale_datetime BETWEEN CURRENT_DATE - INTERVAL '60 days' 
           AND CURRENT_DATE - INTERVAL '30 days') as receivables
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        WHERE i.snapshot_timestamp = (
          SELECT MAX(snapshot_timestamp) FROM inventory_snapshots 
          WHERE snapshot_timestamp < CURRENT_DATE - INTERVAL '30 days'
        )
      )
      SELECT 
        c.inventory_value + c.receivables as current,
        p.inventory_value + p.receivables as previous,
        ((c.inventory_value + c.receivables) - (p.inventory_value + p.receivables)) / 
          NULLIF(p.inventory_value + p.receivables, 0) * 100 as change_percent
      FROM current_wc c, previous_wc p
    `;

    const result = await QueryBuilder.executeWithDebug<WorkingCapitalRow[]>(
      app.prisma,
      query,
      [],
      'getWorkingCapital'
    );

    const data = result[0] || { current: 0, previous: 0, change_percent: 0 };
    const changePercent = Number(data.change_percent ?? 0);
    const trend = changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'flat';

    return {
      current: Number(data.current ?? 0),
      changePercent,
      trend
    };
  }

  static async getCostBreakdown(app: AppWithPrisma): Promise<CostBreakdown[]> {
    const query = `
      SELECT 
        'Inventory Holding' as category,
        SUM(i.quantity_on_hand * p.cost * 0.025) as value
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      UNION ALL
      SELECT 
        'Purchase Costs' as category,
        SUM(total_cost) as value
      FROM purchases
      WHERE purchase_datetime >= CURRENT_DATE - INTERVAL '30 days'
      UNION ALL
      SELECT 
        'Stockout Costs' as category,
        COUNT(DISTINCT product_id) * 5000 as value
      FROM inventory_snapshots
      WHERE quantity_on_hand = 0
        AND snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
    `;

    return await QueryBuilder.executeWithDebug<CostBreakdown[]>(
      app.prisma,
      query,
      [],
      'getCostBreakdown'
    );
  }

  static async getCashFlowData(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<CashFlowData[]> {
    const query = `
      SELECT 
        DATE(d) as date,
        COALESCE(s.revenue, 0) as inflow,
        COALESCE(p.purchases, 0) as outflow
      FROM generate_series($1::date, $2::date, '1 day'::interval) d
      LEFT JOIN (
        SELECT DATE(sale_datetime) as date, SUM(total_price) as revenue
        FROM sales_partitioned
        WHERE sale_datetime BETWEEN $1::timestamp AND $2::timestamp
        GROUP BY DATE(sale_datetime)
      ) s ON d::date = s.date
      LEFT JOIN (
        SELECT DATE(purchase_datetime) as date, SUM(total_cost) as purchases
        FROM purchases
        WHERE purchase_datetime BETWEEN $1::timestamp AND $2::timestamp
        GROUP BY DATE(purchase_datetime)
      ) p ON d::date = p.date
      ORDER BY date
    `;

    return await QueryBuilder.executeWithDebug<CashFlowData[]>(
      app.prisma,
      query,
      [startDate.toISOString(), endDate.toISOString()],
      'getCashFlowData'
    );
  }

  static async getPOQueue(app: AppWithPrisma): Promise<POQueueData> {
    const query = `
      SELECT 
        COUNT(*) as count,
        SUM(r.recommended_quantity * p.cost) as totalValue,
        COUNT(CASE WHEN r.confidence > 0.9 THEN 1 END) as urgent
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      WHERE r.created_at >= CURRENT_DATE - INTERVAL '7 days'
        AND r.recommended_quantity > 0
    `;

    const result = await QueryBuilder.executeWithDebug<POQueueRow[]>(
      app.prisma,
      query,
      [],
      'getPOQueue'
    );

    const row = result[0];
    return {
      count: Number(row?.count ?? 0),
      totalValue: Number(row?.totalvalue ?? 0),
      urgent: Number(row?.urgent ?? 0)
    };
  }

  static async getTopSuppliers(app: AppWithPrisma, limit: number = 5): Promise<SupplierData[]> {
    const query = `
      WITH supplier_data AS (
        SELECT 
          COALESCE(p.supply_type, 'Unknown') as supplier,
          COUNT(DISTINCT pur.purchase_id) as total_orders,
          COUNT(DISTINCT pur.purchase_id) FILTER (
            WHERE pur.purchase_datetime BETWEEN CURRENT_DATE - INTERVAL '90 days' AND CURRENT_DATE
          ) as recent_orders,
          AVG(pur.unit_cost / NULLIF(p.cost, 0)) as price_ratio
        FROM purchases pur
        JOIN products p ON pur.product_id = p.product_id
        WHERE pur.purchase_datetime >= CURRENT_DATE - INTERVAL '180 days'
        GROUP BY p.supply_type
      ),
      quality_scores AS (
        SELECT 
          p.supply_type as supplier,
          1.0 - (COUNT(r.return_id)::float / NULLIF(COUNT(s.sale_id), 0)) as quality_score
        FROM sales_partitioned s
        JOIN products p ON s.product_id = p.product_id
        LEFT JOIN returns r ON s.sale_id = r.sale_id
        WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '90 days'
        GROUP BY p.supply_type
      )
      SELECT 
        sd.supplier,
        LEAST(1.0, sd.recent_orders::float / NULLIF(sd.total_orders, 0) * 1.1) as otifRate,
        COALESCE(qs.quality_score, 0.9) as qualityScore,
        CASE 
          WHEN sd.price_ratio > 1.05 THEN 0.8
          WHEN sd.price_ratio < 0.95 THEN 1.0
          ELSE 0.9
        END as priceCompetitiveness
      FROM supplier_data sd
      LEFT JOIN quality_scores qs ON sd.supplier = qs.supplier
      ORDER BY sd.recent_orders DESC
      LIMIT $1
    `;

    return await QueryBuilder.executeWithDebug<SupplierData[]>(
      app.prisma,
      query,
      [limit],
      'getTopSuppliers'
    );
  }

  static async getAtRiskShipments(app: AppWithPrisma): Promise<AtRiskShipment[]> {
    const query = `
      SELECT 
        p.sku,
        p.product_name,
        i.quantity_on_hand,
        f.predicted_demand * 7 as week_demand,
        GREATEST(0, (f.predicted_demand * 7) - i.quantity_on_hand) as shortage
      FROM forecasts f
      JOIN products p ON f.product_id = p.product_id
      LEFT JOIN inventory_snapshots i ON f.product_id = i.product_id
        AND i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      WHERE f.forecast_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND COALESCE(i.quantity_on_hand, 0) < f.predicted_demand * 7
      GROUP BY p.sku, p.product_name, i.quantity_on_hand, f.predicted_demand
      ORDER BY shortage DESC
      LIMIT 3
    `;

    return await QueryBuilder.executeWithDebug<AtRiskShipment[]>(
      app.prisma,
      query,
      [],
      'getAtRiskShipments'
    );
  }

  static async getTopPurchaseRecommendation(app: AppWithPrisma): Promise<PurchaseRecommendation | null> {
    const query = `
      SELECT 
        r.*,
        p.product_name,
        p.sku,
        p.cost,
        p.moq,
        r.recommended_quantity * p.cost as order_value,
        i.quantity_on_hand as current_stock
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      LEFT JOIN inventory_snapshots i ON r.product_id = i.product_id
        AND i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      WHERE r.confidence = (SELECT MAX(confidence) FROM recommendations)
      ORDER BY r.created_at DESC
      LIMIT 1
    `;

    const result = await QueryBuilder.executeWithDebug<PurchaseRecommendationRow[]>(
      app.prisma,
      query,
      [],
      'getTopPurchaseRecommendation'
    );

    const row = result[0];
    if (!row) {
      return null;
    }

    return {
      ...row,
      order_value: Number(row.order_value ?? 0),
      current_stock: Number(row.current_stock ?? 0)
    };
  }

  static async getSavingsTracking(app: AppWithPrisma): Promise<SavingsTracking[]> {
    const query = `
      WITH monthly_savings AS (
        SELECT 
          TO_CHAR(created_at, 'Mon') as month,
          EXTRACT(month FROM created_at) as month_num,
          SUM(impact_value) as actual
        FROM insights
        WHERE insight_type = 'cost_savings'
          AND EXTRACT(year FROM created_at) = EXTRACT(year FROM CURRENT_DATE)
        GROUP BY TO_CHAR(created_at, 'Mon'), EXTRACT(month FROM created_at)
      )
      SELECT 
        month,
        COALESCE(actual, 0) as actual,
        42000 as target
      FROM monthly_savings
      ORDER BY month_num
    `;

    return await QueryBuilder.executeWithDebug<SavingsTracking[]>(
      app.prisma,
      query,
      [],
      'getSavingsTracking'
    );
  }

  static async getSalesMetrics(app: AppWithPrisma): Promise<SalesMetrics> {
    const query = `
      SELECT 
        SUM(total_price) as revenue,
        COUNT(DISTINCT client_id) as unique_customers,
        COUNT(*) as total_orders
      FROM sales_partitioned
      WHERE sale_datetime >= DATE_TRUNC('month', CURRENT_DATE)
    `;

    const result = await QueryBuilder.executeWithDebug<SalesMetricsRow[]>(
      app.prisma,
      query,
      [],
      'getSalesMetrics'
    );

    const row = result[0];
    const target = 1500000; // Monthly target

    return { 
      revenue: Number(row?.revenue ?? 0), 
      target, 
      unique_customers: Number(row?.unique_customers ?? 0),
      total_orders: Number(row?.total_orders ?? 0)
    };
  }

  static async getStockoutRisks(app: AppWithPrisma, limit: number = 5): Promise<StockoutRisk[]> {
    const query = `
      SELECT 
        p.sku,
        p.product_name,
        COALESCE(i.quantity_on_hand, 0) as current_stock,
        COALESCE(s.daily_sales * 7, 0) as week_demand,
        CASE 
          WHEN i.quantity_on_hand = 0 THEN 0
          WHEN s.daily_sales > 0 THEN i.quantity_on_hand / s.daily_sales
          ELSE 999
        END as days_of_stock
      FROM products p
      LEFT JOIN inventory_snapshots i ON p.product_id = i.product_id
        AND i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      LEFT JOIN (
        SELECT product_id, SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned
        WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY product_id
      ) s ON p.product_id = s.product_id
      WHERE p.is_deleted = false
        AND COALESCE(i.quantity_on_hand, 0) < COALESCE(s.daily_sales * 7, 1)
      ORDER BY days_of_stock
      LIMIT $1
    `;

    return await QueryBuilder.executeWithDebug<StockoutRisk[]>(
      app.prisma,
      query,
      [limit],
      'getStockoutRisks'
    );
  }

  static async getSalesVelocityHeatmap(app: AppWithPrisma): Promise<SalesVelocity[]> {
    const query = `
      SELECT 
        EXTRACT(hour FROM sale_datetime) as hour,
        EXTRACT(dow FROM sale_datetime) as dayOfWeek,
        COUNT(*) as sales
      FROM sales_partitioned
      WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY hour, dayOfWeek
      ORDER BY dayOfWeek, hour
    `;

    return await QueryBuilder.executeWithDebug<SalesVelocity[]>(
      app.prisma,
      query,
      [],
      'getSalesVelocityHeatmap'
    );
  }

  static async getCategoryContribution(app: AppWithPrisma): Promise<CategoryContribution[]> {
    const query = `
      SELECT 
        p.category,
        SUM(s.total_price) as revenue,
        (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) as margin
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
        AND s.unit_price > 0
      GROUP BY p.category
      ORDER BY revenue DESC
    `;

    return await QueryBuilder.executeWithDebug<CategoryContribution[]>(
      app.prisma,
      query,
      [],
      'getCategoryContribution'
    );
  }

  static async getInventoryHealth(app: AppWithPrisma): Promise<InventoryHealth> {
    const query = `
      WITH zone_data AS (
        SELECT 
          CASE 
            WHEN p.category = 'BEBIDAS' THEN 'Zone A'
            WHEN p.category = 'LACTEOS' THEN 'Zone B'
            WHEN p.category = 'LIMPIEZA' THEN 'Zone C'
            ELSE 'Zone D'
          END as zone,
          COUNT(*) as items_counted,
          COUNT(*) FILTER (WHERE ABS(i.quantity_on_hand - COALESCE(r.recommended_quantity, i.quantity_on_hand)) >= 5) as discrepancies
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        LEFT JOIN recommendations r ON i.product_id = r.product_id
        WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
        GROUP BY zone
      )
      SELECT 
        zone,
        items_counted,
        discrepancies,
        1.0 - (discrepancies::float / NULLIF(items_counted, 0)) as accuracy
      FROM zone_data
      ORDER BY zone
    `;

    const result = await QueryBuilder.executeWithDebug<InventoryZoneRow[]>(
      app.prisma,
      query,
      [],
      'getInventoryHealth'
    );

    const zones: InventoryZoneRow[] = result;
    const normalizedZones = zones.map((zone): ZoneData => ({
      zone: zone.zone,
      items_counted: Number(zone.items_counted ?? 0),
      discrepancies: Number(zone.discrepancies ?? 0),
      accuracy: Number(zone.accuracy ?? 0)
    }));
    const zoneAccuracy = normalizedZones.reduce<Record<string, number>>((acc, zone) => {
      acc[zone.zone] = zone.accuracy;
      return acc;
    }, {});
    
    return { zones: normalizedZones, zoneAccuracy };
  }

  static async getProcessTimers(app: AppWithPrisma): Promise<ProcessTimers> {
    const query = `
      WITH process_times AS (
        SELECT 
          'receiving' as process,
          AVG(EXTRACT(EPOCH FROM (changed_at - LAG(changed_at) OVER (PARTITION BY record_id ORDER BY log_id)))/60) as average,
          60 as target
        FROM audit_logs
        WHERE table_name = 'purchases'
          AND action = 'INSERT'
          AND changed_at >= CURRENT_DATE - INTERVAL '30 days'
        
        UNION ALL
        
        SELECT 
          'putaway' as process,
          AVG(EXTRACT(EPOCH FROM (changed_at - LAG(changed_at) OVER (PARTITION BY record_id ORDER BY log_id)))/60) as average,
          30 as target
        FROM audit_logs
        WHERE table_name = 'inventory_snapshots'
          AND action = 'INSERT'
          AND changed_at >= CURRENT_DATE - INTERVAL '30 days'
        
        UNION ALL
        
        SELECT 
          'picking' as process,
          AVG(EXTRACT(EPOCH FROM (changed_at - LAG(changed_at) OVER (PARTITION BY record_id ORDER BY log_id)))/60) as average,
          20 as target
        FROM audit_logs
        WHERE table_name = 'sales_partitioned'
          AND action IN ('INSERT', 'UPDATE')
          AND changed_at >= CURRENT_DATE - INTERVAL '30 days'
        
        UNION ALL
        
        SELECT 
          'shipping' as process,
          AVG(EXTRACT(EPOCH FROM (changed_at - LAG(changed_at) OVER (PARTITION BY record_id ORDER BY log_id)))/60) as average,
          30 as target
        FROM audit_logs
        WHERE table_name = 'sales_partitioned'
          AND action = 'INSERT'
          AND changed_at >= CURRENT_DATE - INTERVAL '30 days'
      )
      SELECT 
        process,
        COALESCE(average, target * 0.75) as average,
        target,
        'minutes' as unit
      FROM process_times
    `;

    const result = await QueryBuilder.executeWithDebug<ProcessTimerRow[]>(
      app.prisma,
      query,
      [],
      'getProcessTimers'
    );

    const timers: Partial<Record<keyof ProcessTimers, ProcessTimers[keyof ProcessTimers]>> = {};
    result.forEach((row) => {
      timers[row.process] = {
        average: Number(row.average ?? 0),
        target: Number(row.target ?? 0),
        unit: row.unit ?? 'minutes'
      };
    });

    // Return with defaults if no data
    return {
      receiving: timers.receiving || { average: 45, target: 60, unit: 'minutes' },
      putaway: timers.putaway || { average: 30, target: 30, unit: 'minutes' },
      picking: timers.picking || { average: 15, target: 20, unit: 'minutes' },
      shipping: timers.shipping || { average: 25, target: 30, unit: 'minutes' }
    };
  }

  static async getAgeingAnalysis(app: AppWithPrisma): Promise<AgeingAnalysis[]> {
    const query = `
      SELECT 
        p.category,
        SUM(CASE WHEN age <= 30 THEN value ELSE 0 END) as "0-30",
        SUM(CASE WHEN age > 30 AND age <= 60 THEN value ELSE 0 END) as "31-60",
        SUM(CASE WHEN age > 60 AND age <= 90 THEN value ELSE 0 END) as "61-90",
        SUM(CASE WHEN age > 90 THEN value ELSE 0 END) as "90+"
      FROM (
        SELECT 
          p.category,
          i.quantity_on_hand * p.cost as value,
          EXTRACT(days FROM NOW() - i.snapshot_timestamp) as age
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ) aged
      GROUP BY category
      ORDER BY category
    `;

    return await QueryBuilder.executeWithDebug<AgeingAnalysis[]>(
      app.prisma,
      query,
      [],
      'getAgeingAnalysis'
    );
  }
}
