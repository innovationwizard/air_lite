import type {
  AppWithPrisma,
  Dashboard,
  DashboardOptions,
  SalesMetrics,
  WorkingCapitalData
} from '../types';
import { ForecastingQueries } from '../queries/forecasting.queries';
import { FinancialQueries } from '../queries/financial.queries';
import { SalesQueries } from '../queries/sales.queries';
import { AlertsService } from '../services/alerts.service';
import { HelperFunctionsService } from '../services/helper-functions.service';
import { QueryBuilder } from '../utils/query-builder';
import type { RevenueMetrics, ProfitabilityMetrics } from '../queries/financial.queries';

interface SparklineRow {
  date: string;
  value: string | number | null;
}

interface RevenueTrendRow {
  date: string;
  revenue: string | number | null;
}

interface CategoryBreakdownRow {
  label: string | null;
  value: number | null;
}

interface ProfitabilityTrendRow {
  date: string | null;
  revenue: number | string | null;
  profit: number | string | null;
  aiSavings: number | string | null;
}

interface ProfitabilityTrendEntry {
  date: string;
  revenue: number;
  profit: number;
  aiSavings: number;
}

interface CategoryPerformanceRow {
  category: string | null;
  turnover: number | string | null;
  profitability: number | string | null;
  stockoutRisk: number | string | null;
}

interface CategoryPerformanceEntry {
  category: string;
  turnover: number;
  profitability: number;
  stockoutRisk: number;
}

interface MaxDateRow {
  max_date: string | null;
}

interface AIValueAddMetrics {
  stockouts_prevented: number;
  overstock_reduced: number;
  cost_savings: number;
  total_insights: number;
}

export class GerenciaDashboard {
  static async create(app: AppWithPrisma, options: DashboardOptions): Promise<Dashboard> {
    app.log.info('[GERENCIA DASHBOARD] Creating Executive dashboard');
    
    const { startDate, endDate } = options;
    const now = new Date();

    try {
      const aiValueAdd: AIValueAddMetrics = await ForecastingQueries.getAIValueAdd(app, startDate, endDate);
      const workingCapital: WorkingCapitalData = await FinancialQueries.getWorkingCapital(app, startDate, endDate);
      const salesMetrics: SalesMetrics = await SalesQueries.getSalesMetrics(app, startDate, endDate);
      const revenueMetrics: RevenueMetrics = await FinancialQueries.getRevenueMetrics(app, startDate, endDate);
      const profitabilityMetrics: ProfitabilityMetrics = await FinancialQueries.getProfitabilityMetrics(app, startDate, endDate);
      const maxDataDate = await this.getMaxDataDate(app);
      const invoicedRevenue = await FinancialQueries.getInvoicedRevenue(app, startDate, endDate);
      const revenueByChannel = await FinancialQueries.getRevenueByChannel(app, startDate, endDate);

      const alerts = await AlertsService.getAllAlerts(app);
      const profitabilityTrend = this.normalizeProfitabilityTrend(
        await HelperFunctionsService.getProfitabilityTrend(app, startDate, endDate)
      );
      const categoryPerformance = this.normalizeCategoryPerformance(
        await HelperFunctionsService.getCategoryPerformance(app, startDate, endDate)
      );
      const categoryBreakdown = await this.getCategoryBreakdown(app, startDate, endDate);
      const revenueTrend = await this.getRevenueTrend(app, startDate, endDate);

      return {
        role: 'Gerencia',
        title: 'Executive Summary Dashboard',
        lastUpdated: now.toISOString(),
        maxDataDate,
        kpis: [
          {
            id: 'ai-value-add',
            name: 'AI Value Add',
            value: this.toNumber(aiValueAdd.stockouts_prevented + aiValueAdd.overstock_reduced + aiValueAdd.cost_savings),
            target: 100000,
            unit: 'currency',
            trend: this.calculateTrend(this.toNumber(aiValueAdd.stockouts_prevented + aiValueAdd.overstock_reduced + aiValueAdd.cost_savings), 100000),
            sparkline: await this.getSparklineData(app, 'ai_value_add', startDate, endDate),
            details: {
              stockoutsPrevented: aiValueAdd.stockouts_prevented,
              overstockReduced: aiValueAdd.overstock_reduced,
              costSavings: aiValueAdd.cost_savings
            }
          },
          {
            id: 'working-capital',
            name: 'Working Capital',
            value: workingCapital.current,
            target: 500000,
            unit: 'currency',
            trend: workingCapital.trend,
            sparkline: await this.getSparklineData(app, 'working_capital', startDate, endDate),
            change: workingCapital.changePercent
          },
          {
            id: 'monthly-revenue',
            name: 'Monthly Revenue',
            value: salesMetrics.revenue,
            target: salesMetrics.target,
            unit: 'currency',
            trend: this.calculateTrend(salesMetrics.revenue, salesMetrics.target),
            sparkline: await this.getSparklineData(app, 'monthly_revenue', startDate, endDate),
            progress: (salesMetrics.revenue / salesMetrics.target) * 100
          },
          {
            id: 'gross-margin',
            name: 'Gross Margin',
            value: (profitabilityMetrics.gross_margin || 0) * 100,
            target: 25,
            unit: 'percentage',
            trend: this.calculateTrend((profitabilityMetrics.gross_margin || 0) * 100, 25),
            sparkline: await this.getSparklineData(app, 'gross_margin', startDate, endDate)
          },
          {
            id: 'customer-growth',
            name: 'Active Customers',
            value: salesMetrics.unique_customers,
            target: 1000,
            unit: 'count',
            trend: this.calculateTrend(salesMetrics.unique_customers, 1000),
            sparkline: await this.getSparklineData(app, 'customer_growth', startDate, endDate)
          },
          {
            id: 'revenue-volatility',
            name: 'Revenue Volatility',
            value: revenueMetrics.revenue_volatility || 0,
            target: 10000,
            unit: 'currency',
            trend: revenueMetrics.revenue_volatility < 10000 ? 'down' : 'up',
            sparkline: await this.getSparklineData(app, 'revenue_volatility', startDate, endDate)
          },
          {
            id: 'invoiced-revenue',
            name: 'Invoiced Revenue',
            value: invoicedRevenue.total,
            target: salesMetrics.target,
            unit: 'currency',
            trend: this.calculateTrend(invoicedRevenue.total, salesMetrics.target),
            sparkline: invoicedRevenue.byMonth.map(m => m.revenue)
          }
        ],
        alerts,
        charts: {
          profitabilityTrend: {
            type: 'line',
            data: profitabilityTrend,
            config: {
              xAxis: { key: 'date', type: 'date' },
              yAxis: { key: 'value', format: 'currency' },
              series: [
                { dataKey: 'revenue', name: 'Revenue', color: '#2563eb' },
                { dataKey: 'profit', name: 'Profit', color: '#10b981' },
                { dataKey: 'aiSavings', name: 'AI Savings', color: '#f59e0b' },
              ],
            }
          },
          categoryPerformance: {
            type: 'radar',
            data: categoryPerformance,
            config: {
              angleKey: 'category',
              series: [
                { dataKey: 'turnover', name: 'Turnover' },
                { dataKey: 'profitability', name: 'Profitability' },
                { dataKey: 'stockoutRisk', name: 'Stockout Risk' },
              ],
            }
          },
          categoryBreakdown: {
            type: 'pie',
            data: categoryBreakdown,
            config: {
              title: 'Revenue by Category'
            }
          },
          aiImpact: {
            type: 'bar',
            data: [
              { label: 'Stockouts Prevented', value: aiValueAdd.stockouts_prevented },
              { label: 'Overstock Reduced', value: aiValueAdd.overstock_reduced },
              { label: 'Cost Savings', value: aiValueAdd.cost_savings }
            ],
            config: {
              title: 'AI Impact Breakdown'
            }
          },
          revenueTrend: {
            type: 'line',
            data: revenueTrend,
            config: {
              title: 'Revenue Trend',
              xAxis: 'date',
              yAxis: 'revenue'
            }
          },
          revenueByChannel: {
            type: 'bar',
            data: revenueByChannel.map(r => ({
              label: r.channel,
              value: r.revenue,
              invoiceCount: r.invoiceCount
            })),
            config: {
              title: 'Revenue by Channel (Invoiced)'
            }
          }
        }
      };
    } catch (error) {
      app.log.error({ err: error }, '[GERENCIA DASHBOARD] Error creating dashboard:');
      throw error;
    }
  }

  private static calculateTrend(current: number, target: number): string {
    if (current >= target) return 'up';
    if (current >= target * 0.8) return 'stable';
    return 'down';
  }

  private static async getSparklineData(app: AppWithPrisma, metric: string, startDate?: Date, endDate?: Date): Promise<number[]> {
    try {
      const dateCondition = startDate && endDate
        ? `WHERE sale_datetime >= $1 AND sale_datetime < $2 + INTERVAL '1 day'`
        : `WHERE sale_datetime >= CURRENT_DATE - INTERVAL '7 days' AND sale_datetime < CURRENT_DATE`;

      const params = startDate && endDate ? [startDate, endDate] : [];

      const metricQueries: { [key: string]: string } = {
        'ai_value_add': `
          SELECT DATE(sale_datetime) as date, SUM(total_price) * 0.02 as value
          FROM sales_partitioned
          ${dateCondition}
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'working_capital': `
          SELECT DATE(sale_datetime) as date, SUM(total_price) * 0.3 as value
          FROM sales_partitioned
          ${dateCondition}
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'monthly_revenue': `
          SELECT DATE(sale_datetime) as date, SUM(total_price) as value
          FROM sales_partitioned
          ${dateCondition}
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'gross_margin': `
          SELECT DATE(sale_datetime) as date,
                 (SUM(total_price) - SUM(quantity * p.cost)) / NULLIF(SUM(total_price), 0) * 100 as value
          FROM sales_partitioned s
          JOIN products p ON s.product_id = p.product_id
          ${dateCondition.replace(/sale_datetime/g, 's.sale_datetime')}
            AND s.is_deleted = false
            AND s.total_price > 0
          GROUP BY DATE(s.sale_datetime)
          ORDER BY date
        `,
        'customer_growth': `
          SELECT DATE(sale_datetime) as date, COUNT(DISTINCT client_id) as value
          FROM sales_partitioned
          ${dateCondition}
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `,
        'revenue_volatility': `
          SELECT DATE(sale_datetime) as date, 0.0 as value
          FROM sales_partitioned
          ${dateCondition}
            AND is_deleted = false
          GROUP BY DATE(sale_datetime)
          ORDER BY date
        `
      };

      const query = metricQueries[metric];
      if (!query) {
        app.log.error(`[GERENCIA DASHBOARD] Unknown metric: ${metric}`);
        return [];
      }

      const result = await QueryBuilder.executeWithDebug<SparklineRow[]>(
        app.prisma,
        query,
        params,
        'GerenciaDashboard.getSparklineData'
      );

      return result.map(r => Number(r.value) || 0);
    } catch (error) {
      app.log.error({ err: error }, `[GERENCIA DASHBOARD] Error getting sparkline data for ${metric}:`);
      return [];
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
      const result = await QueryBuilder.executeWithDebug<RevenueTrendRow[]>(
        app.prisma,
        query,
        params,
        'GerenciaDashboard.getRevenueTrend'
      );
      return result.map(row => ({
        date: row.date,
        revenue: Number(row.revenue) || 0
      }));
    } catch (error) {
      app.log.error({ err: error }, '[GERENCIA DASHBOARD] Error getting revenue trend:');
      return [];
    }
  }

  private static async getCategoryBreakdown(app: AppWithPrisma, startDate?: Date, endDate?: Date): Promise<Array<{ label: string; value: number }>> {
    try {
      const dateCondition = startDate && endDate
        ? `WHERE s.sale_datetime >= $1 AND s.sale_datetime < $2 + INTERVAL '1 day'`
        : `WHERE s.sale_datetime >= CURRENT_DATE - INTERVAL '30 days'`;
        
      const query = `
        SELECT 
          p.category as label,
          SUM(s.total_price) as value
        FROM sales_partitioned s
        JOIN products p ON s.product_id = p.product_id
        ${dateCondition}
        GROUP BY p.category
        ORDER BY value DESC
      `;
      
      const params = startDate && endDate ? [startDate, endDate] : [];
      const result = await QueryBuilder.executeWithDebug<CategoryBreakdownRow[]>(
        app.prisma,
        query,
        params,
        'GerenciaDashboard.getCategoryBreakdown'
      );

      return result.map(row => ({
        label: row.label ?? 'Otros',
        value: Number(row.value) || 0
      }));
    } catch (error) {
      app.log.error({ err: error }, '[GERENCIA DASHBOARD] Error getting category breakdown:');
      return [];
    }
  }

  private static async getMaxDataDate(app: AppWithPrisma): Promise<string> {
    try {
      const query = `
        SELECT MAX(sale_datetime) as max_date
        FROM sales_partitioned
      `;
      
      const result = await QueryBuilder.executeWithDebug<MaxDateRow[]>(
        app.prisma,
        query,
        [],
        'GerenciaDashboard.getMaxDataDate'
      );
      return result[0]?.max_date || new Date().toISOString();
    } catch (error) {
      app.log.error({ err: error }, '[GERENCIA DASHBOARD] Error getting max data date:');
      return new Date().toISOString();
    }
  }

  private static normalizeProfitabilityTrend(rows: unknown[]): ProfitabilityTrendEntry[] {
    return rows.map(row => {
      const record = row as ProfitabilityTrendRow;
      return {
        date: record.date ?? new Date().toISOString(),
        revenue: this.toNumber(record.revenue),
        profit: this.toNumber(record.profit),
        aiSavings: this.toNumber(record.aiSavings)
      };
    });
  }

  private static normalizeCategoryPerformance(rows: unknown[]): CategoryPerformanceEntry[] {
    return rows.map(row => {
      const record = row as CategoryPerformanceRow;
      return {
        category: record.category ?? 'Unknown',
        turnover: this.toNumber(record.turnover),
        profitability: this.toNumber(record.profitability),
        stockoutRisk: this.toNumber(record.stockoutRisk)
      };
    });
  }

  private static toNumber(value: unknown): number {
    if (typeof value === 'number' && !Number.isNaN(value)) {
      return value;
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    return 0;
  }
}