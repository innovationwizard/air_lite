import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse, errorResponseFromError } from '../../../utils/responses';
import { CacheService } from '../services/cache.service';
import { RateLimiterService } from '../services/rate-limiter.service';
import { validateDrillDownOptions } from '../utils/validators';
import { QueryBuilder } from '../utils/query-builder';
import type { AppWithPrisma } from '../types';

interface DrillDownResponse<T> {
  metric: string;
  timeRange: string;
  data: T[];
  summary: Record<string, number>;
}

interface SalesRow {
  date: string;
  category: string | null;
  revenue: number;
  quantity: number;
  orders: number;
  unique_customers: number;
}

interface InventoryRow {
  category: string | null;
  sku: string | null;
  product_name: string | null;
  quantity_on_hand: number | null;
  value: number | null;
  daily_sales: number | null;
  days_of_stock: number | null;
}

interface PurchasesRow {
  date: string;
  category: string | null;
  supplier: string | null;
  total_cost: number;
  quantity: number;
  purchase_orders: number;
}

interface CustomerRow {
  client_id: number;
  total_orders: number;
  total_spent: number;
  avg_order_value: number;
  last_purchase: string;
  first_purchase: string;
}

interface ProductRow {
  sku: string;
  product_name: string;
  category: string | null;
  total_quantity: number;
  total_revenue: number;
  total_orders: number;
  avg_price: number;
  margin: number | null;
}

interface FinancialRow {
  date: string;
  revenue: number;
  cost_of_goods_sold: number;
  gross_profit: number;
  gross_margin: number | null;
}

interface PerfectOrderRow {
  date: string;
  total_orders: number;
  perfect_orders: number;
  rate: number;
}

interface FailureReasonRow {
  reason: string;
  count: number;
}

interface AIStockoutRow {
  product_name: string;
  sku: string;
  times_prevented: number;
  value_saved: number;
}

interface OverstockRow {
  product_name: string;
  sku: string;
  avg_reduction: number;
  holding_saved: number;
}

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class DrillDownHandler {
  static async getDrillDown(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { metric } = request.params as { metric: string };
      const { timeRange = '30d' } = request.query as { timeRange?: string };
      const userId = request.user?.id;
      if (!userId) {
        throw new Error('Unauthorized');
      }

      request.log.info(
        `[DRILLDOWN HANDLER] Getting drill-down for metric: ${metric}, timeRange: ${timeRange}, user: ${userId}`
      );

      validateDrillDownOptions({ timeRange: timeRange as '7d' | '30d' | '90d' | '1y', metric });

      RateLimiterService.checkRateLimit(userId);

      const cacheKey = CacheService.generateKey('drilldown', String(metric), String(timeRange));
      const cached = await CacheService.get<DrillDownResponse<unknown>>(cacheKey);
      if (cached) {
        request.log.info(`[DRILLDOWN HANDLER] Cache hit for metric: ${metric}`);
        return successResponse(reply, cached);
      }

      const data = await this.getLevel1DrillDown(request.server, metric, timeRange);

      await CacheService.set(cacheKey, data, 300);

      request.log.info(`[DRILLDOWN HANDLER] Successfully retrieved drill-down data for metric: ${metric}`);
      return successResponse(reply, data);
    } catch (error: unknown) {
      request.log.error({ err: error }, '[DRILLDOWN HANDLER] Error getting drill-down:');
      return errorResponseFromError(reply, new Error(getErrorMessage(error)));
    }
  }

  private static async getLevel1DrillDown(app: AppWithPrisma, metric: string, timeRange: string): Promise<DrillDownResponse<unknown>> {
    app.log.info(`[DRILLDOWN HANDLER] Getting level 1 drill-down for metric: ${metric}, timeRange: ${timeRange}`);

    const days = this.getDaysFromTimeRange(timeRange);
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const endDate = new Date();

    switch (metric) {
      case 'sales':
        return await this.getSalesDrillDown(app, startDate, endDate);
      case 'inventory':
        return await this.getInventoryDrillDown(app, startDate, endDate);
      case 'purchases':
        return await this.getPurchasesDrillDown(app, startDate, endDate);
      case 'customers':
        return await this.getCustomersDrillDown(app, startDate, endDate);
      case 'products':
        return await this.getProductsDrillDown(app, startDate, endDate);
      case 'financial':
        return await this.getFinancialDrillDown(app, startDate, endDate);
      case 'perfect-order-rate':
        return await this.getPerfectOrderRateDrillDown(app, startDate, endDate) as unknown as DrillDownResponse<unknown>;
      case 'ai-value-add':
        return await this.getAIValueAddDrillDown(app, startDate, endDate) as unknown as DrillDownResponse<unknown>;
      default:
        throw new Error(`Unknown metric: ${metric}`);
    }
  }

  private static getDaysFromTimeRange(timeRange: string): number {
    switch (timeRange) {
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      case '1y': return 365;
      default: return 30;
    }
  }

  private static async getSalesDrillDown(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<DrillDownResponse<SalesRow>> {
    const query = `
      SELECT 
        DATE(sale_datetime) as date,
        p.category,
        SUM(s.total_price) as revenue,
        SUM(s.quantity * s.uom_ratio) as quantity,
        COUNT(*) as orders,
        COUNT(DISTINCT s.client_id) as unique_customers
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      WHERE s.sale_datetime BETWEEN $1::timestamp AND $2::timestamp
      GROUP BY DATE(sale_datetime), p.category
      ORDER BY date DESC, revenue DESC
    `;

    const data = await QueryBuilder.executeWithDebug<SalesRow[]>(
      app.prisma,
      query,
      [startDate.toISOString(), endDate.toISOString()],
      'DrillDownHandler.getSalesDrillDown'
    );

    return {
      metric: 'sales',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      data,
      summary: {
        totalRevenue: data.reduce((sum, item) => sum + item.revenue, 0),
        totalOrders: data.reduce((sum, item) => sum + item.orders, 0),
        totalQuantity: data.reduce((sum, item) => sum + item.quantity, 0),
        uniqueCustomers: new Set(data.map(item => item.unique_customers)).size
      }
    };
  }

  private static async getInventoryDrillDown(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<DrillDownResponse<InventoryRow>> {
    const query = `
      SELECT 
        p.category,
        p.sku,
        p.product_name,
        i.quantity_on_hand,
        i.quantity_on_hand * p.cost as value,
        COALESCE(s.daily_sales, 0) as daily_sales,
        CASE 
          WHEN s.daily_sales > 0 THEN i.quantity_on_hand / s.daily_sales
          ELSE 999
        END as days_of_stock
      FROM inventory_snapshots i
      JOIN products p ON i.product_id = p.product_id
      LEFT JOIN (
        SELECT product_id, SUM(quantity * uom_ratio) / 30.0 as daily_sales
        FROM sales_partitioned
        WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
        GROUP BY product_id
      ) s ON i.product_id = s.product_id
      WHERE i.snapshot_timestamp = (SELECT MAX(snapshot_timestamp) FROM inventory_snapshots)
      ORDER BY value DESC
    `;

    const data = await QueryBuilder.executeWithDebug<InventoryRow[]>(
      app.prisma,
      query,
      [],
      'DrillDownHandler.getInventoryDrillDown'
    );

    return {
      metric: 'inventory',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      data,
      summary: {
        totalValue: data.reduce((sum, item) => sum + (item.value ?? 0), 0),
        totalItems: data.length,
        outOfStock: data.filter(item => item.quantity_on_hand === 0).length,
        slowMoving: data.filter(item => (item.days_of_stock ?? 0) > 90).length
      }
    };
  }

  private static async getPurchasesDrillDown(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<DrillDownResponse<PurchasesRow>> {
    const query = `
      SELECT 
        DATE(pur.purchase_datetime) as date,
        p.category,
        p.supply_type as supplier,
        SUM(pur.total_cost) as total_cost,
        SUM(pur.quantity) as quantity,
        COUNT(*) as purchase_orders
      FROM purchases pur
      JOIN products p ON pur.product_id = p.product_id
      WHERE pur.purchase_datetime BETWEEN $1::timestamp AND $2::timestamp
      GROUP BY DATE(pur.purchase_datetime), p.category, p.supply_type
      ORDER BY date DESC, total_cost DESC
    `;

    const data = await QueryBuilder.executeWithDebug<PurchasesRow[]>(
      app.prisma,
      query,
      [startDate.toISOString(), endDate.toISOString()],
      'DrillDownHandler.getPurchasesDrillDown'
    );

    return {
      metric: 'purchases',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      data,
      summary: {
        totalCost: data.reduce((sum, item) => sum + item.total_cost, 0),
        totalQuantity: data.reduce((sum, item) => sum + item.quantity, 0),
        totalOrders: data.reduce((sum, item) => sum + item.purchase_orders, 0),
        uniqueSuppliers: new Set(data.map(item => item.supplier)).size
      }
    };
  }

  private static async getCustomersDrillDown(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<DrillDownResponse<CustomerRow>> {
    const query = `
      SELECT 
        s.client_id,
        COUNT(*) as total_orders,
        SUM(s.total_price) as total_spent,
        AVG(s.total_price) as avg_order_value,
        MAX(s.sale_datetime) as last_purchase,
        MIN(s.sale_datetime) as first_purchase
      FROM sales_partitioned s
      WHERE s.sale_datetime BETWEEN $1::timestamp AND $2::timestamp
      GROUP BY s.client_id
      ORDER BY total_spent DESC
      LIMIT 100
    `;

    const data = await QueryBuilder.executeWithDebug<CustomerRow[]>(
      app.prisma,
      query,
      [startDate.toISOString(), endDate.toISOString()],
      'DrillDownHandler.getCustomersDrillDown'
    );

    return {
      metric: 'customers',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      data,
      summary: {
        totalCustomers: data.length,
        totalRevenue: data.reduce((sum, item) => sum + item.total_spent, 0),
        avgOrderValue: data.reduce((sum, item) => sum + item.avg_order_value, 0) / data.length,
        repeatCustomers: data.filter(item => item.total_orders > 1).length
      }
    };
  }

  private static async getProductsDrillDown(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<DrillDownResponse<ProductRow>> {
    const query = `
      SELECT 
        p.sku,
        p.product_name,
        p.category,
        SUM(s.quantity * s.uom_ratio) as total_quantity,
        SUM(s.total_price) as total_revenue,
        COUNT(*) as total_orders,
        AVG(s.unit_price) as avg_price,
        (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) as margin
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      WHERE s.sale_datetime BETWEEN $1::timestamp AND $2::timestamp
        AND s.total_price > 0
      GROUP BY p.sku, p.product_name, p.category
      ORDER BY total_revenue DESC
      LIMIT 100
    `;

    const data = await QueryBuilder.executeWithDebug<ProductRow[]>(
      app.prisma,
      query,
      [startDate.toISOString(), endDate.toISOString()],
      'DrillDownHandler.getProductsDrillDown'
    );

    return {
      metric: 'products',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      data,
      summary: {
        totalProducts: data.length,
        totalRevenue: data.reduce((sum, item) => sum + item.total_revenue, 0),
        totalQuantity: data.reduce((sum, item) => sum + item.total_quantity, 0),
        avgMargin: data.reduce((sum, item) => sum + (item.margin || 0), 0) / data.length
      }
    };
  }

  private static async getFinancialDrillDown(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<DrillDownResponse<FinancialRow>> {
    const query = `
      SELECT 
        DATE(sale_datetime) as date,
        SUM(s.total_price) as revenue,
        SUM(s.quantity * p.cost) as cost_of_goods_sold,
        SUM(s.total_price - s.quantity * p.cost) as gross_profit,
        (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) as gross_margin
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      WHERE s.sale_datetime BETWEEN $1::timestamp AND $2::timestamp
        AND s.total_price > 0
      GROUP BY DATE(sale_datetime)
      ORDER BY date DESC
    `;

    const data = await QueryBuilder.executeWithDebug<FinancialRow[]>(
      app.prisma,
      query,
      [startDate.toISOString(), endDate.toISOString()],
      'DrillDownHandler.getFinancialDrillDown'
    );

    return {
      metric: 'financial',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      data,
      summary: {
        totalRevenue: data.reduce((sum, item) => sum + item.revenue, 0),
        totalCost: data.reduce((sum, item) => sum + item.cost_of_goods_sold, 0),
        totalProfit: data.reduce((sum, item) => sum + item.gross_profit, 0),
        avgMargin: data.reduce((sum, item) => sum + (item.gross_margin || 0), 0) / data.length
      }
    };
  }

  private static async getPerfectOrderRateDrillDown(
    app: AppWithPrisma,
    startDate: Date,
    endDate: Date
  ): Promise<{
    metric: string;
    timeRange: string;
    breakdown: PerfectOrderRow[];
    failureReasons: FailureReasonRow[];
  }> {
    const query = `
      SELECT 
        DATE(s.sale_datetime) as date,
        COUNT(*) as total_orders,
        SUM(CASE WHEN s.quantity = s.quantity AND r.return_id IS NULL THEN 1 ELSE 0 END) as perfect_orders,
        AVG(CASE WHEN s.quantity = s.quantity AND r.return_id IS NULL THEN 1 ELSE 0 END) as rate
      FROM sales_partitioned s
      LEFT JOIN returns r ON s.sale_id = r.sale_id
      WHERE s.sale_datetime BETWEEN $1::timestamp AND $2::timestamp
      GROUP BY DATE(s.sale_datetime)
      ORDER BY date DESC
    `;

    const failureReasonsQuery = `
      SELECT 
        CASE 
          WHEN r.return_reason IS NOT NULL THEN r.return_reason
          ELSE 'Other'
        END as reason,
        COUNT(*) as count
      FROM sales_partitioned s
      LEFT JOIN returns r ON s.sale_id = r.sale_id
      WHERE s.sale_datetime BETWEEN $1::timestamp AND $2::timestamp
        AND (r.return_id IS NOT NULL)
      GROUP BY reason
      ORDER BY count DESC
    `;

    const [breakdown, failureReasons] = await Promise.all([
      QueryBuilder.executeWithDebug<PerfectOrderRow[]>(
        app.prisma,
        query,
        [startDate.toISOString(), endDate.toISOString()],
        'DrillDownHandler.getPerfectOrderRateDrillDown'
      ),
      QueryBuilder.executeWithDebug<FailureReasonRow[]>(
        app.prisma,
        failureReasonsQuery,
        [startDate.toISOString(), endDate.toISOString()],
        'DrillDownHandler.getPerfectOrderRateFailureReasons'
      )
    ]);

    return {
      metric: 'perfect-order-rate',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      breakdown,
      failureReasons
    };
  }

  private static async getAIValueAddDrillDown(app: AppWithPrisma, startDate: Date, endDate: Date): Promise<{
    metric: string;
    timeRange: string;
    stockoutsPrevented: AIStockoutRow[];
    overstockReduced: OverstockRow[];
  }> {
    const stockoutsPreventedQuery = `
      SELECT 
        p.product_name,
        p.sku,
        COUNT(*) as times_prevented,
        SUM(p.cost * r.recommended_quantity * 0.25) as value_saved
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      WHERE r.created_at BETWEEN $1::timestamp AND $2::timestamp
        AND r.reason LIKE '%prevent stockout%'
      GROUP BY p.product_id, p.product_name, p.sku
      ORDER BY value_saved DESC
      LIMIT 20
    `;

    const overstockReducedQuery = `
      SELECT 
        p.product_name,
        p.sku,
        AVG(i.quantity_on_hand - r.recommended_quantity) as avg_reduction,
        SUM(p.cost * (i.quantity_on_hand - r.recommended_quantity) * 0.1) as holding_saved
      FROM recommendations r
      JOIN products p ON r.product_id = p.product_id
      JOIN inventory_snapshots i ON r.product_id = i.product_id
      WHERE r.created_at BETWEEN $1::timestamp AND $2::timestamp
        AND i.quantity_on_hand > r.recommended_quantity * 1.5
      GROUP BY p.product_id, p.product_name, p.sku
      ORDER BY holding_saved DESC
      LIMIT 20
    `;

    const [stockoutsPrevented, overstockReduced] = await Promise.all([
      QueryBuilder.executeWithDebug<AIStockoutRow[]>(app.prisma, stockoutsPreventedQuery, [startDate.toISOString(), endDate.toISOString()], 'DrillDownHandler.getStockoutsPrevented'),
      QueryBuilder.executeWithDebug<OverstockRow[]>(app.prisma, overstockReducedQuery, [startDate.toISOString(), endDate.toISOString()], 'DrillDownHandler.getOverstockReduced')
    ]);

    return {
      metric: 'ai-value-add',
      timeRange: `${startDate.toISOString()} to ${endDate.toISOString()}`,
      stockoutsPrevented,
      overstockReduced
    };
  }
}
