import { QueryBuilder } from '../utils/query-builder';
import {
  WorkingCapitalData,
  CostBreakdown,
  CashFlowData,
  FinancialAlert,
  AppWithPrisma
} from '../types';

interface WorkingCapitalRow {
  current: number | null;
  previous: number | null;
  change_percent: number | null;
}

interface CostBreakdownRow {
  category: string;
  value: number | null;
}

interface CashFlowRow {
  date: string;
  inflow: number | null;
  outflow: number | null;
}

interface FinancialAlertRow {
  alert_type: string | null;
  sku: string | null;
  product_name: string | null;
  value_at_risk: number | null;
}

interface RevenueMetricsRow {
  total_revenue: number | null;
  avg_daily_revenue: number | null;
  revenue_volatility: number | null;
  min_daily_revenue: number | null;
  max_daily_revenue: number | null;
}

export interface RevenueMetrics {
  total_revenue: number;
  avg_daily_revenue: number;
  revenue_volatility: number;
  min_daily_revenue: number;
  max_daily_revenue: number;
}

interface ProfitabilityMetricsRow {
  total_revenue: number | null;
  total_cost: number | null;
  gross_profit: number | null;
  gross_margin: number | null;
}

export interface ProfitabilityMetrics {
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  gross_margin: number;
}

interface InventoryValuationRow {
  total_value: number | null;
  unique_products: number | null;
  avg_product_value: number | null;
  out_of_stock_count: number | null;
}

export interface InventoryValuation {
  total_value: number;
  unique_products: number;
  avg_product_value: number;
  out_of_stock_count: number;
}

interface PurchaseMetricsRow {
  total_purchases: number | null;
  total_purchase_value: number | null;
  avg_purchase_value: number | null;
  unique_products_purchased: number | null;
}

export interface PurchaseMetricsSummary {
  total_purchases: number;
  total_purchase_value: number;
  avg_purchase_value: number;
  unique_products_purchased: number;
}

interface CostAnalysisRow {
  category: string;
  inventory_value: number | null;
  cost_of_goods_sold: number | null;
  product_count: number | null;
}

export interface CostAnalysisEntry {
  category: string;
  inventory_value: number;
  cost_of_goods_sold: number;
  product_count: number;
}

export class FinancialQueries {
  static async getWorkingCapital(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<WorkingCapitalData> {
    const hasDateRange = startDate && endDate;

    const currentReceivablesCond = hasDateRange
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day' AND is_deleted = false`
      : `WHERE sale_datetime >= (SELECT MAX(sale_datetime) - INTERVAL '30 days' FROM sales_partitioned)
           AND sale_datetime <= (SELECT MAX(sale_datetime) FROM sales_partitioned) AND is_deleted = false`;

    const previousReceivablesCond = hasDateRange
      ? `WHERE sale_datetime >= $1 - INTERVAL '30 days' AND sale_datetime < $1 AND is_deleted = false`
      : `WHERE sale_datetime BETWEEN (SELECT MAX(sale_datetime) - INTERVAL '60 days' FROM sales_partitioned)
           AND (SELECT MAX(sale_datetime) - INTERVAL '30 days' FROM sales_partitioned) AND is_deleted = false`;

    const query = `
      WITH current_wc AS (
        SELECT
          SUM(GREATEST(i.quantity_on_hand, 0) * p.cost) as inventory_value,
          (SELECT SUM(total_price) FROM sales_partitioned
           ${currentReceivablesCond}) as receivables
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ),
      previous_wc AS (
        SELECT
          SUM(GREATEST(i.quantity_on_hand, 0) * p.cost) as inventory_value,
          (SELECT SUM(total_price) FROM sales_partitioned
           ${previousReceivablesCond}) as receivables
        FROM inventory_snapshots i
        JOIN products p ON i.product_id = p.product_id
        WHERE i.snapshot_timestamp = (
          SELECT MAX(snapshot_timestamp) FROM inventory_snapshots
          WHERE snapshot_timestamp < (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots) - INTERVAL '30 days'
        )
      )
      SELECT
        COALESCE(c.inventory_value, 0) + COALESCE(c.receivables, 0) as current,
        COALESCE(p.inventory_value, 0) + COALESCE(p.receivables, 0) as previous,
        ((COALESCE(c.inventory_value, 0) + COALESCE(c.receivables, 0)) -
         (COALESCE(p.inventory_value, 0) + COALESCE(p.receivables, 0))) /
          NULLIF(COALESCE(p.inventory_value, 0) + COALESCE(p.receivables, 0), 0) * 100 as change_percent
      FROM current_wc c, previous_wc p
    `;

    const params = hasDateRange ? [startDate, endDate] : [];

    const result = await QueryBuilder.executeWithDebug<WorkingCapitalRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getWorkingCapital'
    );

    const row = result[0] || {};
    const current = Number(row.current) || 0;
    const changePercent = Number(row.change_percent) || 0;

    return {
      current,
      changePercent,
      trend: changePercent > 0 ? 'up' : 'down'
    };
  }

  static async getCostBreakdown(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<CostBreakdown[]> {
    const dateCondition = startDate && endDate
      ? `WHERE purchase_datetime >= $1 AND purchase_datetime < $2 + INTERVAL '1 day'`
      : `WHERE purchase_datetime >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

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
        SUM(quantity * unit_cost) as value
      FROM purchases
      ${dateCondition}
      UNION ALL
      SELECT 
        'Stockout Costs' as category,
        COUNT(DISTINCT product_id) * 5000 as value
      FROM inventory_snapshots
      WHERE quantity_on_hand = 0
        AND snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
    `;

    const result = await QueryBuilder.executeWithDebug<CostBreakdownRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getCostBreakdown'
    );

    return result.map(r => ({
      category: r.category,
      value: Number(r.value) || 0
    }));
  }

  static async getCashFlowData(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<CashFlowData[]> {
    const useDefaultDates = !startDate || !endDate;
    
    const query = useDefaultDates ? `
      WITH date_params AS (
        SELECT 
          CURRENT_DATE - INTERVAL '30 days' as start_date,
          CURRENT_DATE as end_date
      )
      SELECT 
        DATE(d) as date,
        COALESCE(s.revenue, 0) as inflow,
        COALESCE(p.purchases, 0) as outflow
      FROM date_params,
           generate_series((SELECT start_date FROM date_params), (SELECT end_date FROM date_params), '1 day'::interval) d
      LEFT JOIN (
        SELECT DATE(sale_datetime) as date, SUM(total_price) as revenue
        FROM sales_partitioned, date_params
        WHERE sale_datetime >= (SELECT start_date FROM date_params)
          AND sale_datetime < (SELECT end_date FROM date_params) + INTERVAL '1 day'
          AND is_deleted = false
        GROUP BY DATE(sale_datetime)
      ) s ON d::date = s.date
      LEFT JOIN (
        SELECT DATE(purchase_datetime) as date, SUM(quantity * unit_cost) as purchases
        FROM purchases, date_params
        WHERE purchase_datetime >= (SELECT start_date FROM date_params) 
          AND purchase_datetime < (SELECT end_date FROM date_params) + INTERVAL '1 day'
        GROUP BY DATE(purchase_datetime)
      ) p ON d::date = p.date
      ORDER BY date
    ` : `
      SELECT 
        DATE(d) as date,
        COALESCE(s.revenue, 0) as inflow,
        COALESCE(p.purchases, 0) as outflow
      FROM generate_series($1::date, $2::date, '1 day'::interval) d
      LEFT JOIN (
        SELECT DATE(sale_datetime) as date, SUM(total_price) as revenue
        FROM sales_partitioned
        WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'
          AND is_deleted = false
        GROUP BY DATE(sale_datetime)
      ) s ON d::date = s.date
      LEFT JOIN (
        SELECT DATE(purchase_datetime) as date, SUM(quantity * unit_cost) as purchases
        FROM purchases
        WHERE purchase_datetime >= $1 AND purchase_datetime < $2 + INTERVAL '1 day'
        GROUP BY DATE(purchase_datetime)
      ) p ON d::date = p.date
      ORDER BY date
    `;

    const params = useDefaultDates ? [] : [startDate, endDate];

    const result = await QueryBuilder.executeWithDebug<CashFlowRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getCashFlowData'
    );

    return result.map(r => ({
      date: r.date,
      inflow: Number(r.inflow) || 0,
      outflow: Number(r.outflow) || 0
    }));
  }

  static async getFinancialAlerts(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<FinancialAlert[]> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day' AND is_deleted = false`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days' AND is_deleted = false`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        CASE 
          WHEN i.quantity_on_hand * p.cost > 50000 AND COALESCE(s.daily_sales, 0) < 1 
          THEN 'HIGH_VALUE_SLOW_MOVER'
          WHEN EXTRACT(days FROM NOW() - i.snapshot_timestamp) > p.shelf_life_days * 0.8 
          THEN 'NEAR_EXPIRY'
          WHEN p.cost > 1000 AND i.quantity_on_hand > COALESCE(r.recommended_quantity, 10) * 3
          THEN 'OVERSTOCK_HIGH_VALUE'
        END as alert_type,
        p.sku,
        p.product_name,
        i.quantity_on_hand * p.cost as value_at_risk
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN recommendations r ON i.product_id = r.product_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned
        ${dateCondition}
        GROUP BY product_id
      ) s ON i.product_id = s.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
        AND (
          (i.quantity_on_hand * p.cost > 50000 AND COALESCE(s.daily_sales, 0) < 1) OR
          (EXTRACT(days FROM NOW() - i.snapshot_timestamp) > p.shelf_life_days * 0.8) OR
          (p.cost > 1000 AND i.quantity_on_hand > COALESCE(r.recommended_quantity, 10) * 3)
        )
      ORDER BY value_at_risk DESC
      LIMIT 5
    `;

    const result = await QueryBuilder.executeWithDebug<FinancialAlertRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getFinancialAlerts'
    );

    return result.map(r => ({
      alert_type: r.alert_type ?? '',
      sku: r.sku ?? '',
      product_name: r.product_name ?? '',
      value_at_risk: Number(r.value_at_risk) || 0
    }));
  }

  static async getRevenueMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<RevenueMetrics> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day' AND is_deleted = false`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days' AND is_deleted = false`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      WITH daily_revenue AS (
        SELECT 
          DATE(sale_datetime) as date,
          SUM(total_price) as revenue
        FROM sales_partitioned
        ${dateCondition}
        GROUP BY DATE(sale_datetime)
      )
      SELECT 
        SUM(revenue) as total_revenue,
        AVG(revenue) as avg_daily_revenue,
        STDDEV(revenue) as revenue_volatility,
        MIN(revenue) as min_daily_revenue,
        MAX(revenue) as max_daily_revenue
      FROM daily_revenue
    `;

    const result = await QueryBuilder.executeWithDebug<RevenueMetricsRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getRevenueMetrics'
    );

    const row = result[0] || {};
    return {
      total_revenue: Number(row.total_revenue) || 0,
      avg_daily_revenue: Number(row.avg_daily_revenue) || 0,
      revenue_volatility: Number(row.revenue_volatility) || 0,
      min_daily_revenue: Number(row.min_daily_revenue) || 0,
      max_daily_revenue: Number(row.max_daily_revenue) || 0
    };
  }

  static async getProfitabilityMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<ProfitabilityMetrics> {
    const dateCondition = startDate && endDate
      ? `WHERE s.sale_datetime >= $1 AND s.sale_datetime < $2 + INTERVAL '1 day' AND s.is_deleted = false AND s.total_price > 0`
      : `WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days' AND s.is_deleted = false AND s.total_price > 0`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT
        SUM(s.total_price) as total_revenue,
        SUM(s.quantity * p.cost) as total_cost,
        SUM(s.total_price - s.quantity * p.cost) as gross_profit,
        (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) as gross_margin
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      ${dateCondition}
    `;

    const result = await QueryBuilder.executeWithDebug<ProfitabilityMetricsRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getProfitabilityMetrics'
    );

    const row = result[0] || {};
    return {
      total_revenue: Number(row.total_revenue) || 0,
      total_cost: Number(row.total_cost) || 0,
      gross_profit: Number(row.gross_profit) || 0,
      gross_margin: Number(row.gross_margin) || 0
    };
  }

  static async getInventoryValuation(app: AppWithPrisma): Promise<InventoryValuation> {
    const query = `
      SELECT 
        SUM(GREATEST(i.quantity_on_hand, 0) * p.cost) as total_value,
        COUNT(DISTINCT i.product_id) as unique_products,
        AVG(GREATEST(i.quantity_on_hand, 0) * p.cost) as avg_product_value,
        SUM(CASE WHEN i.quantity_on_hand = 0 THEN 1 ELSE 0 END) as out_of_stock_count
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
    `;

    const result = await QueryBuilder.executeWithDebug<InventoryValuationRow[]>(
      app.prisma,
      query,
      [],
      'FinancialQueries.getInventoryValuation'
    );

    const row = result[0] || {};
    return {
      total_value: Number(row.total_value) || 0,
      unique_products: Number(row.unique_products) || 0,
      avg_product_value: Number(row.avg_product_value) || 0,
      out_of_stock_count: Number(row.out_of_stock_count) || 0
    };
  }

  static async getPurchaseMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<PurchaseMetricsSummary> {
    const dateCondition = startDate && endDate
      ? `WHERE purchase_datetime >= $1 AND purchase_datetime < $2 + INTERVAL '1 day'`
      : `WHERE purchase_datetime >= CURRENT_DATE - INTERVAL '30 days'`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        COUNT(*) as total_purchases,
        SUM(quantity * unit_cost) as total_purchase_value,
        AVG(quantity * unit_cost) as avg_purchase_value,
        COUNT(DISTINCT product_id) as unique_products_purchased
      FROM purchases
      ${dateCondition}
    `;

    const result = await QueryBuilder.executeWithDebug<PurchaseMetricsRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getPurchaseMetrics'
    );

    const row = result[0] || {};
    return {
      total_purchases: Number(row.total_purchases) || 0,
      total_purchase_value: Number(row.total_purchase_value) || 0,
      avg_purchase_value: Number(row.avg_purchase_value) || 0,
      unique_products_purchased: Number(row.unique_products_purchased) || 0
    };
  }

  static async getCostAnalysis(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<CostAnalysisEntry[]> {
    const dateCondition = startDate && endDate
      ? `AND s.sale_datetime >= $1 AND s.sale_datetime < $2 + INTERVAL '1 day' AND s.is_deleted = false`
      : `AND s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days' AND s.is_deleted = false`;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const query = `
      SELECT 
        p.category,
        SUM(GREATEST(i.quantity_on_hand, 0) * p.cost) as inventory_value,
        SUM(s.quantity * p.cost) as cost_of_goods_sold,
        COUNT(DISTINCT i.product_id) as product_count
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN sales_partitioned s ON i.product_id = s.product_id
        AND s.sale_datetime IS NOT NULL ${dateCondition}
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      GROUP BY p.category
      ORDER BY inventory_value DESC
    `;

    const result = await QueryBuilder.executeWithDebug<CostAnalysisRow[]>(
      app.prisma,
      query,
      params,
      'FinancialQueries.getCostAnalysis'
    );

    return result.map(r => ({
      category: r.category,
      inventory_value: Number(r.inventory_value) || 0,
      cost_of_goods_sold: Number(r.cost_of_goods_sold) || 0,
      product_count: Number(r.product_count) || 0
    }));
  }

  // ─── Accounting-sourced queries ────────────────────────────────────────

  static async getInvoicedRevenue(
    app: AppWithPrisma,
    startDate?: Date,
    endDate?: Date
  ): Promise<{ total: number; byMonth: Array<{ month: string; revenue: number }> }> {
    try {
      const dateCondition = startDate && endDate
        ? `WHERE invoice_month >= DATE_TRUNC('month', $1::date) AND invoice_month <= DATE_TRUNC('month', $2::date)`
        : `WHERE invoice_month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')`;
      const params = startDate && endDate ? [startDate, endDate] : [];

      const totalQuery = `SELECT COALESCE(SUM(net_revenue), 0) as total FROM invoice_revenue_by_product ${dateCondition}`;
      const totalResult = await QueryBuilder.executeWithDebug<[{ total: number }]>(
        app.prisma, totalQuery, params, 'FinancialQueries.getInvoicedRevenue.total'
      );

      const byMonthQuery = `
        SELECT invoice_month as month, SUM(net_revenue) as revenue
        FROM invoice_revenue_by_product ${dateCondition}
        GROUP BY invoice_month ORDER BY invoice_month
      `;
      const byMonthResult = await QueryBuilder.executeWithDebug<Array<{ month: string; revenue: number }>>(
        app.prisma, byMonthQuery, params, 'FinancialQueries.getInvoicedRevenue.byMonth'
      );

      return {
        total: Number(totalResult[0]?.total) || 0,
        byMonth: byMonthResult.map(r => ({ month: String(r.month), revenue: Number(r.revenue) || 0 }))
      };
    } catch (error) {
      app.log.error({ err: error }, '[FINANCIAL] Error getting invoiced revenue (view may not exist yet)');
      return { total: 0, byMonth: [] };
    }
  }

  static async getRevenueByChannel(
    app: AppWithPrisma,
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ channel: string; revenue: number; invoiceCount: number }>> {
    try {
      const dateCondition = startDate && endDate
        ? `WHERE invoice_month >= DATE_TRUNC('month', $1::date) AND invoice_month <= DATE_TRUNC('month', $2::date)`
        : `WHERE invoice_month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '6 months')`;
      const params = startDate && endDate ? [startDate, endDate] : [];

      const query = `
        SELECT
          COALESCE(cost_center, 'Sin asignar') as channel,
          SUM(net_revenue) as revenue,
          SUM(invoice_count) as invoice_count
        FROM invoice_revenue_by_product ${dateCondition}
        GROUP BY cost_center
        ORDER BY revenue DESC
      `;

      const result = await QueryBuilder.executeWithDebug<Array<{ channel: string; revenue: number; invoice_count: number }>>(
        app.prisma, query, params, 'FinancialQueries.getRevenueByChannel'
      );

      return result.map(r => ({
        channel: r.channel,
        revenue: Number(r.revenue) || 0,
        invoiceCount: Number(r.invoice_count) || 0
      }));
    } catch (error) {
      app.log.error({ err: error }, '[FINANCIAL] Error getting revenue by channel (view may not exist yet)');
      return [];
    }
  }
}