import { FastifyRequest, FastifyReply } from 'fastify';
import { QueryBuilder } from '../utils/query-builder';
import type { AppWithPrisma } from '../types';

interface StrategyReportRequest {
  startDate?: string;
  endDate?: string;
  includeNarrative?: boolean;
}

interface KPIWidget {
  name: string;
  value: string | number;
  trend: string;
  delta: string;
  drilldownPath?: string;
  available: boolean;
  reason?: string;
}

interface StrategyReportResponse {
  reportDate: string;
  period: {
    start: string;
    end: string;
  };
  level0Widgets: KPIWidget[];
  aiNarrative: string;
  criticalAlerts: Array<{
    severity: 'high' | 'medium' | 'low';
    title: string;
    message: string;
  }>;
  drilldownData?: Record<string, unknown>;
}

interface SalesMetricsRow {
  revenue: string | number;
  order_count: string | number;
  customer_count: string | number;
  avg_order_value: string | number;
}

interface SalesPriorRow {
  revenue: string | number;
  order_count: string | number;
}

interface CustomerMetricsRow {
  champions: string | number;
  at_risk: string | number;
  high_churn_risk: string | number;
  avg_lifetime_value: string | number;
}

interface InventoryCogsRow {
  cogs: string | number;
}

interface SalesMetrics {
  totalRevenue: string;
  orderCount: number;
  customerCount: number;
  avgOrderValue: number;
  revenueDelta: string;
  revenueTrend: 'up' | 'down' | 'neutral';
}

interface CustomerMetrics {
  champions: number;
  atRisk: number;
  highChurnRisk: number;
  avgLifetimeValue: number;
}

interface InventoryMetrics {
  turnoverRate: string | null;
  turnoverTrend: 'up' | 'down' | 'neutral';
  turnoverDelta: string;
  available: boolean;
}

const getErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export class StrategicReportsHandler {
  static async generate(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    try {
      const { startDate, endDate, includeNarrative = true } = (request.body as StrategyReportRequest) || {};

      const end = endDate ? new Date(endDate) : new Date();
      const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);

      const app = request.server;

      const salesMetrics = await StrategicReportsHandler.calculateSalesMetrics(app, start, end);
      const customerMetrics = await StrategicReportsHandler.calculateCustomerMetrics(app, start);
      const inventoryMetrics = await StrategicReportsHandler.calculateInventoryMetrics(app, start, end);

      const level0Widgets: KPIWidget[] = [
        {
          name: 'Tasa de Pedido Perfecto',
          value: 'No disponible',
          trend: 'neutral',
          delta: '-',
          available: false,
          reason: 'Requiere datos de entregas y órdenes de compra'
        },
        {
          name: 'Ciclo de Conversión de Efectivo',
          value: 'No disponible',
          trend: 'neutral',
          delta: '-',
          available: false,
          reason: 'Requiere datos de compras y pagos'
        },
        {
          name: 'Ingresos Totales',
          value: salesMetrics.totalRevenue,
          trend: salesMetrics.revenueTrend,
          delta: salesMetrics.revenueDelta,
          drilldownPath: '/gerencia/revenue-breakdown',
          available: true
        },
        {
          name: 'Rotación de Inventario',
          value: inventoryMetrics.turnoverRate || 'No disponible',
          trend: inventoryMetrics.turnoverTrend,
          delta: inventoryMetrics.turnoverDelta,
          available: inventoryMetrics.available,
          reason: inventoryMetrics.available ? undefined : 'Requiere datos de inventario'
        },
        {
          name: 'Valor Agregado por IA',
          value: 'No disponible',
          trend: 'neutral',
          delta: '-',
          available: false,
          reason: 'Requiere datos de recomendaciones y pronósticos'
        }
      ];

      const aiNarrative = includeNarrative
        ? StrategicReportsHandler.generateNarrative(salesMetrics, customerMetrics)
        : '';

      const criticalAlerts = StrategicReportsHandler.generateAlerts(salesMetrics, customerMetrics);

      const response: StrategyReportResponse = {
        reportDate: new Date().toISOString(),
        period: {
          start: start.toISOString(),
          end: end.toISOString()
        },
        level0Widgets,
        aiNarrative,
        criticalAlerts
      };

      return reply.status(200).send(response);
    } catch (error: unknown) {
      request.log.error({ err: error }, 'Error generating strategic report:');
      return reply.status(500).send({
        error: 'Error al generar reporte estratégico',
        message: getErrorMessage(error)
      });
    }
  }

  private static async calculateSalesMetrics(prisma: AppWithPrisma, start: Date, end: Date): Promise<SalesMetrics> {
    try {
      const currentPeriod = await QueryBuilder.executeWithDebug<SalesMetricsRow[]>(
        prisma.prisma,
        `
        SELECT 
          COALESCE(SUM(total_price), 0) as revenue,
          COALESCE(COUNT(DISTINCT sale_id), 0) as order_count,
          COALESCE(COUNT(DISTINCT client_id), 0) as customer_count,
          COALESCE(AVG(total_price), 0) as avg_order_value
        FROM sales_partitioned
        WHERE sale_datetime >= $1 
          AND sale_datetime <= $2
          AND is_deleted = false
      `,
        [start, end],
        'StrategicReportsHandler.calculateSalesMetrics.currentPeriod'
      );

      const periodDays = Math.max(1, Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)));
      const priorStart = new Date(start.getTime() - periodDays * 24 * 60 * 60 * 1000);
      
      const priorPeriod = await QueryBuilder.executeWithDebug<SalesPriorRow[]>(
        prisma.prisma,
        `
        SELECT 
          COALESCE(SUM(total_price), 0) as revenue,
          COALESCE(COUNT(DISTINCT sale_id), 0) as order_count
        FROM sales_partitioned
        WHERE sale_datetime >= $1 
          AND sale_datetime < $2
          AND is_deleted = false
      `,
        [priorStart, start],
        'StrategicReportsHandler.calculateSalesMetrics.priorPeriod'
      );

      const currentRow = currentPeriod[0];
      const priorRow = priorPeriod[0];
      
      const currentRevenue = Number(currentRow?.revenue ?? 0);
      const priorRevenue = Number(priorRow?.revenue ?? 0);
      
      const revenueDelta = priorRevenue > 0 
        ? ((currentRevenue - priorRevenue) / priorRevenue * 100).toFixed(1)
        : '0.0';

      const trend: SalesMetrics['revenueTrend'] = currentRevenue > priorRevenue
        ? 'up'
        : currentRevenue < priorRevenue
          ? 'down'
          : 'neutral';

      return {
        totalRevenue: new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(currentRevenue),
        orderCount: Number(currentRow?.order_count ?? 0),
        customerCount: Number(currentRow?.customer_count ?? 0),
        avgOrderValue: Number(currentRow?.avg_order_value ?? 0),
        revenueDelta: `${revenueDelta}%`,
        revenueTrend: trend
      };
    } catch (error: unknown) {
      prisma.log.error({ err: error }, 'Error calculating sales metrics:');
      return {
        totalRevenue: 'Q0.00',
        orderCount: 0,
        customerCount: 0,
        avgOrderValue: 0,
        revenueDelta: '0%',
        revenueTrend: 'neutral'
      };
    }
  }

  private static async calculateCustomerMetrics(prisma: AppWithPrisma, start: Date): Promise<CustomerMetrics> {
    try {
      const result = await QueryBuilder.executeWithDebug<CustomerMetricsRow[]>(
        prisma.prisma,
        `
        SELECT 
          COUNT(DISTINCT CASE WHEN segment = 'Champions' THEN client_id END) as champions,
          COUNT(DISTINCT CASE WHEN segment = 'At Risk' THEN client_id END) as at_risk,
          COUNT(DISTINCT CASE WHEN churn_risk_score > 70 THEN client_id END) as high_churn_risk,
          COALESCE(AVG(lifetime_value), 0) as avg_lifetime_value
        FROM clients
        WHERE is_deleted = false
          AND last_purchase_date >= $1
      `,
        [start],
        'StrategicReportsHandler.calculateCustomerMetrics'
      );

      const row = result[0];

      return {
        champions: Number(row?.champions ?? 0),
        atRisk: Number(row?.at_risk ?? 0),
        highChurnRisk: Number(row?.high_churn_risk ?? 0),
        avgLifetimeValue: Number(row?.avg_lifetime_value ?? 0)
      };
    } catch (error: unknown) {
      prisma.log.error({ err: error }, 'Error calculating customer metrics:');
      return {
        champions: 0,
        atRisk: 0,
        highChurnRisk: 0,
        avgLifetimeValue: 0
      };
    }
  }

  private static async calculateInventoryMetrics(prisma: AppWithPrisma, start: Date, end: Date): Promise<InventoryMetrics> {
    try {
      const salesData = await QueryBuilder.executeWithDebug<InventoryCogsRow[]>(
        prisma.prisma,
        `
        SELECT 
          COALESCE(SUM(quantity * p.cost), 0) as cogs
        FROM sales_partitioned s
        JOIN products p ON s.product_id = p.product_id
        WHERE s.sale_datetime >= $1 
          AND s.sale_datetime <= $2
          AND s.is_deleted = false
          AND p.is_deleted = false
          AND p.cost IS NOT NULL
      `,
        [start, end],
        'StrategicReportsHandler.calculateInventoryMetrics'
      );

      const row = salesData[0];
      const cogs = Number(row?.cogs ?? 0);

      if (cogs === 0) {
        return {
          turnoverRate: null,
          turnoverTrend: 'neutral',
          turnoverDelta: '-',
          available: false
        };
      }

      return {
        turnoverRate: 'No disponible',
        turnoverTrend: 'neutral',
        turnoverDelta: '-',
        available: false
      };
    } catch (error: unknown) {
      prisma.log.error({ err: error }, 'Error calculating inventory metrics:');
      return {
        turnoverRate: null,
        turnoverTrend: 'neutral',
        turnoverDelta: '-',
        available: false
      };
    }
  }

  private static generateNarrative(
    salesMetrics: SalesMetrics,
    customerMetrics: CustomerMetrics
  ): string {
    const narrativeParts: string[] = [];

    // Revenue narrative
    if (salesMetrics.orderCount > 0) {
      const trendWord =
        salesMetrics.revenueTrend === 'up'
          ? 'aumentaron'
          : salesMetrics.revenueTrend === 'down'
            ? 'disminuyeron'
            : 'se mantuvieron estables';
      narrativeParts.push(
        `En el período analizado, los ingresos ${trendWord} ${salesMetrics.revenueDelta} alcanzando ${salesMetrics.totalRevenue}. `
      );
    } else {
      narrativeParts.push('No hay datos de ventas disponibles para el período seleccionado. ');
    }

    // Customer narrative
    if (customerMetrics.champions > 0) {
      narrativeParts.push(
        `Actualmente tenemos ${customerMetrics.champions} clientes Champions, nuestro segmento más valioso. `
      );
    }

    if (customerMetrics.atRisk > 0) {
      narrativeParts.push(
        `⚠️ ${customerMetrics.atRisk} clientes están en riesgo de abandono y requieren atención inmediata. `
      );
    }

    // Data limitations
    narrativeParts.push(
      '\n\nLimitaciones actuales: Para un análisis completo, se requieren datos de órdenes de compra, inventario y entregas.'
    );

    return narrativeParts.join('');
  }

  private static generateAlerts(salesMetrics: SalesMetrics, customerMetrics: CustomerMetrics) {
    const alerts: Array<{
      severity: 'high' | 'medium' | 'low';
      title: string;
      message: string;
    }> = [];

    // Revenue decline alert
    const revenueDeltaNum = parseFloat(salesMetrics.revenueDelta);
    if (revenueDeltaNum < -10) {
      alerts.push({
        severity: 'high',
        title: 'Caída Significativa en Ingresos',
        message: `Los ingresos han caído ${Math.abs(revenueDeltaNum).toFixed(1)}% comparado con el período anterior. Se recomienda análisis inmediato de causas.`
      });
    }

    // Customer churn alert
    if (customerMetrics.highChurnRisk > 0) {
      alerts.push({
        severity: 'high',
        title: 'Alerta de Abandono de Clientes',
        message: `${customerMetrics.highChurnRisk} clientes tienen alto riesgo de abandono. Se recomienda intervención inmediata.`
      });
    }

    // Data availability alert
    alerts.push({
      severity: 'medium',
      title: 'Datos Incompletos',
      message: 'Algunos KPIs no están disponibles debido a datos faltantes de compras, inventario y entregas. Complete la integración de datos para análisis completo.'
    });

    return alerts;
  }
}
