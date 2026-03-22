import type { AppWithPrisma, Dashboard, DashboardOptions } from '../types';
import { FinancialQueries } from '../queries/financial.queries';

interface SparklineRow {
  date: string;
  value: string | number | null;
}

interface RevenueTrendRow {
  date: string;
  revenue: string | number | null;
}

export class FinanzasDashboard {
  static async create(app: AppWithPrisma, options: DashboardOptions): Promise<Dashboard> {
    app.log.info('[FINANZAS DASHBOARD] Creating Financial dashboard');
    
    const { startDate, endDate } = options;
    const now = new Date();

    try {
      // Get financial metrics
      const workingCapital = await FinancialQueries.getWorkingCapital(app);
      const costBreakdown = await FinancialQueries.getCostBreakdown(app, startDate, endDate);
      const cashFlowData = await FinancialQueries.getCashFlowData(app, startDate, endDate);
      const financialAlerts = await FinancialQueries.getFinancialAlerts(app, startDate, endDate);
      const revenueMetrics = await FinancialQueries.getRevenueMetrics(app, startDate, endDate);
      const profitabilityMetrics = await FinancialQueries.getProfitabilityMetrics(app, startDate, endDate);
      const inventoryValuation = await FinancialQueries.getInventoryValuation(app);

      return {
        role: 'Financiero',
        title: 'Financial Health Dashboard',
        lastUpdated: now.toISOString(),
        kpis: [
          {
            id: 'working-capital',
            name: 'Working Capital',
            value: workingCapital.current,
            target: 500000,
            unit: 'currency',
            trend: workingCapital.trend,
            sparkline: await this.getSparklineData(app, 'working_capital', 7),
            change: workingCapital.changePercent
          },
          {
            id: 'monthly-revenue',
            name: 'Monthly Revenue',
            value: revenueMetrics.total_revenue || 0,
            target: 1500000,
            unit: 'currency',
            trend: this.calculateTrend(revenueMetrics.total_revenue || 0, 1500000),
            sparkline: await this.getSparklineData(app, 'monthly_revenue', 7)
          },
          {
            id: 'gross-margin',
            name: 'Gross Margin',
            value: (profitabilityMetrics.gross_margin || 0) * 100,
            target: 25,
            unit: 'percentage',
            trend: this.calculateTrend((profitabilityMetrics.gross_margin || 0) * 100, 25),
            sparkline: await this.getSparklineData(app, 'gross_margin', 7)
          },
          {
            id: 'inventory-value',
            name: 'Inventory Value',
            value: inventoryValuation.total_value || 0,
            target: 300000,
            unit: 'currency',
            trend: this.calculateTrend(inventoryValuation.total_value || 0, 300000),
            sparkline: await this.getSparklineData(app, 'inventory_value', 7)
          },
          {
            id: 'revenue-volatility',
            name: 'Revenue Volatility',
            value: revenueMetrics.revenue_volatility || 0,
            target: 10000,
            unit: 'currency',
            trend: revenueMetrics.revenue_volatility < 10000 ? 'down' : 'up',
            sparkline: await this.getSparklineData(app, 'revenue_volatility', 7)
          },
          {
            id: 'out-of-stock-count',
            name: 'Out of Stock Items',
            value: inventoryValuation.out_of_stock_count || 0,
            target: 5,
            unit: 'count',
            trend: (inventoryValuation.out_of_stock_count || 0) < 5 ? 'down' : 'up',
            sparkline: await this.getSparklineData(app, 'out_of_stock_count', 7)
          }
        ],
        alerts: financialAlerts.map((alert, index) => ({
          id: `financial-${index}`,
          severity: this.getSeverityFromAlertType(alert.alert_type),
          type: 'financial_risk',
          message: `${alert.product_name} (${alert.sku}): ${alert.alert_type}`,
          product: alert.sku,
          actionRequired: true,
          impact: alert.value_at_risk
        })),
        charts: {
          cashFlow: {
            type: 'line',
            data: cashFlowData,
            config: {
              title: 'Cash Flow Trend',
              xAxis: 'date',
              yAxis: 'net_flow'
            }
          },
          costBreakdown: {
            type: 'pie',
            data: costBreakdown,
            config: {
              title: 'Cost Breakdown'
            }
          },
          revenueTrend: {
            type: 'line',
          data: await this.getRevenueTrend(app, startDate, endDate),
            config: {
              title: 'Revenue Trend',
              xAxis: 'date',
              yAxis: 'revenue'
            }
          }
        }
      };
    } catch (error) {
      app.log.error({ err: error }, '[FINANZAS DASHBOARD] Error creating dashboard:');
      throw error;
    }
  }

  private static calculateTrend(current: number, target: number): string {
    if (current >= target) return 'up';
    if (current >= target * 0.8) return 'stable';
    return 'down';
  }

  private static getSeverityFromAlertType(alertType: string): string {
    switch (alertType) {
      case 'HIGH_VALUE_SLOW_MOVER':
        return 'warning';
      case 'NEAR_EXPIRY':
        return 'critical';
      case 'OVERSTOCK_HIGH_VALUE':
        return 'warning';
      default:
        return 'info';
    }
  }

  private static async getSparklineData(app: AppWithPrisma, metric: string, days: number): Promise<number[]> {
    try {
      const metricQueries: { [key: string]: string } = {
        'working_capital': `
          SELECT DATE(sale_datetime) as date, SUM(total_price) * 0.3 as value
          FROM sales_partitioned
          WHERE sale_datetime >= CURRENT_DATE - INTERVAL '${days} days'
            AND sale_datetime < CURRENT_DATE
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'monthly_revenue': `
          SELECT DATE(sale_datetime) as date, SUM(total_price) as value
          FROM sales_partitioned
          WHERE sale_datetime >= CURRENT_DATE - INTERVAL '${days} days'
            AND sale_datetime < CURRENT_DATE
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'gross_margin': `
          SELECT DATE(sale_datetime) as date, 
                 (SUM(total_price) - SUM(quantity * p.cost)) / NULLIF(SUM(total_price), 0) * 100 as value
          FROM sales_partitioned s
          JOIN products p ON s.product_id = p.product_id
          WHERE sale_datetime >= CURRENT_DATE - INTERVAL '${days} days'
            AND sale_datetime < CURRENT_DATE
            AND s.is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'inventory_value': `
          SELECT DATE(sale_datetime) as date, SUM(s.quantity * p.cost) * 2 as value
          FROM sales_partitioned s
          JOIN products p ON s.product_id = p.product_id
          WHERE sale_datetime >= CURRENT_DATE - INTERVAL '${days} days'
            AND sale_datetime < CURRENT_DATE
            AND s.is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'revenue_volatility': `
          SELECT DATE(sale_datetime) as date, 0.0 as value
          FROM sales_partitioned
          WHERE sale_datetime >= CURRENT_DATE - INTERVAL '${days} days'
            AND sale_datetime < CURRENT_DATE
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'out_of_stock_count': `
          SELECT DATE(sale_datetime) as date, 0.0 as value
          FROM sales_partitioned
          WHERE sale_datetime >= CURRENT_DATE - INTERVAL '${days} days'
            AND sale_datetime < CURRENT_DATE
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `
      };
      
      const query = metricQueries[metric];
      if (!query) {
        app.log.error(`[FINANZAS DASHBOARD] Unknown metric: ${metric}`);
        return Array<number>(days).fill(0);
      }
      
      const result = await app.prisma.$queryRawUnsafe<SparklineRow[]>(query);
      return result.map(r => Number(r.value) || 0);
    } catch (error) {
      app.log.error({ err: error }, `[FINANZAS DASHBOARD] Error getting sparkline data for ${metric}:`);
      return Array<number>(days).fill(0);
    }
  }

  private static async getRevenueTrend(
    app: AppWithPrisma,
    startDate?: Date,
    endDate?: Date
  ): Promise<Array<{ date: string; revenue: number }>> {
    try {
      const dateCondition = startDate && endDate
        ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'`
        : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '30 days'`;
        
      const query = `
        SELECT 
          DATE(sale_datetime) as date,
          SUM(total_price) as revenue
        FROM sales_partitioned
        ${dateCondition}
        GROUP BY DATE(sale_datetime)
        ORDER BY date
      `;
      
      const params = startDate && endDate ? [startDate, endDate] : [];
      const result = await app.prisma.$queryRawUnsafe<RevenueTrendRow[]>(query, ...params);
      return result.map(row => ({
        date: row.date,
        revenue: Number(row.revenue) || 0
      }));
    } catch (error) {
      app.log.error({ err: error }, '[FINANZAS DASHBOARD] Error getting revenue trend:');
      return [];
    }
  }
}