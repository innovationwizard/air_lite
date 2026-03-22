import type { AppWithPrisma, Dashboard, DashboardOptions, DashboardAlert } from '../types';
import { ForecastingQueries } from '../queries/forecasting.queries';
import { AlertsService } from '../services/alerts.service';
import { HelperFunctionsService } from '../services/helper-functions.service';
import { QueryBuilder } from '../utils/query-builder';

type ModelAccuracyMetrics = Awaited<ReturnType<typeof ForecastingQueries.getModelAccuracy>>;
type ForecastAccuracyMetrics = Awaited<ReturnType<typeof ForecastingQueries.getForecastAccuracyMetrics>>;
type ForecastQualityScore = Awaited<ReturnType<typeof ForecastingQueries.getDataQualityScore>>;
type RecommendationStats = Awaited<ReturnType<typeof ForecastingQueries.getRecommendationStats>>;
type ForecastLatencyMetrics = Awaited<ReturnType<typeof ForecastingQueries.getModelLatency>>;
type AIValueAddMetrics = Awaited<ReturnType<typeof ForecastingQueries.getAIValueAdd>>;

interface KpiRow {
  kpi_value: number;
  previous_value: number | null;
}

interface SparklineRow {
  value: number;
}

export class SuperuserDashboard {
  static async create(app: AppWithPrisma, options: DashboardOptions): Promise<Dashboard> {
    app.log.info('[SUPERUSER DASHBOARD] Creating Superuser dashboard');
    
    const now = new Date();

    try {
      const resolvedEnd = options.endDate ?? now;
      const resolvedStart = options.startDate ?? new Date(resolvedEnd.getTime() - 30 * 24 * 60 * 60 * 1000);

      const modelAccuracy: ModelAccuracyMetrics = await ForecastingQueries.getModelAccuracy(app, resolvedStart, resolvedEnd);
      const wmapeData: ForecastAccuracyMetrics = await ForecastingQueries.getForecastAccuracyMetrics(app);
      const dataQualityScore: ForecastQualityScore = await ForecastingQueries.getDataQualityScore(app, resolvedStart, resolvedEnd);
      const recommendationStats: RecommendationStats = await ForecastingQueries.getRecommendationStats(app, resolvedStart, resolvedEnd);
      const modelLatency: ForecastLatencyMetrics = await ForecastingQueries.getModelLatency(app, resolvedStart, resolvedEnd);
      const aiValueAdd: AIValueAddMetrics = await ForecastingQueries.getAIValueAdd(app, resolvedStart, resolvedEnd);
      const alerts: DashboardAlert[] = await AlertsService.getAllAlerts(app);

      return {
        role: 'Superuser',
        title: 'AI Model Governance Dashboard',
        lastUpdated: now.toISOString(),
        kpis: [
          {
            id: 'model-accuracy',
            name: 'Model Accuracy (WMAPE)',
            value: wmapeData.wmape ? 1 - wmapeData.wmape : 0,
            target: 0.9,
            unit: 'percentage',
            trend: await this.getTrend(app, 'model_accuracy'),
            sparkline: await this.getSparklineData(app, 'model_accuracy', 7),
            details: {
              totalForecasts: modelAccuracy.total_forecasts || 0,
              highAccuracyCount: modelAccuracy.high_accuracy || 0
            }
          },
          {
            id: 'data-quality',
            name: 'Data Quality Score',
            value: dataQualityScore.completeness || 0,
            target: 0.95,
            unit: 'percentage',
            trend: await this.getTrend(app, 'data_quality'),
            sparkline: await this.getSparklineData(app, 'data_quality', 7)
          },
          {
            id: 'recommendation-acceptance',
            name: 'Recommendation Acceptance Rate',
            value: recommendationStats.total_recommendations > 0
              ? recommendationStats.accepted / recommendationStats.total_recommendations
              : 0,
            target: 0.8,
            unit: 'percentage',
            trend: await this.getTrend(app, 'recommendation_acceptance'),
            sparkline: await this.getSparklineData(app, 'recommendation_acceptance', 7)
          },
          {
            id: 'model-latency',
            name: 'Model Latency',
            value: modelLatency.avg_latency || 0,
            target: 1000,
            unit: 'ms',
            trend: modelLatency.avg_latency < 1000 ? 'down' : 'up',
            sparkline: await this.getSparklineData(app, 'model_latency', 7)
          },
          {
            id: 'ai-value-add',
            name: 'AI Value Add',
            value: this.sumAiValueAdd(aiValueAdd),
            target: 100000,
            unit: 'currency',
            trend: await this.getTrend(app, 'ai_value_add'),
            sparkline: await this.getSparklineData(app, 'ai_value_add', 7)
          },
          {
            id: 'total-insights',
            name: 'Total AI Insights',
            value: aiValueAdd.total_insights || 0,
            target: 1000,
            unit: 'count',
            trend: await this.getTrend(app, 'total_insights'),
            sparkline: await this.getSparklineData(app, 'total_insights', 7)
          }
        ],
        alerts,
        charts: {
          accuracyTimeline: {
            type: 'line',
            data: await HelperFunctionsService.getAccuracyTimeline(app, resolvedStart, resolvedEnd),
            config: {
              xAxis: { key: 'date', type: 'date' },
              yAxis: { key: 'accuracy', format: 'percentage' },
              series: [
                { dataKey: 'forecastAccuracy', name: 'Forecast Accuracy', color: '#2563eb' },
                { dataKey: 'wmape', name: 'WMAPE', color: '#dc2626' }
              ]
            }
          },
          biasDetection: {
            type: 'scatter',
            data: await HelperFunctionsService.getBiasAnalysis(app),
            config: {
              xAxis: { key: 'category', type: 'category' },
              yAxis: { key: 'bias', format: 'percentage' },
              series: [
                { dataKey: 'overforecast', name: 'Over-forecast Bias', color: '#f59e0b' },
                { dataKey: 'underforecast', name: 'Under-forecast Bias', color: '#8b5cf6' }
              ]
            }
          },
          dataFreshness: {
            type: 'heatmap',
            data: await HelperFunctionsService.getDataFreshnessMatrix(app),
            config: {
              xAxis: { key: 'dataSource' },
              yAxis: { key: 'hour' },
              valueKey: 'recordCount',
              colorScale: ['#f3f4f6', '#3b82f6', '#1d4ed8']
            }
          },
          recommendationBreakdown: {
            type: 'pie',
            data: [
              { label: 'Accepted', value: recommendationStats.accepted },
              { label: 'Rejected', value: recommendationStats.rejected },
              {
                label: 'Pending',
                value: recommendationStats.total_recommendations - recommendationStats.accepted - recommendationStats.rejected
              }
            ],
            config: {
              title: 'Recommendation Status Breakdown'
            }
          }
        }
      };
    } catch (error) {
      app.log.error({ err: error }, '[SUPERUSER DASHBOARD] Error creating dashboard:');
      throw error;
    }
  }

  private static async getTrend(app: AppWithPrisma, metric: string, lowerIsBetter: boolean = false): Promise<string> {
    try {
      const query = `
        SELECT 
          kpi_value,
          LAG(kpi_value) OVER (ORDER BY created_at) as previous_value
        FROM kpis
        WHERE kpi_name = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;
      
      const result = await QueryBuilder.executeWithDebug<KpiRow[]>(
        app.prisma,
        query,
        [metric],
        'SuperuserDashboard.getTrend'
      );

      const row = result[0];
      if (!row || row.previous_value === null) return 'stable';

      const current = Number(row.kpi_value) || 0;
      const previous = Number(row.previous_value) || 0;
      
      if (lowerIsBetter) {
        return current < previous ? 'up' : current > previous ? 'down' : 'stable';
      } else {
        return current > previous ? 'up' : current < previous ? 'down' : 'stable';
      }
    } catch (error) {
      app.log.error({ err: error }, `[SUPERUSER DASHBOARD] Error getting trend for ${metric}:`);
      return 'stable';
    }
  }

  private static async getSparklineData(app: AppWithPrisma, metric: string, days: number): Promise<number[]> {
    try {
      const query = `
        SELECT 
          DATE(created_at) as date,
          kpi_value as value
        FROM kpis
        WHERE kpi_name = $1
          AND created_at >= CURRENT_DATE - INTERVAL '${days} days'
        ORDER BY created_at
      `;
      
      const result = await QueryBuilder.executeWithDebug<SparklineRow[]>(
        app.prisma,
        query,
        [metric],
        'SuperuserDashboard.getSparklineData'
      );

      if (!result || result.length === 0) {
        return Array<number>(days).fill(0.85);
      }

      return result.map(row => Number(row.value) || 0);
    } catch (error) {
      app.log.error({ err: error }, `[SUPERUSER DASHBOARD] Error getting sparkline data for ${metric}:`);
      return Array<number>(days).fill(0.85);
    }
  }

  private static sumAiValueAdd(metrics: AIValueAddMetrics): number {
    return (metrics.stockouts_prevented || 0) + (metrics.overstock_reduced || 0) + (metrics.cost_savings || 0);
  }
}
