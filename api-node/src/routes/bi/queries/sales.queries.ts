import { QueryBuilder } from '../utils/query-builder';
import {
  SalesMetrics,
  SalesVelocity,
  CategoryContribution,
  StockoutRisk,
  AppWithPrisma
} from '../types';

interface SalesMetricsRow {
  revenue: number | null;
  unique_customers: number | null;
  total_orders: number | null;
}

interface SalesVelocityRow {
  hour: number | null;
  dayOfWeek: number | null;
  sales: number | null;
}

interface CategoryContributionRow {
  category: string | null;
  revenue: number | null;
  margin: number | null;
}

interface StockoutRiskRow {
  sku: string;
  product_name: string;
  current_stock: number | null;
  week_demand: number | null;
  days_of_stock: number | null;
}

export interface SalesTrendEntry {
  date: string;
  revenue: number;
  orders: number;
  unique_customers: number;
}

interface SalesTrendRow {
  date: string;
  revenue: number | null;
  orders: number | null;
  unique_customers: number | null;
}

interface TopProductRow {
  sku: string;
  product_name: string;
  category: string;
  total_quantity: number | null;
  total_revenue: number | null;
  unique_customers: number | null;
  avg_price: number | null;
}

export interface TopProductEntry {
  sku: string;
  product_name: string;
  category: string;
  total_quantity: number;
  total_revenue: number;
  unique_customers: number;
  avg_price: number;
}

interface TopCustomerRow {
  client_id: number;
  client_name: string | null;
  total_orders: number | null;
  total_spent: number | null;
  avg_order_value: number | null;
  last_purchase: string | null;
}

export interface TopCustomerEntry {
  client_id: number;
  client_name: string | null;
  total_orders: number;
  total_spent: number;
  avg_order_value: number;
  last_purchase: string | null;
}

interface CustomerMetricsRow {
  total_customers: number | null;
  repeat_customers: number | null;
  avg_customer_value: number | null;
  avg_order_value: number | null;
  active_customers: number | null;
}

export interface CustomerMetrics {
  total_customers: number;
  repeat_customers: number;
  avg_customer_value: number;
  avg_order_value: number;
  active_customers: number;
}

interface SalesByHourRow {
  hour: number | null;
  orders: number | null;
  revenue: number | null;
  avg_order_value: number | null;
}

export interface SalesByHourEntry {
  hour: number;
  orders: number;
  revenue: number;
  avg_order_value: number;
}

interface SalesByDayRow {
  day_of_week: number | null;
  day_name: string;
  orders: number | null;
  revenue: number | null;
  avg_order_value: number | null;
}

export interface SalesByDayEntry {
  day_of_week: number;
  day_name: string;
  orders: number;
  revenue: number;
  avg_order_value: number;
}

interface SalesForecastAccuracyRow {
  total_forecasts: number | null;
  avg_predicted_demand: number | null;
  min_predicted_demand: number | null;
  max_predicted_demand: number | null;
}

export interface SalesForecastAccuracy {
  total_forecasts: number;
  avg_predicted_demand: number;
  min_predicted_demand: number;
  max_predicted_demand: number;
}

export class SalesQueries {
  static async getSalesMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<SalesMetrics> {
    app.log.info(`[SALES QUERIES] getSalesMetrics called with dates: ${startDate?.toISOString()} to ${endDate?.toISOString()}`);
    
    const query = startDate && endDate ? `
      SELECT
        SUM(total_price) as revenue,
        COUNT(DISTINCT client_id) as unique_customers,
        COUNT(*) as total_orders
      FROM sales_partitioned
      WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'
        AND is_deleted = false
    ` : `
      SELECT
        SUM(total_price) as revenue,
        COUNT(DISTINCT client_id) as unique_customers,
        COUNT(*) as total_orders
      FROM sales_partitioned
      WHERE sale_datetime >= (SELECT MAX(sale_datetime) - INTERVAL '30 days' FROM sales_partitioned)
        AND sale_datetime <= (SELECT MAX(sale_datetime) FROM sales_partitioned)
        AND is_deleted = false
    `;

    const params = startDate && endDate ? [startDate, endDate] : [];
    app.log.info({ params }, `[SALES QUERIES] Using query with params:`);

    const result = await QueryBuilder.executeWithDebug<SalesMetricsRow[]>(
      app.prisma,
      query,
      params,
      'SalesQueries.getSalesMetrics'
    );

    app.log.info({ result }, `[SALES QUERIES] Query result:`);

    const [row = {} as SalesMetricsRow] = result;
    const revenue = Number(row.revenue) || 0;
    const target = 1500000;

    const metrics = { 
      revenue, 
      target, 
      unique_customers: Number(row.unique_customers) || 0,
      total_orders: Number(row.total_orders) || 0
    };

    app.log.info({ metrics }, `[SALES QUERIES] Returning metrics:`);
    return metrics;
  }

  static async getSalesVelocityHeatmap(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<SalesVelocity[]> {
    const query = startDate && endDate ? `
      SELECT
        EXTRACT(hour FROM sale_datetime) as hour,
        EXTRACT(dow FROM sale_datetime) as dayOfWeek,
        COUNT(*) as sales
      FROM sales_partitioned
      WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'
        AND is_deleted = false
      GROUP BY hour, dayOfWeek
      ORDER BY dayOfWeek, hour
    ` : `
      SELECT
        EXTRACT(hour FROM sale_datetime) as hour,
        EXTRACT(dow FROM sale_datetime) as dayOfWeek,
        COUNT(*) as sales
      FROM sales_partitioned
      WHERE sale_datetime >= (SELECT MAX(sale_datetime) - INTERVAL '30 days' FROM sales_partitioned)
        AND sale_datetime <= (SELECT MAX(sale_datetime) FROM sales_partitioned)
        AND is_deleted = false
      GROUP BY hour, dayOfWeek
      ORDER BY dayOfWeek, hour
    `;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const result = await QueryBuilder.executeWithDebug<SalesVelocityRow[]>(
      app.prisma,
      query,
      params,
      'SalesQueries.getSalesVelocityHeatmap'
    );

    return result.map(({ hour, dayOfWeek, sales }: SalesVelocityRow) => ({
      hour: Number(hour) || 0,
      dayOfWeek: Number(dayOfWeek) || 0,
      sales: Number(sales) || 0
    }));
  }

  static async getCategoryContribution(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<CategoryContribution[]> {
    const query = startDate && endDate ? `
      SELECT
        p.category,
        SUM(s.total_price) as revenue,
        (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) as margin
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      WHERE s.sale_datetime >= $1 AND s.sale_datetime < $2 + INTERVAL '1 day'
        AND s.is_deleted = false
        AND s.unit_price > 0
      GROUP BY p.category
      ORDER BY revenue DESC
    ` : `
      SELECT
        p.category,
        SUM(s.total_price) as revenue,
        (SUM(s.total_price) - SUM(s.quantity * p.cost)) / NULLIF(SUM(s.total_price), 0) as margin
      FROM sales_partitioned s
      JOIN products p ON s.product_id = p.product_id
      WHERE s.sale_datetime >= (SELECT MAX(sale_datetime) - INTERVAL '30 days' FROM sales_partitioned)
        AND s.sale_datetime <= (SELECT MAX(sale_datetime) FROM sales_partitioned)
        AND s.is_deleted = false
        AND s.unit_price > 0
      GROUP BY p.category
      ORDER BY revenue DESC
    `;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const result = await QueryBuilder.executeWithDebug<CategoryContributionRow[]>(
      app.prisma,
      query,
      params,
      'SalesQueries.getCategoryContribution'
    );

    return result.map(({ category, revenue, margin }: CategoryContributionRow) => ({
      category: category || 'Sin categoría',
      revenue: Number(revenue) || 0,
      margin: Number(margin) || 0
    }));
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
          AND is_deleted = false
        GROUP BY product_id
      ) s ON p.product_id = s.product_id
      WHERE p.is_deleted = false
        AND COALESCE(i.quantity_on_hand, 0) < COALESCE(s.daily_sales * 7, 1)
      ORDER BY days_of_stock
      LIMIT $1
    `;

    const result = await QueryBuilder.executeWithDebug<StockoutRiskRow[]>(
      app.prisma,
      query,
      [limit],
      'SalesQueries.getStockoutRisks'
    );

    return result.map(({ sku, product_name, current_stock, week_demand, days_of_stock }: StockoutRiskRow) => ({
      sku,
      product_name,
      current_stock: Number(current_stock) || 0,
      week_demand: Number(week_demand) || 0,
      days_of_stock: Number(days_of_stock) || 0
    }));
  }

  // Sales Trend
  static async getSalesTrend(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<SalesTrendEntry[]> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day' AND is_deleted = false`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days' AND is_deleted = false`;

    const query = `
    SELECT
      DATE(sale_datetime) as date,
      SUM(total_price) as revenue,
      COUNT(*) as orders,
      COUNT(DISTINCT client_id) as unique_customers
    FROM sales_partitioned
    ${dateCondition}
    GROUP BY DATE(sale_datetime)
    ORDER BY date
  `;

    const params = startDate && endDate ? [startDate, endDate] : [];

    const result = await QueryBuilder.executeWithDebug<SalesTrendRow[]>(
      app.prisma,
      query,
      params,
      'SalesQueries.getSalesTrend'
    );

    return result.map(({ date, revenue, orders, unique_customers }: SalesTrendRow) => ({
      date,
      revenue: Number(revenue) || 0,
      orders: Number(orders) || 0,
      unique_customers: Number(unique_customers) || 0
    }));
  }

  // Top Products
  static async getTopProducts(app: AppWithPrisma, startDate?: Date, endDate?: Date, limit: number = 10): Promise<TopProductEntry[]> {
    const dateCondition = startDate && endDate
      ? `WHERE s.sale_datetime >= $1 AND s.sale_datetime < $2 + INTERVAL '1 day' AND s.is_deleted = false`
      : `WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days' AND s.is_deleted = false`;

    const query = `
    SELECT
      p.sku,
      p.product_name,
      p.category,
      SUM(s.quantity * s.uom_ratio) as total_quantity,
      SUM(s.total_price) as total_revenue,
      COUNT(DISTINCT s.client_id) as unique_customers,
      AVG(s.unit_price) as avg_price
    FROM sales_partitioned s
    JOIN products p ON s.product_id = p.product_id
    ${dateCondition}
    GROUP BY p.sku, p.product_name, p.category
    ORDER BY total_revenue DESC
    LIMIT $${startDate && endDate ? 3 : 1}
  `;

    const params = startDate && endDate ? [startDate, endDate, limit] : [limit];

    const result = await QueryBuilder.executeWithDebug<TopProductRow[]>(
      app.prisma,
      query,
      params,
      'SalesQueries.getTopProducts'
    );

    return result.map(({ sku, product_name, category, total_quantity, total_revenue, unique_customers, avg_price }: TopProductRow) => ({
      sku,
      product_name,
      category,
      total_quantity: Number(total_quantity) || 0,
      total_revenue: Number(total_revenue) || 0,
      unique_customers: Number(unique_customers) || 0,
      avg_price: Number(avg_price) || 0
    }));
  }

  // Top Customers
  static async getTopCustomers(app: AppWithPrisma, startDate?: Date, endDate?: Date, limit: number = 10): Promise<TopCustomerEntry[]> {
    const dateCondition = startDate && endDate
      ? `WHERE s.sale_datetime >= $1 AND s.sale_datetime < $2 + INTERVAL '1 day' AND s.is_deleted = false`
      : `WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '90 days' AND s.is_deleted = false`;

    const query = `
    SELECT
      s.client_id,
      c.client_name,
      COUNT(*) as total_orders,
      SUM(s.total_price) as total_spent,
      AVG(s.total_price) as avg_order_value,
      MAX(s.sale_datetime) as last_purchase
    FROM sales_partitioned s
    LEFT JOIN clients c ON s.client_id = c.client_id AND c.is_deleted = false
    ${dateCondition}
    GROUP BY s.client_id, c.client_name
    ORDER BY total_spent DESC
    LIMIT $${startDate && endDate ? 3 : 1}
  `;

    const params = startDate && endDate ? [startDate, endDate, limit] : [limit];

    const result = await QueryBuilder.executeWithDebug<TopCustomerRow[]>(
      app.prisma,
      query,
      params,
      'SalesQueries.getTopCustomers'
    );

    return result.map(({ client_id, client_name, total_orders, total_spent, avg_order_value, last_purchase }: TopCustomerRow) => ({
      client_id,
      client_name: client_name ?? null,
      total_orders: Number(total_orders) || 0,
      total_spent: Number(total_spent) || 0,
      avg_order_value: Number(avg_order_value) || 0,
      last_purchase
    }));
  }

  static async getCustomerMetrics(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<CustomerMetrics> {
    const dateCondition = startDate && endDate
      ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day' AND is_deleted = false`
      : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '90 days' AND is_deleted = false`;

    const query = `
      WITH customer_stats AS (
        SELECT
          client_id,
          COUNT(*) as total_orders,
          SUM(total_price) as total_spent,
          MAX(sale_datetime) as last_purchase
        FROM sales_partitioned
        ${dateCondition}
        GROUP BY client_id
      )
      SELECT 
        COUNT(*) as total_customers,
        COUNT(CASE WHEN total_orders >= 2 THEN 1 END) as repeat_customers,
        AVG(total_spent) as avg_customer_value,
        SUM(total_spent) / NULLIF(SUM(total_orders), 0) as avg_order_value,
        COUNT(CASE WHEN last_purchase >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as active_customers
      FROM customer_stats
    `;
  
    const params = startDate && endDate ? [startDate, endDate] : [];

    const result = await QueryBuilder.executeWithDebug<CustomerMetricsRow[]>(
      app.prisma,
      query,
      params,
      'SalesQueries.getCustomerMetrics'
    );

    const [row = {} as CustomerMetricsRow] = result;
    app.log.info({ row }, '[SALES QUERIES] getCustomerMetrics result:');
    return {
      total_customers: Number(row.total_customers) || 0,
      repeat_customers: Number(row.repeat_customers) || 0,
      avg_customer_value: Number(row.avg_customer_value) || 0,
      avg_order_value: Number(row.avg_order_value) || 0,
      active_customers: Number(row.active_customers) || 0
    };
  }

  static async getSalesByHour(app: AppWithPrisma): Promise<SalesByHourEntry[]> {
    const query = `
      SELECT 
        EXTRACT(hour FROM sale_datetime) as hour,
        COUNT(*) as orders,
        SUM(total_price) as revenue,
        AVG(total_price) as avg_order_value
      FROM sales_partitioned
      WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
        AND is_deleted = false
      GROUP BY EXTRACT(hour FROM sale_datetime)
      ORDER BY hour
    `;

    const result = await QueryBuilder.executeWithDebug<SalesByHourRow[]>(
      app.prisma,
      query,
      [],
      'SalesQueries.getSalesByHour'
    );

    return result.map(({ hour, orders, revenue, avg_order_value }: SalesByHourRow) => ({
      hour: Number(hour) || 0,
      orders: Number(orders) || 0,
      revenue: Number(revenue) || 0,
      avg_order_value: Number(avg_order_value) || 0
    }));
  }

  static async getSalesByDayOfWeek(app: AppWithPrisma): Promise<SalesByDayEntry[]> {
    const query = `
      SELECT 
        EXTRACT(dow FROM sale_datetime) as day_of_week,
        TO_CHAR(sale_datetime, 'Day') as day_name,
        COUNT(*) as orders,
        SUM(total_price) as revenue,
        AVG(total_price) as avg_order_value
      FROM sales_partitioned
      WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
        AND is_deleted = false
      GROUP BY EXTRACT(dow FROM sale_datetime), TO_CHAR(sale_datetime, 'Day')
      ORDER BY day_of_week
    `;

    const result = await QueryBuilder.executeWithDebug<SalesByDayRow[]>(
      app.prisma,
      query,
      [],
      'SalesQueries.getSalesByDayOfWeek'
    );

    return result.map(({ day_of_week, day_name, orders, revenue, avg_order_value }: SalesByDayRow) => ({
      day_of_week: Number(day_of_week) || 0,
      day_name,
      orders: Number(orders) || 0,
      revenue: Number(revenue) || 0,
      avg_order_value: Number(avg_order_value) || 0
    }));
  }

  static async getSalesForecastAccuracy(app: AppWithPrisma): Promise<SalesForecastAccuracy> {
    const query = `
    SELECT 
      COUNT(*) as total_forecasts,
      AVG(predicted_demand) as avg_predicted_demand,
      MIN(predicted_demand) as min_predicted_demand,
      MAX(predicted_demand) as max_predicted_demand
    FROM forecasts 
    WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  `;

    const result = await QueryBuilder.executeWithDebug<SalesForecastAccuracyRow[]>(
      app.prisma,
      query,
      [],
      'SalesQueries.getSalesForecastAccuracy'
    );

    const [row = {} as SalesForecastAccuracyRow] = result;
    return {
      total_forecasts: Number(row.total_forecasts) || 0,
      avg_predicted_demand: Number(row.avg_predicted_demand) || 0,
      min_predicted_demand: Number(row.min_predicted_demand) || 0,
      max_predicted_demand: Number(row.max_predicted_demand) || 0
    };
  }
}