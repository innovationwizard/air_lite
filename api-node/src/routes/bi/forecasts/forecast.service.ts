import type { AppWithPrisma } from '../types';
export type { AppWithPrisma };

export interface ProductForecast {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  current_stock: number;
  avg_daily_demand: number;
  demand_stddev: number;
  days_with_sales: number;
  total_sold: number;
  total_revenue: number;
  forecast_30d: number;
  forecast_30d_lower: number;
  forecast_30d_upper: number;
  confidence_score: number;
  trend_direction: 'increasing' | 'decreasing' | 'stable';
  trend_change_pct: number;
  days_until_stockout: number;
  ml_components: {
    base_demand: number;
    trend_component: number;
    seasonal_factor: number;
    volatility: number;
    data_points: number;
  };
  confidence_factors: string[];
  risk_factors: string[];
}

interface ProductRow {
  product_id: number;
  sku: string;
  product_name: string;
  category: string;
  days_with_sales?: number | null;
  total_quantity?: number | null;
  total_revenue?: number | null;
  avg_daily_quantity?: number | null;
  quantity_stddev?: number | null;
  current_stock?: number | null;
  trend_direction?: 'increasing' | 'decreasing' | 'stable' | null;
  trend_change_pct?: number | null;
}

export class ForecastService {
  static async getProductForecasts(
    app: AppWithPrisma,
    options: {
      limit: number;
      category?: string;
      forecastDays: number;
    }
  ): Promise<ProductForecast[]> {
    const { limit, category, forecastDays } = options;

    // Get top products by recent sales
    const productsQuery = `
      WITH product_sales AS (
        SELECT 
          sp.product_id,
          p.sku,
          p.product_name,
          p.category,
          COUNT(DISTINCT DATE(sp.sale_datetime)) as days_with_sales,
          COUNT(DISTINCT sp.client_id) as unique_customers,
          SUM(sp.quantity) as total_quantity,
          SUM(sp.total_price) as total_revenue,
          AVG(sp.quantity) as avg_daily_quantity,
          STDDEV(sp.quantity) as quantity_stddev
        FROM sales_partitioned sp
        JOIN products p ON sp.product_id = p.product_id
        WHERE sp.sale_datetime >= CURRENT_DATE - INTERVAL '90 days'
          AND sp.is_deleted = false
          ${category ? 'AND p.category = $2' : ''}
        GROUP BY sp.product_id, p.sku, p.product_name, p.category
        HAVING COUNT(DISTINCT DATE(sp.sale_datetime)) >= 7  -- At least 7 distinct sale days
        ORDER BY SUM(sp.total_price) DESC
        LIMIT $1
      ),
      current_inventory AS (
        SELECT 
          product_id,
          quantity_on_hand as current_stock
        FROM inventory_snapshots
        WHERE snapshot_timestamp = (
          SELECT MAX(snapshot_timestamp) 
          FROM inventory_snapshots
        )
      ),
      recent_trend AS (
        SELECT 
          sp.product_id,
          CASE 
            WHEN COALESCE(SUM(CASE WHEN sp.sale_datetime >= CURRENT_DATE - INTERVAL '15 days' 
                                   THEN sp.quantity END), 0) >
                 COALESCE(SUM(CASE WHEN sp.sale_datetime < CURRENT_DATE - INTERVAL '15 days' 
                                   AND sp.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
                                   THEN sp.quantity END), 0)
            THEN 'increasing'
            WHEN COALESCE(SUM(CASE WHEN sp.sale_datetime >= CURRENT_DATE - INTERVAL '15 days' 
                                   THEN sp.quantity END), 0) <
                 COALESCE(SUM(CASE WHEN sp.sale_datetime < CURRENT_DATE - INTERVAL '15 days' 
                                   AND sp.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
                                   THEN sp.quantity END), 0) * 0.9
            THEN 'decreasing'
            ELSE 'stable'
          END as trend_direction,
          (COALESCE(SUM(CASE WHEN sp.sale_datetime >= CURRENT_DATE - INTERVAL '15 days' 
                            THEN sp.quantity END), 0) -
           COALESCE(SUM(CASE WHEN sp.sale_datetime < CURRENT_DATE - INTERVAL '15 days' 
                                  AND sp.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
                            THEN sp.quantity END), 0)) * 100.0 / 
          NULLIF(COALESCE(SUM(CASE WHEN sp.sale_datetime < CURRENT_DATE - INTERVAL '15 days' 
                                       AND sp.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
                                 THEN sp.quantity END), 1), 0) as trend_change_pct
        FROM sales_partitioned sp
        WHERE sp.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'
          AND sp.is_deleted = false
        GROUP BY sp.product_id
      )
      SELECT 
        ps.*,
        COALESCE(ci.current_stock, 0) as current_stock,
        rt.trend_direction,
        COALESCE(rt.trend_change_pct, 0) as trend_change_pct
      FROM product_sales ps
      LEFT JOIN current_inventory ci ON ps.product_id = ci.product_id
      LEFT JOIN recent_trend rt ON ps.product_id = rt.product_id
    `;

    const params = category ? [limit, category] : [limit];
    const products = await app.prisma.$queryRawUnsafe<ProductRow[]>(productsQuery, ...params);

    // Generate forecasts for each product
    const forecasts: ProductForecast[] = [];

    for (const product of products) {
      forecasts.push(this.generateProductForecast(product, forecastDays));
    }

    return forecasts;
  }

  static async getSingleProductForecast(
    app: AppWithPrisma,
    productId: number,
    forecastDays: number
  ): Promise<ProductForecast> {
    const productQuery = `
      SELECT 
        p.product_id,
        p.sku,
        p.product_name,
        p.category,
        COUNT(DISTINCT DATE(sp.sale_datetime)) as days_with_sales,
        SUM(sp.quantity) as total_quantity,
        SUM(sp.total_price) as total_revenue,
        AVG(sp.quantity) as avg_daily_quantity,
        STDDEV(sp.quantity) as quantity_stddev,
        (SELECT quantity_on_hand FROM inventory_snapshots 
         WHERE product_id = p.product_id 
         ORDER BY snapshot_timestamp DESC LIMIT 1) as current_stock
      FROM products p
      LEFT JOIN sales_partitioned sp ON p.product_id = sp.product_id
        AND sp.sale_datetime >= CURRENT_DATE - INTERVAL '90 days'
        AND sp.is_deleted = false
      WHERE p.product_id = $1
      GROUP BY p.product_id, p.sku, p.product_name, p.category
    `;

    const [product] = await app.prisma.$queryRawUnsafe<ProductRow[]>(productQuery, productId);
    
    if (!product) {
      throw new Error('Product not found');
    }

    return this.generateProductForecast(product, forecastDays);
  }

  private static generateProductForecast(product: ProductRow, forecastDays: number): ProductForecast {
    // Calculate base metrics
    const avgDailyDemand = Number(product.avg_daily_quantity) || 0;
    const demandStddev = Number(product.quantity_stddev) || 0;
    const currentStock = Number(product.current_stock) || 0;
    const daysWithSales = Number(product.days_with_sales) || 0;
    
    // Calculate forecast with confidence intervals
    const baseForecast = avgDailyDemand * forecastDays;
    const stdError = demandStddev * Math.sqrt(forecastDays);
    
    // 80% confidence interval (1.28 z-score)
    const forecast30dLower80 = Math.max(0, baseForecast - 1.28 * stdError);
    const forecast30dUpper80 = baseForecast + 1.28 * stdError;
    
    // Calculate confidence score based on data quality
    const dataPoints = daysWithSales;
    const volatility = demandStddev / Math.max(avgDailyDemand, 1);
    const confidenceScore = Math.min(100, 
      (dataPoints / 90) * 50 +  // 50% weight for data completeness
      ((1 - Math.min(volatility, 1)) * 50)  // 50% weight for low volatility
    );

    // Calculate days until stockout
    const daysUntilStockout = avgDailyDemand > 0 ? Math.floor(currentStock / avgDailyDemand) : 999;

    // Determine confidence and risk factors
    const confidenceFactors: string[] = [];
    const riskFactors: string[] = [];

    if (dataPoints >= 60) {
      confidenceFactors.push('Sufficient historical data');
    } else if (dataPoints < 30) {
      riskFactors.push('Limited historical data');
    }

    if (volatility < 0.3) {
      confidenceFactors.push('Stable demand pattern');
    } else if (volatility > 0.7) {
      riskFactors.push('High demand volatility');
    }

    if (product.trend_direction === 'increasing') {
      confidenceFactors.push('Increasing trend detected');
    } else if (product.trend_direction === 'decreasing') {
      riskFactors.push('Decreasing trend detected');
    }

    if (daysUntilStockout <= 7) {
      riskFactors.push('Low stock levels');
    }

    const currentMonth = new Date().getMonth();
    const seasonalFactors = [0.9, 0.9, 1.0, 1.0, 1.1, 1.2, 1.2, 1.1, 1.0, 1.1, 1.2, 1.3];
    const seasonalFactor = seasonalFactors[currentMonth];

    const trendChangePct = Number(product.trend_change_pct ?? 0);

    return {
      product_id: product.product_id,
      sku: product.sku,
      product_name: product.product_name,
      category: product.category,
      current_stock: currentStock,
      avg_daily_demand: avgDailyDemand,
      demand_stddev: demandStddev,
      days_with_sales: daysWithSales,
      total_sold: Number(product.total_quantity ?? 0),
      total_revenue: Number(product.total_revenue ?? 0),
      forecast_30d: baseForecast * seasonalFactor,
      forecast_30d_lower: forecast30dLower80 * seasonalFactor,
      forecast_30d_upper: forecast30dUpper80 * seasonalFactor,
      confidence_score: confidenceScore,
      trend_direction: product.trend_direction ?? 'stable',
      trend_change_pct: trendChangePct,
      days_until_stockout: daysUntilStockout,
      ml_components: {
        base_demand: avgDailyDemand,
        trend_component: (trendChangePct / 100) * avgDailyDemand,
        seasonal_factor: seasonalFactor,
        volatility,
        data_points: dataPoints
      },
      confidence_factors: confidenceFactors,
      risk_factors: riskFactors
    };
  }
}